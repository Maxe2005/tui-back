// core/routes/list-routes: lists the routes a repo's route-explorer module discovers. The gate
// is the manifest's own `modules` map, never a hardcoded repo name. A repo without the module
// is `route-exploration-not-activated`, never an empty list; a scanner failure is
// `route-scan-failed`; a successful scan — even a zero-route one — is `ok`.
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
