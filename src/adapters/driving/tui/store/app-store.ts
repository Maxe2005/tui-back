// tui/store: the single cross-zone Zustand store (AD-10) — composed from per-concern slices
// under slices/ (navigation/chrome, EDT domain state, the repo registry screen, and the
// `:settings` screen). Each slice owns its own fields/actions and is unit-tested directly
// (AD-13); this file's only job is to declare the combined `AppState` shape, wire
// `AppStoreDeps` (the ports every slice's use-case calls close over, AD-2) through to each
// slice factory, and export the one `createAppStore()`/`useAppStore` pair every driving
// adapter (zones, command-bar, app-shell) imports.
import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import type { EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../core/ports/git.js';
import type { LockPort } from '../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../core/ports/registry.js';
import type { SettingsPort } from '../../../../core/ports/settings.js';
import type { StatePort } from '../../../../core/ports/state.js';
import { createNavigationSlice, type NavigationSlice } from './slices/navigation-slice.js';
import { createEdtSlice, type EdtSlice } from './slices/edt-slice.js';
import { createRegistrySlice, type RegistrySlice } from './slices/registry-slice.js';
import { createSettingsSlice, type SettingsSlice } from './slices/settings-slice.js';

export type { ZoneEvents, ZoneRatios, ResizeMode } from './slices/navigation-slice.js';
export type { CreateEdtParams, SwitchEdtParams, ModifyEdtParams, EdtActionState, EdtActionLogEntry } from './slices/edt-slice.js';
export { DEFAULT_BASE_BRANCH, NO_BRANCH_CREATION } from './slices/edt-slice.js';
export type { RegistryOutcome, RegistryRegisterResult } from './slices/registry-slice.js';
export type { SettingsUpdate } from './slices/settings-slice.js';

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
};

export type AppState = NavigationSlice & EdtSlice & RegistrySlice & SettingsSlice;

export function createAppStore(deps?: AppStoreDeps) {
  return create<AppState>()((...args) => ({
    ...createNavigationSlice(deps)(...args),
    ...createEdtSlice(deps)(...args),
    ...createRegistrySlice(deps)(...args),
    ...createSettingsSlice(deps)(...args),
  }));
}

export const useAppStore = createAppStore();
