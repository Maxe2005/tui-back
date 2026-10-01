// tui/zones/edts/dialogs/create-wizard: Step 3 "Branches" (Story 2.37) — one global branch
// rule for every selected service, then per-service exceptions.
//   - Panel A "STRATÉGIE GLOBALE" (focused on entry): "Branche source par défaut" (empty = a
//     dim `<shared-branch>` placeholder: each service uses its own manifest sharedBranch) and
//     "Nom global de la branche" (the Step 1 slug until edited). `↑/↓` move between the two
//     lines, `Enter` enters edit mode, `Esc` leaves it; on the base line any printable key
//     also enters edit mode with that character typed.
//   - Panel B "RÉSUMÉ ET EXCEPTIONS PAR SERVICE": a height-bounded table, one row per selected
//     service (`Service | Mode | Base / Source | Branche cible`). `↑/↓` move the row cursor,
//     `Enter` opens the "Configurer <service>" override box (override-box.tsx).
//   - `Tab` switches panels. `Enter` never advances the wizard here; `Ctrl+N`/`Ctrl+→` do.
//   - `Esc` closes the innermost element first: a field in edit, then the box, then Panel A's
//     edit mode, then (reported as `cancel`) the whole wizard.
// The key handling is a pure reducer over the dialog state (reduceBranchStepKey).
import { Box, Text, type Key } from 'ink';
import { nextTextInputValue, type TextEditKey } from '../../../../shared/components/text-edit.js';
import { TextInputLine } from '../../../../shared/components/text-input-line.js';
import { colors } from '../../../../shared/theme/theme.js';
import { type BranchStepState, type CreateDialogState, type EdtDialogState } from '../../edts-zone.logic.js';
import { BranchPlanTable, PanelTitle, type BranchPlanCell } from '../branch-plan-table.js';
import { openOverrideBox, reduceOverrideBoxKey, type OverrideBoxContext } from './override-box.logic.js';
import { OverrideBoxView } from './override-box.js';
import { buildStep3Rows, refreshSeededNames, type BranchCandidate, type RowView } from './wizard.logic.js';

export const SHARED_BRANCH_PLACEHOLDER = '<shared-branch>';
export const STEP3_FOOTER = '[Tab] Changer de zone • [Entrée] Configurer la ligne • [Ctrl+N] Étape suivante';

export function overrideBoxContextFor(state: CreateDialogState, path: string, candidates: readonly BranchCandidate[]): OverrideBoxContext {
  const lists = state.branches.lists[path];
  const candidate = candidates.find((entry) => entry.path === path);
  return {
    service: candidate?.service ?? path,
    status: lists?.status ?? 'pending',
    local: lists?.local ?? [],
    remote: lists?.remote ?? [],
    sharedBranch: candidate?.sharedBranch ?? '',
    protectedBranches: candidate?.protectedBranches ?? [],
  };
}

// A printable, non-blank key: Space never starts the base line's edit mode (no branch name
// starts with a space).
function isPrintable(input: string, key: TextEditKey): boolean {
  return (
    input.trim().length > 0 &&
    !key.ctrl &&
    !key.meta &&
    !key.return &&
    !key.escape &&
    !key.tab &&
    !key.backspace &&
    !key.delete &&
    !key.upArrow &&
    !key.downArrow &&
    !key.leftArrow &&
    !key.rightArrow
  );
}

// Clears the wizard's stale "can't leave Step 3" error once anything that feeds the rows
// changed (global base/name, an override).
function withBranches(state: CreateDialogState, branches: BranchStepState): CreateDialogState {
  const rowsChanged =
    branches.globalBase.value !== state.branches.globalBase.value ||
    branches.globalName.value !== state.branches.globalName.value ||
    branches.overrides !== state.branches.overrides;
  return { ...state, branches, error: rowsChanged ? null : state.error };
}

export type BranchStepKeyResult = { state: CreateDialogState; cancel: boolean };

