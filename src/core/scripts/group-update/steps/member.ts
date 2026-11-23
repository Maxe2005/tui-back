// core/scripts/group-update/member: the per-service pipeline: pull/merge, migrate, restart.
import type { ContainerPort } from "../../../ports/runtime/container.js";
import type { GitPort } from "../../../ports/vcs/git.js";
import type { Manifest, ManifestPort } from "../../../ports/vcs/manifest.js";
import type { MigrationPort } from "../../../ports/vcs/migration.js";
import type { RestartPort } from "../../../ports/runtime/restart.js";
import { ok } from "../../../result.js";
import type {
  GroupUpdateRunDetail,
  AutoResolveConflict,
  OnUpdateBlocker,
  OnUpdatePhase,
} from "./types.js";
import { emitPhase, MIGRATION_FAILED_CODE } from "./observers.js";
import { effectiveSourceBranch } from "./selection.js";
import { runRestartStep } from "./restart.js";
import type { RepoOutcome } from "./outcome.js";
import { runCancelledRow, failed, skipped, failedOutcome } from "./outcome.js";
import {
  isLockfileOnly,
  settlePreexistingMidState,
  resolveDirtyBlocker,
  resolveUnpushedCommits,
} from "./blockers.js";
import { resolveMidRunConflict } from "./conflict.js";
import { isSystemEdt } from "../../../edt/shared-edt/shared-edt.js";

const OUTPUT_EXCERPT_LINES = 3;

const OUTPUT_EXCERPT_MAX_CHARS = 200;

// Last non-empty lines of the trimmed output (ANSI escapes stripped), capped from the tail so
// the final line — usually the informative one — survives a chatty migration.
export function outputExcerpt(output: string): string {
  const lines = output
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
  return lines
    .slice(-OUTPUT_EXCERPT_LINES)
    .join("\n")
    .slice(-OUTPUT_EXCERPT_MAX_CHARS);
}

// Compares HEAD before/after the pull/merge. A failing read on either side yields no detail;
// a failing diff keeps `advanced` without counts. Never affects the row's outcome.
async function readMergeDetail(
  git: GitPort,
  repoPath: string,
  before: string | undefined,
): Promise<GroupUpdateRunDetail["merge"] | undefined> {
  if (before === undefined) {
    return undefined;
  }
  const after = await git.headRevision(repoPath);
  if (!after.ok) {
    return undefined;
  }
  if (after.data === before) {
    return { kind: "up-to-date" };
  }
  const stat = await git.diffStat(repoPath, before, after.data);
  if (!stat.ok) {
    return { kind: "advanced" };
  }
  return {
    kind: "advanced",
    files: stat.data.files,
    insertions: stat.data.insertions,
    deletions: stat.data.deletions,
  };
}

export async function updateMember(
  manifest: ManifestPort,
  git: GitPort,
  container: ContainerPort,
  migration: MigrationPort,
  restart: RestartPort,
  edtUlid: string,
  member: { service: string; repoPath: string; branch: string },
  onUpdateBlocker?: OnUpdateBlocker,
  sourceBranch?: string,
  runMigrations = true,
  cleanRestart = false,
  onPhase?: OnUpdatePhase,
  shouldStop?: () => boolean,
  autoResolveConflict?: AutoResolveConflict,
): Promise<RepoOutcome> {
  const { service, repoPath, branch } = member;

  const loaded = await manifest.load(repoPath);
  if (!loaded.ok) {
    return { row: failed(service, loaded.error), cancelRun: false };
  }

  return updateWithLoadedManifest(
    loaded.data,
    git,
    container,
    migration,
    restart,
    edtUlid,
    repoPath,
    service,
    branch,
    onUpdateBlocker,
    effectiveSourceBranch(loaded.data.sharedBranch, sourceBranch),
    runMigrations,
    cleanRestart,
    onPhase,
    shouldStop,
    autoResolveConflict,
  );
}

