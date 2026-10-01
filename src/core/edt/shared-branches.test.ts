import { describe, expect, it } from 'vitest';
import { isProtectedBranch } from './shared-branches.js';

describe('isProtectedBranch (story 2.42, manifest-defined set)', () => {
  it('protects every branch the manifest lists', () => {
    const manifest = { sharedBranch: 'main', protectedBranches: ['preprod', 'prod'] };
    expect(isProtectedBranch('preprod', manifest)).toBe(true);
    expect(isProtectedBranch('prod', manifest)).toBe(true);
  });

  it("always protects the manifest's own sharedBranch", () => {
    expect(isProtectedBranch('main', { sharedBranch: 'main', protectedBranches: ['prod'] })).toBe(true);
    expect(isProtectedBranch('development', { sharedBranch: 'development' })).toBe(true);
  });

  it('protects nothing implicitly when protectedBranches is absent', () => {
    const manifest = { sharedBranch: 'main' };
    expect(isProtectedBranch('development', manifest)).toBe(false);
    expect(isProtectedBranch('preprod', manifest)).toBe(false);
    expect(isProtectedBranch('prod', manifest)).toBe(false);
  });

  it('protects only the sharedBranch when protectedBranches is an empty list', () => {
    const manifest = { sharedBranch: 'main', protectedBranches: [] };
    expect(isProtectedBranch('main', manifest)).toBe(true);
    expect(isProtectedBranch('development', manifest)).toBe(false);
    expect(isProtectedBranch('prod', manifest)).toBe(false);
  });

  it('handles a list that also contains the sharedBranch (overlap)', () => {
    const manifest = { sharedBranch: 'development', protectedBranches: ['development', 'prod'] };
    expect(isProtectedBranch('development', manifest)).toBe(true);
    expect(isProtectedBranch('prod', manifest)).toBe(true);
    expect(isProtectedBranch('preprod', manifest)).toBe(false);
    expect(isProtectedBranch('feat/x', manifest)).toBe(false);
  });

  it('tolerates duplicate entries', () => {
    expect(isProtectedBranch('prod', { sharedBranch: 'main', protectedBranches: ['prod', 'prod'] })).toBe(true);
  });

  it('matches exactly and case-sensitively', () => {
    const manifest = { sharedBranch: 'development', protectedBranches: ['prod'] };
    expect(isProtectedBranch('feat/x', manifest)).toBe(false);
    expect(isProtectedBranch('Prod', manifest)).toBe(false);
    expect(isProtectedBranch('Development', manifest)).toBe(false);
    expect(isProtectedBranch('prod-hotfix', manifest)).toBe(false);
  });
});
