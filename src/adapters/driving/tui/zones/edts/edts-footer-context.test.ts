import { describe, expect, it } from 'vitest';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import { createBranchPickerState } from '../../shared/components/branch-picker.js';
import { edtsFooterContext, wizardFooterContext } from './edts-footer-context.js';
import {
  initialActivationState,
  initialBranchStepState,
  initialCreateDialog,
  initialIssuesDialog,
  initialServiceActionsDialog,
  initialSwitchDialog,
  type CreateDialogState,
  type EdtDialogState,
} from './edts-zone.logic.js';

const EDT: EdtRegistryEntry = {
  ulid: 'u1',
  topic: 'topic',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'active',
  members: [{ service: 'svc', repoPath: '/r', branch: 'main' }],
};
const SESSION = {
  repoPath: '/r',
  branches: ['main'],
  branchesStatus: 'ready' as const,
  state: createBranchPickerState({ suggestedName: 'x', defaultBaseBranch: 'main', hasCurrentBranch: true, currentBranch: 'main' }),
};
const CLOSED = { registryEmpty: false, resolutionPending: false };

function wizard(overrides: Partial<CreateDialogState>): CreateDialogState {
  return { ...initialCreateDialog(), ...overrides };
}

describe('wizardFooterContext', () => {
  it('follows the step, and says quit instead of cancel on a first EDT', () => {
    expect(wizardFooterContext(wizard({ step: 1 }), false)).toBe('wizard');
    expect(wizardFooterContext(wizard({ step: 2 }), true)).toBe('wizard-first');
    expect(wizardFooterContext(wizard({ step: 3 }), false)).toBe('wizard-branches');
    expect(wizardFooterContext(wizard({ step: 3 }), true)).toBe('wizard-branches-first');
    expect(wizardFooterContext(wizard({ step: 4 }), false)).toBe('wizard-activation');
    expect(wizardFooterContext(wizard({ step: 4, activation: { ...initialActivationState(true) } }), true)).toBe('wizard-activation-first');
  });

  it('prefers the innermost layer: text edit, then the pause panel and its overwrite confirmation', () => {
    const editing = wizard({ step: 3, branches: { ...initialBranchStepState(), editing: true } });
    expect(wizardFooterContext(editing, false)).toBe('confirm');
    const blocked = [{ repoPath: '/r', service: 'svc', paths: ['a'] }];
    const created = { ulid: 'u', topic: 't' };
    const paused = wizard({ step: 4, activation: { ...initialActivationState(), created, blocked } });
    expect(wizardFooterContext(paused, false)).toBe('wizard-pause');
    expect(wizardFooterContext({ ...paused, activation: { ...paused.activation, confirm: { scroll: 0 } } }, false)).toBe('overwrite-confirm');
  });

  it('is acknowledge-only once an outcome landed, and shows no keys while the create runs', () => {
    const created = { ulid: 'u', topic: 't' };
    expect(wizardFooterContext(wizard({ step: 4, activation: { ...initialActivationState(), created, outcome: 'stopped' } }), false)).toBe('close');
    expect(wizardFooterContext(wizard({ step: 4, activation: { ...initialActivationState(), created } }), false)).toBe('busy');
  });
});

describe('edtsFooterContext', () => {
  it('maps every dialog kind to its keys', () => {
    expect(edtsFooterContext({ kind: 'none' }, CLOSED)).toBeNull();
    expect(edtsFooterContext(initialIssuesDialog(), CLOSED)).toBe('dismiss');
    const quickPick = { kind: 'quick-pick', mode: 'switch', notFound: null, query: '', queryCursor: 0, cursor: 0 } as unknown as EdtDialogState;
    expect(edtsFooterContext(quickPick, CLOSED)).toBe('menu');
  });

  it('switch: confirm, forced confirm, resolution view, then the result summary', () => {
    const base = initialSwitchDialog(EDT);
    expect(edtsFooterContext(base, CLOSED)).toBe('confirm');
    expect(edtsFooterContext({ ...base, blocked: true }, CLOSED)).toBe('force-confirm');
    expect(edtsFooterContext(base, { ...CLOSED, resolutionPending: true })).toBe('busy');
    expect(edtsFooterContext({ ...base, results: [] }, CLOSED)).toBe('close');
  });

  it('service actions: the menu, then the branch picker layered over it', () => {
    const base = initialServiceActionsDialog(EDT, '/r', 'svc');
    expect(edtsFooterContext(base, CLOSED)).toBe('menu');
    expect(edtsFooterContext({ ...base, branchPicker: SESSION }, CLOSED)).toBe('branch-picker-base');
  });
});
