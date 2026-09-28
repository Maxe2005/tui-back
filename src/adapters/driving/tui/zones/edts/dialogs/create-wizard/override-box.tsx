// tui/zones/edts/dialogs/create-wizard: Story 2.37 — the "Configurer <service>" override box
// opened from a Step 3 Panel B row. Its state, its pure key reducer (unit-tested directly,
// same split as branch-autocomplete-input.tsx) and its view.
//
// Lines: `Mode : (•) Créer nouvelle ( ) Choisir existante`, then the mode's own lines, then
// `[ Appliquer ]`.
//   - Créer nouvelle: "Branche de base (source)" (BranchAutocompleteInput over the service's
//     local + remote branches) and "Nom de la branche" (TextInputLine).
//   - Choisir existante: "Branche existante" (BranchAutocompleteInput), a
//     `[ ] Renommer la branche locale` checkbox, and "Nouveau nom" once it is checked.
// Keys: `↑/↓` move between lines; `Space`/`Tab` toggle the mode on the Mode line; `Space`
// toggles the rename checkbox; `Enter` enters the focused field; inside a field `Enter`
// commits and focuses the next line (autocomplete fields follow branch-picker.tsx: an exact
// match commits, otherwise the shared reducer inserts the highlighted branch) and `Esc` leaves
// the field; `Esc` with no field active closes the box without applying; `Enter` on
// `[ Appliquer ]` validates and applies; `Ctrl+R` reverts the row to the global strategy.
import { Box, Text } from 'ink';
import type { MemberBranchPlan } from '../../../../../../../core/edt/create.js';
import {
  BranchAutocompleteInput,
  createBranchAutocompleteState,
  handleBranchAutocompleteKey,
  isBranchAutocompleteExactMatch,
  type BranchAutocompleteState,
} from '../../../../shared/components/branch-autocomplete-input.js';
import { nextTextInputValue, type TextEditKey, type TextInputState } from '../../../../shared/components/text-edit.js';
import { TextInputLine } from '../../../../shared/components/text-input-line.js';
import { colors } from '../../../../shared/theme/theme.js';
import { isProtectedTarget, localNameOf } from './wizard.logic.js';

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

// What the box needs to know about its service: the loaded lists and the manifest
// sharedBranch (FR-7's per-service half).
export type OverrideBoxContext = {
  status: 'pending' | 'loading' | 'ready' | 'error';
  local: readonly string[];
  remote: readonly string[];
  sharedBranch: string;
};

export type OverrideBoxKeyResult =
  | { type: 'update'; box: OverrideBoxState }
  | { type: 'close' }
  | { type: 'revert' }
  | { type: 'apply'; plan: MemberBranchPlan };

export const OVERRIDE_BOX_ERRORS = {
  listsUnavailable: 'Branches de ce service indisponibles — impossible de valider',
  baseRequired: 'Branche de base requise',
  baseNotFound: 'Branche de base introuvable dans ce service',
  nameRequired: 'Nom de branche requis',
  existingRequired: 'Branche existante requise',
  existingNotFound: 'Branche introuvable dans ce service',
  newNameRequired: 'Nouveau nom requis',
  noMatch: 'Aucune branche correspondante',
} as const;

export function protectedNameError(name: string): string {
  return `« ${name} » est une branche protégée (FR-7)`;
}

export function protectedExistingError(name: string): string {
  return `« ${name} » est une branche protégée (FR-7) — cochez « Renommer la branche locale »`;
}

export function shadowedRemoteError(localName: string): string {
  return `La branche locale « ${localName} » existe déjà — choisissez « ${localName} » ou renommez`;
}

function textState(value: string): TextInputState {
  return { value, cursor: value.length };
}

// Opens the box for one row: an existing override is loaded back as-is; a global row starts
// in "Créer nouvelle" pre-filled with the row's current base and the global name.
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