export function reduceBranchStepKey(
  state: CreateDialogState,
  candidates: readonly BranchCandidate[],
  input: string,
  key: TextEditKey,
): BranchStepKeyResult {
  const { branches } = state;
  const box = branches.box;
  // The override box is the innermost element: it owns every key while open.
  if (box !== null) {
    const result = reduceOverrideBoxKey(box, overrideBoxContextFor(state, box.path, candidates), input, key);
    if (result.type === 'update') {
      return { state: withBranches(state, { ...branches, box: result.box }), cancel: false };
    }
    if (result.type === 'close') {
      return { state: withBranches(state, { ...branches, box: null }), cancel: false };
    }
    if (result.type === 'revert') {
      const overrides = { ...branches.overrides };
      delete overrides[box.path];
      return { state: withBranches(state, { ...branches, overrides, box: null }), cancel: false };
    }
    return { state: withBranches(state, { ...branches, overrides: { ...branches.overrides, [box.path]: result.plan }, box: null }), cancel: false };
  }

  if (key.tab) {
    return { state: withBranches(state, { ...branches, panel: branches.panel === 'global' ? 'rows' : 'global', editing: false }), cancel: false };
  }

  if (branches.panel === 'global') {
    const field = branches.globalLine === 'base' ? 'globalBase' : 'globalName';
    if (branches.editing) {
      if (key.escape || key.return) {
        return { state: withBranches(state, { ...branches, editing: false }), cancel: false };
      }
      const next = nextTextInputValue(branches[field], input, key);
      const nameChanged = field === 'globalName' && next.value !== branches.globalName.value;
      const touched = nameChanged ? true : branches.globalNameTouched;
      // Story 2.31 (review): untouched seeded [Créer (Perso)] rows follow a global name edited
      // here too, not only on Step 3 re-entry.
      const overrides = nameChanged
        ? refreshSeededNames(branches.overrides, branches.seededPaths, state.seedFromEdt, branches.globalName.value, next.value)
        : branches.overrides;
      return { state: withBranches(state, { ...branches, [field]: next, globalNameTouched: touched, overrides }), cancel: false };
    }
    if (key.escape) {
      return { state, cancel: true };
    }
    if (key.upArrow || key.downArrow) {
      return { state: withBranches(state, { ...branches, globalLine: key.downArrow ? 'name' : 'base' }), cancel: false };
    }
    if (key.return) {
      return { state: withBranches(state, { ...branches, editing: true }), cancel: false };
    }
    if (branches.globalLine === 'base' && isPrintable(input, key)) {
      const next = nextTextInputValue(branches.globalBase, input, key);
      return { state: withBranches(state, { ...branches, editing: true, globalBase: next }), cancel: false };
    }
    return { state, cancel: false };
  }

  // Panel B.
  if (key.escape) {
    return { state, cancel: true };
  }
  const rowCount = state.selectedMembers.length;
  if (key.upArrow || key.downArrow) {
    const rowCursor = Math.min(Math.max(branches.rowCursor + (key.downArrow ? 1 : -1), 0), Math.max(rowCount - 1, 0));
    return { state: withBranches(state, { ...branches, rowCursor }), cancel: false };
  }
  if (key.return) {
    const row = buildStep3Rows(state, candidates)[branches.rowCursor];
    if (row === undefined) {
      return { state, cancel: false };
    }
    const context = overrideBoxContextFor(state, row.path, candidates);
    // A global row's box starts from what the row currently shows: its resolved base (or the
    // raw input / sharedBranch when unresolved) and the global name.
    const base = row.mode === 'global' && row.baseStatus === 'ok' ? row.base : branches.globalBase.value.trim() || context.sharedBranch;
    const override = branches.overrides[row.path];
    const opened = openOverrideBox(row.path, { ...(override !== undefined ? { override } : {}), base, name: branches.globalName.value.trim() });
    return { state: withBranches(state, { ...branches, box: opened }), cancel: false };
  }
  return { state, cancel: false };
}

export function createBranchStepHandlers(deps: {
  setDialog: (updater: EdtDialogState | ((prev: EdtDialogState) => EdtDialogState)) => void;
  candidates: readonly BranchCandidate[];
}) {
  // Every decision — the cancel included — is taken against `prev`, the latest state, the same
  // way goNext validates: keys arriving in one input chunk (e.g. Enter then Esc) each see the
  // previous key's result, never the render-time state. A cancel cannot run its side effects
  // inside the updater, so it raises `cancelRequested` for the zone to act on.
  function handleBranchStepInput(input: string, key: Key) {
    deps.setDialog((prev) => {
      if (prev.kind !== 'create' || prev.step !== 3) {
        return prev;
      }
      const result = reduceBranchStepKey(prev, deps.candidates, input, key);
      return result.cancel ? { ...prev, cancelRequested: true } : result.state;
    });
  }

  return { handleBranchStepInput };
}

