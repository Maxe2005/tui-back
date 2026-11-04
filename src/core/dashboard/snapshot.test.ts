// core/dashboard/snapshot: unit tests against fake ports — one per snapshot scenario.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../result.js';
import type { DockerPort } from '../ports/docker.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { buildDashboardRegistrySummary, buildDashboardServices, buildDashboardSnapshot } from './snapshot.js';

function manifestFor(path: string, extra: Partial<Manifest> = {}): Manifest {
  const name = path.split('/').pop();
  return { service: `svc-${name}`, container: `ctr-${name}`, sharedBranch: 'development', modules: {}, ...extra };
}

function edt(ulid: string, topic: string, members: Array<[string, string]>): EdtRegistryEntry {
  return {
    ulid,
    topic,
    createdAt: '2026-01-01T00:00:00Z',
    status: 'active',
    members: members.map(([repoPath, branch]) => ({ service: `svc-${repoPath.split('/').pop()}`, repoPath, branch })),
  };
}

interface Setup {
  paths?: string[];
  edts?: EdtRegistryEntry[];
  active?: string | null;
  manifests?: Record<string, Manifest | { code: string }>;
  git?: Partial<Record<keyof GitPort, unknown>>;
  docker?: Partial<DockerPort>;
  registry?: Partial<RegistryPort>;
  edtRegistry?: Partial<EdtRegistryPort>;
}

function build(setup: Setup = {}) {
  const paths = setup.paths ?? ['/r/a', '/r/b'];
  const registry = {
    list: vi.fn(async () => ok(paths)),
    exists: vi.fn(async () => ok(true)),
    ...setup.registry,
  } as unknown as RegistryPort;
  const manifest: ManifestPort = {
    load: vi.fn(async (path: string) => {
      const entry = setup.manifests?.[path];
      if (entry === undefined) {
        return ok(manifestFor(path));
      }
      return 'code' in entry ? err(entry.code, entry.code) : ok(entry);
    }),
  };
  const git = {
    currentBranch: vi.fn(async () => ok('feat/x')),
    aheadBehind: vi.fn(async () => ok({ ahead: 1, behind: 2 })),
    hasUncommittedChanges: vi.fn(async () => ok(false)),
    isMergeInProgress: vi.fn(async () => ok(false)),
    isRebaseInProgress: vi.fn(async () => ok(false)),
    ...setup.git,
  } as unknown as GitPort;
  const docker = {
    getContainerHealth: vi.fn(async () => ok('up' as const)),
    ...setup.docker,
  } as unknown as DockerPort;
  const edtRegistry = {
    list: vi.fn(async () => ok(setup.edts ?? [edt('e1', 'topic-a', [['/r/a', 'feat/x'], ['/r/b', 'feat/x']])])),
    ...setup.edtRegistry,
  } as unknown as EdtRegistryPort;
  const state = { readActiveEdt: vi.fn(async () => ok(setup.active === undefined ? 'e1' : setup.active)) } as unknown as StatePort;
  const deps = { registry, manifest, git, docker, edtRegistry, state };
  return { run: () => buildDashboardSnapshot(deps), deps, docker, git };
}