// Shared per-service flow for both scopes: pull/merge → migrate → restart. The EDT scope
// passes its recorded `branch` plus its ulid (unexpected-branch gate + gated write); the
// all-repos scope passes neither, operating on `currentBranch` as-is (`==sourceBranch` →
// `pull`, else `fetch` + ungated `assertAllowedBranch` + `mergeBranch`). The migrate phase runs
// only when `runMigrations` is on; `cleanRestart` runs the `restartCommands` recipe when
// declared.
//
// Assisted resolution: lockfile-only dirt is silently discarded (seam or not); a pre-existing
// mid-merge/mid-rebase surfaces as its own state before any menu and is never aborted; any
// other dirty worktree or mid-run conflict pauses on the `onUpdateBlocker` seam when present
// (without it, the repo is skipped or its merge aborted). Every resumed repo is re-verified
// before continuing; one repo's resolution never touches another repo.
export async function updateWithLoadedManifest(
  loaded: Manifest,
  git: GitPort,
  container: ContainerPort,
  migration: MigrationPort,
  restart: RestartPort,
  edtUlid: string | undefined,
  repoPath: string,
  service: string,
  expectedBranch: string | undefined,
  onUpdateBlocker?: OnUpdateBlocker,
  sourceBranch?: string,
  runMigrations = true,
  cleanRestart = false,
  onPhase?: OnUpdatePhase,
  shouldStop?: () => boolean,
  autoResolveConflict?: AutoResolveConflict,
): Promise<RepoOutcome> {
  const {
    container: containerName,
    migrationCommand,
    restartCommands,
  } = loaded;
  // A cancelled run lets in-flight services finish their current step, then stops them before
  // the next one — no subprocess is ever killed.
  const stopped = (when: string): RepoOutcome | undefined =>
    shouldStop?.() === true
      ? { row: runCancelledRow(service, repoPath, when), cancelRun: false }
      : undefined;
  const stoppedEarly = stopped("before it started");
  if (stoppedEarly !== undefined) {
    return stoppedEarly;
  }
  // The configured merge source — the manifest `sharedBranch` unless the pre-run screen
  // confirmed a per-service override (trimmed once inside `effectiveSourceBranch`, so padding
  // never reaches fetch/merge). Merge stays `git merge`, never rebase.
  const mergeSource = effectiveSourceBranch(loaded.sharedBranch, sourceBranch);

  const current = await git.currentBranch(repoPath);
  if (!current.ok) {
    return failedOutcome(service, current.error);
  }

  // EDT scope only: the repo must sit on the member's own recorded branch — merging into
  // (or pulling) whatever happens to be checked out would update the wrong line of work.
  // No git write and no restart below this point runs for this repo.
  if (expectedBranch !== undefined && current.data !== expectedBranch) {
    // The system "Shared branches" EDT expects every repo on its shared branch; one checked out
    // elsewhere since the switch is reported and skipped — never switched silently, never failed.
    if (isSystemEdt(edtUlid)) {
      return skipped(
        service,
        "not-on-shared-branch",
        `Repo ${repoPath} is on branch "${current.data}", not on its shared branch "${expectedBranch}" — skipped, left untouched`,
      );
    }
    return {
      row: {
        service,
        outcome: "failed",
        detail: {
          code: "unexpected-branch",
          message: `Repo ${repoPath} is on branch "${current.data}" but the EDT expects "${expectedBranch}" — left untouched`,
        },
      },
      cancelRun: false,
    };
  }

  // A pre-existing mid-merge/mid-rebase is detected as its own case before the dirty gate and
  // before any pull/merge of this run. Core aborts only merges the current run started — this
  // state is never aborted, only reported (seam or not), with the menu applying after the
  // report.
  const settledPreexisting = await settlePreexistingMidState(
    service,
    repoPath,
    git,
    onUpdateBlocker,
  );
  if (!settledPreexisting.resumed) {
    return settledPreexisting.cancelRun
      ? { row: settledPreexisting.row, cancelRun: true }
      : { row: settledPreexisting.row, cancelRun: false };
  }

  // Dirty gate: lockfile-only dirt is discarded silently (seam or not) and the repo proceeds;
  // any other dirt pauses on the seam when present, else is a `skipped`/`dirty-worktree` row.
  const dirtyPaths = await git.listDirtyPaths(repoPath);
  if (!dirtyPaths.ok) {
    return failedOutcome(service, dirtyPaths.error);
  }
  if (dirtyPaths.data.length > 0) {
    if (isLockfileOnly(dirtyPaths.data)) {
      const discarded = await git.discardPaths(repoPath, dirtyPaths.data);
      if (!discarded.ok) {
        return failedOutcome(service, discarded.error);
      }
      const rechecked = await git.listDirtyPaths(repoPath);
      if (!rechecked.ok) {
        return failedOutcome(service, rechecked.error);
      }
      // Still dirty after the auto-fix (e.g. untracked lockfiles a path-scoped checkout
      // cannot restore) — handled as ordinary dirt below, never looped silently.
      if (rechecked.data.length > 0) {
        const outcome = await resolveDirtyBlocker(
          service,
          repoPath,
          git,
          onUpdateBlocker,
        );
        if (!outcome.resumed) {
          return outcome.cancelRun
            ? { row: outcome.row, cancelRun: true }
            : { row: outcome.row, cancelRun: false };
        }
      }
    } else {
      const outcome = await resolveDirtyBlocker(
        service,
        repoPath,
        git,
        onUpdateBlocker,
      );
      if (!outcome.resumed) {
        return outcome.cancelRun
          ? { row: outcome.row, cancelRun: true }
          : { row: outcome.row, cancelRun: false };
      }
    }
  }

  const stoppedBeforeMerge = stopped("before its merge");
  if (stoppedBeforeMerge !== undefined) {
    return stoppedBeforeMerge;
  }
  const headBefore = await git.headRevision(repoPath);
  let conflictOutcome: GroupUpdateRunDetail["conflict"];

  if (current.data === mergeSource) {
    // The live current-step signal for the pull path.
    emitPhase(onPhase, service, "pulling");
    const pulled = await git.pull(repoPath);
    if (!pulled.ok) {
      // A conflicting pull leaves the repo mid-merge exactly like a conflicting merge does —
      // without a seam, abort back to the pre-run HEAD and report it as such; with a seam,
      // the bounded resolution menu applies. Any other pull failure keeps its own code.
      const merging = await git.isMergeInProgress(repoPath);
      if (merging.ok && merging.data) {
        const settlement = await resolveMidRunConflict(
          service,
          git,
          repoPath,
          { code: "merge-conflict", message: pulled.error.message },
          onUpdateBlocker,
          "pull",
          mergeSource,
          autoResolveConflict,
          shouldStop,
        );
        // A resumed conflict rejoins the pipeline below (migrate → restart); a settled
        // one already carries its row.
        if (settlement.done) {
          return settlement.outcome;
        }
        conflictOutcome = settlement.conflict;
      } else {
        return failedOutcome(service, pulled.error);
      }
    }
  } else {
    // The live current-step signal for the fetch+merge path.
    emitPhase(onPhase, service, "merging");
    const fetched = await git.fetch(repoPath, mergeSource);
    if (!fetched.ok) {
      const settlement = await resolveUnpushedCommits(
        service,
        git,
        repoPath,
        mergeSource,
        fetched.error,
        onUpdateBlocker,
      );
      if (!settlement.resumed) {
        return { row: settlement.row, cancelRun: settlement.cancelRun };
      }
    }
    // Re-verify before any git write (AD-8) — never assume the member branch is still safe.
    // All-repos scope passes no edtId: the shared-branch gate still applies, the cross-EDT
    // half is skipped.
    const allowed = await git.assertAllowedBranch(
      repoPath,
      current.data,
      edtUlid,
    );
    if (!allowed.ok) {
      return failedOutcome(service, allowed.error);
    }
    const merged = await git.mergeBranch(repoPath, mergeSource);
    if (!merged.ok) {
      if (merged.error.code === "merge-conflict") {
        const settlement = await resolveMidRunConflict(
          service,
          git,
          repoPath,
          merged.error,
          onUpdateBlocker,
          "merge",
          mergeSource,
          autoResolveConflict,
          shouldStop,
        );
        if (settlement.done) {
          return settlement.outcome;
        }
        conflictOutcome = settlement.conflict;
      } else {
        return failedOutcome(service, merged.error);
      }
    }
  }

  const mergeDetail = await readMergeDetail(
    git,
    repoPath,
    headBefore.ok ? headBefore.data : undefined,
  );
  const runDetail: Partial<GroupUpdateRunDetail> = {};
  if (mergeDetail !== undefined) {
    runDetail.merge = mergeDetail;
  }
  runDetail.migrations = { kind: "none" };
  if (conflictOutcome !== undefined) {
    runDetail.conflict = conflictOutcome;
  }

  // The migrate phase runs between the pull/merge and the restart: the manifest-declared
  // `migrationCommand` (skipped without error when absent or blank) runs with the repo as its
  // working directory, and only when the run-wide migrate toggle is on. A failing migration
  // keeps the repo on its merged code but skips the restart — a `failed` row with
  // `migration-failed` detail naming the command and the error output — and never blocks or
  // rolls back the other services.
  const stoppedBeforeMigration = stopped(
    "after its merge — migration and restart not run",
  );
  if (stoppedBeforeMigration !== undefined) {
    return stoppedBeforeMigration;
  }
  if (
    runMigrations &&
    migrationCommand !== undefined &&
    migrationCommand.trim() !== ""
  ) {
    // The live current-step signal for the migrate phase.
    emitPhase(onPhase, service, "migrating");
    const migrated = await migration.run(repoPath, migrationCommand);
    if (!migrated.ok) {
      return failedOutcome(service, {
        code: MIGRATION_FAILED_CODE,
        message: `Repo ${repoPath} migration "${migrationCommand}" failed: ${migrated.error.message}`,
      });
    }
    runDetail.migrations = {
      kind: "ran",
      command: migrationCommand,
      outputExcerpt: outputExcerpt(migrated.data.output),
    };
  }

  const stoppedBeforeRestart = stopped("before its restart");
  if (stoppedBeforeRestart !== undefined) {
    return stoppedBeforeRestart;
  }
  // The restart phase, shared with the standalone single-service use-case via runRestartStep
  // (which also emits the `restarting` phase).
  const restarted = await runRestartStep({
    container,
    restart,
    containerName,
    restartCommands,
    repoPath,
    cleanRestart,
    service,
    onPhase,
  });
  if (!restarted.ok) {
    if (restarted.error.code === "no-container") {
      // Nothing to restart is not a skipped update: the merge and migrations ran, so the row is
      // `updated` (a container-less shared-types source must still reach its publish phase).
      return {
        row: { service, outcome: "updated", run: runDetail },
        cancelRun: false,
      };
    }
    return failedOutcome(service, restarted.error);
  }

  return {
    row: { service, outcome: "updated", run: runDetail },
    cancelRun: false,
  };
}