const COLUMN_HEADERS = ['Service', 'Mode', 'Base / Source', 'Branche cible'] as const;

// The full text of a blocking error is shown once, on the detail line under the table (the
// shared table truncates every cell).
function baseText(row: RowView): string {
  return row.baseStatus === 'error' ? `✖ ${row.base}` : row.base;
}

function targetText(row: RowView): string {
  return row.targetError !== null ? `✖ ${row.target === '' ? '—' : row.target}` : row.target;
}

function rowCells(row: RowView): BranchPlanCell[] {
  return [
    { text: row.service },
    { text: row.modeLabel },
    {
      text: baseText(row),
      ...(row.baseStatus === 'error' ? { color: colors.error } : row.baseStatus === 'loading' ? { color: colors['text-dim'] } : {}),
    },
    { text: targetText(row), ...(row.targetError !== null ? { color: colors.error } : {}) },
  ];
}

// The row whose blocking error the detail line spells out: the row under the cursor when it
// is blocked, otherwise the first blocked row.
export function detailRow(rows: readonly RowView[], rowCursor: number): RowView | undefined {
  const focused = rows[rowCursor];
  return focused !== undefined && focused.error !== null ? focused : rows.find((row) => row.error !== null);
}

export function BranchStepView({
  dialog,
  candidates,
  maxRows,
  maxVisibleRows,
}: {
  dialog: CreateDialogState;
  candidates: readonly BranchCandidate[];
  // The override box's autocomplete dropdown cap (settings.edts.branchDropdownMaxRows).
  maxRows: number;
  // Panel B's table height budget (NFR-7), derived live from the terminal size.
  maxVisibleRows: number;
}) {
  const { branches } = dialog;
  const rows = buildStep3Rows(dialog, candidates);
  const box = branches.box;
  if (box !== null) {
    return <OverrideBoxView box={box} context={overrideBoxContextFor(dialog, box.path, candidates)} maxRows={maxRows} />;
  }
  const globalFocused = branches.panel === 'global';
  const lineFocused = (line: 'base' | 'name') => globalFocused && branches.globalLine === line;
  const rowsFocused = branches.panel === 'rows';
  const blocked = detailRow(rows, branches.rowCursor);
  return (
    <Box flexDirection="column">
      <PanelTitle text="STRATÉGIE GLOBALE" focused={globalFocused} />
      <Box>
        <Text color={colors.accent}>{lineFocused('base') ? '› ' : '  '}</Text>
        {branches.globalBase.value === '' ? (
          <Text color={lineFocused('base') ? colors.accent : colors.text}>
            Branche source par défaut: <Text color={colors['text-dim']}>{SHARED_BRANCH_PLACEHOLDER}</Text>
          </Text>
        ) : (
          <TextInputLine
            label="Branche source par défaut"
            value={branches.globalBase.value}
            cursor={branches.globalBase.cursor}
            focused={lineFocused('base') && branches.editing}
          />
        )}
      </Box>
      <Box>
        <Text color={colors.accent}>{lineFocused('name') ? '› ' : '  '}</Text>
        <TextInputLine
          label="Nom global de la branche"
          value={branches.globalName.value}
          cursor={branches.globalName.cursor}
          focused={lineFocused('name') && branches.editing}
        />
      </Box>
      <PanelTitle text="RÉSUMÉ ET EXCEPTIONS PAR SERVICE" focused={rowsFocused} />
      <BranchPlanTable
        headers={COLUMN_HEADERS}
        rows={rows}
        rowKey={(row) => row.path}
        cells={rowCells}
        cursor={branches.rowCursor}
        focused={rowsFocused}
        maxVisibleRows={maxVisibleRows}
        labels={{ moreAbove: 'services au-dessus', moreBelow: 'services en dessous' }}
      />
      {blocked !== undefined ? (
        <Text color={colors.error}>
          ✖ {blocked.service} : {blocked.error}
        </Text>
      ) : null}
      <Text color={colors['text-dim']}>{STEP3_FOOTER}</Text>
    </Box>
  );
}
