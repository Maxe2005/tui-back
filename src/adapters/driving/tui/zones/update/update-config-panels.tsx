// tui/zones/update: render-only view of the two-panel update configuration (EDT and all-repos
// scopes), laid out like edt-create's Step 3: GLOBAL SETTINGS above a per-service table.
// Height: modal chrome is budgeted by computeConfigBudget; this view adds panel A (one line per
// global line), the table (header 1 + `tableRows` incl. its more-above/below lines), one error
// line, all truncated to a single line — nothing here can wrap.
import { Box, Text } from 'ink';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import { BranchAutocompleteInput } from '../../shared/components/branch-autocomplete-input.js';
import { createSuggestFieldState, type SuggestFieldState } from '../../shared/components/suggest-field.logic.js';
import { colors } from '../../shared/theme/theme.js';
import { BranchPlanTable, PanelTitle, type BranchPlanCell } from '../edts/dialogs/branch-plan-table.js';
import type { UpdateConfigDraft, UpdateConfigRow } from './update-config-dialog.logic.js';
import {
  CONFIG_MIN_ROWS,
  CONFIG_SERVICE_MIN_ROWS,
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
export const PANELS_TITLE_SERVICE = 'CONFIGURE SERVICE UPDATE';
export const START_RUN_LABEL = '[ Start run ]';
export const PANELS_GLOBAL_TITLE = 'GLOBAL SETTINGS';
export const PANELS_TABLE_TITLE = 'SUMMARY AND PER-SERVICE EXCEPTIONS';
export const PANELS_TOO_SMALL = `Terminal too small: enlarge it (at least ${CONFIG_MIN_ROWS} rows).`;
export function panelsTooSmallText(draft: UpdateConfigDraft): string {
  return draft.layout === 'service-panels' ? `Terminal too small: enlarge it (at least ${CONFIG_SERVICE_MIN_ROWS} rows).` : PANELS_TOO_SMALL;
}
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
      <Text color={colors.accent} wrap="truncate-end">{focused ? '› ' : '  '}</Text>
      <Text color={focused ? colors.accent : colors.text} wrap="truncate-end">{label.padEnd(LABEL_WIDTH)}</Text>
      {children}
    </Box>
  );
}

// The global panel is a fixed handful of settings.
const MAX_GLOBAL_LINES = 8;

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
      {lines.slice(0, MAX_GLOBAL_LINES).map((line) => {
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
              <BranchAutocompleteInput
                label=""
                subject="EDT topics"
                state={view.edtField !== null ? edtState : createSuggestFieldState(topic)}
                branches={edtTopics}
                placeholder={EDT_PLACEHOLDER}
                branchesStatus={edtStatus}
                maxLines={dropdownLines}
                editing={view.edtField !== null}
                focused={focusedLine(line)}
              />
            </GlobalRow>
          );
        }
        if (line === 'start') {
          return (
            <GlobalRow key={line} focused={focusedLine(line)} label="">
              <Text color={focusedLine(line) ? colors.accent : colors.text} bold={focusedLine(line)} wrap="truncate-end">
                {START_RUN_LABEL}
              </Text>
            </GlobalRow>
          );
        }
        const on = line === 'migrations' ? draft.runMigrations : draft.cleanRestart;
        return (
          <GlobalRow key={line} focused={focusedLine(line)} label={line === 'migrations' ? 'Migrations' : 'Clean restart'}>
            <Text color={focusedLine(line) ? colors.accent : colors.text} wrap="truncate-end">
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
  const title =
    draft.layout === 'service-panels' ? PANELS_TITLE_SERVICE : draft.scope === 'all' ? PANELS_TITLE_ALL : PANELS_TITLE_EDT;
  if (budget.tooSmall) {
    return (
      <ModalDialog title={title} open>
        <Text color={colors.warning} wrap="truncate-end">
          {panelsTooSmallText(draft)}
        </Text>
      </ModalDialog>
    );
  }
  if (box !== null && boxContext !== null) {
    return (
      <ModalDialog title={title} open>
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
    <ModalDialog title={title} open>
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
    </ModalDialog>
  );
}
