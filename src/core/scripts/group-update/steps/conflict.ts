// core/scripts/group-update/conflict: mid-run merge-conflict resolution (menu, edited, retry) and conflict abort.
import { resolve } from "node:path";
import type { GitPort } from "../../../ports/git.js";
import { ok, type ResultError } from "../../../result.js";
import type {
  GroupUpdateRunDetail,
  GroupUpdateRepoResult,
  AutoResolveConflict,
  UpdateBlocker,
  OnUpdateBlocker,
} from "./types.js";
import type { RepoOutcome } from "./outcome.js";
import { failed, skipped, failedOutcome } from "./outcome.js";
import { askSeam, reverifyClean } from "./blockers.js";

// Aborts a conflicting merge (or pull) back to the pre-run HEAD and reports it as
// `merge-conflict`. An abort failure keeps the `merge-conflict` code — the repo is still
// conflicted — surfacing both messages so the abort failure isn't silent.
async function failConflicted(
  service: string,
  git: GitPort,
  repoPath: string,
  conflict: ResultError,
): Promise<RepoOutcome> {
  const aborted = await git.abortMerge(repoPath);
  if (!aborted.ok) {
    return failedOutcome(service, {
      code: "merge-conflict",
      message: `${conflict.message} (merge --abort also failed: ${aborted.error.message})`,
    });
  }
  return failedOutcome(service, conflict);
}

// Mid-run conflict settlement (a merge — or pull — this run started now leaves the repo
// mid-merge). Without a seam this is an abort-and-report `failed`/`merge-conflict` row; with
// a seam there is no abort and no retry bound: every `edited` choice retries the update, and
// any attempt that does not settle the conflict re-presents the menu with an incremented
// `retry` counter and its reason. The only clean exits from an unresolvable conflict are the
// two cancel choices, which abort the own-started merge and land a `skipped` row. A resumed
// conflict rejoins the caller's pipeline (migrate → restart) via `{ done: false }`.
type ConflictSettlement =
  | { done: true; outcome: RepoOutcome }
  | { done: false; conflict?: GroupUpdateRunDetail["conflict"] };

export async function resolveMidRunConflict(
  service: string,
  git: GitPort,
  repoPath: string,
  conflict: ResultError,
  onUpdateBlocker: OnUpdateBlocker | undefined,
  via: "pull" | "merge",
  sharedBranch: string,
  autoResolveConflict?: AutoResolveConflict,
  shouldStop?: () => boolean,
): Promise<ConflictSettlement> {
  if (onUpdateBlocker === undefined) {
    return {
      done: true,
      outcome: await failConflicted(service, git, repoPath, conflict),
    };
  }
  let retry = 0;
  let retryReason = "";
  // What the auto-resolver did across the whole conflict: whether it settled anything, the
  // first issue note it raised (kept while the conflict stays unresolved), the issue of its
  // last pass, and whether the developer was ever asked.
  let touched = false;
  let note: string | undefined;
  let lastIssue: string | undefined;
  let menuShown = false;
  const conflictOutcome = (): GroupUpdateRunDetail["conflict"] => {
    if (touched) {
      return menuShown || lastIssue !== undefined ? "partial" : "auto-resolved";
    }
    return note !== undefined ? "left-to-user" : undefined;
  };
  const tagged = (outcome: RepoOutcome): RepoOutcome => {
    // A row that did not finish its merge is never `auto-resolved`.
    const raw = conflictOutcome();
    const value = raw === "auto-resolved" ? "partial" : raw;
    return value === undefined
      ? outcome
      : {
          ...outcome,
          row: { ...outcome.row, run: { ...outcome.row.run, conflict: value } },
        };
  };
  // One auto-resolve pass; a throwing seam is an issue note, never a failed run. A stopped run
  // never starts one.
  const autoPass = async (): Promise<{ touched: boolean }> => {
    if (autoResolveConflict === undefined || shouldStop?.() === true) {
      return { touched: false };
    }
    try {
      const result = await autoResolveConflict({ service, repoPath });
      touched = touched || result.touched;
      lastIssue = result.issue;
      if (result.issue !== undefined) {
        note = result.issue;
      }
      return { touched: result.touched };
    } catch (error) {
      lastIssue = `Auto-resolution failed: ${error instanceof Error ? error.message : String(error)}`;
      note = lastIssue;
      return { touched: false };
    }
  };
  let skipPreMenuPass = false;
  for (;;) {
    if (!skipPreMenuPass) {
      const pass = await autoPass();
      if (pass.touched) {
        // The resolver may have settled everything: finalize without bothering the developer.
        const settled = await attemptEdited(git, repoPath, via, sharedBranch);
        if (settled.type === "resumed") {
          return { done: false, conflict: conflictOutcome() };
        }
        if (settled.type === "failed") {
          return { done: true, outcome: tagged(settled.outcome(service)) };
        }
        // Blocked (unmerged paths remain, or finalize refused): the menu takes over, uncounted.
      }
    }
    skipPreMenuPass = false;
    const blocker: UpdateBlocker = {
      service,
      repoPath,
      kind: "merge-conflict",
      ...(retry > 0 ? { retry, retryReason } : {}),
      ...(note !== undefined ? { autoResolveNote: note } : {}),
    };
    menuShown = true;
    const asked = await askSeam(onUpdateBlocker, blocker);
    if ("error" in asked) {
      return {
        done: true,
        outcome: tagged(
          await failConflicted(service, git, repoPath, asked.error),
        ),
      };
    }
    if (asked.choice === "cancel-repo" || asked.choice === "cancel-run") {
      // Own-started merge aborted, repo left at pre-run HEAD; a cancelled repo is `skipped`,
      // never `failed` — even when the abort itself fails, the code stays informative.
      const aborted = await git.abortMerge(repoPath);
      const row: GroupUpdateRepoResult = aborted.ok
        ? {
            service,
            outcome: "skipped",
            detail: {
              code: "merge-conflict",
              message: `Repo ${repoPath} update cancelled by developer — merge aborted`,
            },
          }
        : {
            service,
            outcome: "skipped",
            detail: {
              code: "merge-conflict",
              message: `Repo ${repoPath} update cancelled by developer (merge --abort also failed: ${aborted.error.message})`,
            },
          };
      return {
        done: true,
        outcome: tagged({ row, cancelRun: asked.choice === "cancel-run" }),
      };
    }
    // `stash` is never run on a conflict (the TUI does not offer it): git refuses to stash
    // unmerged paths, and on a resolved-but-uncommitted merge it would shelve the
    // resolution and clear the merge — a seam answering it just re-presents the menu.
    let attempt: ConflictAttempt;
    if (asked.choice === "stash") {
      attempt = {
        type: "blocked",
        reason: "Stash is not available during a merge conflict",
      };
    } else {
      // After the developer's edit the resolver runs again: with `package.json` now settled it
      // regenerates and stages the lockfile before the merge is finalized.
      await autoPass();
      skipPreMenuPass = true;
      attempt = await attemptEdited(git, repoPath, via, sharedBranch);
    }
    if (attempt.type === "resumed") {
      return { done: false, conflict: conflictOutcome() };
    }
    if (attempt.type === "failed") {
      return { done: true, outcome: tagged(attempt.outcome(service)) };
    }
    // Still blocked → re-present the menu, counting the failed attempt.
    retry += 1;
    retryReason = attempt.reason;
  }
}

