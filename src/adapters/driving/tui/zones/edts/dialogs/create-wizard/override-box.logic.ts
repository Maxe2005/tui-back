// tui/zones/edts/dialogs/create-wizard: the "Configure <service>" override box's state, pure key
// reducer and Apply validation, kept apart from its Ink view (override-box.tsx) so
// edts-zone.logic.ts can type its state without importing a view file. Two modes: Create new
// (base branch + new name) and Choose existing (existing branch, optionally renamed).
import type { MemberBranchPlan } from '../../../../../../../core/edt/create.js';
import {
  createBranchAutocompleteState,
  handleBranchAutocompleteKey,
  isBranchAutocompleteExactMatch,
  type BranchAutocompleteState,
} from '../../../../shared/components/branch-autocomplete-input.js';
import { nextTextInputValue, type TextEditKey, type TextInputState } from '../../../../shared/components/text-edit.js';
import { checkPlan, type PlanIssue } from './wizard.logic.js';
import { nextBoxLine } from '../../../../shared/keys/box-line-nav.js';

export type OverrideBoxMode = 'create' | 'existing';

export type OverrideBoxLine = 'mode' | 'base' | 'name' | 'existing' | 'rename' | 'newName' | 'apply';

export type OverrideBoxState = {
  path: string;
  mode: OverrideBoxMode;
  line: OverrideBoxLine;
  editing: boolean;
  base: BranchAutocompleteState;
  name: TextInputState;
  existing: BranchAutocompleteState;
  rename: boolean;
  newName: TextInputState;
  error: string | null;
};

// What the box needs to know about its service: its name, the loaded lists and the manifest's
// protected set — `protectedBranches ∪ {sharedBranch}` (FR-7). `service` names the
// manifest in the inline protected-branch messages.
export type OverrideBoxContext = {
  service: string;
  status: 'pending' | 'loading' | 'ready' | 'error';
  local: readonly string[];
  remote: readonly string[];
  sharedBranch: string;
  protectedBranches: string[];
};

export type OverrideBoxKeyResult =
  | { type: 'update'; box: OverrideBoxState }
  | { type: 'close' }
  | { type: 'revert' }
  | { type: 'apply'; plan: MemberBranchPlan };

export const OVERRIDE_BOX_ERRORS = {
  listsUnavailable: 'Branches of this service are unavailable — cannot validate',
  baseRequired: 'Base branch required',
  baseNotFound: 'Base branch not found in this service',
  nameRequired: 'Branch name required',
  existingRequired: 'Existing branch required',
  existingNotFound: 'Branch not found in this service',
  newNameRequired: 'New name required',
  noMatch: 'No matching branch',
} as const;

// Every protected-branch message names the branch and the service whose manifest protects it.
export function protectedNameError(name: string, service: string): string {
  return `“${name}” is protected by the manifest of ${service}`;
}

export function protectedExistingError(name: string, service: string): string {
  return `“${name}” is protected by the manifest of ${service} — tick “Rename the local branch”`;
}

export function shadowedRemoteError(localName: string): string {
  return `The local branch “${localName}” already exists — choose “${localName}” or rename`;
}

function textState(value: string): TextInputState {
  return { value, cursor: value.length };
}

// Opens the box for one row: an existing override is loaded back as-is; a global row starts
// in "Create new" pre-filled with the row's current base and the global name.
export function openOverrideBox(path: string, init: { override?: MemberBranchPlan; base: string; name: string }): OverrideBoxState {
  const { override } = init;
  const createBase = override?.kind === 'create' ? override.base : init.base;
  const createName = override?.kind === 'create' ? override.name : init.name;
  return {
    path,
    mode: override?.kind === 'existing' ? 'existing' : 'create',
    line: 'mode',
    editing: false,
    base: createBranchAutocompleteState({ value: createBase }),
    name: textState(createName),
    existing: createBranchAutocompleteState({ value: override?.kind === 'existing' ? override.branch : '' }),
    rename: override?.kind === 'existing' && override.renameTo !== undefined,
    newName: textState(override?.kind === 'existing' ? (override.renameTo ?? '') : ''),
    error: null,
  };
}

export function overrideBoxLines(box: Pick<OverrideBoxState, 'mode' | 'rename'>): OverrideBoxLine[] {
  if (box.mode === 'create') {
    return ['mode', 'base', 'name', 'apply'];
  }
  return box.rename ? ['mode', 'existing', 'rename', 'newName', 'apply'] : ['mode', 'existing', 'rename', 'apply'];
}

function nextLine(box: OverrideBoxState): OverrideBoxLine {
  const lines = overrideBoxLines(box);
  return lines[Math.min(lines.indexOf(box.line) + 1, lines.length - 1)] ?? 'apply';
}

export function overrideBoxBranches(context: Pick<OverrideBoxContext, 'local' | 'remote'>): string[] {
  return [...context.local, ...context.remote];
}

export function protectedSourceError(branch: string, service: string): string {
  return `“${branch}” is a local branch protected by the manifest of ${service} — it can be neither reused nor renamed`;
}

export function existingTargetError(name: string): string {
  return `The branch “${name}” already exists in this service`;
}

export function noopRenameError(name: string): string {
  return `“${name}” is already the local name of this branch — untick “Rename the local branch” or change the name`;
}

