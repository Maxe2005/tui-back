// core/scripts/group-update/all: the all-repos flow: every registered repo, narrowed by the confirmed selection.
import { basename, resolve } from "node:path";
import { withActionLock } from "../../locking.js";
import type { ManifestPort } from "../../ports/manifest.js";
import { err, ok, type Result } from "../../result.js";
import { runPool, type StageControl } from "../run-pool.js";
import type {
  GroupUpdateRepoResult,
  GroupUpdateData,
  GroupUpdateSelectionItem,
  GroupUpdateParams,
} from "./types.js";
import { foldCancel, emitServiceResult } from "./observers.js";
import {
  GROUP_UPDATE_LOCK_KEY,
  matchSelectionItem,
  effectiveSourceBranch,
  validateSelectionBranches,
} from "./selection.js";
import {
  runCancelledRow,
  pausingSeam,
  unexpectedError,
  failed,
  skipped,
} from "./outcome.js";
import { updateWithLoadedManifest } from "./member.js";

export async function groupUpdateAll(
  params: GroupUpdateParams,
): Promise<Result<GroupUpdateData>> {
  const {
    manifest,
    git,
    container,
    migration,
    restart,
    lock,
    registry,
    selection,
  } = params;
  const runMigrations = params.runMigrations ?? true;
  const cleanRestart = params.cleanRestart ?? false;
  if (registry === undefined) {
    return err(
      "internal-error",
      "Registry port is required for an all-repos group update",
    );
  }

  const listed = await registry.list();
  if (!listed.ok) {
    return listed;
  }

  // Dedupe by resolved path (first wins) — the same normalization the EDT path uses, so
  // trailing-slash/relative-segment variants of one repo still collapse. Blank entries
  // never reach the filesystem: resolving '' would target the process cwd.
  const seen = new Set<string>();
  const paths = listed.data
    .filter((candidate) => candidate.trim() !== "")
    .filter((candidate) => {
      const key = resolve(candidate);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

  // Zero registry entries: explicit no-op before any lock is taken (nothing to serialize).
  if (paths.length === 0) {
    return ok({
      ulid: "all",
      topic: "all-repos",
      results: [],
      note: "No managed repos found — nothing to update.",
      scope: "all",
    });
  }

  // Narrow the enumerated paths down to the confirmed selection before any lock is taken —
  // deselected services are excluded entirely (never touched, never reported). Reads only
  // (manifest loads for service-name matching, local branch checks); no git write, no
  // migration, no restart below this point runs for an excluded service — or at all when the
  // selection rejects the run outright.
  let targets: {
    repoPath: string;
    sourceBranch: string | undefined;
    runMigrations?: boolean;
    cleanRestart?: boolean;
  }[] = paths.map((repoPath) => ({
    repoPath,
    sourceBranch: undefined,
  }));
  if (selection !== undefined) {
    if (selection.length === 0) {
      return err(
        "no-services-selected",
        "No services selected — select at least one service before confirming.",
      );
    }
    const narrowed = await narrowAllTargets(manifest, paths, selection);
    if (narrowed.length === 0) {
      return err(
        "no-services-selected",
        "None of the selected services match a managed repo — nothing to update.",
      );
    }
    const branchCheck = await validateSelectionBranches(
      git,
      narrowed.map((target) => ({
        service: target.service,
        repoPath: target.repoPath,
        sourceBranch: target.sourceBranch,
      })),
    );
    if (!branchCheck.ok) {
      return branchCheck;
    }
    targets = narrowed;
  }

  const run = await withActionLock(lock, GROUP_UPDATE_LOCK_KEY, async () => {
    const rows = await runPool<(typeof targets)[number], GroupUpdateRepoResult>(
      targets,
      {
        concurrency: params.concurrency ?? 1,
        keyOf: (target) => resolve(target.repoPath),
        ...(params.ordering !== undefined
          ? {
              stageOf: (target) =>
                params.ordering?.({
                  service: serviceFallback(target.repoPath),
                  repoPath: target.repoPath,
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
        onCancelled: async (target) => {
          const loaded = await manifest.load(target.repoPath);
          if (!loaded.ok && loaded.error.code === "manifest-not-found") {
            return undefined;
          }
          const service = loaded.ok
            ? loaded.data.service
            : serviceFallback(target.repoPath);
          const row = loaded.ok
            ? runCancelledRow(service, target.repoPath, "before it started")
            : failed(service, loaded.error);
          emitServiceResult(params.onServiceResult, row);
          return row;
        },
        onError: (target, error) => {
          const row = failed(
            serviceFallback(target.repoPath),
            unexpectedError(error),
          );
          emitServiceResult(params.onServiceResult, row);
          return row;
        },
      },
      async (target, control) => {
        const { repoPath } = target;
        const loaded = await manifest.load(repoPath);
        if (!loaded.ok) {
          // Genuinely unmanaged — silently skipped, the list-repos manifest-not-found pattern.
          if (loaded.error.code === "manifest-not-found") {
            return undefined;
          }
          return failed(serviceFallback(repoPath), loaded.error);
        }
        // `cancel-run` stops the pool but still returns `ok` with rows so far (a cancelled repo
        // is `skipped`, never `failed`).
        const outcome = await updateWithLoadedManifest(
          loaded.data,
          git,
          container,
          migration,
          restart,
          undefined,
          repoPath,
          loaded.data.service,
          undefined,
          pausingSeam(params.onUpdateBlocker, control),
          effectiveSourceBranch(loaded.data.sharedBranch, target.sourceBranch),
          target.runMigrations ?? runMigrations,
          target.cleanRestart ?? cleanRestart,
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
    // Every registered path was unmanaged — an explicit no-op, never silent success.
    if (results.length === 0) {
      return ok({
        ulid: "all",
        topic: "all-repos",
        results: [],
        note: "No managed repos found — nothing to update.",
        scope: "all" as const,
      });
    }
    return ok({
      ulid: "all",
      topic: "all-repos",
      results,
      scope: "all" as const,
    });
  });
  if (!run.ok && run.error.code === "action-in-progress") {
    return err(
      "update-already-running",
      "A group update is already in progress — wait for it to finish before starting another.",
    );
  }
  return run;
}

function serviceFallback(repoPath: string): string {
  const base = basename(repoPath);
  return base !== "" ? base : repoPath;
}

// Narrows all-repos enumeration to the confirmed selection. Items carrying
// `repoPath` match by resolved path; the rest match by loaded manifest service (an
// unloadable manifest falls back to the path-basename service, the same label the run
// loop would report its failure under, so a genuine load error still surfaces as a
// `failed` row rather than going silent). First match wins; unmatched items are dropped.
async function narrowAllTargets(
  manifest: ManifestPort,
  paths: readonly string[],
  selection: readonly GroupUpdateSelectionItem[],
): Promise<
  {
    service: string;
    repoPath: string;
    sourceBranch: string | undefined;
    runMigrations?: boolean;
    cleanRestart?: boolean;
  }[]
> {
  const services = new Map<string, string>();
  for (const repoPath of paths) {
    const loaded = await manifest.load(repoPath);
    services.set(
      repoPath,
      loaded.ok ? loaded.data.service : serviceFallback(repoPath),
    );
  }
  const seen = new Set<string>();
  const targets: {
    service: string;
    repoPath: string;
    sourceBranch: string | undefined;
    runMigrations?: boolean;
    cleanRestart?: boolean;
  }[] = [];
  for (const repoPath of paths) {
    const item = matchSelectionItem(selection, {
      service: services.get(repoPath) ?? serviceFallback(repoPath),
      repoPath,
    });
    if (item === undefined) {
      continue;
    }
    const key = resolve(repoPath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push({
      service: services.get(repoPath) ?? serviceFallback(repoPath),
      repoPath,
      sourceBranch: item.sourceBranch,
      ...(item.runMigrations !== undefined
        ? { runMigrations: item.runMigrations }
        : {}),
      ...(item.cleanRestart !== undefined
        ? { cleanRestart: item.cleanRestart }
        : {}),
    });
  }
  return targets;
}
