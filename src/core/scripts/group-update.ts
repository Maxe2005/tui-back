// core/scripts/group-update: brings every member service of the active EDT (or every repo, in
// all-repos scope) up to date with its merge source, runs its migration and restarts it — one
// `updated`/`skipped`/`failed` row per service, none silently absent, one failure never
// aborting the others. Merge means `git merge`, never rebase; a rerun with no change is a
// no-op. Lock order: global `group-update` key, then `edt:<ulid>` (which switch peeks).
// This file is the public entry point: the flows live in `group-update/*.ts`.
import type { Result } from "../result.js";
import { groupUpdateAll } from "./group-update/all.js";
import { groupUpdateEdt } from "./group-update/edt.js";
import type {
  GroupUpdateData,
  GroupUpdateParams,
} from "./group-update/types.js";
import type { StageControl } from "./update-support/run-pool.js";
export type { StageControl };
export {
  edtUpdateLockKey,
  GROUP_UPDATE_LOCK_KEY,
} from "./group-update/selection.js";
export { MIGRATION_FAILED_CODE } from "./group-update/observers.js";
export {
  markGroupUpdateInterrupted,
  runRestartStep,
} from "./group-update/restart.js";
export type { RestartStepInput } from "./group-update/restart.js";
export type {
  AutoResolveConflict,
  AutoResolveResult,
  GroupUpdateData,
  GroupUpdateParams,
  GroupUpdateRepoResult,
  GroupUpdateRunDetail,
  GroupUpdateScope,
  GroupUpdateSelectionItem,
  OnServiceResult,
  OnUpdateBlocker,
  OnUpdatePhase,
  UpdateBlocker,
  UpdateBlockerChoice,
  UpdateBlockerKind,
  UpdatePhase,
} from "./group-update/types.js";

export async function groupUpdate(
  params: GroupUpdateParams,
): Promise<Result<GroupUpdateData>> {
  const { scope = "edt" } = params;
  if (scope === "all") {
    return groupUpdateAll(params);
  }
  return groupUpdateEdt(params);
}