// The Apply gate (advisory — the git gate stays authoritative). Returns the plan, or the
// inline error that refuses Apply.
export function validateOverrideBox(box: OverrideBoxState, context: OverrideBoxContext): { ok: true; plan: MemberBranchPlan } | { ok: false; error: string } {
  if (context.status !== 'ready') {
    return { ok: false, error: OVERRIDE_BOX_ERRORS.listsUnavailable };
  }
  const branches = overrideBoxBranches(context);
  if (box.mode === 'create') {
    const base = box.base.value.trim();
    const name = box.name.value.trim();
    if (base === '') {
      return { ok: false, error: OVERRIDE_BOX_ERRORS.baseRequired };
    }
    if (!branches.includes(base)) {
      return { ok: false, error: OVERRIDE_BOX_ERRORS.baseNotFound };
    }
    if (name === '') {
      return { ok: false, error: OVERRIDE_BOX_ERRORS.nameRequired };
    }
    if (isProtectedTarget(name, context.sharedBranch)) {
      return { ok: false, error: protectedNameError(name) };
    }
    return { ok: true, plan: { kind: 'create', base, name } };
  }
  const branch = box.existing.value.trim();
  if (branch === '') {
    return { ok: false, error: OVERRIDE_BOX_ERRORS.existingRequired };
  }
  if (!branches.includes(branch)) {
    return { ok: false, error: OVERRIDE_BOX_ERRORS.existingNotFound };
  }
  if (box.rename) {
    const renameTo = box.newName.value.trim();
    if (renameTo === '') {
      return { ok: false, error: OVERRIDE_BOX_ERRORS.newNameRequired };
    }
    if (isProtectedTarget(renameTo, context.sharedBranch)) {
      return { ok: false, error: protectedNameError(renameTo) };
    }
    return { ok: true, plan: { kind: 'existing', branch, renameTo } };
  }
  const localName = localNameOf(branch, context);
  if (isProtectedTarget(localName, context.sharedBranch)) {
    return { ok: false, error: protectedExistingError(localName) };
  }
  // A remote-only pick whose derived local name is already a local branch: core would fail
  // creating the tracking branch — pick the local one, or rename.
  if (!context.local.includes(branch) && context.local.includes(localName)) {
    return { ok: false, error: shadowedRemoteError(localName) };
  }
  return { ok: true, plan: { kind: 'existing', branch } };
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
  // branch-picker.tsx L384-411: an exact match commits at once; otherwise the shared reducer
  // decides (insert the highlighted branch and keep editing, or commit-through on no match).
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

export function reduceOverrideBoxKey(box: OverrideBoxState, context: OverrideBoxContext, input: string, key: TextEditKey): OverrideBoxKeyResult {
  // Ctrl+R: "Revenir à la stratégie globale" — wins from any line, in or out of a field.
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
  if (key.upArrow || key.downArrow) {
    const lines = overrideBoxLines(box);
    const index = lines.indexOf(box.line) + (key.downArrow ? 1 : -1);
    const line = lines[Math.min(Math.max(index, 0), lines.length - 1)] ?? box.line;
    return update({ ...box, line });
  }
  if (box.line === 'mode') {
    if (input === ' ' || key.tab) {
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

function LineMarker({ focused }: { focused: boolean }) {
  return <Text color={colors.accent}>{focused ? '› ' : '  '}</Text>;
}

function BoxField({
  label,
  focused,
  editing,
  autocomplete,
  value,
  context,
  maxRows,
}: {
  label: string;
  focused: boolean;
  editing: boolean;
  autocomplete?: BranchAutocompleteState;
  value: TextInputState;
  context: OverrideBoxContext;
  maxRows: number;
}) {
  if (focused && editing && autocomplete !== undefined) {
    const status = context.status === 'ready' ? 'ready' : context.status === 'error' ? 'error' : 'loading';
    return (
      <Box>
        <LineMarker focused={true} />
        <BranchAutocompleteInput
          label={label}
          state={autocomplete}
          branches={overrideBoxBranches(context)}
          branchesStatus={status}
          maxRows={maxRows}
          focused={true}
        />
      </Box>
    );
  }
  return (
    <Box>
      <LineMarker focused={focused} />
      <TextInputLine label={label} value={value.value} cursor={value.cursor} focused={focused && editing} />
    </Box>
  );
}

export const OVERRIDE_BOX_FOOTER =
  "[↑/↓] Ligne • [Entrée] Éditer / Valider • [Espace/Tab] Mode • [Ctrl+R] Revenir à la stratégie globale • [Esc] Fermer";

export function OverrideBoxView({
  box,
  service,
  context,
  maxRows,
}: {
  box: OverrideBoxState;
  service: string;
  context: OverrideBoxContext;
  maxRows: number;
}) {
  const focused = (line: OverrideBoxLine) => box.line === line;
  const nameProtected = box.mode === 'create' && box.name.value.trim() !== '' && isProtectedTarget(box.name.value, context.sharedBranch);
  const newNameProtected = box.mode === 'existing' && box.rename && box.newName.value.trim() !== '' && isProtectedTarget(box.newName.value, context.sharedBranch);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.accent} paddingX={1}>
      <Text color={colors.accent} bold>
        Configurer {service}
      </Text>
      <Box>
        <LineMarker focused={focused('mode')} />
        <Text color={focused('mode') ? colors.accent : colors.text}>
          Mode : {box.mode === 'create' ? '(•)' : '( )'} Créer nouvelle {box.mode === 'existing' ? '(•)' : '( )'} Choisir existante
        </Text>
      </Box>
      {box.mode === 'create' ? (
        <>
          <BoxField
            label="Branche de base (source)"
            focused={focused('base')}
            editing={box.editing}
            autocomplete={box.base}
            value={box.base}
            context={context}
            maxRows={maxRows}
          />
          <BoxField label="Nom de la branche" focused={focused('name')} editing={box.editing} value={box.name} context={context} maxRows={maxRows} />
          {nameProtected ? <Text color={colors.error}>✖ {protectedNameError(box.name.value.trim())}</Text> : null}
        </>
      ) : (
        <>
          <BoxField
            label="Branche existante"
            focused={focused('existing')}
            editing={box.editing}
            autocomplete={box.existing}
            value={box.existing}
            context={context}
            maxRows={maxRows}
          />
          <Box>
            <LineMarker focused={focused('rename')} />
            <Text color={focused('rename') ? colors.accent : colors.text}>{box.rename ? '[x]' : '[ ]'} Renommer la branche locale</Text>
          </Box>
          {box.rename ? (
            <BoxField label="Nouveau nom" focused={focused('newName')} editing={box.editing} value={box.newName} context={context} maxRows={maxRows} />
          ) : null}
          {newNameProtected ? <Text color={colors.error}>✖ {protectedNameError(box.newName.value.trim())}</Text> : null}
        </>
      )}
      <Box>
        <LineMarker focused={focused('apply')} />
        <Text color={focused('apply') ? colors.accent : colors.text} bold={focused('apply')}>
          [ Appliquer ]
        </Text>
      </Box>
      {box.error !== null ? <Text color={colors.error}>✖ {box.error}</Text> : null}
      <Text color={colors['text-dim']}>{OVERRIDE_BOX_FOOTER}</Text>
    </Box>
  );
}
