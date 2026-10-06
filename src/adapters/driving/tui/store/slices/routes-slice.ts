// tui/store/slices: the Routes zone's state — one repo's discovered routes (the active EDT's
// member carrying `route-explorer`, else the first carrying repo), the scan lifecycle, and the
// per-route drafts, responses, tree states and body drafts. No carrying repo is
// `route-exploration-not-activated`, never an empty list: the status/error fields, not the
// array length, drive the zone so failure and genuinely-empty stay distinct.
import { resolve } from 'node:path';
import type { StateCreator } from 'zustand';
import { ROUTES_MODULE_ID } from '../../../../../core/edt/resolve-tab-visibility.js';
import type { Route } from '../../../../../core/ports/route-scanner.js';
import type { SavedRequest } from '../../../../../core/ports/saved-request.js';
import { err, ok, type Result } from '../../../../../core/result.js';
import { fireRequest, type FireRequestOptions, type FireResult } from '../../../../../core/routes/fire-request.js';
import { listRoutes } from '../../../../../core/routes/list-routes.js';
import {
  deleteSavedRequest as deleteSavedRequestUseCase,
  listSavedRequests,
  overwriteSavedRequest,
  saveRequest,
  type SavedWithStale,
} from '../../../../../core/routes/saved-requests.js';
import { listRepos } from '../../../../../core/scripts/list-repos.js';
import type { TextInputState } from '../../shared/components/text-edit.js';
import type { AppState, AppStoreDeps } from '../app-store.js';
import {
  MAX_BODY_DRAFTS,
  MAX_JSON_TREE_STATES,
  createDefaultJsonTreeState,
  pruneBodyDrafts,
  pruneJsonTreeStates,
  routeKeyFor,
  type BodyEditError,
  type JsonTreeState,
} from '../../shared/components/json-tree/model.js';
import {
  MAX_REQUEST_DRAFTS,
  MAX_ROUTE_RESPONSES,
  bodyTreeKey,
  seedRequestDraft,
  type RequestDraft,
} from '../../zones/routes/routes-request.logic.js';

export const MAX_DRAFT_ORIGINS = 50;

const NO_DEPS_ERROR = 'No ports wired into the TUI store';
const NO_SCANNER_ERROR = 'No route scanner wired into the TUI store';
const NO_AUTH_ERROR = 'No dev auth wired into the TUI store';
const NO_SAVED_ERROR = 'No saved-request store wired into the TUI store';

export type RoutesStatus = 'idle' | 'loading' | 'ready' | 'error';

// One fire outcome per route.
export type RouteResponse =
  | { status: 'firing' }
  | { status: 'fired'; result: FireResult }
  | { status: 'error'; error: { code: string; message: string } };

export type RoutesPaneFocus = 'list' | 'detail';

// The right pane's sub-tabs, in display order.
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
  // Per-route request drafts (params/query/headers — the body stays in `bodyDrafts`) and last
  // responses, keyed `METHOD + ' ' + templatePath`. Session-only, pruned to their caps on every
  // touch like `jsonTreeStates`; kept across a same-repo reload, dropped on a reload onto
  // another repo.
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
  // The JsonTree's per-route session state (folds, key rules, hide-nulls, selection), keyed
  // `METHOD + ' ' + path`. Session-only — never persisted to disk — and pruned to the
  // MAX_JSON_TREE_STATES most-recently-touched entries on every touch.
  jsonTreeStates: Record<string, JsonTreeState>;
  // The body editor's per-route session drafts, keyed the same way. Session-only, never
  // persisted; seeded lazily from the route's `bodyExample` on first open (`undefined` =
  // empty, press `r`) and pruned to the MAX_BODY_DRAFTS most-recently-touched entries on
  // every touch, mirroring `jsonTreeStates`.
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
  // Which saved request a draft came from (`routeKey -> saved id`), so a re-fire can offer
  // overwrite-original vs. save-as-new. Same 50-entry LRU prune as the other per-route maps;
  // kept across a same-repo reload, dropped with the other maps on a repo switch.
  draftOrigins: Record<string, string>;
  // The last library listing with advisory stale flags (global, not per-repo — kept across
  // reloads and refreshed on demand for the saved picker and the CLI-mirroring views).
  savedRequests: SavedWithStale[] | null;
  savedRequestsError: { code: string; message: string } | null;
  refreshSavedRequests: (repoPath?: string) => Promise<void>;
  // Persists one route's live draft (params stay template-seeded; query/headers/body/tree go
  // verbatim) under `name`. Overwrite updates the colliding record in place (bumping
  // `updatedAt`); without it a colliding name is `duplicate-request-name` and nothing is saved.
  saveRequestDraft: (name: string, routeKey: string, opts?: { overwrite?: boolean }) => Promise<Result<SavedRequest>>;
  // Seeds `requestDraft`, the `#body` draft and `jsonTreeStates` from the named record and
  // links the route's origin to it. A stale record loads anyway — the hard gate stays at fire
  // time, where `fireRoute` still rejects the vanished route with `unknown-route`.
  loadSavedRequest: (name: string) => Promise<Result<void>>;
  // Removes one record by exact name (`saved-request-not-found` when unknown) and unlinks
  // every draft origin pointing at it.
  deleteSavedRequest: (name: string) => Promise<Result<void>>;
};

