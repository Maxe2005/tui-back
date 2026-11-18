import { describe, expect, it } from 'vitest';
import { branchOwners, branchOwnersMap } from './branch-owners.js';

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


describe('branchOwnersMap', () => {
  it('maps only owned branches, excluding the given EDT', () => {
    expect(branchOwnersMap(edts, '/repos/a', ['feat/x', 'feat/y'], 'U1')).toEqual({ 'feat/x': ['beta'] });
    expect(branchOwnersMap(edts, '/repos/a', ['feat/y'])).toEqual({});
  });
});

describe('system shared-branches EDT (story 2.46)', () => {
  const system = { ulid: '01SHAREDBRANCHES0000000000', topic: 'Shared branches', kind: 'system-shared' as const, members: [{ service: 'a', repoPath: '/r/a', branch: 'development' }] };

  it('is never listed as owner of a shared branch', () => {
    expect(branchOwners([system], '/r/a', 'development')).toEqual([]);
    expect(branchOwnersMap([system], '/r/a', ['development'])).toEqual({});
  });

  it('is recognized by its constant ulid even without the kind field', () => {
    expect(branchOwners([{ ...system, kind: undefined }], '/r/a', 'development')).toEqual([]);
  });
});

describe('prototype-key safety', () => {
  it('a branch named constructor/__proto__ is a normal key', () => {
    const map = branchOwnersMap(edts, '/repos/a', ['constructor', '__proto__', 'feat/x']);
    expect(Object.keys(map)).toEqual(['feat/x']);
    expect(Object.hasOwn(map, 'constructor')).toBe(false);
  });
});