// The box's wording of wizard.logic.ts's shared PlanIssue (the rows use a short form).
export function boxIssueMessage(issue: PlanIssue, mode: OverrideBoxMode, service: string): string {
  switch (issue.kind) {
    case 'empty-name':
      return mode === 'create' ? OVERRIDE_BOX_ERRORS.nameRequired : OVERRIDE_BOX_ERRORS.newNameRequired;
    case 'protected-name':
      return protectedNameError(issue.name, service);
    case 'protected-source':
      return protectedSourceError(issue.branch, service);
    case 'protected-existing':
      return protectedExistingError(issue.name, service);
    case 'exists':
      return existingTargetError(issue.name);
    case 'noop-rename':
      return noopRenameError(issue.name);
    case 'shadowed':
      return shadowedRemoteError(issue.name);
  }
}

// The Apply gate (advisory — the git gate stays authoritative). Checks the fields the box
// owns (base/branch picked from the lists), then the target through wizard.logic.ts's
// checkPlan — the same check the Panel B row re-runs. Returns the plan, or the inline error
// that refuses Apply.
export function validateOverrideBox(box: OverrideBoxState, context: OverrideBoxContext): { ok: true; plan: MemberBranchPlan } | { ok: false; error: string } {
  if (context.status !== 'ready') {
    return { ok: false, error: OVERRIDE_BOX_ERRORS.listsUnavailable };
  }
  const branches = overrideBoxBranches(context);
  let plan: MemberBranchPlan;
  if (box.mode === 'create') {
    const base = box.base.value.trim();
    if (base === '') {
      return { ok: false, error: OVERRIDE_BOX_ERRORS.baseRequired };
    }
    if (!branches.includes(base)) {
      return { ok: false, error: OVERRIDE_BOX_ERRORS.baseNotFound };
    }
    plan = { kind: 'create', base, name: box.name.value.trim() };
  } else {
    const branch = box.existing.value.trim();
    if (branch === '') {
      return { ok: false, error: OVERRIDE_BOX_ERRORS.existingRequired };
    }
    if (!branches.includes(branch)) {
      return { ok: false, error: OVERRIDE_BOX_ERRORS.existingNotFound };
    }
    plan = box.rename ? { kind: 'existing', branch, renameTo: box.newName.value.trim() } : { kind: 'existing', branch };
  }
  const issue = checkPlan(plan, { status: 'ready', local: context.local, remote: context.remote }, context);
  return issue === null ? { ok: true, plan } : { ok: false, error: boxIssueMessage(issue, box.mode, context.service) };
}

function update(box: OverrideBoxState): OverrideBoxKeyResult {
  return { type: 'update', box };
}

function reduceAutocompleteField(
  box: OverrideBoxState,
  field: 'base' | 'existing',
  branches: readonly string[],
  input: string,
  key: TextEditKey,
): OverrideBoxKeyResult {
  const state = box[field];
  // Like branch-picker.tsx: an exact match commits at once; otherwise the shared reducer decides
  // (insert the highlighted branch and keep editing, or commit-through on no match).
  if (key.return && isBranchAutocompleteExactMatch(state.value, branches)) {
    const value = state.value.trim();
    return update({ ...box, [field]: { value, cursor: value.length, pickCursor: 0 }, editing: false, line: nextLine(box), error: null });
  }
  const result = handleBranchAutocompleteKey(state, branches, input, key);
  if (result.type === 'commit-through') {
    return update({ ...box, error: OVERRIDE_BOX_ERRORS.noMatch });
  }
  const changed = result.state.value !== state.value;
  return update({ ...box, [field]: result.state, error: changed || result.type === 'insert' ? null : box.error });
}

// `↑/↓` move between lines; `Space`/`Tab` toggle the mode on the Mode line; `Space` toggles the
// rename checkbox; `Enter` enters the focused field, and inside a field commits and focuses the
// next line; `Esc` leaves the field, or closes the box without applying; `Enter` on
// `[ Apply ]` validates and applies; `Ctrl+R` reverts the row to the global strategy.
export function reduceOverrideBoxKey(box: OverrideBoxState, context: OverrideBoxContext, input: string, key: TextEditKey): OverrideBoxKeyResult {
  // Ctrl+R: back to the global strategy — wins from any line, in or out of a field.
  if (key.ctrl && input.toLowerCase() === 'r') {
    return { type: 'revert' };
  }
  if (box.editing) {
    if (key.escape) {
      return update({ ...box, editing: false });
    }
    if (box.line === 'base' || box.line === 'existing') {
      return reduceAutocompleteField(box, box.line, overrideBoxBranches(context), input, key);
    }
    if (box.line === 'name' || box.line === 'newName') {
      if (key.return) {
        return update({ ...box, editing: false, line: nextLine(box) });
      }
      const current = box[box.line];
      const next = nextTextInputValue(current, input, key);
      return update({ ...box, [box.line]: next, error: next.value !== current.value ? null : box.error });
    }
    return update({ ...box, editing: false });
  }
  if (key.escape) {
    return { type: 'close' };
  }
  const moved = nextBoxLine(overrideBoxLines(box), box.line, input, key);
  if (moved !== null) {
    return update({ ...box, line: moved });
  }
  if (box.line === 'mode') {
    if (input === ' ' || key.leftArrow || key.rightArrow) {
      return update({ ...box, mode: box.mode === 'create' ? 'existing' : 'create', error: null });
    }
    return key.return ? update({ ...box, line: nextLine(box) }) : update(box);
  }
  if (box.line === 'rename') {
    if (input === ' ') {
      return update({ ...box, rename: !box.rename, error: null });
    }
    return key.return ? update({ ...box, line: nextLine(box) }) : update(box);
  }
  if (box.line === 'apply') {
    if (!key.return) {
      return update(box);
    }
    const checked = validateOverrideBox(box, context);
    return checked.ok ? { type: 'apply', plan: checked.plan } : update({ ...box, error: checked.error });
  }
  // A field line, not in edit: Enter enters it.
  return key.return ? update({ ...box, editing: true, error: null }) : update(box);
}