function hasDraft(drafts: Record<string, unknown>, routeKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(drafts, routeKey);
}

// Touch = delete + re-insert (Record insertion order = recency), then prune past the cap
// (`pruneBodyDrafts` is the generic most-recent-N pruner, despite its name).
function touchEntry<T>(entries: Record<string, T>, routeKey: string, value: T, limit: number): Record<string, T> {
  const touched: Record<string, T> = { ...entries };
  delete touched[routeKey];
  touched[routeKey] = value;
  return pruneBodyDrafts(touched, limit);
}

// Joint touch for drafts + error maps: both re-insert the route key (recency), drafts prune
// to MAX_BODY_DRAFTS, and error maps without a surviving draft drop — the two maps never
// drift apart. A null `nextErrors` keeps the route's existing map.
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

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRoutesSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], RoutesSlice> {
  // In-flight fires are tracked apart from the pruned `responses` map (a pruned `firing` entry
  // must never re-open the door to a duplicate fire), and every reload onto another repo bumps
  // a generation so a late outcome from before it — even after a switch back to the same repo
  // — never lands in the fresh maps.
  const inFlight = new Set<string>();
  let repoGeneration = 0;
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
    draftOrigins: {},
    savedRequests: null,
    savedRequestsError: null,
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
    // Draft touches mirror the tree-state pattern. Drafts and their error maps touch together
    // (opening/editing a draft marks both recent); the prune keeps the drafts to
    // MAX_BODY_DRAFTS and drops error maps for keys without a draft, so the two never drift
    // apart.
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
        // A same-repo reload (every zone remount) keeps each route's drafts and last response;
        // a reload onto another repo drops them — they belong to another route list — and hands
        // the keyboard back to the list. Tree states survive either way (keyed, harmless; a
        // re-fire re-applies them).
        const previousRepoPath = get().routesRepoPath;
        const repoChanged = previousRepoPath !== null && resolve(previousRepoPath) !== resolve(target.path);
        if (repoChanged) {
          repoGeneration += 1;
        }
        set({
          routesRepoPath: target.path,
          routes: result.data.routes,
          routesStatus: 'ready',
          routesError: null,
          ...(repoChanged
            ? {
                requestDrafts: {},
                responses: {},
                draftOrigins: {},
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
    // Fires a route through core/routes/fire-request.ts in-process (AD-2) — the same use-case
    // `tui-back fire-request` runs — against the slice's loaded routes repo. The outcome is
    // recorded per route; a concurrent fire of the same route is dropped (other routes may
    // fire meanwhile). An unwired store degrades to an explicit error rather than throwing.
    fireRoute: async (routeKey, method, path, options) => {
      const record = (response: RouteResponse) =>
        set((state) => ({ responses: touchEntry(state.responses, routeKey, response, MAX_ROUTE_RESPONSES) }));
      const fail = (code: string, message: string) => record({ status: 'error', error: { code, message } });
      // The pane shows Response even for a dropped duplicate, so Ctrl+R always answers.
      set({ routesPaneTab: 'response' });
      if (inFlight.has(routeKey)) {
        return;
      }
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
      inFlight.add(routeKey);
      const generation = repoGeneration;

      let result: Awaited<ReturnType<typeof fireRequest>>;
      try {
        result = await fireRequest(
          { manifest: deps.manifest, scanner: deps.scanner, auth: deps.auth },
          repoPath,
          method,
          path,
          ...(options === undefined ? [] : [options]),
        );
      } catch (error) {
        // A throwing port must never leave the route stuck in `firing`.
        result = { ok: false, error: { code: 'request-failed', message: `Request failed for ${method} ${path}: ${reasonOf(error)}` } };
      } finally {
        inFlight.delete(routeKey);
      }
      // A reload onto another repo while in flight dropped this route's entry — the late
      // outcome belongs to the old route list and must not resurrect it.
      if (repoGeneration !== generation) {
        return;
      }
      if (result.ok) {
        // Touch (never reset) the route's response tree state, so a re-fire re-applies its key
        // rules and normalized folds.
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
    refreshSavedRequests: async (repoPath) => {
      const store = deps?.savedRequests;
      if (store === undefined) {
        set({ savedRequests: null, savedRequestsError: { code: 'store-not-wired', message: NO_SAVED_ERROR } });
        return;
      }
      const result = await listSavedRequests(
        { store, manifest: deps?.manifest, scanner: deps?.scanner },
        ...(repoPath === undefined ? [] : [{ repoPath }]),
      );
      if (result.ok) {
        set({ savedRequests: result.data.requests, savedRequestsError: null });
      } else {
        set({
          savedRequests: null,
          savedRequestsError: { code: result.error.code, message: result.error.message },
        });
      }
    },
    saveRequestDraft: async (name, routeKey, opts) => {
      const store = deps?.savedRequests;
      if (store === undefined) {
        return err('store-not-wired', NO_SAVED_ERROR);
      }
      const state = get();
      const repoPath = state.routesRepoPath;
      if (repoPath === null) {
        return err('missing-argument', 'No routes repo selected');
      }
      const space = routeKey.indexOf(' ');
      if (space === -1) {
        return err('invalid-argument', `The route key is not "METHOD path": ${routeKey}`);
      }
      const draft = state.requestDrafts[routeKey] ?? { params: [], query: [], headers: [] };
      const toRecord = (rows: ReadonlyArray<{ name: string; value: string }>): Record<string, string> => {
        const record: Record<string, string> = {};
        for (const row of rows) {
          record[row.name] = row.value;
        }
        return record;
      };
      const bodyDraft = hasDraft(state.bodyDrafts, routeKey) ? state.bodyDrafts[routeKey] : undefined;
      const route = (state.routes ?? []).find((candidate) => routeKeyFor(candidate.method, candidate.path) === routeKey);
      const contentType = route?.bodyContentType ?? (bodyDraft !== undefined ? 'application/json' : undefined);
      const input = {
        name,
        repoPath,
        method: routeKey.slice(0, space),
        path: routeKey.slice(space + 1),
        query: toRecord(draft.query),
        headers: toRecord(draft.headers),
        ...(bodyDraft === undefined ? {} : { bodyText: JSON.stringify(bodyDraft) }),
        ...(contentType === undefined ? {} : { contentType }),
        ...((state.jsonTreeStates[bodyTreeKey(routeKey)] ?? undefined) === undefined
          ? {}
          : { treeState: state.jsonTreeStates[bodyTreeKey(routeKey)] }),
      };
      const result =
        opts?.overwrite === true
          ? await overwriteSavedRequest({ store }, name, input)
          : await saveRequest({ store }, input);
      if (result.ok) {
        const saved = result.data;
        set((live) => ({
          draftOrigins: touchEntry(live.draftOrigins, routeKey, saved.id, MAX_DRAFT_ORIGINS),
          // The picker reads this cache: append the new record (or replace the same-name
          // entry on overwrite) so it never waits for the next refresh to show the save.
          savedRequests:
            live.savedRequests === null
              ? null
              : live.savedRequests.some((item) => item.name === saved.name)
                ? live.savedRequests.map((item) => (item.name === saved.name ? { ...saved, stale: false } : item))
                : [...live.savedRequests, { ...saved, stale: false }],
        }));
      }
      return result;
    },
    loadSavedRequest: async (name) => {
      const store = deps?.savedRequests;
      if (store === undefined) {
        return err('store-not-wired', NO_SAVED_ERROR);
      }
      if (typeof name !== 'string' || name.trim() === '') {
        return err('invalid-argument', 'A saved request name is required');
      }
      const loaded = await store.get(name.trim());
      if (!loaded.ok) {
        return loaded;
      }
      const saved = loaded.data;
      if (saved.bodyText !== undefined) {
        try {
          JSON.parse(saved.bodyText) as unknown;
        } catch {
          return err('invalid-argument', `Saved request "${saved.name}" has a corrupt body: nothing was loaded`);
        }
      }
      if (saved.treeState !== undefined && !isJsonTreeState(saved.treeState)) {
        return err('invalid-argument', `Saved request "${saved.name}" has a corrupt tree state: nothing was loaded`);
      }
      const routeKey = `${saved.method.trim().toUpperCase()} ${saved.path.trim()}`;
      const route = (get().routes ?? []).find((candidate) => routeKeyFor(candidate.method, candidate.path) === routeKey);
      const seed = seedRequestDraft(route ?? { path: saved.path });
      const withSavedRows = (
        seedRows: RequestDraft['query'],
        savedMap: Record<string, string> | undefined,
      ): RequestDraft['query'] => {
        if (savedMap === undefined) {
          return seedRows;
        }
        const seen = new Set(seedRows.map((row) => row.name));
        const merged = seedRows.map((row) =>
          savedMap[row.name] === undefined ? row : { ...row, value: savedMap[row.name] as string },
        );
        for (const [rowName, rowValue] of Object.entries(savedMap)) {
          if (!seen.has(rowName)) {
            merged.push({ name: rowName, value: rowValue, required: false });
          }
        }
        return merged;
      };
      const draft: RequestDraft = {
        params: seed.params,
        query: withSavedRows(seed.query, saved.query),
        headers: withSavedRows(seed.headers, saved.headers),
      };
      let bodyValue: unknown;
      if (saved.bodyText !== undefined) {
        bodyValue = JSON.parse(saved.bodyText) as unknown;
      }
      const treeState = isJsonTreeState(saved.treeState) ? saved.treeState : createDefaultJsonTreeState();
      set((live) => {
        const touchedDrafts = touchEntry(live.requestDrafts, routeKey, draft, MAX_REQUEST_DRAFTS);
        const { bodyDrafts, bodyEditErrors } = touchBodyDraftEntries(live.bodyDrafts, live.bodyEditErrors, routeKey, bodyValue, {});
        const bodyKey = bodyTreeKey(routeKey);
        const touchedTrees: Record<string, JsonTreeState> = { ...live.jsonTreeStates };
        delete touchedTrees[bodyKey];
        touchedTrees[bodyKey] = treeState;
        return {
          requestDrafts: touchedDrafts,
          bodyDrafts,
          bodyEditErrors,
          jsonTreeStates: pruneJsonTreeStates(touchedTrees, MAX_JSON_TREE_STATES),
          draftOrigins: touchEntry(live.draftOrigins, routeKey, saved.id, MAX_DRAFT_ORIGINS),
        };
      });
      return ok(undefined);
    },
    deleteSavedRequest: async (name) => {
      const store = deps?.savedRequests;
      if (store === undefined) {
        return err('store-not-wired', NO_SAVED_ERROR);
      }
      if (typeof name !== 'string' || name.trim() === '') {
        return err('invalid-argument', 'A saved request name is required');
      }
      const trimmed = name.trim();
      const loaded = await store.get(trimmed);
      if (!loaded.ok) {
        return loaded;
      }
      const removed = await deleteSavedRequestUseCase({ store }, trimmed);
      if (!removed.ok) {
        return removed;
      }
      const id = loaded.data.id;
      set((live) => {
        const origins: Record<string, string> = {};
        for (const [routeKey, savedId] of Object.entries(live.draftOrigins)) {
          if (savedId !== id) {
            origins[routeKey] = savedId;
          }
        }
        return {
          draftOrigins: origins,
          savedRequests: live.savedRequests === null ? null : live.savedRequests.filter((item) => item.name !== trimmed),
        };
      });
      return ok(undefined);
    },
  });
}

function isJsonTreeState(value: unknown): value is JsonTreeState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.foldedPaths) &&
    Array.isArray(candidate.hiddenKeys) &&
    Array.isArray(candidate.onlyKeys) &&
    typeof candidate.hideNulls === 'boolean' &&
    typeof candidate.selected === 'number'
  );
}
