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
import { BoundedList } from '../../../../shared/components/bounded-list.js';
import { nextTextInputValue, type TextEditKey } from '../../../../shared/components/text-edit.js';
import { TextInputLine } from '../../../../shared/components/text-input-line.js';
import { colors } from '../../../../shared/theme/theme.js';
import { BRANCH_MAX_WIDTH, truncateBranchLabel, type BranchStepState, type CreateDialogState, type EdtDialogState } from '../../edts-zone.logic.js';
import { openOverrideBox, reduceOverrideBoxKey, type OverrideBoxContext } from './override-box.logic.js';
import { OverrideBoxView } from './override-box.js';
import { buildStep3Rows, type BranchCandidate, type RowView } from './wizard.logic.js';

export const SHARED_BRANCH_PLACEHOLDER = '<shared-branch>';
export const STEP3_FOOTER = '[Tab] Changer de zone • [Entrée] Configurer la ligne • [Ctrl+N] Étape suivante';

export function overrideBoxContextFor(state: CreateDialogState, path: string, candidates: readonly BranchCandidate[]): OverrideBoxContext {
  const lists = state.branches.lists[path];
  return {
    status: lists?.status ?? 'pending',
    local: lists?.local ?? [],
    remote: lists?.remote ?? [],
    sharedBranch: candidates.find((candidate) => candidate.path === path)?.sharedBranch ?? '',
  };
}

function isPrintable(input: string, key: TextEditKey): boolean {
  return (
    input.length > 0 &&
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
      const touched = field === 'globalName' && next.value !== branches.globalName.value ? true : branches.globalNameTouched;
      return { state: withBranches(state, { ...branches, [field]: next, globalNameTouched: touched }), cancel: false };
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
  cancel: () => void;
}) {
  // The cancel decision is taken on the keypress-time state (the reducer is pure, so running
  // it here and again inside the updater is safe); every state change runs against `prev`.
  function handleBranchStepInput(current: CreateDialogState, input: string, key: Key) {
    if (reduceBranchStepKey(current, deps.candidates, input, key).cancel) {
      deps.cancel();
      return;
    }
    deps.setDialog((prev) => (prev.kind === 'create' && prev.step === 3 ? reduceBranchStepKey(prev, deps.candidates, input, key).state : prev));
  }

  return { handleBranchStepInput };
}

const COLUMN_HEADERS = ['Service', 'Mode', 'Base / Source', 'Branche cible'] as const;

// Every free-text cell (service name, branch ref, error label) is capped with the list's own
// truncateBranchLabel/BRANCH_MAX_WIDTH, so no column can push the table past the modal; the
// full text of a blocking error is shown once, on the detail line under the table.
function cell(text: string): string {
  return truncateBranchLabel(text, BRANCH_MAX_WIDTH);
}

function serviceCell(row: RowView): string {
  return cell(row.service);
}

function baseCell(row: RowView): string {
  return cell(row.baseStatus === 'error' ? `✖ ${row.base}` : row.base);
}

function targetCell(row: RowView): string {
  return cell(row.targetError !== null ? `✖ ${row.target === '' ? '—' : row.target}` : row.target);
}

function columnWidths(rows: readonly RowView[]): [number, number, number] {
  const width = (values: readonly string[], header: string) => Math.max(header.length, ...values.map((value) => value.length));
  return [width(rows.map(serviceCell), COLUMN_HEADERS[0]), width(rows.map((row) => row.modeLabel), COLUMN_HEADERS[1]), width(rows.map(baseCell), COLUMN_HEADERS[2])];
}

// The row whose blocking error the detail line spells out: the row under the cursor when it
// is blocked, otherwise the first blocked row.
export function detailRow(rows: readonly RowView[], rowCursor: number): RowView | undefined {
  const focused = rows[rowCursor];
  return focused !== undefined && focused.error !== null ? focused : rows.find((row) => row.error !== null);
}

function PanelTitle({ text, focused }: { text: string; focused: boolean }) {
  return (
    <Text color={focused ? colors.accent : colors.text} bold={focused}>
      {focused ? '▶ ' : '  '}
      {text}
    </Text>
  );
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
    const service = candidates.find((candidate) => candidate.path === box.path)?.service ?? box.path;
    return <OverrideBoxView box={box} service={service} context={overrideBoxContextFor(dialog, box.path, candidates)} maxRows={maxRows} />;
  }
  const globalFocused = branches.panel === 'global';
  const lineFocused = (line: 'base' | 'name') => globalFocused && branches.globalLine === line;
  const [serviceWidth, modeWidth, baseWidth] = columnWidths(rows);
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
      <Text color={colors['text-dim']} wrap="truncate-end">
        {'  '}
        {COLUMN_HEADERS[0].padEnd(serviceWidth)} │ {COLUMN_HEADERS[1].padEnd(modeWidth)} │ {COLUMN_HEADERS[2].padEnd(baseWidth)} │ {COLUMN_HEADERS[3]}
      </Text>
      <BoundedList
        items={rows}
        maxVisibleRows={maxVisibleRows}
        cursorIndex={branches.rowCursor}
        moreAboveLabel="services au-dessus"
        moreBelowLabel="services en dessous"
        renderItem={(row, index) => {
          const selected = rowsFocused && index === branches.rowCursor;
          const textColor = selected ? colors.accent : colors.text;
          return (
            <Text key={row.path} wrap="truncate-end">
              <Text color={colors.accent}>{selected ? '› ' : '  '}</Text>
              <Text color={textColor}>
                {serviceCell(row).padEnd(serviceWidth)} │ {row.modeLabel.padEnd(modeWidth)} │{' '}
              </Text>
              <Text color={row.baseStatus === 'error' ? colors.error : row.baseStatus === 'loading' ? colors['text-dim'] : textColor}>
                {baseCell(row).padEnd(baseWidth)}
              </Text>
              <Text color={textColor}> │ </Text>
              <Text color={row.targetError !== null ? colors.error : textColor}>{targetCell(row)}</Text>
            </Text>
          );
        }}
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