// One resolution attempt's verdict: `resumed` rejoins the pipeline, `blocked` re-presents
// the menu with its reason, `failed` ends the repo on a non-conflict error (a git read or
// a non-conflict pull/merge failure — retrying the menu cannot fix those).
type ConflictAttempt =
  | { type: "resumed" }
  | { type: "blocked"; reason: string; unmerged?: boolean }
  | { type: "failed"; outcome: (service: string) => RepoOutcome };

function failedAttempt(error: ResultError): ConflictAttempt {
  return {
    type: "failed",
    outcome: (service) => failedOutcome(service, error),
  };
}

// `edited` — the developer resolved by hand driving-side. Still mid-merge: zero unmerged
// paths finalizes the merge commit; anything else re-presents (never aborts — the tree
// carries the developer's own in-the-moment resolution). No longer mid-merge (committed or
// aborted from the editor): a clean tree retries the update — a no-op when the merge was
// committed, a fresh conflict when it was aborted.
async function attemptEdited(
  git: GitPort,
  repoPath: string,
  via: "pull" | "merge",
  sharedBranch: string,
): Promise<ConflictAttempt> {
  const merging = await git.isMergeInProgress(repoPath);
  if (!merging.ok) {
    return failedAttempt(merging.error);
  }
  if (merging.data) {
    const unmerged = await git.hasUnmergedPaths(repoPath);
    if (!unmerged.ok) {
      return failedAttempt(unmerged.error);
    }
    if (unmerged.data) {
      return {
        type: "blocked",
        reason:
          "Unmerged paths remain — resolve and stage (git add) every conflicted file",
        unmerged: true,
      };
    }
    const finalized = await git.finalizeMerge(repoPath);
    if (!finalized.ok) {
      return { type: "blocked", reason: finalized.error.message };
    }
    return { type: "resumed" };
  }
  const verify = await reverifyClean(git, repoPath);
  if (!verify.ok) {
    return failedAttempt(verify.error);
  }
  if (!verify.data) {
    return {
      type: "blocked",
      reason:
        "The merge is no longer in progress but the worktree has uncommitted changes",
    };
  }
  return retryUpdate(git, repoPath, via, sharedBranch);
}

// One re-pull/re-merge on a settled tree: a clean one resumes, a conflicting one leaves the
// repo mid-merge again and re-presents the menu, any other failure keeps its own code.
async function retryUpdate(
  git: GitPort,
  repoPath: string,
  via: "pull" | "merge",
  sharedBranch: string,
): Promise<ConflictAttempt> {
  if (via === "pull") {
    const retried = await git.pull(repoPath);
    if (retried.ok) {
      return { type: "resumed" };
    }
    const stillMerging = await git.isMergeInProgress(repoPath);
    if (stillMerging.ok && stillMerging.data) {
      return {
        type: "blocked",
        reason: `Retried pull conflicted again: ${retried.error.message}`,
      };
    }
    return failedAttempt(retried.error);
  }
  const retried = await git.mergeBranch(repoPath, sharedBranch);
  if (retried.ok) {
    return { type: "resumed" };
  }
  if (retried.error.code === "merge-conflict") {
    return {
      type: "blocked",
      reason: `Retried merge conflicted again: ${retried.error.message}`,
    };
  }
  return failedAttempt(retried.error);
}
