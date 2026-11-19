// core/scripts/group-update/blockers: blocker resolution before/while updating: pre-existing mid-state, dirty worktree, unpushed commits.
import { basename } from "node:path";
import type { GitPort } from "../../ports/git.js";
import { ok, type Result, type ResultError } from "../../result.js";
import type {
  GroupUpdateRepoResult,
  UpdateBlockerKind,
  UpdateBlocker,
  UpdateBlockerChoice,
  OnUpdateBlocker,
} from "./types.js";
import { failed, skipped } from "./outcome.js";

// Lockfile-only dirt (the `update_repo.sh` convention) is silently discarded, everything else
// pauses on the seam. Basename-matched at any depth.
const LOCKFILE_BASENAMES: readonly string[] = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
];

export function isLockfileOnly(paths: readonly string[]): boolean {
  return (
    paths.length > 0 &&
    paths.every((candidate) =>
      LOCKFILE_BASENAMES.includes(basename(candidate.replace(/\/+$/, ""))),
    )
  );
}

// The message tag for seam-driven stashes (message-tagged, not stack-position — safe alongside
// the developer's own unrelated stashes).
const UPDATE_STASH_MESSAGE = "tui-back:update";

// Asks the driving-provided seam for a blocker choice. A throwing seam (a driving-side bug —
// dispatch maps top-level throws to `internal-error`) is folded into a per-service `failed`
// row here instead, so one repo's menu failure never strands the others' rows; an unknown
// choice string is the same class of driving bug.
export async function askSeam(
  onUpdateBlocker: OnUpdateBlocker,
  blocker: UpdateBlocker,
): Promise<{ choice: UpdateBlockerChoice } | { error: ResultError }> {
  try {
    const choice = await onUpdateBlocker(blocker);
    if (
      choice !== "stash" &&
      choice !== "edited" &&
      choice !== "cancel-repo" &&
      choice !== "cancel-run" &&
      choice !== "fetch"
    ) {
      return {
        error: {
          code: "internal-error",
          message: `Update blocker seam returned an unknown choice for repo ${blocker.repoPath}`,
        },
      };
    }
    return { choice };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      error: {
        code: "internal-error",
        message: `Update blocker seam failed for repo ${blocker.repoPath}: ${detail}`,
      },
    };
  }
}

// Re-verifies a repo before resuming it after a `stash`/`edited` choice: no mid-merge, no
// mid-rebase, and zero dirty paths. Real conflict content is never auto-resolved here — this
// only reads state.
export async function reverifyClean(
  git: GitPort,
  repoPath: string,
): Promise<Result<boolean>> {
  const merging = await git.isMergeInProgress(repoPath);
  if (!merging.ok) {
    return merging;
  }
  if (merging.data) {
    return ok(false);
  }
  const rebasing = await git.isRebaseInProgress(repoPath);
  if (!rebasing.ok) {
    return rebasing;
  }
  if (rebasing.data) {
    return ok(false);
  }
  const paths = await git.listDirtyPaths(repoPath);
  if (!paths.ok) {
    return paths;
  }
  return ok(paths.data.length === 0);
}

type BlockerSettlement =
  | { resumed: true }
  | { resumed: false; row: GroupUpdateRepoResult; cancelRun: boolean };

