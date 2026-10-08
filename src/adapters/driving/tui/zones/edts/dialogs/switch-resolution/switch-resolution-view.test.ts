import { describe, expect, it } from 'vitest';
import type { SwitchDirtyRepo } from '../../../../../../../core/edt/switch.js';
import { buildRows, globalOf, initialSwitchResolution } from './switch-resolution.logic.js';
import { discardConfirmLines } from './switch-resolution-view.js';

function repo(overrides: Partial<SwitchDirtyRepo> = {}): SwitchDirtyRepo {
  return {
    service: 'svc-a',
    repoPath: '/repo/a',
    scope: 'non-member',
    currentBranch: 'development',
    currentBranchShared: true,
    sharedBranch: 'development',
    protectedBranches: [],
    owningEdtTopics: [],
    dirtyPaths: ['a.txt'],
    ...overrides,
  };
}

function confirmTexts(dirty: SwitchDirtyRepo[]): string[] {
  const state = { ...initialSwitchResolution('Topic', dirty), globalAction: 'discard' as const };
  return discardConfirmLines(buildRows(dirty, globalOf(state))).map((line) => line.text);
}

describe('discardConfirmLines', () => {
  it('lists a carried manifest as conserved, after the files that will be destroyed', () => {
    expect(confirmTexts([repo({ manifestCarried: true })])).toEqual([
      'svc-a (1 file(s))',
      '    a.txt',
      '    .tui-back.yaml — conserved, not discarded',
    ]);
  });

  it('says nothing about the manifest when it is not dirty', () => {
    expect(confirmTexts([repo()])).toEqual(['svc-a (1 file(s))', '    a.txt']);
  });
});
