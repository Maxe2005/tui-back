import { describe, expect, it } from 'vitest';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { StatePort } from '../ports/state.js';
import { err, ok } from '../result.js';
import { listConsumers, type ConsumerConfigParser } from './list-consumers.js';

const MODULE = 'some-consumer-module';

function manifest(service: string, modules: Manifest['modules']): Manifest {
  return { service, sharedBranch: 'development', modules };
}

const parse: ConsumerConfigParser = (raw) =>
  raw['bad'] === true ? err('invalid-config', 'bad params') : ok({ dependency: String(raw['dependency'] ?? 'dep'), packageJsonPath: 'package.json' });

function deps(active: string | null, manifests: Record<string, Manifest>) {
  const state = { readActiveEdt: async () => ok(active) } as unknown as StatePort;
  const edtRegistry = {
    list: async () =>
      ok([
        {
          ulid: 'E1',
          topic: 't',
          createdAt: '',
          status: 'active' as const,
          members: Object.keys(manifests).map((name) => ({ service: name, repoPath: `/r/${name}`, branch: `feat/${name}` })),
        },
      ]),
  } as unknown as EdtRegistryPort;
  const manifestPort: ManifestPort = {
    load: async (repoPath) => {
      const found = manifests[repoPath.split('/').pop() ?? ''];
      return found ? ok(found) : err('manifest-not-found', 'nope');
    },
  };
  return { state, edtRegistry, manifest: manifestPort, moduleId: MODULE, parseConfig: parse };
}

describe('listConsumers', () => {
  it('lists only the active EDT members that declare the module, with parsed config', async () => {
    const result = await listConsumers(
      deps('E1', { a: manifest('a', { [MODULE]: { dependency: 'x' } }), b: manifest('b', {}) }),
    );

    expect(result).toEqual({
      ok: true,
      data: { consumers: [{ service: 'a', repoPath: '/r/a', branch: 'feat/a', dependency: 'x', packageJsonPath: 'package.json' }], issues: [] },
    });
  });

  it('is empty when no EDT is active', async () => {
    expect(await listConsumers(deps(null, { a: manifest('a', { [MODULE]: {} }) }))).toEqual({ ok: true, data: { consumers: [], issues: [] } });
  });

  it('surfaces a member with bad parameters as an issue', async () => {
    const result = await listConsumers(deps('E1', { a: manifest('a', { [MODULE]: { bad: true } }) }));

    expect(result).toMatchObject({ ok: true, data: { consumers: [], issues: [{ service: 'a', message: 'bad params' }] } });
  });
});