// Pre-existing mid-merge/mid-rebase settlement. Without a seam this is a distinct `skipped`
// row (never the dirty/conflict codes, never aborted); with a seam the same four-choice menu
// applies after the report, and cancel choices never abort the pre-existing state (only
// merges this run started are ever aborted). Resumption means the mid-state cleared —
// ordinary dirt left behind falls through to the dirty gate, which re-reads the tree fresh.
export async function settlePreexistingMidState(
  service: string,
  repoPath: string,
  git: GitPort,
  onUpdateBlocker: OnUpdateBlocker | undefined,
): Promise<BlockerSettlement> {
  const merging = await git.isMergeInProgress(repoPath);
  if (!merging.ok) {
    return {
      resumed: false,
      row: failed(service, merging.error),
      cancelRun: false,
    };
  }
  const rebasing = await git.isRebaseInProgress(repoPath);
  if (!rebasing.ok) {
    return {
      resumed: false,
      row: failed(service, rebasing.error),
      cancelRun: false,
    };
  }
  if (!merging.data && !rebasing.data) {
    return { resumed: true };
  }
  const kind: UpdateBlockerKind = rebasing.data ? "mid-rebase" : "mid-merge";
  const stateName = kind === "mid-rebase" ? "mid-rebase" : "mid-merge";
  if (onUpdateBlocker === undefined) {
    return {
      resumed: false,
      row: {
        service,
        outcome: "skipped",
        detail: {
          code: kind,
          message: `Repo ${repoPath} is ${stateName} — left untouched`,
        },
      },
      cancelRun: false,
    };
  }
  for (;;) {
    const asked = await askSeam(onUpdateBlocker, { service, repoPath, kind });
    if ("error" in asked) {
      return {
        resumed: false,
        row: failed(service, asked.error),
        cancelRun: false,
      };
    }
    if (asked.choice === "cancel-repo") {
      return {
        resumed: false,
        row: {
          service,
          outcome: "skipped",
          detail: {
            code: kind,
            message: `Repo ${repoPath} ${stateName} update cancelled by developer — left as-is`,
          },
        },
        cancelRun: false,
      };
    }
    if (asked.choice === "cancel-run") {
      return {
        resumed: false,
        row: {
          service,
          outcome: "skipped",
          detail: {
            code: kind,
            message: `Repo ${repoPath} ${stateName} update cancelled by developer — left as-is`,
          },
        },
        cancelRun: true,
      };
    }
    if (asked.choice === "stash") {
      // A stash during a mid-merge/mid-rebase may fail (git refuses) — either way the
      // re-verification below decides: still mid-state re-presents the menu.
      await git.stashSave(repoPath, UPDATE_STASH_MESSAGE);
    }
    // `edited` is driving-side only (the editor spawn) — core only re-verifies.
    const stillMerging = await git.isMergeInProgress(repoPath);
    if (!stillMerging.ok) {
      return {
        resumed: false,
        row: failed(service, stillMerging.error),
        cancelRun: false,
      };
    }
    const stillRebasing = await git.isRebaseInProgress(repoPath);
    if (!stillRebasing.ok) {
      return {
        resumed: false,
        row: failed(service, stillRebasing.error),
        cancelRun: false,
      };
    }
    if (!stillMerging.data && !stillRebasing.data) {
      return { resumed: true };
    }
    // Still mid-state → re-present the menu.
  }
}

// Ordinary (non-lockfile) dirty-worktree settlement. Without a seam this is a
// `skipped`/`dirty-worktree` row with zero writes; with a seam the run waits on the
// four-choice menu and resumes only after a passing re-verification (`stash` stashes via the
// git port, `edited` re-verifies a driving-side edit; still dirty re-presents).
export async function resolveDirtyBlocker(
  service: string,
  repoPath: string,
  git: GitPort,
  onUpdateBlocker: OnUpdateBlocker | undefined,
): Promise<BlockerSettlement> {
  if (onUpdateBlocker === undefined) {
    return {
      resumed: false,
      row: {
        service,
        outcome: "skipped",
        detail: {
          code: "dirty-worktree",
          message: `Repo ${repoPath} has uncommitted changes — left untouched`,
        },
      },
      cancelRun: false,
    };
  }
  for (;;) {
    const asked = await askSeam(onUpdateBlocker, {
      service,
      repoPath,
      kind: "dirty-worktree",
    });
    if ("error" in asked) {
      return {
        resumed: false,
        row: failed(service, asked.error),
        cancelRun: false,
      };
    }
    if (asked.choice === "cancel-repo") {
      return {
        resumed: false,
        row: {
          service,
          outcome: "skipped",
          detail: {
            code: "dirty-worktree",
            message: `Repo ${repoPath} update cancelled by developer — left untouched`,
          },
        },
        cancelRun: false,
      };
    }
    if (asked.choice === "cancel-run") {
      return {
        resumed: false,
        row: {
          service,
          outcome: "skipped",
          detail: {
            code: "dirty-worktree",
            message: `Repo ${repoPath} update cancelled by developer — left untouched`,
          },
        },
        cancelRun: true,
      };
    }
    if (asked.choice === "stash") {
      // A failed stash leaves the dirt behind — the re-verification below re-presents
      // the menu rather than failing the repo for a transient stash error.
      await git.stashSave(repoPath, UPDATE_STASH_MESSAGE);
    }
    // `edited` is driving-side only — core only re-verifies before resuming.
    const verify = await reverifyClean(git, repoPath);
    if (!verify.ok) {
      return {
        resumed: false,
        row: failed(service, verify.error),
        cancelRun: false,
      };
    }
    if (verify.data) {
      return { resumed: true };
    }
    // Still dirty/conflicted → re-present the menu.
  }
}

