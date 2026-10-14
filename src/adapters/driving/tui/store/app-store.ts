// tui/store: the single cross-zone Zustand store (AD-10) — composed from per-concern slices
// under slices/ (navigation/chrome, EDT domain state, the repo registry screen, and the
// `:settings` screen). Each slice owns its own fields/actions and is unit-tested directly
// (AD-13); this file's only job is to declare the combined `AppState` shape, wire
// `AppStoreDeps` (the ports every slice's use-case calls close over, AD-2) through to each
// slice factory, and export the one `createAppStore()`/`useAppStore` pair every driving
// adapter (zones, command-bar, app-shell) imports.
import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import type { ContainerPort } from '../../../../core/ports/container.js';
import type { DevAuthPort } from '../../../../core/ports/dev-auth.js';
import type { DockerPort } from '../../../../core/ports/docker.js';
import type { EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../core/ports/git.js';
import type { LockPort } from '../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../core/ports/manifest.js';
import type { MigrationPort } from '../../../../core/ports/migration.js';
import type { RestartPort } from '../../../../core/ports/restart.js';
import type { RegistryPort } from '../../../../core/ports/registry.js';
import type { RouteScannerPort } from '../../../../core/ports/route-scanner.js';
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

export type { ZoneEvents, ZoneRatios, ResizeMode } from './slices/navigation-slice.js';
export type { ActivateEdtRequest, CreateEdtParams, SwitchEdtParams, ModifyEdtParams, DeleteEdtParams, EdtActionState, EdtActionLogEntry } from './slices/edt-slice.js';
export { DEFAULT_BASE_BRANCH, NO_BRANCH_CREATION } from './slices/edt-slice.js';
export type { RegistryOutcome, RegistryRegisterResult } from './slices/registry-slice.js';
export type { StaleRegistryEntry, StaleRegistryReason, RemoveStaleRegistryEntryResult, RemoveStaleRegistryOutcome, RegistryEntryError } from '../../../../core/scripts/clean-registry.js';
export type { ValidateRegistryEntryResult, ValidateRegistryOutcome } from '../../../../core/scripts/validate-registry.js';
export type { SettingsUpdate } from './slices/settings-slice.js';
export type { UpdateRunStatus } from './slices/update-slice.js';
export type { LogsPaneData } from './slices/logs-slice.js';
export type { ResetPreview } from './slices/reset-slice.js';
export type { RoutesStatus } from './slices/routes-slice.js';
export type { FireStatus } from './slices/routes-slice.js';

export type AppStore = UseBoundStore<StoreApi<AppState>>;

// Story 2.6: the ports createAppStore closes over to run core use-cases in-process (AD-2) —
// the same ones src/bin/main.ts's CLI composition root builds, mirrored by src/bin/tui.ts.
// Optional so every pre-existing `createAppStore()` call (tests, and the module-level
// `useAppStore` default below) keeps working unwired; loadEdtsBranches degrades to an
// explicit error state rather than throwing when no deps were supplied.
// Story 2.9 extends the deps with `lock`/`edtRegistryResourceKey`/`edtsBaseDir` — the same
// three createEdt/switchActiveEdt/modifyEdt need alongside the pre-existing five, closing the
// composition-root gap (src/bin/tui.ts previously built these for nothing, since no store
// action consumed them).
export type AppStoreDeps = {
  registry: RegistryPort;
  manifest: ManifestPort;
  git: GitPort;
  edtRegistry: EdtRegistryPort;
  state: StatePort;
  lock: LockPort;
  edtRegistryResourceKey: string;
  edtsBaseDir: string;
  registryResourceKey: string;
  // Story 2.19: the settings screen's persistence port (zod-validated settings.yaml).
  settings: SettingsPort;
  // Story 3.1: the container-restart port the Update zone's runGroupUpdate closes over.
  // Optional so every pre-existing `createAppStore()` call (tests, and the module-level
  // `useAppStore` default below) keeps working unwired; runGroupUpdate degrades to an
  // explicit error state rather than throwing when it is missing.
  container?: ContainerPort;
  // Story 3.2: the migration-run port the Update zone's runGroupUpdate closes over (the
  // manifest `migrationCommand` runs between pull/merge and restart). Same optionality
  // contract as `container` above — runGroupUpdate requires both before starting a run.
  migration?: MigrationPort;
  // Story 3.8: the clean-restart recipe port the Update zone's runGroupUpdate closes
  // over (one run per declared `restartCommands` entry, in order, when the clean-restart
  // toggle calls for it). Same optionality contract as `container`/`migration` —
  // runGroupUpdate requires all three before starting a run.
  restart?: RestartPort;
  // Story 5.1: the Logs zone's Docker touchpoint (AD-1/AD-2) — wrapped by a single
  // LogsManager instance the logs slice creates and closes over (see that file's header).
  docker: DockerPort;
  // Story 6.1: the Routes zone's scanner touchpoint (AD-1/AD-2) — the routes slice calls
  // core/routes/list-routes.ts in-process through it. Optional so every pre-existing
  // `createAppStore()` call (tests, and the module-level `useAppStore` default below)
  // keeps working unwired; loadRoutes degrades to an explicit error state rather than
  // throwing when it is missing.
  scanner?: RouteScannerPort;
  // Story 6.2: the Routes zone's dev-auth touchpoint (AD-1/AD-2) — the routes slice calls
  // core/routes/fire-request.ts in-process through it alongside the scanner above. Same
  // optionality contract: fireRoute degrades to an explicit error state rather than
  // throwing when it is missing.
  auth?: DevAuthPort;
};

export type AppState = NavigationSlice & EdtSlice & RegistrySlice & SettingsSlice & UpdateSlice & LogsSlice & ResetSlice & RoutesSlice;

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
  }));
}

export const useAppStore = createAppStore();
