import { describe, expect, it } from 'vitest';
import { isSharedBranch, SHARED_BRANCHES } from './shared-branches.js';

describe('isSharedBranch (story 2.37, moved from the git adapter)', () => {
  it('rejects every fixed shared branch regardless of the manifest', () => {
    for (const name of SHARED_BRANCHES) {
      expect(isSharedBranch(name, 'main')).toBe(true);
    }
  });

  it("rejects the repo's own manifest sharedBranch", () => {
    expect(isSharedBranch('main', 'main')).toBe(true);
  });

  it('accepts any other name, case-sensitively', () => {
    expect(isSharedBranch('feat/x', 'main')).toBe(false);
    expect(isSharedBranch('Development', 'main')).toBe(false);
  });
});
