// tui/store/slices: the repo registry screen — scan a root for `.tui-back.yaml`-carrying
// candidates, register the selected ones, the empty-registry check behind Dashboard's
// onboarding prompt, and classifying/removing stale registry entries.
import type { StateCreator } from 'zustand';
import type { ScanResult } from '../../../../../core/ports/registry.js';
import { registerRepo } from '../../../../../core/scripts/register.js';
import { scanRepos } from '../../../../../core/scripts/scan.js';
import {
  classifyStaleRegistry,
  removeStaleRegistryEntries,
  type StaleRegistryEntry,
  type RemoveStaleRegistryEntryResult,
  type RegistryEntryError,
} from '../../../../../core/scripts/clean-registry.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

// A per-path register outcome, classified by snapshotting registry.list() before registering
// and diffing against it — registerRepo/registry.add are idempotent and never signal
// new-vs-existing on their own.
export type RegistryOutcome = 'registered' | 'already-registered' | 'failed';

export type RegistryRegisterResult = {
  path: string;
  outcome: RegistryOutcome;
  detail?: string;
};

export type RegistrySlice = {
  // Repo registry screen — reachable only via the `registry` command and Dashboard's
  // empty-registry prompt (a store-level open/close flag so both call sites can trigger it).
  registryScreenOpen: boolean;
  openRegistryScreen: () => void;
  closeRegistryScreen: () => void;
  // Bumped by resetRegistryScreen (and therefore by openRegistryScreen, which always calls
  // it) — scanRegistryRoot/registerRegistryCandidates/checkRegistryEmpty each capture this at
  // the start of their async work and no-op their terminal `set()` if it has moved on by the
  // time they resolve, so a stale in-flight call from a superseded session (screen closed and
  // reopened, or reset, while the call was still pending) can never overwrite fresher state.
  registrySessionId: number;
  // Dashboard's "no repos registered yet" prompt (checked before any other Dashboard
  // content). null = not yet checked — Dashboard falls back to its existing content rather
  // than assuming empty. dashboard-zone.tsx re-checks on mount and again whenever
  // registryScreenOpen flips, so the prompt never reflects a stale cached registry state
  // after the registry screen closes (whether or not that closing also switched zones).
  registryEmpty: boolean | null;
  registryEmptyStatus: 'idle' | 'loading' | 'error';
  checkRegistryEmpty: () => Promise<void>;
  // registryScanResult: null = not scanned yet this screen session; a `candidates: []`
  // result is the distinct "nothing found" state (never conflated with
  // registryScanStatus === 'error', a genuine scan failure e.g. root not found).
  registryScanStatus: 'idle' | 'loading' | 'error';
  registryScanError: string | null;
  registryScanResult: ScanResult | null;
  scanRegistryRoot: (root: string) => Promise<void>;
  // registryRegisterResults: null = not registered yet this screen session; populated once,
  // one entry per selected path, in the order registration was attempted.
  registryRegisterStatus: 'idle' | 'loading';
  registryRegisterResults: RegistryRegisterResult[] | null;
  registerRegistryCandidates: (paths: string[]) => Promise<void>;
  // "Clean stale entries" — classify (never write), then remove only the confirmed paths
  // (list-then-confirm, never automatic/silent). registryCleanCandidates: null = not scanned
  // yet this screen session; a `[]` result is the distinct "no stale entries" state.
  registryCleanScanStatus: 'idle' | 'loading' | 'error';
  registryCleanScanError: string | null;
  registryCleanCandidates: StaleRegistryEntry[] | null;
  // Paths whose staleness couldn't even be checked (a registry.exists() error) — reported
  // alongside candidates, never silently dropped. Always `[]` once a classify has resolved
  // successfully with nothing inconclusive, never left stale/undefined.
  registryCleanErrors: RegistryEntryError[];
  scanRegistryStaleEntries: () => Promise<void>;
  // registryCleanResults: null = not removed yet this screen session; populated once, one
  // entry per confirmed path, in the order removal was attempted (mirrors
  // registryRegisterResults' own convention).
  registryCleanStatus: 'idle' | 'loading';
  registryCleanResults: RemoveStaleRegistryEntryResult[] | null;
  removeStaleRegistryCandidates: (paths: string[]) => Promise<void>;
  // Clears scan/register/clean state back to a fresh root-input session — called once on
  // every registry-screen mount so a closed-then-reopened screen (or a second, later `:`
  // open) never shows a stale phase/result from the prior session.
  resetRegistryScreen: () => void;
};

