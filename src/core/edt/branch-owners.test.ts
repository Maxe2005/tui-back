import { describe, expect, it } from 'vitest';
import { branchOwners } from './branch-owners.js';

const edts = [
  { ulid: 'U1', topic: 'alpha', members: [{ service: 's', repoPath: '/repos/a/', branch: 'feat/x' }] },
  { ulid: 'U2', topic: 'beta', members: [{ service: 's', repoPath: '/repos/a', branch: 'feat/x' }] },
  { ulid: 'U3', topic: 'gamma', members: [{ service: 's', repoPath: '/repos/b', branch: 'feat/x' }] },
];

describe('branchOwners', () => {
  it('returns owner topics in registry order, resolve()-normalised', () => {
    expect(branchOwners(edts, '/repos/a', 'feat/x')).toEqual(['alpha', 'beta']);
  });
  it('excludes the given ulid', () => {
    expect(branchOwners(edts, '/repos/a', 'feat/x', 'U1')).toEqual(['beta']);
  });
  it('returns [] for another repo or branch', () => {
    expect(branchOwners(edts, '/repos/c', 'feat/x')).toEqual([]);
    expect(branchOwners(edts, '/repos/a', 'feat/y')).toEqual([]);
  });
});

import { branchOwnersMap } from './branch-owners.js';

describe('branchOwnersMap', () => {
  it('maps only owned branches, excluding the given EDT', () => {
    expect(branchOwnersMap(edts, '/repos/a', ['feat/x', 'feat/y'], 'U1')).toEqual({ 'feat/x': ['beta'] });
    expect(branchOwnersMap(edts, '/repos/a', ['feat/y'])).toEqual({});
  });
});
