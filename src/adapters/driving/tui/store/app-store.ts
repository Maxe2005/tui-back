// tui/store: the single cross-zone Zustand store (AD-10), composed from per-concern slices
// under slices/, each owning its fields/actions and unit-tested directly. This file declares
// the combined `AppState`, threads `AppStoreDeps` (the ports the slices' use-cases close over,
// AD-2) to each slice factory, and exports the one `createAppStore()`/`useAppStore` pair.
import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import type { ContainerPort } from '../../../../core/ports/container.js';
import type { DevAuthPort } from '../../../../core/ports/dev-auth.js';
import type { DockerPort } from '../../../../core/ports/docker.js';
import type { EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../core/ports/git.js';
import type { LockPort } from '../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../core/ports/manifest.js';
import type { ManifestCarryPort } from '../../../../core/ports/manifest-carry.js';
import type { MigrationPort } from '../../../../core/ports/migration.js';
import type { ConsumerConfigParser } from '../../../../core/shared-types/list-consumers.js';
import type { SharedTypesPort } from '../../../../core/ports/shared-types.js';
import type { RestartPort } from '../../../../core/ports/restart.js';
import type { RegistryPort } from '../../../../core/ports/registry.js';
import type { RouteScannerPort } from '../../../../core/ports/route-scanner.js';
import type { SavedRequestPort } from '../../../../core/ports/saved-request.js';
import type { SettingsPort } from '../../../../core/ports/settings.js';
import type { StatePort } from '../../../../core/ports/state.js';
import { createNavigationSlice, type NavigationSlice } from './slices/navigation-slice.js';
import { createEdtSlice, type EdtSlice } from './slices/edt-slice.js';
import { createRegistrySlice, type RegistrySlice } from './slices/registry-slice.js';
import { createSettingsSlice, type SettingsSlice } from './slices/settings-slice.js';
import { createUpdateSlice, type UpdateSlice } from './slices/update-slice.js';
import { createLogsSlice, type LogsSlice } from './slices/logs-slice.js';
import { createResetSlice, type ResetSlice } from './slices/reset-slice.js';
import { createRoutesSlice, type RoutesSlice } from './slices/routes-slice.js';
import { createSharedTypesSlice, type SharedTypesSlice } from './slices/shared-types-slice.js';

export type { ZoneEvents, ZoneRatios, ResizeMode } from './slices/navigation-slice.js';
export type { ActivateEdtRequest, CreateEdtParams, SwitchEdtParams, ModifyEdtParams, DeleteEdtParams, EdtActionState, EdtActionLogEntry } from './slices/edt-slice.js';
export { DEFAULT_BASE_BRANCH, NO_BRANCH_CREATION } from './slices/edt-slice.js';
export type { RegistryOutcome, RegistryRegisterResult } from './slices/registry-slice.js';
export type { StaleRegistryEntry, StaleRegistryReason, RemoveStaleRegistryEntryResult, RemoveStaleRegistryOutcome, RegistryEntryError } from '../../../../core/scripts/clean-registry.js';
export type { SettingsUpdate } from './slices/settings-slice.js';
export type { UpdateRunStatus } from './slices/update-slice.js';
export type { LogsPaneData } from './slices/logs-slice.js';
export type { ResetPreview } from './slices/reset-slice.js';
export type { SharedTypesRun, SharedTypesRunStatus } from './slices/shared-types-slice.js';
export type { RoutesStatus } from './slices/routes-slice.js';
export type { RouteResponse, RoutesPaneFocus, RoutesPaneTab } from './slices/routes-slice.js';

export type AppStore = UseBoundStore<StoreApi<AppState>>;

// The ports createAppStore closes over to run core use-cases in-process (AD-2) — the same ones
// the CLI composition root builds. Optional so an unwired `createAppStore()` (tests, and the
// module-level `useAppStore` default below) keeps working; actions then degrade to an explicit
// error state rather than throwing.
export type AppStoreDeps = {
  registry: RegistryPort;
  manifest: ManifestPort;
  manifestCarry: ManifestCarryPort;
  git: GitPort;
  edtRegistry: EdtRegistryPort;
  state: StatePort;
  lock: LockPort;
  edtRegistryResourceKey: string;
  edtsBaseDir: string;
  registryResourceKey: string;
  // The settings screen's persistence port (zod-validated settings.yaml).
  settings: SettingsPort;
  // The container-restart port the Update zone's runGroupUpdate closes over. Optional like the
  // rest; runGroupUpdate degrades to an explicit error state when it is missing.
  container?: ContainerPort;
  // The migration-run port the Update zone's runGroupUpdate closes over (the manifest
  // `migrationCommand` runs between pull/merge and restart). Same optionality contract as
  // `container` above — runGroupUpdate requires both before starting a run.
  migration?: MigrationPort;
  // The clean-restart recipe port the Update zone's runGroupUpdate closes over (one run per
  // declared `restartCommands` entry, in order, when the clean-restart toggle calls for it).
  // Same optionality contract — runGroupUpdate requires all three before starting a run.
  restart?: RestartPort;
  // The Logs zone's Docker touchpoint — wrapped by the single LogsManager instance the logs
  // slice creates and closes over.
  docker: DockerPort;
  // The Routes zone's scanner touchpoint — the routes slice calls core/routes/list-routes.ts
  // in-process through it; loadRoutes degrades to an explicit error state when it is missing.
  scanner?: RouteScannerPort;
  // The Routes zone's dev-auth touchpoint, used with the scanner by core/routes/fire-request.ts;
  // fireRoute degrades to an explicit error state when it is missing.
  auth?: DevAuthPort;
  // The saved-request library touchpoint — the same global.db store the CLI's request-*
  // subcommands run against. Save/load/delete degrade to an explicit error when missing.
  savedRequests?: SavedRequestPort;
  // The shared-types zone's wiring: the registry/package port the manifest module provides, the
  // consuming module's id, and the parser of its manifest parameters (core cannot import the
  // module's schema). Optional like the rest; the zone degrades to an explicit error without it.
  sharedTypes?: { port: SharedTypesPort; consumerModuleId: string; parseConsumerConfig: ConsumerConfigParser };
};

export type AppState = NavigationSlice & EdtSlice & RegistrySlice & SettingsSlice & UpdateSlice & LogsSlice & ResetSlice & RoutesSlice & SharedTypesSlice;

export function createAppStore(deps?: AppStoreDeps) {
  return create<AppState>()((...args) => ({
    ...createNavigationSlice(deps)(...args),
    ...createEdtSlice(deps)(...args),
    ...createRegistrySlice(deps)(...args),
    ...createSettingsSlice(deps)(...args),
    ...createUpdateSlice(deps)(...args),
    ...createLogsSlice(deps)(...args),
    ...createResetSlice(deps)(...args),
    ...createRoutesSlice(deps)(...args),
    ...createSharedTypesSlice(deps)(...args),
  }));
}

export const useAppStore = createAppStore();
