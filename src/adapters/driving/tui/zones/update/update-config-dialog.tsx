// tui/zones/update: story 3.7 — the pre-run configuration screen. A `ModalDialog`-hosted
// list reusing the `CheckboxListItem` (`[x]`/`[ ]`) checklist pattern plus `TextInputLine`
// branch fields: one row per targeted service (pre-selected, branch pre-filled from the
// manifest `sharedBranch`), then the two run-wide toggles (migrate, clean restart). The
// component only ever renders — every keystroke is interpreted by
// update-config-dialog.logic.ts and dispatched from update-zone.tsx's own `useInput`
// (the zone convention), with the keyboard cursor + branch edit held in zone-local
// `useState` and the draft itself in the Zustand store.
import { Box, Text } from 'ink';
import { colors } from '../../shared/theme/theme.js';
import { BranchAutocompleteInput, type BranchAutocompleteStatus } from '../../shared/components/branch-autocomplete-input.js';
import { CheckboxListItem } from '../../shared/components/checkbox-list-item.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import { resolveRowLayout } from '../../shared/components/list-row.js';
import {
  isCleanRestartRow,
  isMigrateRow,
  updateConfigRowCount,
  type MergeStrategy,
  type UpdateConfigDraft,
  type UpdateConfigRow,
  type UpdateConfigViewState,
} from './update-config-dialog.logic.js';

export const UPDATE_CONFIG_TITLE_EDT = 'CONFIGURE GROUP UPDATE';
export const UPDATE_CONFIG_TITLE_ALL = 'CONFIGURE ALL-REPOS UPDATE';
export const UPDATE_CONFIG_HINTS = '[Space] toggle  [e]/[Enter] edit branch  [y] start run  [Esc] cancel';
export const UPDATE_CONFIG_MIGRATE_LABEL = 'Run migrations';
export const UPDATE_CONFIG_CLEAN_LABEL = 'Clean restart';
export const MERGE_PANEL_TITLE = 'MERGE SOURCE';
export const MERGE_PANEL_HINTS = '[Tab] panel/table  [Ctrl+R] reset manual row to strategy';

const SOURCE_ERROR_TEXT = { 'not-in-edt': 'not in', 'branch-not-found': 'branch not found' } as const;

function rowSourceMeta(row: UpdateConfigRow, strategy: MergeStrategy): string {
  if (row.sourceError !== undefined) {
    return row.repoPath;
  }
  const suffix = row.origin === 'manual' ? ' [Manual]' : row.origin === 'edt' && strategy.kind === 'edt' ? ` ← ${strategy.topic}` : '';
  return `${row.repoPath} ← ${row.sourceBranch}${suffix}`;
}

function sourceErrorLabel(row: UpdateConfigRow, strategy: MergeStrategy): string {
  const topic = strategy.kind === 'edt' ? strategy.topic : '';
  return row.sourceError === 'not-in-edt' ? `✖ ${SOURCE_ERROR_TEXT['not-in-edt']} ${topic}` : `✖ ${SOURCE_ERROR_TEXT['branch-not-found']}`;
}

// The global merge-source panel: a two-option radio over the strategy. The accent bar and
// marker show the panel cursor only while the panel owns the keys.
function MergePanel({ draft, focused, panelCursor }: { draft: UpdateConfigDraft; focused: boolean; panelCursor: number }) {
  const fromEdt = draft.strategy.kind === 'edt';
  const options = [
    { selected: !fromEdt, text: 'Shared branches' },
    { selected: fromEdt, text: `From EDT: ${draft.strategy.kind === 'edt' ? draft.strategy.topic : '<none>'}` },
  ];
  return (
    <Box flexDirection="column">
      <Text color={focused ? colors.accent : colors['text-dim']}>{MERGE_PANEL_TITLE}</Text>
      {options.map((option, index) => (
        <Text key={option.text} color={focused && index === panelCursor ? colors.accent : colors.text}>
          {focused && index === panelCursor ? '› ' : '  '}
          {option.selected ? '(•)' : '( )'} {option.text}
        </Text>
      ))}
    </Box>
  );
}