// A rejected `fetch origin <b>:<b>` is almost always a local branch carrying commits origin
// lacks (git refuses to move a branch backwards). Core refreshes `origin/<b>` with a plain
// fetch and lists those commits: none → the failure is something else (network, auth) and
// stays the original `git-fetch-error`; some → the repo is stopped with an explicit message
// naming them. Without a seam that is a `failed` row; with one the developer chooses: `fetch`
// (carry on with the local branch as is), `edited` (fix it in the editor — e.g. push — then the
// strict fetch is retried), or one of the two cancels.
function unpushedMessage(
  service: string,
  branch: string,
  commits: readonly string[],
): string {
  return `There are unpushed commits on branch ${branch} of service ${service}, which prevents a clean fetch: ${commits.join(" | ")}`;
}

export async function resolveUnpushedCommits(
  service: string,
  git: GitPort,
  repoPath: string,
  branch: string,
  fetchError: ResultError,
  onUpdateBlocker: OnUpdateBlocker | undefined,
): Promise<BlockerSettlement> {
  const refreshed = await git.fetchRemote(repoPath, branch);
  if (!refreshed.ok) {
    return {
      resumed: false,
      row: failed(service, fetchError),
      cancelRun: false,
    };
  }
  const listed = await git.listUnpushedCommits(repoPath, branch);
  if (!listed.ok || listed.data.length === 0) {
    return {
      resumed: false,
      row: failed(service, fetchError),
      cancelRun: false,
    };
  }
  let commits = listed.data;
  if (onUpdateBlocker === undefined) {
    return {
      resumed: false,
      row: failed(service, {
        code: "unpushed-commits",
        message: unpushedMessage(service, branch, commits),
      }),
      cancelRun: false,
    };
  }
  let retry = 0;
  let retryReason = "";
  for (;;) {
    const blocker: UpdateBlocker = {
      service,
      repoPath,
      kind: "unpushed-commits",
      branch,
      commits,
      ...(retry > 0 ? { retry, retryReason } : {}),
    };
    const asked = await askSeam(onUpdateBlocker, blocker);
    if ("error" in asked) {
      return {
        resumed: false,
        row: failed(service, asked.error),
        cancelRun: false,
      };
    }
    if (asked.choice === "cancel-repo" || asked.choice === "cancel-run") {
      return {
        resumed: false,
        row: {
          service,
          outcome: "skipped",
          detail: {
            code: "unpushed-commits",
            message: `Repo ${repoPath} update cancelled by developer — left untouched`,
          },
        },
        cancelRun: asked.choice === "cancel-run",
      };
    }
    if (asked.choice === "fetch") {
      // The plain fetch already ran above; the local branch (a superset of origin's) is merged as is.
      return { resumed: true };
    }
    // `edited` (or an unavailable `stash`): retry the strict fetch the editor session may have unblocked.
    const retried = await git.fetch(repoPath, branch);
    if (retried.ok) {
      return { resumed: true };
    }
    retry += 1;
    retryReason = "Local branch still has commits origin lacks";
    await git.fetchRemote(repoPath, branch);
    const again = await git.listUnpushedCommits(repoPath, branch);
    if (again.ok && again.data.length > 0) {
      commits = again.data;
    }
  }
}
