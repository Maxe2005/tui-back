// core/scripts/group-update/observers: never-throwing phase/result observer emitters, the cancel folder and the migration-failed code.
import { resolve } from "node:path";
import type {
  GroupUpdateRepoResult,
  UpdatePhase,
  OnUpdatePhase,
  OnServiceResult,
} from "./types.js";
import { failed } from "./outcome.js";

// The stop predicate handed to the per-service steps: the pool's flag, or the external one
// (which also cancels the pool so unstarted services resolve through `onCancelled`).
export function foldCancel(
  control: { cancelled(): boolean; cancel(): void },
  shouldCancel: (() => boolean) | undefined,
): () => boolean {
  return () => {
    if (control.cancelled()) {
      return true;
    }
    let external = false;
    try {
      external = shouldCancel?.() === true;
    } catch (error) {
      console.error(error);
      external = true;
    }
    if (external) {
      control.cancel();
    }
    return external;
  };
}

// Same never-break-the-pipeline contract as emitPhase.
export function emitServiceResult(
  onServiceResult: OnServiceResult | undefined,
  row: GroupUpdateRepoResult,
): void {
  if (onServiceResult === undefined) {
    return;
  }
  try {
    const result = onServiceResult(row) as unknown;
    if (result instanceof Promise) {
      result.catch(() => {
        // Observer-only — the run continues.
      });
    }
  } catch {
    // Observer-only — the run continues.
  }
}

// A driving-side phase observer must never break the pipeline — a throwing observer (a
// driving-side bug) is swallowed per emission so one repo's live view never strands the
// others' rows. An observer that returns a rejected promise despite its `void` contract is
// sunk the same way, so it never surfaces as an unhandled rejection.
export function emitPhase(
  onPhase: OnUpdatePhase | undefined,
  service: string,
  phase: UpdatePhase,
): void {
  if (onPhase === undefined) {
    return;
  }
  try {
    const result = onPhase(service, phase) as unknown;
    if (result instanceof Promise) {
      result.catch(() => {
        // Observer-only — the run continues with the phase untracked.
      });
    }
  } catch {
    // Observer-only — the run continues with the phase untracked.
  }
}

// The normalized row-detail code for a failed migration — a named export instead of a magic
// string, so the TUI's live issue log cannot drift from core's contract.
export const MIGRATION_FAILED_CODE = "migration-failed";