async function data(setup?: Setup) {
  const result = await build(setup).run();
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

describe('buildDashboardSnapshot', () => {
  it('returns one row per member with every field', async () => {
    const snapshot = await data();
    expect(snapshot.status).toBe('active');
    expect(snapshot.edt).toEqual({ ulid: 'e1', topic: 'topic-a', serviceCount: 2 });
    expect(snapshot.services.map((s) => s.path)).toEqual(['/r/a', '/r/b']);
    expect(snapshot.services[0]).toMatchObject({
      service: 'svc-a',
      status: { ok: true, value: { state: 'up', verified: false, container: 'up' } },
      branch: 'feat/x',
      divergence: { status: 'current', ahead: 1, behind: 2 },
      workingTree: { ok: true, value: { uncommitted: false, mergeInProgress: false, rebaseInProgress: false } },
      protectedBranch: false,
      usedByEdts: [],
      expectedBranch: 'feat/x',
      drift: 'aligned',
    });
    expect(snapshot.others).toEqual([]);
  });

  it('reports no-active-edt with the registry summary still present', async () => {
    const snapshot = await data({ active: null });
    expect(snapshot).toMatchObject({ status: 'no-active-edt', edt: null, services: [], others: [], registry: { repoCount: 2 } });
    const unknown = await data({ active: 'missing' });
    expect(unknown.status).toBe('no-active-edt');
  });

  it.each([undefined, '', '   '])('marks a container-less service (container=%j) without calling docker', async (container) => {
    const setup = build({
      edts: [edt('e1', 'topic-a', [['/r/a', 'feat/x']])],
      manifests: { '/r/a': manifestFor('/r/a', { container }) },
    });
    const result = await setup.run();
    expect(result.ok && result.data.services[0]?.status).toEqual({ ok: true, value: { state: 'no-container', verified: false, container: 'no-container' } });
    expect(setup.docker.getContainerHealth).not.toHaveBeenCalled();
  });

  it('queries docker with the trimmed container name', async () => {
    const setup = build({
      edts: [edt('e1', 'topic-a', [['/r/a', 'feat/x']])],
      manifests: { '/r/a': manifestFor('/r/a', { container: ' ctr-a ' }) },
    });
    await setup.run();
    expect(setup.docker.getContainerHealth).toHaveBeenCalledWith('ctr-a');
  });

  it('confines a docker failure to that row container field', async () => {
    const snapshot = await data({
      docker: {
        getContainerHealth: async (name: string) => (name === 'ctr-a' ? err('docker-unavailable', 'no docker') : ok('down' as const)),
      },
    });
    expect(snapshot.services[0]?.status).toEqual({ ok: false, error: { code: 'docker-unavailable', message: 'no docker' } });
    expect(snapshot.services[0]?.branch).toBe('feat/x');
    expect(snapshot.services[1]?.status).toEqual({ ok: true, value: { state: 'down', verified: false, container: 'down' } });
  });

  it('resolves each row health-first through the wired probe', async () => {
    const setup = build({
      edts: [edt('e1', 'topic-a', [['/r/a', 'feat/x'], ['/r/b', 'feat/x']])],
      manifests: {
        '/r/a': manifestFor('/r/a', { healthUrl: 'http://a/h' }),
        '/r/b': manifestFor('/r/b', { healthUrl: 'http://b/h' }),
      },
    });
    const probe = vi.fn(async (url: string) => ok(url === 'http://a/h' ? { healthy: false, reason: 'HTTP 503' } : { healthy: true }));
    const result = await buildDashboardSnapshot({ ...setup.deps, healthProbe: { probe } });
    expect(result.ok && result.data.services[0]?.status).toEqual({
      ok: true,
      value: { state: 'unhealthy', verified: true, container: 'up', probeReason: 'HTTP 503' },
    });
    expect(result.ok && result.data.services[1]?.status).toEqual({ ok: true, value: { state: 'up', verified: true, container: 'up' } });
  });

  it('keeps the probe reason in details when Docker and the probe both fail', async () => {
    const setup = build({
      edts: [edt('e1', 'topic-a', [['/r/a', 'feat/x']])],
      manifests: { '/r/a': manifestFor('/r/a', { healthUrl: 'http://a/h' }) },
      docker: { getContainerHealth: async () => err('docker-unavailable', 'no docker') },
    });
    const probe = vi.fn(async () => ok({ healthy: false, reason: 'HTTP 503' }));
    const result = await buildDashboardSnapshot({ ...setup.deps, healthProbe: { probe } });
    expect(result.ok && result.data.services[0]?.status).toEqual({
      ok: false,
      error: { code: 'docker-unavailable', message: 'no docker', details: { probeReason: 'HTTP 503' } },
    });
  });

  it('carries the container error next to a 2xx probe, as up', async () => {
    const setup = build({
      edts: [edt('e1', 'topic-a', [['/r/a', 'feat/x']])],
      manifests: { '/r/a': manifestFor('/r/a', { healthUrl: 'http://a/h' }) },
      docker: { getContainerHealth: async () => err('docker-unavailable', 'no docker') },
    });
    const result = await buildDashboardSnapshot({ ...setup.deps, healthProbe: { probe: async () => ok({ healthy: true }) } });
    expect(result.ok && result.data.services[0]?.status).toEqual({
      ok: true,
      value: { state: 'up', verified: true, container: null, containerError: { code: 'docker-unavailable', message: 'no docker' } },
    });
  });

  it('gives a container-less service declaring healthUrl a real up/down, without Docker', async () => {
    const setup = build({
      edts: [edt('e1', 'topic-a', [['/r/a', 'feat/x'], ['/r/b', 'feat/x']])],
      manifests: {
        '/r/a': manifestFor('/r/a', { container: undefined, healthUrl: 'http://a/h' }),
        '/r/b': manifestFor('/r/b', { container: undefined, healthUrl: 'http://b/h' }),
      },
    });
    const probe = vi.fn(async (url: string) => ok(url === 'http://a/h' ? { healthy: true } : { healthy: false, reason: 'timeout' }));
    const result = await buildDashboardSnapshot({ ...setup.deps, healthProbe: { probe } });
    expect(result.ok && result.data.services[0]?.status).toEqual({ ok: true, value: { state: 'up', verified: true, container: 'no-container' } });
    expect(result.ok && result.data.services[1]?.status).toEqual({
      ok: true,
      value: { state: 'down', verified: true, container: 'no-container', probeReason: 'timeout' },
    });
    expect(setup.docker.getContainerHealth).not.toHaveBeenCalled();
  });

  it('ignores healthUrl when no probe is wired', async () => {
    const snapshot = await data({ manifests: { '/r/a': manifestFor('/r/a', { healthUrl: 'http://a/h' }) } });
    expect(snapshot.services[0]?.status).toEqual({ ok: true, value: { state: 'up', verified: false, container: 'up' } });
  });

  it('classifies no-upstream and unknown-offline divergence', async () => {
    const noUpstream = await data({ git: { aheadBehind: async () => err('no-upstream', 'none') } });
    expect(noUpstream.services[0]?.divergence).toEqual({ status: 'no-upstream', ahead: null, behind: null });
    const offline = await data({ git: { aheadBehind: async () => err('git-error', 'boom') } });
    expect(offline.services[0]?.divergence).toMatchObject({ status: 'unknown-offline', ahead: null, behind: null, detail: { code: 'git-error' } });
  });

  it('flags dirty, mid-merge and mid-rebase, and surfaces probe errors', async () => {
    const flags = await data({
      git: { hasUncommittedChanges: async () => ok(true), isMergeInProgress: async () => ok(true), isRebaseInProgress: async () => ok(true) },
    });
    expect(flags.services[0]?.workingTree).toEqual({ ok: true, value: { uncommitted: true, mergeInProgress: true, rebaseInProgress: true } });
    const failed = await data({ git: { isRebaseInProgress: async () => err('git-spawn', 'x') } });
    expect(failed.services[0]?.workingTree).toEqual({ ok: false, error: { code: 'git-spawn', message: 'x' } });
  });

  it('flags protected branches and branches used by another EDT', async () => {
    const snapshot = await data({
      edts: [edt('e1', 'topic-a', [['/r/a', 'development'], ['/r/b', 'feat/x']]), edt('e2', 'topic-b', [['/r/b', 'feat/x']]), edt('e3', 'topic-c', [['/r/b', 'other']])],
      git: { currentBranch: async (path: string) => ok(path === '/r/a' ? 'development' : 'feat/x') },
    });
    expect(snapshot.services[0]).toMatchObject({ protectedBranch: true, usedByEdts: [] });
    expect(snapshot.services[1]).toMatchObject({ protectedBranch: false, usedByEdts: ['topic-b'] });
  });

  it('summarizes the registry per path', async () => {
    const snapshot = await data({
      paths: ['/r/a', '/r/b', '/r/gone', '/r/bad', '/r/err', '/r/unmanaged'],
      registry: {
        exists: async (path: string) => (path === '/r/err' ? err('fs', 'x') : ok(path !== '/r/gone')),
      },
      manifests: { '/r/bad': { code: 'manifest-invalid' }, '/r/unmanaged': { code: 'manifest-not-found' } },
    });
    expect(snapshot.registry).toEqual({ repoCount: 6, invalidManifests: 1, unreachable: 1, listingIssues: 1 });
  });

  it('keeps a row with a manifest error when a member manifest cannot load', async () => {
    const snapshot = await data({ manifests: { '/r/a': { code: 'manifest-invalid' } } });
    expect(snapshot.services[0]).toMatchObject({
      service: 'svc-a',
      manifest: { ok: false, error: { code: 'manifest-invalid' } },
      status: { ok: false, error: { code: 'manifest-invalid' } },
    });
    expect(snapshot.services[1]?.manifest.ok).toBe(true);
  });

  it('returns the error when the registry or EDT list fails', async () => {
    expect((await build({ registry: { list: async () => err('registry-error', 'x') } }).run()).ok).toBe(false);
    expect((await build({ edtRegistry: { list: async () => err('edt-error', 'x') } }).run()).ok).toBe(false);
  });

  it('builds the services and registry sections independently', async () => {
    const { deps } = build({ registry: { list: async () => err('registry-error', 'x') } });
    const services = await buildDashboardServices(deps);
    expect(services.ok && services.data.status).toBe('active');
    expect((await buildDashboardRegistrySummary(deps)).ok).toBe(false);

    const healthy = build({ edtRegistry: { list: async () => err('edt-error', 'x') } }).deps;
    expect((await buildDashboardServices(healthy)).ok).toBe(false);
    const summary = await buildDashboardRegistrySummary(healthy);
    expect(summary.ok && summary.data.repoCount).toBe(2);
  });

  describe('drift', () => {
    const oneMember = [edt('e1', 'topic-a', [['/r/a', 'feat/x']])];

    it('flags a member on another branch than its EDT branch', async () => {
      const snapshot = await data({ edts: oneMember, paths: ['/r/a'], git: { currentBranch: async () => ok('main') } });
      expect(snapshot.services[0]).toMatchObject({ branch: 'main', expectedBranch: 'feat/x', drift: 'drifted' });
    });

    it('treats a detached HEAD as drifted and any other branch failure as unknown', async () => {
      const detached = await data({
        edts: oneMember,
        paths: ['/r/a', '/r/o'],
        git: { currentBranch: async () => err('git-detached-head', 'HEAD is detached') },
      });
      expect(detached.services[0]).toMatchObject({ branch: null, drift: 'drifted' });
      expect(detached.others[0]).toMatchObject({ path: '/r/o', branch: null, drift: 'drifted', detail: { code: 'git-detached-head' } });

      const failed = await data({
        edts: oneMember,
        paths: ['/r/a', '/r/o'],
        git: { currentBranch: async (path: string) => (path === '/r/o' ? err('git-current-branch-error', 'boom') : ok('feat/x')) },
      });
      expect(failed.services[0]).toMatchObject({ drift: 'aligned' });
      expect(failed.others[0]).toMatchObject({ drift: 'unknown', detail: { code: 'git-current-branch-error', message: 'boom' } });
      const memberFailed = await data({ edts: oneMember, paths: ['/r/a'], git: { currentBranch: async () => err('git-spawn', 'x') } });
      expect(memberFailed.services[0]).toMatchObject({ branch: null, drift: 'unknown' });
    });

    it('judges other managed services against their sharedBranch', async () => {
      const setup = build({
        edts: oneMember,
        paths: ['/r/a', '/r/./o', '/r/p', '/r/gone', '/r/err', '/r/bad', '/r/unmanaged'],
        registry: { exists: async (path: string) => (path === '/r/err' ? err('fs', 'x') : ok(path !== '/r/gone')) },
        manifests: {
          '/r/o': manifestFor('/r/o', { sharedBranch: 'develop' }),
          '/r/p': manifestFor('/r/p', { sharedBranch: 'develop' }),
          '/r/bad': { code: 'manifest-invalid' },
          '/r/unmanaged': { code: 'manifest-not-found' },
        },
        git: { currentBranch: vi.fn(async (path: string) => ok(path === '/r/o' ? 'hotfix' : path === '/r/p' ? 'develop' : 'feat/x')) },
      });
      const result = await setup.run();
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      expect(result.data.others).toEqual([
        { service: 'svc-o', path: '/r/o', branch: 'hotfix', expectedBranch: 'develop', drift: 'drifted' },
        { service: 'svc-p', path: '/r/p', branch: 'develop', expectedBranch: 'develop', drift: 'aligned' },
      ]);
      // One currentBranch call per member and per other service, nothing more.
      expect(setup.git.currentBranch).toHaveBeenCalledTimes(3);
    });

    it('keeps the services section when the registry listing fails', async () => {
      const { deps } = build({ edts: oneMember, registry: { list: async () => err('registry-error', 'x') } });
      const services = await buildDashboardServices(deps);
      expect(services.ok && services.data.others).toEqual([]);
      const throwing = build({ edts: oneMember, registry: { list: async () => Promise.reject(new Error('boom')) } }).deps;
      const thrown = await buildDashboardServices(throwing);
      expect(thrown.ok && thrown.data).toMatchObject({ services: [{ path: '/r/a', drift: 'aligned' }], others: [] });
    });

    it('drops only the other row whose probe throws, members untouched', async () => {
      const { deps } = build({
        edts: oneMember,
        paths: ['/r/a', '/r/o', '/r/p', '/r/q'],
        registry: { exists: async (path: string) => (path === '/r/p' ? Promise.reject(new Error('fs boom')) : ok(true)) },
        git: { currentBranch: async (path: string) => (path === '/r/o' ? Promise.reject(new Error('git boom')) : ok('feat/x')) },
      });
      const result = await buildDashboardServices(deps);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      expect(result.data.services).toMatchObject([{ path: '/r/a', branch: 'feat/x', drift: 'aligned' }]);
      expect(result.data.others.map((other) => other.path)).toEqual(['/r/q']);
    });
  });
});
