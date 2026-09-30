// core/routes/list-routes: unit tests against fake ports (AD-13) — no real manifests,
// no real OpenAPI specs. Covers the spec's I/O & Edge-Case Matrix row by row.
import { describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '../result.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { Route, RouteScannerPort } from '../ports/route-scanner.js';
import { listRoutes } from './list-routes.js';

function manifestWithModules(modules: Manifest['modules']): Manifest {
  return {
    service: 'api-gateway',
    container: 'api-gateway',
    sharedBranch: 'development',
    modules,
  };
}

function fakeManifest(load: ManifestPort['load']): ManifestPort {
  return { load };
}

function fakeScanner(scan: RouteScannerPort['scan']): RouteScannerPort {
  return { scan };
}

const ROUTES: Route[] = [
  { method: 'GET', path: '/users' },
  { method: 'POST', path: '/users', summary: 'Create a user' },
];

describe('listRoutes (story 6.1 I/O matrix)', () => {
  it('lists every route the scanner discovers when the manifest activates route-explorer', async () => {
    const manifest = fakeManifest(async () => ok(manifestWithModules({ 'route-explorer': {} })));
    const scanner = fakeScanner(async () => ok(ROUTES));

    const result = await listRoutes({ manifest, scanner }, '/repos/api-gateway');

    expect(result).toEqual({ ok: true, data: { routes: ROUTES } });
  });

  it('passes the manifest module config through to the scanner untouched', async () => {
    const config = { openapi: 'openapi.json' };
    const manifest = fakeManifest(async () => ok(manifestWithModules({ 'route-explorer': config })));
    const scan = vi.fn(async (_repoPath: string, _config: Record<string, unknown>): Promise<Result<Route[]>> => ok([]));
    const scanner = fakeScanner(scan);

    const result = await listRoutes({ manifest, scanner }, '/repos/api-gateway');

    expect(result).toEqual({ ok: true, data: { routes: [] } });
    expect(scan).toHaveBeenCalledWith('/repos/api-gateway', config);
  });

  it('rejects with route-exploration-not-activated (never an empty list) when the manifest lacks route-explorer', async () => {
    const manifest = fakeManifest(async () => ok(manifestWithModules({})));
    const scan = vi.fn(async (): Promise<Result<Route[]>> => ok(ROUTES));
    const scanner = fakeScanner(scan);

    const result = await listRoutes({ manifest, scanner }, '/repos/plain-service');

    expect(result).toMatchObject({ ok: false, error: { code: 'route-exploration-not-activated' } });
    if (!result.ok) {
      expect(result.error.message).toContain('No route list for this repo');
    }
    expect(scan).not.toHaveBeenCalled();
  });

  it('propagates a scan failure as route-scan-failed with its reason, never as empty', async () => {
    const manifest = fakeManifest(async () => ok(manifestWithModules({ 'route-explorer': {} })));
    const scanner = fakeScanner(async () => err('route-scan-failed', 'boom', { reason: 'boom' }));

    const result = await listRoutes({ manifest, scanner }, '/repos/api-gateway');

    expect(result).toEqual({
      ok: false,
      error: { code: 'route-scan-failed', message: 'boom', details: { reason: 'boom' } },
    });
  });

  it('returns a genuinely-empty list as ok (visibly distinct from a failure)', async () => {
    const manifest = fakeManifest(async () => ok(manifestWithModules({ 'route-explorer': {} })));
    const scanner = fakeScanner(async () => ok([]));

    const result = await listRoutes({ manifest, scanner }, '/repos/empty-service');

    expect(result).toEqual({ ok: true, data: { routes: [] } });
  });

  it('propagates manifest load failures verbatim (e.g. manifest-not-found)', async () => {
    const manifest = fakeManifest(async () => err('manifest-not-found', 'no manifest'));
    const scan = vi.fn(async (): Promise<Result<Route[]>> => ok(ROUTES));
    const scanner = fakeScanner(scan);

    const result = await listRoutes({ manifest, scanner }, '/repos/gone');

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
    expect(scan).not.toHaveBeenCalled();
  });

  it('rejects an empty repoPath with missing-argument before touching any port', async () => {
    const load = vi.fn(async (): Promise<Result<Manifest>> => ok(manifestWithModules({})));
    const scan = vi.fn(async (): Promise<Result<Route[]>> => ok([]));

    const result = await listRoutes({ manifest: fakeManifest(load), scanner: fakeScanner(scan) }, '   ');

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    expect(load).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });
});
