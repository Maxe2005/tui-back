// core/insight/routes/favorites: per-EDT favorite routes. A favorite is (repoPath, method, path) kept on
// the EDT's registry entry, so one EDT's favorites never leak into another's and deleting the
// EDT deletes them. Writes go through EdtRegistryPort.update under the registry lock (AD-9).
// Stale is advisory at list time (a fresh per-repo scan); a manifest/scan failure is never
// stale, and a stale favorite is returned, never dropped or fired.
import type { EdtRegistryEntry, EdtRegistryPort, FavoriteRoute } from '../../ports/storage/edt-registry.js';
import type { LockPort } from '../../ports/runtime/lock.js';
import type { RouteScannerPort } from '../../ports/modules/route-scanner.js';
import type { StatePort } from '../../ports/storage/state.js';
import type { ManifestPort } from '../../ports/vcs/manifest.js';
import { withActionLock } from '../../locking.js';
import { err, ok, type Result } from '../../result.js';
import { ROUTES_MODULE_ID } from '../../workspace/edt/shared-edt/resolve-tab-visibility.js';
import { isRoutePresent } from './saved-requests.js';

export type FavoriteWithStale = FavoriteRoute & { stale: boolean };

export interface FavoriteRoutesDeps {
  edtRegistry: EdtRegistryPort;
  edtRegistryResourceKey: string;
  lock: LockPort;
  state: StatePort;
}

export interface FavoriteRoutesListDeps {
  edtRegistry: EdtRegistryPort;
  state: StatePort;
  manifest?: ManifestPort;
  scanner?: RouteScannerPort;
}

export interface FavoriteRouteInput {
  // EDT topic; omitted = the active EDT.
  edt?: string;
  repoPath: string;
  method: string;
  path: string;
}

const HTTP_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']);

function normalize(input: FavoriteRouteInput): Result<FavoriteRoute> {
  if (typeof input.repoPath !== 'string' || input.repoPath.trim() === '') {
    return err('missing-argument', 'A favorite route needs a repoPath');
  }
  if (typeof input.method !== 'string' || input.method.trim() === '') {
    return err('missing-argument', 'A favorite route needs a method');
  }
  if (typeof input.path !== 'string' || input.path.trim() === '') {
    return err('missing-argument', 'A favorite route needs a path');
  }
  const method = input.method.trim().toUpperCase();
  if (!HTTP_VERBS.has(method)) {
    return err('invalid-argument', `"${input.method.trim()}" is not a valid HTTP method`);
  }
  const path = input.path.trim();
  if (/[?#]/.test(path)) {
    return err('invalid-argument', 'The favorite path must not carry a query or fragment');
  }
  return ok({ repoPath: input.repoPath.trim(), method, path });
}

function findEdt(edts: EdtRegistryEntry[], activeUlid: string | null, topic: string | undefined): Result<EdtRegistryEntry> {
  if (topic !== undefined) {
    const byTopic = edts.find((candidate) => candidate.topic === topic);
    return byTopic === undefined ? err('edt-not-found', `No EDT with topic "${topic}"`) : ok(byTopic);
  }
  if (activeUlid === null) {
    return err('edt-not-found', 'No active EDT: pass --edt <topic> or switch to one');
  }
  const active = edts.find((candidate) => candidate.ulid === activeUlid);
  return active === undefined ? err('edt-not-found', `The active EDT ${activeUlid} is not registered`) : ok(active);
}

async function resolveEdt(
  deps: { edtRegistry: EdtRegistryPort; state: StatePort },
  topic: string | undefined,
): Promise<Result<EdtRegistryEntry>> {
  if (topic !== undefined && topic.trim() === '') {
    return err('invalid-argument', 'The EDT topic must not be blank');
  }
  const active = topic === undefined ? await deps.state.readActiveEdt() : ok<string | null>(null);
  if (!active.ok) {
    return active;
  }
  const listed = await deps.edtRegistry.list();
  if (!listed.ok) {
    return listed;
  }
  return findEdt(listed.data, active.data, topic);
}

const sameRoute = (a: FavoriteRoute, b: FavoriteRoute): boolean =>
  a.repoPath === b.repoPath && a.method === b.method && a.path === b.path;

type Mode = 'toggle' | 'add' | 'remove';

async function mutate(deps: FavoriteRoutesDeps, input: FavoriteRouteInput, mode: Mode): Promise<Result<{ favorite: boolean }>> {
  const route = normalize(input);
  if (!route.ok) {
    return route;
  }
  return withActionLock(deps.lock, deps.edtRegistryResourceKey, async () => {
    const edt = await resolveEdt(deps, input.edt);
    if (!edt.ok) {
      return edt;
    }
    const current = edt.data.favoriteRoutes ?? [];
    const present = current.some((favorite) => sameRoute(favorite, route.data));
    const favorite = mode === 'toggle' ? !present : mode === 'add';
    if (favorite === present) {
      return ok({ favorite });
    }
    const next = favorite ? [...current, route.data] : current.filter((entry) => !sameRoute(entry, route.data));
    const updated = await deps.edtRegistry.update(edt.data.ulid, { favoriteRoutes: next });
    return updated.ok ? ok({ favorite }) : updated;
  });
}

export function toggleFavoriteRoute(deps: FavoriteRoutesDeps, input: FavoriteRouteInput): Promise<Result<{ favorite: boolean }>> {
  return mutate(deps, input, 'toggle');
}

// Idempotent: adding an existing favorite is a no-op.
export function addFavoriteRoute(deps: FavoriteRoutesDeps, input: FavoriteRouteInput): Promise<Result<{ favorite: boolean }>> {
  return mutate(deps, input, 'add');
}

// Idempotent: removing a non-favorite is a no-op.
export function removeFavoriteRoute(deps: FavoriteRoutesDeps, input: FavoriteRouteInput): Promise<Result<{ favorite: boolean }>> {
  return mutate(deps, input, 'remove');
}

export async function listFavoriteRoutes(
  deps: FavoriteRoutesListDeps,
  opts: { edt?: string } = {},
): Promise<Result<{ favorites: FavoriteWithStale[] }>> {
  const edt = await resolveEdt(deps, opts.edt);
  if (!edt.ok) {
    return edt;
  }
  const favorites = edt.data.favoriteRoutes ?? [];
  const { manifest, scanner } = deps;
  if (manifest === undefined || scanner === undefined) {
    return ok({ favorites: favorites.map((favorite) => ({ ...favorite, stale: false })) });
  }
  // One scan per repo. `null` = unknown (manifest/scan failure), which is never stale.
  const scans = new Map<string, Awaited<ReturnType<RouteScannerPort['scan']>> | null>();
  for (const repoPath of new Set(favorites.map((favorite) => favorite.repoPath))) {
    try {
      const loaded = await manifest.load(repoPath);
      scans.set(repoPath, loaded.ok ? await scanner.scan(repoPath, loaded.data.modules[ROUTES_MODULE_ID] ?? {}) : null);
    } catch {
      scans.set(repoPath, null);
    }
  }
  return ok({
    favorites: favorites.map((favorite) => {
      const scanned = scans.get(favorite.repoPath);
      const stale = scanned?.ok === true && !isRoutePresent(scanned.data, favorite.method, favorite.path);
      return { ...favorite, stale };
    }),
  });
}
