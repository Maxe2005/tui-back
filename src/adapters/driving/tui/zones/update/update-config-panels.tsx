// tui/zones/update: render-only view of the two-panel update configuration (EDT and all-repos
// scopes), laid out like edt-create's Step 3: PARAMÈTRES GLOBAUX above a per-service table.
// Height: modal chrome is budgeted by computeConfigBudget; this view adds panel A (one line per
// global line), the table (header 1 + `tableRows` incl. its more-above/below lines), one error
// line and two hint lines, all truncated to a single line — nothing here can wrap.
import { Box, Text } from 'ink';
import { formatHints, KEY_UP_DOWN } from '../../shared/components/hints.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import { SuggestField } from '../../shared/components/suggest-field.js';
import { createSuggestFieldState, type SuggestFieldState } from '../../shared/components/suggest-field.logic.js';
import { colors } from '../../shared/theme/theme.js';
import { BranchPlanTable, PanelTitle, type BranchPlanCell } from '../edts/dialogs/branch-plan-table.js';
import type { UpdateConfigDraft, UpdateConfigRow } from './update-config-dialog.logic.js';
import {
  CONFIG_MIN_ROWS,
  effectiveMigrations,
  effectiveRestart,
  globalLines,
  rowMode,
  type ConfigBudget,
  type GlobalLine,
  type PanelsViewState,
} from './update-config-panels.logic.js';
import { UpdateServiceBox } from './update-service-box.js';
import type { ServiceBoxContext, ServiceBoxState } from './update-service-box.logic.js';

export const PANELS_TITLE_EDT = 'CONFIGURE UPDATE';
export const PANELS_TITLE_ALL = 'CONFIGURE ALL-REPOS UPDATE';
export const PANELS_GLOBAL_TITLE = 'GLOBAL SETTINGS';
export const PANELS_TABLE_TITLE = 'SUMMARY AND PER-SERVICE EXCEPTIONS';
// Two hint lines of at most ~70 characters each, so an 80-column terminal never truncates a key.
export const PANELS_HINTS_PANEL = [
  formatHints([['Tab', 'table'], [KEY_UP_DOWN, 'move'], ['Space', 'change']]),
  formatHints([['Ctrl+N', 'start run'], ['Esc', 'cancel']]),
] as const;
export const PANELS_HINTS_TABLE = [
  formatHints([['Tab', 'settings'], [KEY_UP_DOWN, 'move'], ['Space', 'select'], ['Enter', 'configure']]),
  formatHints([['Ctrl+R', 'back to global'], ['Ctrl+N', 'start run'], ['Esc', 'cancel']]),
] as const;
export const PANELS_TOO_SMALL = `Terminal too small: enlarge it (at least ${CONFIG_MIN_ROWS} rows).`;
export const EDT_PLACEHOLDER = '<none>';

const COLUMN_HEADERS = ['    Service', 'Mode', 'Source', 'Migrations', 'Restart'] as const;
const LABEL_WIDTH = 18;

function sourceText(draft: UpdateConfigDraft, row: UpdateConfigRow): BranchPlanCell {
  if (row.sourceError === 'not-in-edt') {
    return { text: `✖ not in ${draft.strategy.kind === 'edt' ? draft.strategy.topic : ''}`, color: colors.error };
  }
  if (row.sourceError === 'branch-not-found') {
    return { text: '✖ branch not found', color: colors.error };
  }
  if (row.sourceError === 'no-edt-chosen') {
    return { text: '✖ no EDT chosen', color: colors.error };
  }
  const suffix = row.origin === 'edt' && draft.strategy.kind === 'edt' ? ` ← ${draft.strategy.topic}` : '';
  return { text: `${row.sourceBranch}${suffix}` };
}

export function tableCells(draft: UpdateConfigDraft, row: UpdateConfigRow): BranchPlanCell[] {
  const dim = row.selected ? {} : { color: colors['text-dim'] };
  const migrations = effectiveMigrations(draft, row);
  const restart = effectiveRestart(draft, row);
  const source = sourceText(draft, row);
  return [
    { text: `${row.selected ? '[x]' : '[ ]'} ${row.service}`, ...dim },
    { text: rowMode(row), ...dim },
    row.selected ? source : { ...source, color: colors['text-dim'] },
    migrations === 'migrate'
      ? { text: '✔ migrate', color: row.selected ? colors.success : colors['text-dim'] }
      : { text: migrations === 'off' ? 'off' : '— no command', color: colors['text-dim'] },
    restart === 'clean'
      ? { text: '✔ clean', color: row.selected ? colors.success : colors['text-dim'] }
      : { text: restart === 'basic' ? 'basic' : 'basic (no recipe)', color: colors['text-dim'] },
  ];
}

