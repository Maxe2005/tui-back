// core/scripts/group-update/edt: the EDT flow: every member service of the active EDT.
import { resolve } from "node:path";
import { withActionLock } from "../../../../locking.js";
import { err, ok, type Result } from "../../../../result.js";
import { runPool, type StageControl } from "../../update-support/run-pool.js";
import type {
  GroupUpdateRepoResult,
  GroupUpdateData,
  GroupUpdateParams,
} from "./types.js";
import { foldCancel, emitServiceResult } from "./observers.js";
import {
  GROUP_UPDATE_LOCK_KEY,
  edtUpdateLockKey,
  matchSelectionItem,
  validateSelectionBranches,
} from "./selection.js";
import {
  runCancelledRow,
  pausingSeam,
  unexpectedError,
  failed,
  skipped,
} from "./outcome.js";
import { updateMember } from "./member.js";

export async function groupUpdateEdt(
  params: GroupUpdateParams,
): Promise<Result<GroupUpdateData>> {
  const {
    edtRegistry,
    state,
    manifest,
    git,
    container,
    migration,
    restart,
    lock,
    selection,
  } = params;
  const runMigrations = params.runMigrations ?? true;
  const cleanRestart = params.cleanRestart ?? false;

  const currentActive = await state.readActiveEdt();
  if (!currentActive.ok) {
    return currentActive;
  }
  if (currentActive.data === null) {
    return err(
      "no-active-edt",
      "No active EDT — switch to an EDT before running tui-back update",
    );
  }

  const listed = await edtRegistry.list();
  if (!listed.ok) {
    return listed;
  }
  const active = listed.data.find(
    (candidate) => candidate.ulid === currentActive.data,
  );
  if (active === undefined) {
    return err(
      "edt-not-found",
      `Active EDT "${currentActive.data}" is no longer registered`,
    );
  }

  // Zero-member scope is an explicit no-op message, never silent success — resolved before
  // any lock is taken since a no-op run writes nothing that needs serializing.
  if (active.members.length === 0) {
    return ok({
      ulid: active.ulid,
      topic: active.topic,
      results: [],
      note: `EDT "${active.topic}" has no member services — nothing to update.`,
      scope: "edt" as const,
    });
  }

  // Narrow the EDT members down to the confirmed selection before any lock is taken —
  // deselected services are excluded entirely (never touched, never reported). Reads only (a
  // local branch check per custom sourceBranch); the unexpected-branch gate and
  // assertAllowedBranch gating below still apply.
  type ConfiguredMember = {
    member: (typeof active.members)[number];
    sourceBranch: string | undefined;
    runMigrations?: boolean;
    cleanRestart?: boolean;
  };
  let configured: ConfiguredMember[] | null = null;
  if (selection !== undefined) {
    if (selection.length === 0) {
      return err(
        "no-services-selected",
        "No services selected — select at least one service before confirming.",
      );
    }
    const seenSelection = new Set<string>();
    const kept: ConfiguredMember[] = [];
    for (const member of active.members) {
      const key = resolve(member.repoPath);
      if (seenSelection.has(key)) {
        continue;
      }
      seenSelection.add(key);
      const item = matchSelectionItem(selection, member);
      if (item === undefined) {
        continue;
      }
      kept.push({
        member,
        sourceBranch: item.sourceBranch,
        ...(item.runMigrations !== undefined
          ? { runMigrations: item.runMigrations }
          : {}),
        ...(item.cleanRestart !== undefined
          ? { cleanRestart: item.cleanRestart }
          : {}),
      });
    }
    if (kept.length === 0) {
      return err(
        "no-services-selected",
        `None of the selected services are members of EDT "${active.topic}" — nothing to update.`,
      );
    }
    const branchCheck = await validateSelectionBranches(
      git,
      kept.map(({ member, sourceBranch }) => ({
        service: member.service,
        repoPath: member.repoPath,
        sourceBranch,
      })),
    );
    if (!branchCheck.ok) {
      return branchCheck;
    }
    configured = kept;
  }

  const run = await withActionLock(lock, GROUP_UPDATE_LOCK_KEY, () =>
    withActionLock(lock, edtUpdateLockKey(active.ulid), async () => {
      // Duplicate repoPath entries in one EDT would be merged/restarted twice — dedupe by
      // repoPath (first wins) before the loop so every targeted repo is touched exactly
      // once. Paths are resolved before comparing, the same normalization switch.ts uses,
      // so trailing-slash/relative-segment variants of one repo still collapse.
      const seen = new Set<string>();
      const shortlist =
        configured !== null
          ? configured
          : active.members.map((member): ConfiguredMember => ({
              member,
              sourceBranch: undefined,
            }));
      const enlisted = shortlist.filter(({ member }) => {
        const key = resolve(member.repoPath);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      const rows = await runPool<ConfiguredMember, GroupUpdateRepoResult>(
        enlisted,
        {
          concurrency: params.concurrency ?? 1,
          keyOf: ({ member }) => resolve(member.repoPath),
          ...(params.ordering !== undefined
            ? {
                stageOf: ({ member }) =>
                  params.ordering?.({
                    service: member.service,
                    repoPath: member.repoPath,
                  }) ?? 0,
              }
            : {}),
          ...(params.afterStage !== undefined
            ? {
                afterStage: (
                  stage: number,
                  stageRows: (GroupUpdateRepoResult | undefined)[],
                  control: StageControl,
                ) =>
                  params.afterStage?.(
                    stage,
                    stageRows.filter(
                      (row): row is GroupUpdateRepoResult => row !== undefined,
                    ),
                    control,
                  ),
              }
            : {}),
          onCancelled: ({ member }) => {
            const row = runCancelledRow(
              member.service,
              member.repoPath,
              "before it started",
            );
            emitServiceResult(params.onServiceResult, row);
            return row;
          },
          onError: ({ member }, error) => {
            const row = failed(member.service, unexpectedError(error));
            emitServiceResult(params.onServiceResult, row);
            return row;
          },
        },
        async (
          {
            member,
            sourceBranch,
            runMigrations: memberMigrations,
            cleanRestart: memberCleanRestart,
          },
          control,
        ) => {
          // `cancel-run` stops the pool but still returns `ok` with rows so far.
          const outcome = await updateMember(
            manifest,
            git,
            container,
            migration,
            restart,
            active.ulid,
            member,
            pausingSeam(params.onUpdateBlocker, control),
            sourceBranch,
            memberMigrations ?? runMigrations,
            memberCleanRestart ?? cleanRestart,
            params.onPhase,
            foldCancel(control, params.shouldCancel),
            params.autoResolveConflict,
          );
          if (outcome.cancelRun) {
            control.cancel();
          }
          emitServiceResult(params.onServiceResult, outcome.row);
          return outcome.row;
        },
      );
      const results = rows.filter(
        (row): row is GroupUpdateRepoResult => row !== undefined,
      );
      // A fully successful run clears a previously set `interrupted` status so the re-run
      // offer doesn't persist forever: results exist and none failed (a `skipped` row
      // doesn't block the clear — the services that could update did). The zero-member
      // no-op returns before any lock is taken, so it never reaches — or clears — here.
      if (
        results.length > 0 &&
        results.every((row) => row.outcome !== "failed") &&
        active.status === "interrupted"
      ) {
        const reactivated = await edtRegistry.setStatus(active.ulid, "active");
        if (!reactivated.ok) {
          // The merges above already applied — keep their rows as error details rather
          // than discarding them (the switch.ts writeActiveEdt-failure precedent).
          return err(reactivated.error.code, reactivated.error.message, {
            results,
          });
        }
      }
      return ok({
        ulid: active.ulid,
        topic: active.topic,
        results,
        scope: "edt" as const,
      });
    }),
  );
  if (!run.ok && run.error.code === "action-in-progress") {
    return err(
      "update-already-running",
      "A group update is already in progress — wait for it to finish before starting another.",
    );
  }
  return run;
}
