// core/routes/list-routes: the list-routes use-case (AD-2) — list the routes a repo's
// active route-explorer module discovers. A repo offers routes iff its manifest activates
// `route-explorer` (AD-4, FR-19): the gate is the manifest's own `modules` map, never a
// hardcoded repo name, so a future repo activates route exploration manifest-only with no
// core change. Manifest load failures propagate verbatim; a repo without the module is a
// named `route-exploration-not-activated` rejection, never an empty list; a scanner
// failure propagates as `route-scan-failed` (never rendered as empty downstream); a
// successful scan — even a zero-route one — is `ok`. Thrown errors (a buggy scanner)
// propagate to dispatch.ts's `internal-error` mapping, same as every other use-case.
import { ROUTES_MODULE_ID } from '../edt/resolve-tab-visibility.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { Route, RouteScannerPort } from '../ports/route-scanner.js';
import { err, ok, type Result } from '../result.js';

export interface ListRoutesData {
  routes: Route[];
}

export interface ListRoutesDeps {
  manifest: ManifestPort;
  scanner: RouteScannerPort;
}

export async function listRoutes(
  deps: ListRoutesDeps,
  repoPath: string,
): Promise<Result<ListRoutesData>> {
  if (repoPath === undefined || repoPath.trim() === '') {
    return err('missing-argument', 'Usage: tui-back list-routes <repoPath>');
  }

  const loaded = await deps.manifest.load(repoPath);
  if (!loaded.ok) {
    return loaded;
  }

  const config = loaded.data.modules[ROUTES_MODULE_ID];
  if (config === undefined) {
    return err(
      'route-exploration-not-activated',
      `No route list for this repo: ${repoPath} does not activate the ${ROUTES_MODULE_ID} module`,
    );
  }

  const scanned = await deps.scanner.scan(repoPath, config);
  if (!scanned.ok) {
    return scanned;
  }
  return ok({ routes: scanned.data });
}
