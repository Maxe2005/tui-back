// tui/store/slices: the Routes zone's domain state (story 6.1) — which repo's routes are
// shown, the discovered Route[] itself, and the scan lifecycle. Extracted from app-store.ts
// (see that file's header for why) — a StateCreator factory combined with the other slices
// into one Zustand store (AD-10: still exactly one store/one hook).
//
// The zone shows one repo's routes: the active EDT's member carrying `route-explorer when
// one exists, else the first registry-wide carrying repo (mirroring
// core/edt/resolve-tab-visibility.ts's own active-member resolution, which this slice does
// not duplicate — it reuses listRepos' ManagedRepo rows plus the same state/edtRegistry
// reads). No carrying repo at all is the named `route-exploration-not-activated` error,
// never an empty list; a scanner failure is `route-scan-failed` with its reason; a
// successful zero-route scan is `ready` with `[]` — failure and genuinely-empty stay
// visibly distinct downstream because the status/error fields (not the array length)
// drive the zone's rendering. An unwired store (every pre-6.1 `createAppStore()` call,
// including tests) degrades to an explicit error rather than throwing.
import { resolve } from 'node:path';
import type { StateCreator } from 'zustand';
import { ROUTES_MODULE_ID } from '../../../../../core/edt/resolve-tab-visibility.js';
import type { Route } from '../../../../../core/ports/route-scanner.js';
import { fireRequest, type FireResult } from '../../../../../core/routes/fire-request.js';
import { listRoutes } from '../../../../../core/routes/list-routes.js';
import { listRepos } from '../../../../../core/scripts/list-repos.js';
import type { TextInputState } from '../../shared/components/text-edit.js';
import type { AppState, AppStoreDeps } from '../app-store.js';
import {
  MAX_JSON_TREE_STATES,
  createDefaultJsonTreeState,
  pruneJsonTreeStates,
  routeKeyFor,
  type JsonTreeState,
} from '../../shared/components/json-tree/model.js';

const NO_DEPS_ERROR = 'No ports wired into the TUI store';
const NO_SCANNER_ERROR = 'No route scanner wired into the TUI store';
const NO_AUTH_ERROR = 'No dev auth wired into the TUI store';

export type RoutesStatus = 'idle' | 'loading' | 'ready' | 'error';

export type FireStatus = 'idle' | 'firing' | 'fired' | 'error';

export type { JsonTreeState };

export type RoutesSlice = {
  routesRepoPath: string | null;
  routes: Route[] | null;
  routesStatus: RoutesStatus;
  routesError: { code: string; message: string } | null;
  // The route filter lives in the store (not zone-local state) so it survives tab switches,
  // like the streamed logs do — the zone unmounts on every tab change.
  routesFilter: TextInputState;
  routesSelected: number;
  setRoutesSelected: (index: number) => void;
  setRoutesFilter: (filter: TextInputState) => void;
  loadRoutes: () => Promise<void>;
  fireStatus: FireStatus;
  fireResult: FireResult | null;
  fireError: { code: string; message: string } | null;
  fireRoute: (method: string, path: string) => Promise<void>;
  // Story 6.7: the JsonTree's per-route session state (folds, key rules, hide-nulls,
  // selection), keyed `METHOD + ' ' + path`. Session-only — never persisted to disk —
  // and pruned to the MAX_JSON_TREE_STATES most-recently-touched entries on every touch.
  jsonTreeStates: Record<string, JsonTreeState>;
  // The fired route's key, stored next to the fire triple so the tree state follows the
  // response (not the list cursor); a re-fire on the same key re-applies its rules.
  firedRouteKey: string | null;
  // Firing moves keyboard focus to the response tree (arrows/fold/filter keys go there);
  // Esc returns focus to the routes list.
  treeFocused: boolean;
  setTreeFocused: (focused: boolean) => void;
  updateJsonTreeState: (routeKey: string, updater: (previous: JsonTreeState) => JsonTreeState) => void;
};

