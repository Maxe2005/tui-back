import { describe, expect, it } from 'vitest';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import { createBranchPickerState } from '../../shared/components/branch-picker.js';
import { openOverrideBox } from './dialogs/create-wizard/override-box.logic.js';
import { initialSwitchResolution } from './dialogs/switch-resolution/switch-resolution.logic.js';
import { edtsFooterContext, wizardFooterContext } from './edts-footer-context.js';
import {
  initialActivationState,
  initialBranchStepState,
  initialAddToEdtDialog,
  initialCreateDialog,
  initialDeleteDialog,
  initialModifyDialog,
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
    expect(edtsFooterContext(initialIssuesDialog(), CLOSED)).toBe('issues-list');
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

describe('edtsFooterContext cases', () => {
  const memberless = { ...EDT, members: [] };
  const pickerSession = (overrides: Partial<typeof SESSION.state>) => ({ ...SESSION, state: { ...SESSION.state, ...overrides } });
  const withBox = (box: ReturnType<typeof openOverrideBox>): CreateDialogState => {
    const base = initialCreateDialog();
    return { ...base, step: 3, branches: { ...base.branches, box } };
  };
  const box = (overrides: Partial<ReturnType<typeof openOverrideBox>>) => ({ ...openOverrideBox('/r', { base: 'main', name: 'x' }), ...overrides });
  const switchState = (overrides: Partial<ReturnType<typeof initialSwitchResolution>>) => ({
    ...initialSwitchResolution('topic', []),
    ...overrides,
  });
  const resolving = (resolution: ReturnType<typeof initialSwitchResolution>): EdtDialogState => ({ ...initialSwitchDialog(EDT), resolution });
  const PENDING = { registryEmpty: false, resolutionPending: true };

  const cases: Array<[string, EdtDialogState, { registryEmpty: boolean; resolutionPending: boolean }, string | null]> = [
    ['modify, topic focused', initialModifyDialog(EDT), CLOSED, 'modify-topic'],
    ['modify, members focused', { ...initialModifyDialog(EDT), formFocus: 'members' }, CLOSED, 'modify-members'],
    ['modify, saving', { ...initialModifyDialog(EDT), submitting: true }, CLOSED, 'busy'],
    ['modify, picker over the form', { ...initialModifyDialog(EDT), branchPicker: SESSION }, CLOSED, 'branch-picker-base'],
    ['delete, loading member status', initialDeleteDialog(EDT, false), CLOSED, 'dismiss'],
    ['delete, rejected', initialDeleteDialog(EDT, true), CLOSED, 'dismiss'],
    ['delete, checklist', { ...initialDeleteDialog(EDT, false), memberRows: [] }, CLOSED, 'checklist'],
    ['delete, deleting', { ...initialDeleteDialog(EDT, false), memberRows: [], submitting: true }, CLOSED, 'busy'],
    ['add-to-edt, picker not open', { ...initialAddToEdtDialog(EDT, '/r', 'svc', null, 'main'), branchPicker: null }, CLOSED, 'busy'],
    ['add-to-edt, fresh picker', initialAddToEdtDialog(EDT, '/r', 'svc', null, 'main'), CLOSED, 'branch-picker-base'],
    ['add-to-edt, picker on a name with other members', { ...initialAddToEdtDialog(EDT, '/r', 'svc', null, 'main'), branchPicker: pickerSession({ baseFocused: false }) }, CLOSED, 'branch-picker-name-members'],
    ['add-to-edt, picker on a name, no members', { ...initialAddToEdtDialog(memberless, '/r', 'svc', null, 'main'), branchPicker: pickerSession({ baseFocused: false }) }, CLOSED, 'branch-picker-name'],
    ['add-to-edt, adding', { ...initialAddToEdtDialog(EDT, '/r', 'svc', null, 'main'), submitting: true }, CLOSED, 'busy'],
    ['switch, preparing the resolution', initialSwitchDialog(EDT), PENDING, 'busy'],
    ['switch, resolution view', resolving(switchState({})), PENDING, 'switch-resolution'],
    ['switch, editing the global name', resolving(switchState({ editing: true })), PENDING, 'confirm'],
    ['switch, service box', resolving(switchState({ box: { repoPath: '/r', action: 'adopt', line: 'action', editing: false, branch: { value: '', cursor: 0 }, error: null } })), PENDING, 'switch-box'],
    ['switch, editing in the box', resolving(switchState({ box: { repoPath: '/r', action: 'adopt', line: 'branch', editing: true, branch: { value: '', cursor: 0 }, error: null } })), PENDING, 'confirm'],
    ['switch, discard confirmation', resolving(switchState({ confirm: { scroll: 0, error: null } })), PENDING, 'overwrite-confirm'],
    ['switch, switching', { ...initialSwitchDialog(EDT), submitting: true }, CLOSED, 'busy'],
    ['wizard, override box', withBox(box({})), CLOSED, 'override-box'],
    ['wizard, suggestion field in the box', withBox(box({ editing: true, line: 'base' })), CLOSED, 'branch-input'],
    ['wizard, existing-branch field in the box', withBox(box({ editing: true, line: 'existing', mode: 'existing' })), CLOSED, 'branch-input'],
    ['wizard, plain text field in the box', withBox(box({ editing: true, line: 'name' })), CLOSED, 'confirm'],
    ['wizard, global line being edited', { ...initialCreateDialog(), step: 3, branches: { ...initialBranchStepState(), editing: true } }, CLOSED, 'confirm'],
    ['wizard, overwrite confirmation', { ...initialCreateDialog(), step: 4, activation: { ...initialActivationState(), created: { ulid: 'u', topic: 't' }, blocked: [], confirm: { scroll: 0 } } }, CLOSED, 'overwrite-confirm'],
    ['wizard, creating', { ...initialCreateDialog(), step: 2, submitting: true }, CLOSED, 'busy'],
  ];

  it.each(cases)('%s', (_name, dialog, state, expected) => {
    expect(edtsFooterContext(dialog, state)).toBe(expected);
  });
});