function GlobalRow({
  focused,
  label,
  children,
}: {
  focused: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Text color={colors.accent}>{focused ? '› ' : '  '}</Text>
      <Text color={focused ? colors.accent : colors.text}>{label.padEnd(LABEL_WIDTH)}</Text>
      {children}
    </Box>
  );
}

function GlobalLines({
  draft,
  view,
  edtState,
  edtTopics,
  edtStatus,
  dropdownLines,
}: {
  draft: UpdateConfigDraft;
  view: PanelsViewState;
  edtState: SuggestFieldState;
  edtTopics: readonly string[];
  edtStatus: 'loading' | 'ready' | 'error';
  dropdownLines: number;
}) {
  const lines = globalLines(draft);
  const focusedLine = (line: GlobalLine) => view.focus === 'panel' && lines[view.panelCursor] === line;
  const fromEdt = draft.strategy.kind !== 'shared';
  const topic = draft.strategy.kind === 'edt' ? draft.strategy.topic : '';
  return (
    <Box flexDirection="column">
      {lines.map((line) => {
        if (line === 'source') {
          return (
            <GlobalRow key={line} focused={focusedLine(line)} label="Merge source">
              <Text color={focusedLine(line) ? colors.accent : colors.text} wrap="truncate-end">
                {fromEdt ? '( )' : '(•)'} Shared branches   {fromEdt ? '(•)' : '( )'} From EDT
              </Text>
            </GlobalRow>
          );
        }
        if (line === 'edt') {
          return (
            <GlobalRow key={line} focused={focusedLine(line)} label="EDT source">
              <SuggestField
                label=""
                state={view.edtField !== null ? edtState : createSuggestFieldState(topic)}
                suggestions={edtTopics}
                placeholder={EDT_PLACEHOLDER}
                status={edtStatus}
                maxLines={dropdownLines}
                editing={view.edtField !== null}
                focused={focusedLine(line)}
              />
            </GlobalRow>
          );
        }
        const on = line === 'migrations' ? draft.runMigrations : draft.cleanRestart;
        return (
          <GlobalRow key={line} focused={focusedLine(line)} label={line === 'migrations' ? 'Migrations' : 'Clean restart'}>
            <Text color={focusedLine(line) ? colors.accent : colors.text}>
              {on ? '[x] yes' : '[ ] no'}
            </Text>
          </GlobalRow>
        );
      })}
    </Box>
  );
}

export function UpdateConfigPanels({
  draft,
  view,
  budget,
  edtState,
  edtTopics,
  edtStatus,
  box,
  boxContext,
}: {
  draft: UpdateConfigDraft;
  view: PanelsViewState;
  budget: ConfigBudget;
  edtState: SuggestFieldState;
  edtTopics: readonly string[];
  edtStatus: 'loading' | 'ready' | 'error';
  box: ServiceBoxState | null;
  boxContext: ServiceBoxContext | null;
}) {
  const title = draft.scope === 'all' ? PANELS_TITLE_ALL : PANELS_TITLE_EDT;
  if (budget.tooSmall) {
    return (
      <ModalDialog title={title} open onConfirm={() => {}} onCancel={() => {}}>
        <Text color={colors.warning} wrap="truncate-end">
          {PANELS_TOO_SMALL}
        </Text>
      </ModalDialog>
    );
  }
  if (box !== null && boxContext !== null) {
    return (
      <ModalDialog title={title} open onConfirm={() => {}} onCancel={() => {}}>
        <UpdateServiceBox
          box={box}
          context={boxContext}
          globalMigrations={draft.runMigrations}
          globalCleanRestart={draft.cleanRestart}
          dropdownLines={budget.boxDropdownLines}
        />
      </ModalDialog>
    );
  }
  return (
    <ModalDialog title={title} open onConfirm={() => {}} onCancel={() => {}}>
      <PanelTitle text={PANELS_GLOBAL_TITLE} focused={view.focus === 'panel'} />
      <GlobalLines
        draft={draft}
        view={view}
        edtState={edtState}
        edtTopics={edtTopics}
        edtStatus={edtStatus}
        dropdownLines={budget.dropdownLines}
      />
      <PanelTitle text={PANELS_TABLE_TITLE} focused={view.focus === 'table'} />
      <BranchPlanTable
        headers={COLUMN_HEADERS}
        rows={draft.rows}
        rowKey={(row) => row.repoPath}
        cells={(row) => tableCells(draft, row)}
        cursor={view.tableCursor}
        focused={view.focus === 'table'}
        maxVisibleRows={budget.tableRows}
        labels={{ moreAbove: 'services above', moreBelow: 'services below' }}
      />
      <Text color={colors.error} wrap="truncate-end">
        {draft.error !== null ? `✖ ${draft.error}` : ' '}
      </Text>
      {(view.focus === 'panel' ? PANELS_HINTS_PANEL : PANELS_HINTS_TABLE).map((line) => (
        <Text key={line} color={colors['text-dim']} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </ModalDialog>
  );
}
