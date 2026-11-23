// tui/store/slices: the Update zone's group-update run state. Calls the same
// core/workspace/scripts/group-update/group-update.ts use-case the CLI's `tui-back update` wraps, in-process (AD-2,
// never by shelling out to the CLI).
//
// This file only composes the slice: it creates the per-store closure context once per
// `createUpdateSlice(deps)` call and spreads the sub-creators (run, incident, config, health).
// Every symbol it used to export is re-exported from here.
import type { StateCreator } from 'zustand';
import { createInFlightGuard } from '../../../shared/hooks/in-flight-guard.js';
import type { AppState, AppStoreDeps } from '../../app-store.js';
import { createUpdateConfigActions } from './config/update-slice.config.js';
import { createUpdateHealthActions } from './health/update-slice.health.js';
import { createUpdateIncidentActions } from './health/update-slice.incident.js';
import { createUpdateRunActions } from './run/update-slice.run.js';
import type { UpdateSlice, UpdateSliceContext } from './update-slice.types.js';

export {
  parseUpdateServiceArg,
  UPDATE_HEALTH_POLL_INTERVAL_MS,
  type IncidentBlocker,
  type OpenUpdateConfigTarget,
  type ServiceRunSnapshot,
  type SharedTypesPhaseBlocker,
  type UpdateIncident,
  type UpdateRunOptions,
  type UpdateRunStatus,
  type UpdateSlice,
} from './update-slice.types.js';

export function createUpdateSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], UpdateSlice> {
  // Held in closure, never in Zustand state; shared by reference with every sub-creator.
  const ctx: UpdateSliceContext = {
    deps,
    incidentResolvers: new Map(),
    raisedKinds: new Map(),
    incidentSequence: 0,
    healthPollTimer: null,
    healthInFlight: createInFlightGuard(),
    pollingRepoPaths: [],
    servicePickGeneration: 0,
  };
  return (set, get) => ({
    ...createUpdateRunActions(ctx, set, get),
    ...createUpdateIncidentActions(ctx, set, get),
    ...createUpdateConfigActions(ctx, set, get),
    ...createUpdateHealthActions(ctx, set, get),
  });
}
