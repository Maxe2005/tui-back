import { describe, expect, it } from 'vitest';
import { ok } from '../result.js';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { StatePort } from '../ports/state.js';
import { resolveMergeSourcesFromEdt, selectionFromEdt } from './resolve-merge-sources.js';

const sourceEdt = {
  members: [
    { service: 'api', repoPath: '/r/api', branch: 'feat/x' },
    { service: 'web', repoPath: '/r/web', branch: 'feat/gone' },
  ],
};

describe('resolveMergeSourcesFromEdt', () => {
  it('takes the member branch when it exists locally', () => {
    const rows = resolveMergeSourcesFromEdt([{ service: 'api', repoPath: '/r/api' }], sourceEdt, { '/r/api': ['feat/x', 'development'] });
    expect(rows).toEqual([{ service: 'api', repoPath: '/r/api', source: 'feat/x', origin: 'edt' }]);
  });

  it('flags a service that is not a member of the source EDT', () => {
    const [row] = resolveMergeSourcesFromEdt([{ service: 'db', repoPath: '/r/db' }], sourceEdt, {});
    expect(row).toMatchObject({ source: '', error: 'not-in-edt' });
  });

  it('flags a member branch with no local ref', () => {
    const [row] = resolveMergeSourcesFromEdt([{ service: 'web', repoPath: '/r/web' }], sourceEdt, { '/r/web': ['development'] });
    expect(row).toMatchObject({ source: '', error: 'branch-not-found' });
  });

  it('matches repo paths after normalisation', () => {
    const [row] = resolveMergeSourcesFromEdt([{ service: 'api', repoPath: '/r/api/' }], sourceEdt, { '/r/api/': ['feat/x'] });
    expect(row?.error).toBeUndefined();
  });
});

describe('selectionFromEdt', () => {
  const entry = (ulid: string, topic: string, members: { service: string; repoPath: string; branch: string }[]) => ({
    ulid,
    topic,
    createdAt: '',
    status: 'active' as const,
    members,
  });
  const deps = (git: Record<string, string[]>) => ({
    edtRegistry: {
      list: async () =>
        ok([
          entry('A', 'mine', [{ service: 'api', repoPath: '/r/api', branch: 'feat/mine' }]),
          entry('B', 'sibling', [{ service: 'api', repoPath: '/r/api', branch: 'feat/x' }]),
        ]),
    } as unknown as EdtRegistryPort,
    state: { readActiveEdt: async () => ok('A') } as unknown as StatePort,
    git: { listBranches: async (path: string) => ok(git[path] ?? []) },
  });

  it('builds a full selection from the other EDT', async () => {
    const result = await selectionFromEdt(deps({ '/r/api': ['feat/x'] }), 'sibling');
    expect(result).toEqual(ok([{ service: 'api', repoPath: '/r/api', sourceBranch: 'feat/x' }]));
  });

  it('fails update-source-unresolved listing the services, before any write', async () => {
    const result = await selectionFromEdt(deps({}), 'sibling');
    expect(result).toMatchObject({ ok: false, error: { code: 'update-source-unresolved' } });
    expect(JSON.stringify(result)).toContain('api');
  });

  it('rejects an unknown topic and the active EDT own topic', async () => {
    expect(await selectionFromEdt(deps({}), 'nope')).toMatchObject({ error: { code: 'invalid-argument' } });
    expect(await selectionFromEdt(deps({}), 'mine')).toMatchObject({ error: { code: 'invalid-argument' } });
  });
});
