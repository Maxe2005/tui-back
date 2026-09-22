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
import { listRoutes } from '../../../../../core/routes/list-routes.js';
import { listRepos } from '../../../../../core/scripts/list-repos.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

const NO_DEPS_ERROR = 'No ports wired into the TUI store';
const NO_SCANNER_ERROR = 'No route scanner wired into the TUI store';

export type RoutesStatus = 'idle' | 'loading' | 'ready' | 'error';

export type RoutesSlice = {
  routesRepoPath: string | null;
  routes: Route[] | null;
  routesStatus: RoutesStatus;
  routesError: { code: string; message: string } | null;
  loadRoutes: () => Promise<void>;
};

export function createRoutesSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], RoutesSlice> {
  return (set, get) => ({
    routesRepoPath: null,
    routes: null,
    routesStatus: 'idle',
    routesError: null,
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
        set({ routesRepoPath: target.path, routes: result.data.routes, routesStatus: 'ready', routesError: null });
      } else {
        set({
          routesRepoPath: target.path,
          routes: null,
          routesStatus: 'error',
          routesError: { code: result.error.code, message: result.error.message },
        });
      }
    },
  });
}