export function createRoutesSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], RoutesSlice> {
  return (set, get) => ({
    routesRepoPath: null,
    routes: null,
    routesStatus: 'idle',
    routesError: null,
    routesFilter: { value: '', cursor: 0 },
    setRoutesFilter: (filter) => set({ routesFilter: filter }),
    routesSelected: 0,
    setRoutesSelected: (index) => set({ routesSelected: index }),
    fireStatus: 'idle',
    fireResult: null,
    fireError: null,
    jsonTreeStates: {},
    firedRouteKey: null,
    treeFocused: false,
    setTreeFocused: (focused) => set({ treeFocused: focused }),
    // Touch = delete + re-insert (Record insertion order = recency), then prune past the
    // cap. Creates the route's default state on first touch; updaters must be pure.
    updateJsonTreeState: (routeKey, updater) =>
      set((state) => {
        const previous = state.jsonTreeStates[routeKey] ?? createDefaultJsonTreeState();
        const next = updater(previous);
        const touched: Record<string, JsonTreeState> = { ...state.jsonTreeStates };
        delete touched[routeKey];
        touched[routeKey] = next;
        return { jsonTreeStates: pruneJsonTreeStates(touched, MAX_JSON_TREE_STATES) };
      }),
    loadRoutes: async () => {
      if (!deps) {
        set({ routesStatus: 'error', routesError: { code: 'store-not-wired', message: NO_DEPS_ERROR } });
        return;
      }
      if (!deps.scanner) {
        set({ routesStatus: 'error', routesError: { code: 'store-not-wired', message: NO_SCANNER_ERROR } });
        return;
      }
      if (get().routesStatus === 'loading') {
        return;
      }
      set({ routesStatus: 'loading', routesError: null });

      const listed = await listRepos(deps.registry, deps.manifest);
      if (!listed.ok) {
        set({ routesStatus: 'error', routes: null, routesError: { code: listed.error.code, message: listed.error.message } });
        return;
      }
      const carrying = listed.data.repos.filter((repo) => repo.moduleIds.includes(ROUTES_MODULE_ID));
      if (carrying.length === 0) {
        set({
          routesStatus: 'error',
          routes: null,
          routesError: {
            code: 'route-exploration-not-activated',
            message: 'No route list for this repo: no managed repo activates the route-explorer module',
          },
        });
        return;
      }

      // Mirrors core/edt/resolve-tab-visibility.ts's active-EDT-member resolution: prefer a
      // carrying repo that belongs to the active EDT, else fall back to the first carrying
      // repo. A state/registry read failure degrades to the same fallback rather than
      // failing the whole load — the manifest gate above already decided listability.
      let target = carrying[0];
      const activeUlid = await deps.state.readActiveEdt();
      if (activeUlid.ok && activeUlid.data !== null) {
        const edts = await deps.edtRegistry.list();
        if (edts.ok) {
          const active = edts.data.find((candidate) => candidate.ulid === activeUlid.data);
          if (active !== undefined) {
            const memberPaths = new Set(active.members.map((member) => resolve(member.repoPath)));
            const memberCarrying = carrying.find((repo) => memberPaths.has(resolve(repo.path)));
            if (memberCarrying !== undefined) {
              target = memberCarrying;
            }
          }
        }
      }

      const result = await listRoutes({ manifest: deps.manifest, scanner: deps.scanner }, target.path);
      if (result.ok) {
        // A successful reload (repo switch included) drops any previous fire result — the
        // old response belongs to another route list and must not linger in the detail pane.
        // The fire triple resets exactly as before, plus its two story-6.7 neighbors (the
        // per-route tree states themselves survive: a re-fire re-applies them).
        set({
          routesRepoPath: target.path,
          routes: result.data.routes,
          routesStatus: 'ready',
          routesError: null,
          fireStatus: 'idle',
          fireResult: null,
          fireError: null,
          firedRouteKey: null,
          treeFocused: false,
        });
      } else {
        set({
          routesRepoPath: target.path,
          routes: null,
          routesStatus: 'error',
          routesError: { code: result.error.code, message: result.error.message },
        });
      }
    },
    // Story 6.2: fire the selected route through core/routes/fire-request.ts in-process
    // (AD-2) — the same use-case `tui-back fire-request` runs out-of-process. The repo is
    // the slice's own loaded routes repo (no logs pane — Story 6.4); a concurrent fire is
    // dropped like loadRoutes drops a concurrent load. An unwired store (every pre-6.2
    // `createAppStore()` call, including tests) degrades to an explicit error rather than
    // throwing.
    fireRoute: async (method: string, path: string) => {
      if (!deps) {
        set({ fireStatus: 'error', fireResult: null, fireError: { code: 'store-not-wired', message: NO_DEPS_ERROR } });
        return;
      }
      if (!deps.scanner) {
        set({ fireStatus: 'error', fireResult: null, fireError: { code: 'store-not-wired', message: NO_SCANNER_ERROR } });
        return;
      }
      if (!deps.auth) {
        set({ fireStatus: 'error', fireResult: null, fireError: { code: 'store-not-wired', message: NO_AUTH_ERROR } });
        return;
      }
      if (get().fireStatus === 'firing') {
        return;
      }
      const repoPath = get().routesRepoPath;
      if (repoPath === null) {
        set({
          fireStatus: 'error',
          fireResult: null,
          fireError: { code: 'missing-argument', message: 'No routes repo selected' },
        });
        return;
      }
      set({ fireStatus: 'firing', fireResult: null, fireError: null });

      const result = await fireRequest(
        { manifest: deps.manifest, scanner: deps.scanner, auth: deps.auth },
        repoPath,
        method,
        path,
      );
      if (result.ok) {
        // Story 6.7: firing focuses the response tree and touches (never resets) the
        // route's tree state, so a re-fire re-applies its key rules and normalized folds.
        const firedRouteKey = routeKeyFor(method, path);
        set((state) => {
          const touched: Record<string, JsonTreeState> = { ...state.jsonTreeStates };
          const previous = touched[firedRouteKey] ?? createDefaultJsonTreeState();
          delete touched[firedRouteKey];
          touched[firedRouteKey] = previous;
          return {
            fireStatus: 'fired',
            fireResult: result.data,
            fireError: null,
            firedRouteKey,
            treeFocused: true,
            jsonTreeStates: pruneJsonTreeStates(touched, MAX_JSON_TREE_STATES),
          };
        });
      } else {
        set({
          fireStatus: 'error',
          fireResult: null,
          fireError: { code: result.error.code, message: result.error.message },
          treeFocused: false,
        });
      }
    },
  });
}
