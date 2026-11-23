// core/scripts/group-update/outcome: per-repo outcome rows and the small helpers building them (skipped/failed/cancelled).
import { ok, type ResultError } from "../../result.js";
import { type PoolControl } from "../update-support/run-pool.js";
import type { GroupUpdateRepoResult, OnUpdateBlocker } from "./types.js";

// The row of a service the run was cancelled for: `skipped`, never `failed`, so the summary
// still accounts for it.
export function runCancelledRow(
  service: string,
  repoPath: string,
  when: string,
): GroupUpdateRepoResult {
  return {
    service,
    outcome: "skipped",
    detail: {
      code: "run-cancelled",
      message: `Repo ${repoPath} update cancelled with the run ${when}`,
    },
  };
}

// Wraps the blocker seam so a service waiting on the developer gives its pool slot to the next
// service, and takes one again (behind the waiting ones) once answered. A pool of one keeps
// its slot: that run stays strictly sequential, a blocker waits for the developer exactly as
// before.
export function pausingSeam(
  seam: OnUpdateBlocker | undefined,
  control: PoolControl,
): OnUpdateBlocker | undefined {
  if (seam === undefined) {
    return undefined;
  }
  if (control.concurrency <= 1) {
    return seam;
  }
  return async (blocker) => {
    control.release();
    try {
      return await seam(blocker);
    } finally {
      await control.reacquire();
    }
  };
}

// A worker that threw (never-throw invariant, AD-3) becomes that service's failed row.
export function unexpectedError(error: unknown): ResultError {
  const detail = error instanceof Error ? error.message : String(error);
  return { code: "internal-error", message: detail };
}

export function failed(
  service: string,
  error: ResultError,
): GroupUpdateRepoResult {
  return {
    service,
    outcome: "failed",
    detail: { code: error.code, message: error.message },
  };
}

// The per-repo outcome plus the `cancel-run` loop-stop signal. The cancelled
// repo itself is always a `skipped` row, never `failed` — the outer loops push the row
// and break, still returning `ok` with rows so far.
export interface RepoOutcome {
  row: GroupUpdateRepoResult;
  cancelRun: boolean;
}

export function skipped(
  service: string,
  code: string,
  message: string,
): RepoOutcome {
  return {
    row: { service, outcome: "skipped", detail: { code, message } },
    cancelRun: false,
  };
}

export function failedOutcome(
  service: string,
  error: ResultError,
): RepoOutcome {
  return { row: failed(service, error), cancelRun: false };
}
