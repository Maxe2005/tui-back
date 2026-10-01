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
import { fireRequest, type FireRequestOptions, type FireResult } from '../../../../../core/routes/fire-request.js';
import { listRoutes } from '../../../../../core/routes/list-routes.js';
import { listRepos } from '../../../../../core/scripts/list-repos.js';
import type { TextInputState } from '../../shared/components/text-edit.js';
import type { AppState, AppStoreDeps } from '../app-store.js';
import {
  MAX_BODY_DRAFTS,
  MAX_JSON_TREE_STATES,
  createDefaultJsonTreeState,
  pruneBodyDrafts,
  pruneJsonTreeStates,
  type BodyEditError,
  type JsonTreeState,
} from '../../shared/components/json-tree/model.js';
import {
  MAX_REQUEST_DRAFTS,
  MAX_ROUTE_RESPONSES,
  type RequestDraft,
} from '../../zones/routes/routes-request.logic.js';

const NO_DEPS_ERROR = 'No ports wired into the TUI store';
const NO_SCANNER_ERROR = 'No route scanner wired into the TUI store';
const NO_AUTH_ERROR = 'No dev auth wired into the TUI store';

export type RoutesStatus = 'idle' | 'loading' | 'ready' | 'error';

// Story 6.9: one fire outcome per route (the old global fire triple, now keyed).
export type RouteResponse =
  | { status: 'firing' }
  | { status: 'fired'; result: FireResult }
  | { status: 'error'; error: { code: string; message: string } };

export type RoutesPaneFocus = 'list' | 'detail';

// The right pane's sub-tabs, in display order. Story 6.4 appends 'logs'.
export type RoutesPaneTab = 'request' | 'response';
export const ROUTES_PANE_TABS: readonly RoutesPaneTab[] = ['request', 'response'];

export type { JsonTreeState, RequestDraft };

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
  // Story 6.9: per-route request drafts (params/query/headers — the body stays in
  // `bodyDrafts`) and last responses, keyed `METHOD + ' ' + templatePath`. Session-only,
  // pruned to their caps on every touch like `jsonTreeStates`; kept across a same-repo
  // reload, dropped on a reload onto another repo.
  requestDrafts: Record<string, RequestDraft>;
  responses: Record<string, RouteResponse>;
  ensureRequestDraft: (routeKey: string, seed: RequestDraft) => void;
  updateRequestDraft: (routeKey: string, updater: (previous: RequestDraft) => RequestDraft) => void;
  // Which side owns the keyboard, and the right pane's active sub-tab.
  routesPaneFocus: RoutesPaneFocus;
  routesPaneTab: RoutesPaneTab;
  setRoutesPaneFocus: (focus: RoutesPaneFocus) => void;
  setRoutesPaneTab: (tab: RoutesPaneTab) => void;
  // Fires `method + path` (path may be concrete, params substituted) and records the
  // outcome under `routeKey` (the template route's key); switches the pane to Response.
  fireRoute: (routeKey: string, method: string, path: string, options?: FireRequestOptions) => Promise<void>;
  // Story 6.7: the JsonTree's per-route session state (folds, key rules, hide-nulls,
  // selection), keyed `METHOD + ' ' + path`. Session-only — never persisted to disk —
  // and pruned to the MAX_JSON_TREE_STATES most-recently-touched entries on every touch.
  jsonTreeStates: Record<string, JsonTreeState>;
  // Story 6.8: the body editor's per-route session drafts, keyed the same way.
  // Session-only, never persisted; seeded lazily from the route's `bodyExample` on first
  // open (`undefined` = empty, press `r`) and pruned to the MAX_BODY_DRAFTS
  // most-recently-touched entries on every touch, mirroring `jsonTreeStates`.
  bodyDrafts: Record<string, unknown>;
  // Per-path scalar validation entries for the draft (`Record<routeKey,
  // Record<concretePath, BodyEditError>>`): an invalid entry keeps its raw text in the
  // draft and renders in error color, never coerced; the entry keeps the pre-error
  // scalar kind so a fix re-validates against the original kind. Cleared per-path on
  // the next valid edit, wholesale on a raw-buffer replace; aligned to the drafts' keys
  // on every touch.
  bodyEditErrors: Record<string, Record<string, BodyEditError>>;
  ensureBodyDraft: (routeKey: string, seed: unknown) => void;
  updateBodyDraft: (routeKey: string, updater: (previous: unknown) => unknown) => void;
  setBodyEditError: (routeKey: string, path: string, entry: BodyEditError | null) => void;
  setBodyEditErrors: (routeKey: string, errors: Record<string, BodyEditError>) => void;
  updateJsonTreeState: (routeKey: string, updater: (previous: JsonTreeState) => JsonTreeState) => void;
};