export function createRegistrySlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], RegistrySlice> {
  return (set, get) => ({
    registryScreenOpen: false,
    // Resets scan/register state as part of opening (not a component mount effect) so the
    // reset is atomic with becoming visible — a render seeded with a specific phase's state
    // is never raced by a separate post-mount reset back to root-input.
    openRegistryScreen: () => {
      get().resetRegistryScreen();
      set({ registryScreenOpen: true });
    },
    closeRegistryScreen: () => set({ registryScreenOpen: false }),
    registrySessionId: 0,
    registryEmpty: null,
    registryEmptyStatus: 'idle',
    checkRegistryEmpty: async () => {
      if (!deps) {
        // Deliberately a true no-op — unlike loadEdtsBranches/scanRegistryRoot/
        // registerRegistryCandidates, whose `!deps` path surfaces an explicit error status.
        // Dashboard is the app's always-mounted default zone and calls this on every mount,
        // so treating "store not wired" (a test-scaffolding-only condition — bin/tui.ts's
        // composition root always wires deps) as a genuine registry.list() failure would
        // paint a permanent bogus error banner over Dashboard for every incidental,
        // registry-unrelated test using a bare createAppStore(). registryEmptyStatus stays
        // whatever it already was; a real listing failure (deps wired, list() erroring) is
        // still handled below and does flip to 'error'.
        return;
      }
      const sessionId = get().registrySessionId;
      set({ registryEmptyStatus: 'loading' });
      const result = await deps.registry.list();
      if (get().registrySessionId !== sessionId) {
        // Superseded by a reset/reopen while this listing was in flight — never let a stale
        // result land on top of whatever the current session has already resolved.
        return;
      }
      if (result.ok) {
        set({ registryEmpty: result.data.length === 0, registryEmptyStatus: 'idle' });
      } else {
        // Never keep a stale resolved value once the check itself has failed — a listing
        // failure (e.g. corrupt registry.yaml) must be visibly distinct, not silently masked
        // by whatever registryEmpty last happened to be.
        set({ registryEmpty: null, registryEmptyStatus: 'error' });
      }
    },
    registryScanStatus: 'idle',
    registryScanError: null,
    registryScanResult: null,
    scanRegistryRoot: async (root) => {
      if (!deps) {
        set({ registryScanStatus: 'error', registryScanError: 'No ports wired into the TUI store' });
        return;
      }
      const sessionId = get().registrySessionId;
      set({
        registryScanStatus: 'loading',
        registryScanError: null,
        registryScanResult: null,
        // A fresh scan starts a fresh session — any prior register results are stale once
        // the candidate list they refer to is about to be replaced.
        registryRegisterStatus: 'idle',
        registryRegisterResults: null,
      });
      const result = await scanRepos(deps.registry, root);
      if (get().registrySessionId !== sessionId) {
        return;
      }
      if (result.ok) {
        set({ registryScanStatus: 'idle', registryScanResult: result.data });
      } else {
        set({ registryScanStatus: 'error', registryScanError: result.error.message, registryScanResult: null });
      }
    },
    registryRegisterStatus: 'idle',
    registryRegisterResults: null,
    registerRegistryCandidates: async (paths) => {
      if (!deps) {
        set({
          registryRegisterStatus: 'idle',
          registryRegisterResults: paths.map((path) => ({
            path,
            outcome: 'failed' as const,
            detail: 'No ports wired into the TUI store',
          })),
        });
        return;
      }
      const sessionId = get().registrySessionId;
      set({ registryRegisterStatus: 'loading' });
      // registerRepo/registry.add are idempotent and never signal new-vs-existing — classify
      // by snapshotting registry.list() *before* registering, then diffing each canonicalized
      // outcome against that snapshot.
      const before = await deps.registry.list();
      if (!before.ok) {
        // A failed snapshot must never be silently treated as an empty registry — that would
        // misclassify every already-registered selected path as "registered" instead of
        // surfacing the real error.
        if (get().registrySessionId === sessionId) {
          set({
            registryRegisterStatus: 'idle',
            registryRegisterResults: paths.map((path) => ({
              path,
              outcome: 'failed' as const,
              detail: before.error.message,
            })),
          });
        }
        return;
      }
      const beforePaths = new Set(before.data);
      const results: RegistryRegisterResult[] = [];
      for (const path of paths) {
        const registered = await registerRepo(deps.registry, deps.lock, deps.registryResourceKey, path);
        if (!registered.ok) {
          // A failed path never blocks the remaining selected paths from being attempted.
          results.push({ path, outcome: 'failed', detail: registered.error.message });
          continue;
        }
        const canonicalPath = registered.data.path;
        results.push({
          path: canonicalPath,
          outcome: beforePaths.has(canonicalPath) ? 'already-registered' : 'registered',
        });
      }
      if (get().registrySessionId !== sessionId) {
        return;
      }
      set({ registryRegisterStatus: 'idle', registryRegisterResults: results });
    },
    registryCleanScanStatus: 'idle',
    registryCleanScanError: null,
    registryCleanCandidates: null,
    registryCleanErrors: [],
    scanRegistryStaleEntries: async () => {
      if (!deps) {
        set({ registryCleanScanStatus: 'error', registryCleanScanError: 'No ports wired into the TUI store' });
        return;
      }
      const sessionId = get().registrySessionId;
      set({
        registryCleanScanStatus: 'loading',
        registryCleanScanError: null,
        registryCleanCandidates: null,
        registryCleanErrors: [],
        // A fresh classify starts a fresh clean session — any prior removal results are
        // stale once the candidate list they refer to is about to be replaced.
        registryCleanStatus: 'idle',
        registryCleanResults: null,
      });
      const result = await classifyStaleRegistry({
        registry: deps.registry,
        manifest: deps.manifest,
        edtRegistry: deps.edtRegistry,
      });
      if (get().registrySessionId !== sessionId) {
        return;
      }
      if (result.ok) {
        set({
          registryCleanScanStatus: 'idle',
          registryCleanCandidates: result.data.candidates,
          registryCleanErrors: result.data.errors,
        });
      } else {
        set({
          registryCleanScanStatus: 'error',
          registryCleanScanError: result.error.message,
          registryCleanCandidates: null,
          registryCleanErrors: [],
        });
      }
    },
    registryCleanStatus: 'idle',
    registryCleanResults: null,
    removeStaleRegistryCandidates: async (paths) => {
      if (!deps) {
        set({
          registryCleanStatus: 'idle',
          registryCleanResults: paths.map((path) => ({
            path,
            outcome: 'failed' as const,
            detail: { code: 'internal-error', message: 'No ports wired into the TUI store' },
          })),
        });
        return;
      }
      const sessionId = get().registrySessionId;
      set({ registryCleanStatus: 'loading' });
      const removed = await removeStaleRegistryEntries(
        { registry: deps.registry, lock: deps.lock, registryResourceKey: deps.registryResourceKey },
        paths,
      );
      if (get().registrySessionId !== sessionId) {
        return;
      }
      if (removed.ok) {
        set({ registryCleanStatus: 'idle', registryCleanResults: removed.data.results });
      } else {
        // removeStaleRegistryEntries isolates every per-path failure internally and always
        // resolves ok — this branch only guards a future signature change from silently
        // losing the outcome the way registerRegistryCandidates' own before-snapshot-failure
        // branch already does.
        set({
          registryCleanStatus: 'idle',
          registryCleanResults: paths.map((path) => ({
            path,
            outcome: 'failed' as const,
            detail: { code: removed.error.code, message: removed.error.message },
          })),
        });
      }
    },
    resetRegistryScreen: () =>
      set((state) => ({
        registrySessionId: state.registrySessionId + 1,
        registryScanStatus: 'idle',
        registryScanError: null,
        registryScanResult: null,
        registryRegisterStatus: 'idle',
        registryRegisterResults: null,
        registryCleanScanStatus: 'idle',
        registryCleanScanError: null,
        registryCleanCandidates: null,
        registryCleanErrors: [],
        registryCleanStatus: 'idle',
        registryCleanResults: null,
      })),
  });
}
