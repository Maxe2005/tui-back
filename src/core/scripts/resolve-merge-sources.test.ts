import { describe, expect, it } from 'vitest';
import { resolveMergeSourcesFromEdt } from './resolve-merge-sources.js';

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