function hasDraft(drafts: Record<string, unknown>, routeKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(drafts, routeKey);
}

// Joint touch for story 6.8 drafts + error maps: both re-insert the route key (recency),
// drafts prune to MAX_BODY_DRAFTS, and error maps without a surviving draft drop — the
// two maps never drift apart. A null `nextErrors` keeps the route's existing map.
// Touch = delete + re-insert (Record insertion order = recency), then prune past the cap.
function touchEntry<T>(entries: Record<string, T>, routeKey: string, value: T, limit: number): Record<string, T> {
  const touched: Record<string, T> = { ...entries };
  delete touched[routeKey];
  touched[routeKey] = value;
  return pruneBodyDrafts(touched, limit);
}

function touchBodyDraftEntries(
  drafts: Record<string, unknown>,
  errors: Record<string, Record<string, BodyEditError>>,
  routeKey: string,
  draftValue: unknown,
  nextErrors: Record<string, BodyEditError> | null,
): { bodyDrafts: Record<string, unknown>; bodyEditErrors: Record<string, Record<string, BodyEditError>> } {
  const touchedDrafts: Record<string, unknown> = { ...drafts };
  delete touchedDrafts[routeKey];
  touchedDrafts[routeKey] = draftValue;
  const prunedDrafts = pruneBodyDrafts(touchedDrafts, MAX_BODY_DRAFTS);
  const touchedErrors: Record<string, Record<string, BodyEditError>> = { ...errors };
  const kept = nextErrors ?? touchedErrors[routeKey] ?? {};
  delete touchedErrors[routeKey];
  touchedErrors[routeKey] = kept;
  const aligned: Record<string, Record<string, BodyEditError>> = {};
  for (const key of Object.keys(prunedDrafts)) {
    aligned[key] = touchedErrors[key] ?? {};
  }
  return { bodyDrafts: prunedDrafts, bodyEditErrors: aligned };
}

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
    requestDrafts: {},
    responses: {},
    routesPaneFocus: 'list',
    routesPaneTab: 'request',
    setRoutesPaneFocus: (focus) => set({ routesPaneFocus: focus }),
    setRoutesPaneTab: (tab) => set({ routesPaneTab: tab }),
    ensureRequestDraft: (routeKey, seed) =>
      set((state) => ({
        requestDrafts: touchEntry(state.requestDrafts, routeKey, state.requestDrafts[routeKey] ?? seed, MAX_REQUEST_DRAFTS),
      })),
    updateRequestDraft: (routeKey, updater) =>
      set((state) => {
        const previous = state.requestDrafts[routeKey] ?? { params: [], query: [], headers: [] };
        return { requestDrafts: touchEntry(state.requestDrafts, routeKey, updater(previous), MAX_REQUEST_DRAFTS) };
      }),
    jsonTreeStates: {},
    bodyDrafts: {},
    bodyEditErrors: {},
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
    // Story 6.8: draft touches mirror the tree-state pattern. Drafts and their error
    // maps touch together (opening/editing a draft marks both recent); the prune keeps
    // the drafts to MAX_BODY_DRAFTS and drops error maps for keys without a draft, so
    // the two never drift apart.
    ensureBodyDraft: (routeKey, seed) =>
      set((state) => touchBodyDraftEntries(state.bodyDrafts, state.bodyEditErrors, routeKey, hasDraft(state.bodyDrafts, routeKey) ? state.bodyDrafts[routeKey] : seed, null)),
    updateBodyDraft: (routeKey, updater) =>
      set((state) => {
        const previous = hasDraft(state.bodyDrafts, routeKey) ? state.bodyDrafts[routeKey] : undefined;
        return touchBodyDraftEntries(state.bodyDrafts, state.bodyEditErrors, routeKey, updater(previous), null);
      }),
    setBodyEditError: (routeKey, path, entry) =>
      set((state) => {
        const current = state.bodyEditErrors[routeKey] ?? {};
        const nextErrors = { ...current };
        if (entry === null) {
          delete nextErrors[path];
        } else {
          nextErrors[path] = entry;
        }
        const draftValue = hasDraft(state.bodyDrafts, routeKey) ? state.bodyDrafts[routeKey] : undefined;
        return touchBodyDraftEntries(state.bodyDrafts, state.bodyEditErrors, routeKey, draftValue, nextErrors);
      }),
    setBodyEditErrors: (routeKey, errors) =>
      set((state) => {
        const draftValue = hasDraft(state.bodyDrafts, routeKey) ? state.bodyDrafts[routeKey] : undefined;
        return touchBodyDraftEntries(state.bodyDrafts, state.bodyEditErrors, routeKey, draftValue, { ...errors });
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
        // Story 6.9: a same-repo reload (every zone remount) keeps each route's drafts and
        // last response; a reload onto another repo drops them — they belong to another
        // route list — and hands the keyboard back to the list. Tree states survive either
        // way (keyed, harmless; a re-fire re-applies them).
        const previousRepoPath = get().routesRepoPath;
        const repoChanged = previousRepoPath !== null && resolve(previousRepoPath) !== resolve(target.path);
        set({
          routesRepoPath: target.path,
          routes: result.data.routes,
          routesStatus: 'ready',
          routesError: null,
          ...(repoChanged
            ? {
                requestDrafts: {},
                responses: {},
                bodyDrafts: {},
                bodyEditErrors: {},
                routesPaneFocus: 'list' as const,
                routesPaneTab: 'request' as const,
              }
            : {}),
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
    // Story 6.2: fire a route through core/routes/fire-request.ts in-process (AD-2) — the
    // same use-case `tui-back fire-request` runs out-of-process. The repo is the slice's
    // own loaded routes repo. Story 6.9: the outcome is recorded per route; a concurrent
    // fire of the same route is dropped (other routes may fire meanwhile). An unwired
    // store (every pre-6.2 `createAppStore()` call, including tests) degrades to an
    // explicit error rather than throwing.
    fireRoute: async (routeKey, method, path, options) => {
      const record = (response: RouteResponse) =>
        set((state) => ({ responses: touchEntry(state.responses, routeKey, response, MAX_ROUTE_RESPONSES) }));
      const fail = (code: string, message: string) => record({ status: 'error', error: { code, message } });
      if (get().responses[routeKey]?.status === 'firing') {
        return;
      }
      set({ routesPaneTab: 'response' });
      if (!deps) {
        fail('store-not-wired', NO_DEPS_ERROR);
        return;
      }
      if (!deps.scanner) {
        fail('store-not-wired', NO_SCANNER_ERROR);
        return;
      }
      if (!deps.auth) {
        fail('store-not-wired', NO_AUTH_ERROR);
        return;
      }
      const repoPath = get().routesRepoPath;
      if (repoPath === null) {
        fail('missing-argument', 'No routes repo selected');
        return;
      }
      record({ status: 'firing' });

      const result = await fireRequest(
        { manifest: deps.manifest, scanner: deps.scanner, auth: deps.auth },
        repoPath,
        method,
        path,
        ...(options === undefined ? [] : [options]),
      );
      // A reload onto another repo while in flight dropped this route's entry — the late
      // outcome belongs to the old route list and must not resurrect it.
      if (get().routesRepoPath !== repoPath) {
        return;
      }
      if (result.ok) {
        // Story 6.7: touch (never reset) the route's response tree state, so a re-fire
        // re-applies its key rules and normalized folds.
        set((state) => ({
          responses: touchEntry(state.responses, routeKey, { status: 'fired', result: result.data }, MAX_ROUTE_RESPONSES),
          jsonTreeStates: touchEntry(
            state.jsonTreeStates,
            routeKey,
            state.jsonTreeStates[routeKey] ?? createDefaultJsonTreeState(),
            MAX_JSON_TREE_STATES,
          ),
        }));
      } else {
        fail(result.error.code, result.error.message);
      }
    },
  });
}