// One focusable row: the zone cursor treatment (accent bar + `›` marker +
// surface-selected fill, the `resolveRowLayout` vocabulary every list in the app shares)
// wrapped around the `CheckboxListItem` glyph + label the config screen reuses.
function ConfigRow({
  focused,
  checked,
  label,
  meta,
}: {
  focused: boolean;
  checked: boolean;
  label: string;
  meta?: string;
}) {
  const layout = resolveRowLayout({ label: '', selected: focused });
  return (
    <Box backgroundColor={layout.background} flexDirection="row">
      <Text color={colors.accent}>
        {layout.barGlyph}
        {layout.marker}
      </Text>
      <CheckboxListItem label={label} meta={meta} state={checked ? 'checked' : 'unchecked'} />
    </Box>
  );
}

export function UpdateConfigDialog({
  draft,
  view,
  branches,
  branchesStatus,
  maxRows,
}: {
  draft: UpdateConfigDraft;
  view: UpdateConfigViewState;
  // The edited row's own `listBranches()` result (empty/loading while the zone's
  // fetch-once-per-edit effect is still in flight) plus the shared dropdown cap from
  // `settings.edts.branchDropdownMaxRows`. Only the open branch editor reads them.
  branches: readonly string[];
  branchesStatus: BranchAutocompleteStatus;
  maxRows: number;
}) {
  const count = updateConfigRowCount(draft);
  const cursor = Math.min(Math.max(view.cursor, 0), Math.max(count - 1, 0));
  const scopeLine =
    draft.rows.length === 1
      ? `Single service: ${draft.rows[0]?.service ?? ''}`
      : draft.scope === 'all'
        ? 'Every managed repo'
        : 'Active EDT members';
  return (
    <ModalDialog title={draft.scope === 'all' ? UPDATE_CONFIG_TITLE_ALL : UPDATE_CONFIG_TITLE_EDT} open onConfirm={() => {}} onCancel={() => {}}>
      <Text color={colors['text-dim']}>{scopeLine}</Text>
      {draft.mergePanel ? <MergePanel draft={draft} focused={view.focus === 'panel'} panelCursor={view.panelCursor ?? 0} /> : null}
      {draft.rows.length === 0 ? <Text color={colors['text-dim']}>No services to configure.</Text> : null}
      {draft.rows.map((row, index) => {
        const focused = index === cursor && view.editing === null && view.focus !== 'panel';
        const editingThis = view.editing !== null && index === cursor;
        // Keyed by path + index (the results-list convention): duplicate service names
        // share one repoPath-shaped identity, and React must never drop a same-named row.
        return (
          <Box key={`${row.repoPath}:${index}`} flexDirection="column">
            <ConfigRow focused={focused || editingThis} checked={row.selected} label={row.service} meta={rowSourceMeta(row, draft.strategy)} />
            {row.sourceError !== undefined ? (
              <Box paddingLeft={4}>
                <Text color={colors.error}>{sourceErrorLabel(row, draft.strategy)}</Text>
              </Box>
            ) : null}
            {editingThis && view.editing !== null ? (
              <Box paddingLeft={4}>
                <BranchAutocompleteInput
                  label="Merge from"
                  state={view.editing}
                  branches={branches}
                  branchesStatus={branchesStatus}
                  maxRows={maxRows}
                  focused
                />
              </Box>
            ) : null}
          </Box>
        );
      })}
      <ConfigRow
        focused={isMigrateRow(draft, cursor) && view.editing === null && view.focus !== 'panel'}
        checked={draft.runMigrations}
        label={UPDATE_CONFIG_MIGRATE_LABEL}
        meta="all selected services"
      />
      <ConfigRow
        focused={isCleanRestartRow(draft, cursor) && view.editing === null && view.focus !== 'panel'}
        checked={draft.cleanRestart}
        label={UPDATE_CONFIG_CLEAN_LABEL}
        meta="all selected services"
      />
      {draft.error !== null ? <Text color={colors.error}>{draft.error}</Text> : null}
      <Text color={colors['text-dim']}>{UPDATE_CONFIG_HINTS}</Text>
      {draft.mergePanel ? <Text color={colors['text-dim']}>{MERGE_PANEL_HINTS}</Text> : null}
    </ModalDialog>
  );
}
