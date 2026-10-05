// tui/zones/update: state and pure key reducer of the "Configurer <service>" box — per-service
// exceptions to the global update parameters (source branch, migrations, clean restart), same
// shape and keys as edt-create's override box. Lines: branch field, migrations, restart, then
// `[ Appliquer ]`. An option is only offered when the manifest declares the action.
import {
  createSuggestFieldState,
  stepSuggestField,
  validateSuggestValue,
  type SuggestFieldState,
} from '../../shared/components/suggest-field.logic.js';
import type { TextEditKey } from '../../shared/components/text-edit.js';
import type { BranchAutocompleteStatus } from '../../shared/components/branch-autocomplete-input.js';
import type { ToggleOverride, UpdateConfigDraft } from './update-config-dialog.logic.js';
import { commitEmptyBranch, setRow } from './update-config-panels.logic.js';

export type ServiceBoxLine = 'branch' | 'migrations' | 'restart' | 'apply';

export interface ServiceBoxState {
  index: number;
  line: ServiceBoxLine;
  editing: boolean;
  branch: SuggestFieldState;
  // What the field held on opening: a row that follows a global source opens empty and must
  // stay that way unless the developer types something.
  initialBranch: string;
  migrations: ToggleOverride;
  cleanRestart: ToggleOverride;
  error: string | null;
}

export interface ServiceBoxContext {
  service: string;
  branches: readonly string[];
  branchesStatus: BranchAutocompleteStatus;
  migrationDeclared: boolean;
  recipeDeclared: boolean;
}

export function openServiceBox(draft: UpdateConfigDraft, index: number): ServiceBoxState | null {
  const row = draft.rows[index];
  if (row === undefined) {
    return null;
  }
  const initialBranch = row.origin === 'manual' ? row.sourceBranch : '';
  return {
    index,
    line: 'branch',
    editing: false,
    branch: createSuggestFieldState(initialBranch),
    initialBranch,
    migrations: row.migrations,
    cleanRestart: row.cleanRestart,
    error: null,
  };
}

const LINES: readonly ServiceBoxLine[] = ['branch', 'migrations', 'restart', 'apply'];

// The overrides a line can take: `oui` only when the action is declared.
export function toggleOptions(declared: boolean): ToggleOverride[] {
  return declared ? ['follow', 'off', 'on'] : ['follow', 'off'];
}

export function cycleToggle(current: ToggleOverride, declared: boolean): ToggleOverride {
  const options = toggleOptions(declared);
  return options[(Math.max(options.indexOf(current), 0) + 1) % options.length] ?? 'follow';
}

// The list is only authoritative once loaded: while it loads or when it failed, a typed branch
// is accepted as is (the run itself rejects an unknown branch before touching anything).
function validateBranch(value: string, context: ServiceBoxContext): string | null {
  return context.branchesStatus === 'ready' ? validateSuggestValue(value, context.branches, 'Branche') : null;
}

export type ServiceBoxKey = TextEditKey & { leftArrow?: boolean; rightArrow?: boolean };

export type ServiceBoxStep =
  | { type: 'update'; box: ServiceBoxState }
  | { type: 'close' }
  | { type: 'revert' }
  | { type: 'apply' };

function update(box: ServiceBoxState): ServiceBoxStep {
  return { type: 'update', box };
}

function nextLine(box: ServiceBoxState): ServiceBoxLine {
  return LINES[Math.min(LINES.indexOf(box.line) + 1, LINES.length - 1)] ?? box.line;
}

export function reduceServiceBoxKey(box: ServiceBoxState, context: ServiceBoxContext, input: string, key: ServiceBoxKey): ServiceBoxStep {
  if (key.ctrl && input.toLowerCase() === 'r') {
    return { type: 'revert' };
  }
  if (box.editing) {
    const step = stepSuggestField(box.branch, context.branches, input, key);
    if (step.type === 'cancel') {
      return update({ ...box, editing: false, error: null });
    }
    if (step.type === 'update') {
      return update({ ...box, branch: step.state, error: null });
    }
    const message = validateBranch(step.value, context);
    if (message !== null) {
      return update({ ...box, error: message });
    }
    return update({ ...box, branch: createSuggestFieldState(step.value), editing: false, line: nextLine(box), error: null });
  }
  if (key.escape) {
    return { type: 'close' };
  }
  if (key.upArrow || key.downArrow) {
    const index = LINES.indexOf(box.line) + (key.downArrow ? 1 : -1);
    return update({ ...box, line: LINES[Math.min(Math.max(index, 0), LINES.length - 1)] ?? box.line });
  }
  if (box.line === 'branch') {
    if (key.return) {
      return update({ ...box, editing: true, error: null });
    }
    // Typing on the line starts the edit, like the base line of edt-create's Step 3.
    if (input.length >= 1 && input.trim() !== '' && !key.ctrl && !key.meta && !key.tab) {
      return update({ ...box, editing: true, branch: { ...createSuggestFieldState(box.branch.value + input) }, error: null });
    }
    return update(box);
  }
  if (box.line === 'migrations' || box.line === 'restart') {
    const migrations = box.line === 'migrations';
    const declared = migrations ? context.migrationDeclared : context.recipeDeclared;
    if (input === ' ' || key.tab || key.leftArrow || key.rightArrow) {
      if (!declared) {
        return update(box);
      }
      return update(
        migrations
          ? { ...box, migrations: cycleToggle(box.migrations, declared) }
          : { ...box, cleanRestart: cycleToggle(box.cleanRestart, declared) },
      );
    }
    return key.return ? update({ ...box, line: nextLine(box) }) : update(box);
  }
  return key.return ? { type: 'apply' } : update(box);
}

// Writes the box into the draft. A free-text branch outside the list is refused here too, so
// a stale box can never smuggle an unknown branch past the field's own check.
export function applyServiceBox(
  draft: UpdateConfigDraft,
  box: ServiceBoxState,
  context: ServiceBoxContext,
): { ok: true; draft: UpdateConfigDraft } | { ok: false; error: string } {
  const row = draft.rows[box.index];
  if (row === undefined) {
    return { ok: false, error: 'Service introuvable.' };
  }
  const value = box.branch.value.trim();
  const invalid = validateBranch(value, context);
  if (invalid !== null) {
    return { ok: false, error: invalid };
  }
  let next = { ...row, migrations: box.migrations, cleanRestart: box.cleanRestart };
  if (value !== box.initialBranch.trim()) {
    if (value === '') {
      next = commitEmptyBranch(draft, next);
    } else {
      const { sourceError: _cleared, ...rest } = next;
      next = { ...rest, sourceBranch: value, origin: 'manual' };
    }
  }
  return { ok: true, draft: setRow(draft, box.index, next) };
}
