// core/scripts/group-update/selection: lock keys, selection matching and source-branch resolution/validation.
import { resolve } from "node:path";
import type { GitPort } from "../../../ports/vcs/git.js";
import { err, ok, type Result } from "../../../result.js";
import type { GroupUpdateSelectionItem } from "./types.js";

// The global run-in-flight key: every group-update trigger (EDT-scoped or all-repos)
// serializes on it, so a second trigger is rejected, never queued or raced.
export const GROUP_UPDATE_LOCK_KEY = "group-update";

export function edtUpdateLockKey(ulid: string): string {
  return `edt:${ulid}`;
}

// Matches one enumerated target against the confirmed selection. A selection
// item carrying `repoPath` matches by resolved path (duplicate service names in one EDT);
// otherwise it matches by service name. First match wins.
export function matchSelectionItem(
  selection: readonly GroupUpdateSelectionItem[],
  candidate: { service: string; repoPath: string },
): GroupUpdateSelectionItem | undefined {
  return selection.find((item) =>
    item.repoPath !== undefined
      ? resolve(item.repoPath) === resolve(candidate.repoPath)
      : item.service === candidate.service,
  );
}

// The configured merge source for one service — a non-blank per-service
// `sourceBranch` override wins, otherwise the manifest `sharedBranch`. The override is
// trimmed once here so `" release/1 "` resolves exactly like `release/1` everywhere
// (validation, fetch, merge) instead of failing the branch check on padding.
export function effectiveSourceBranch(
  sharedBranch: string,
  override: string | undefined,
): string {
  const trimmed = override?.trim() ?? "";
  return trimmed !== "" ? trimmed : sharedBranch;
}

// Validates every custom `sourceBranch` against the local branch listing
// (`branchExistsLocally`, the `git rev-parse --verify`-backed adapter — no new git
// machinery) before any lock is taken, so an unresolvable branch rejects the run before
// any git/docker action. A failing check itself is an unexpected git failure and rejects
// the run the same way.
export async function validateSelectionBranches(
  git: GitPort,
  targets: readonly {
    service: string;
    repoPath: string;
    sourceBranch: string | undefined;
  }[],
): Promise<Result<void>> {
  for (const target of targets) {
    const branch = target.sourceBranch?.trim() ?? "";
    if (branch === "") {
      continue;
    }
    const exists = await git.branchExistsLocally(target.repoPath, branch);
    if (!exists.ok) {
      return exists;
    }
    if (!exists.data) {
      return err(
        "unknown-branch",
        `Service "${target.service}" source branch "${branch}" does not exist in ${target.repoPath} — pick a resolvable branch`,
      );
    }
  }
  return ok(undefined);
}
