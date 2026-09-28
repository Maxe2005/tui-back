import { describe, expect, it } from 'vitest';
import { renderToString } from '../../../../shared/components/render-to-string.js';
import { BRANCH_MAX_WIDTH, initialCreateDialog, type BranchStepState, type CreateDialogState } from '../../edts-zone.logic.js';
import { BranchStepView } from './step-branches.js';

const LONG_SERVICE = 'a-very-long-service-name-that-never-ends';
const LONG_BRANCH = 'feature/an-extremely-long-branch-name-for-testing';
const CANDIDATES = [{ path: '/repos/a', service: LONG_SERVICE, sharedBranch: 'main' }];

function dialog(branches: Partial<BranchStepState> = {}): CreateDialogState {
  const base = initialCreateDialog();
  return {
    ...base,
    step: 3,
    topic: 'demo',
    selectedMembers: ['/repos/a'],
    branches: {
      ...base.branches,
      globalName: { value: 'demo', cursor: 4 },
      lists: { '/repos/a': { status: 'ready', local: ['main', LONG_BRANCH], remote: [] } },
      ...branches,
    },
  };
}

describe('BranchStepView — Panel B cells (story 2.37 review)', () => {
  it('truncates long service names and branch refs to BRANCH_MAX_WIDTH', async () => {
    const output = await renderToString(
      <BranchStepView
        dialog={dialog({ overrides: { '/repos/a': { kind: 'existing', branch: LONG_BRANCH } } })}
        candidates={CANDIDATES}
        maxRows={5}
        maxVisibleRows={5}
      />,
    );
    expect(output).not.toContain(LONG_SERVICE);
    expect(output).not.toContain(LONG_BRANCH);
    expect(output).toContain(`${LONG_SERVICE.slice(0, BRANCH_MAX_WIDTH - 1)}…`);
    expect(output).toContain(`${LONG_BRANCH.slice(0, BRANCH_MAX_WIDTH - 1)}…`);
  });

  it('spells out a blocked row\'s full error on the detail line under the table', async () => {
    const output = await renderToString(
      <BranchStepView
        dialog={dialog({ lists: { '/repos/a': { status: 'error', local: [], remote: [], error: 'fatal: not a git repository' } } })}
        candidates={CANDIDATES}
        maxRows={5}
        maxVisibleRows={5}
      />,
    );
    expect(output).toContain('échec du chargement des branches : fatal: not a git repository');
  });
});
