// tui/zones/update: the pre-run configuration screen — a ModalDialog listing one CheckboxListItem
// row per targeted service (pre-selected, branch pre-filled from the manifest `sharedBranch`),
// then the migrate and clean-restart toggles. It only renders: keystrokes are interpreted by
// update-config-dialog.logic.ts from update-zone.tsx's useInput, the cursor and branch edit
// live in zone-local state, the draft in the store.
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
  type UpdateConfigDraft,
  type UpdateConfigViewState,
} from './update-config-dialog.logic.js';

export const UPDATE_CONFIG_TITLE_EDT = 'CONFIGURE GROUP UPDATE';
export const UPDATE_CONFIG_TITLE_ALL = 'CONFIGURE ALL-REPOS UPDATE';
export const UPDATE_CONFIG_HINTS = '[Space] toggle  [e] edit branch  [Enter] start run  [Esc] cancel';
export const UPDATE_CONFIG_MIGRATE_LABEL = 'Run migrations';
export const UPDATE_CONFIG_CLEAN_LABEL = 'Clean restart';

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
    <ModalDialog title={draft.scope === 'all' ? UPDATE_CONFIG_TITLE_ALL : UPDATE_CONFIG_TITLE_EDT} open>
      <Text color={colors['text-dim']}>{scopeLine}</Text>
      {draft.rows.length === 0 ? <Text color={colors['text-dim']}>No services to configure.</Text> : null}
      {draft.rows.map((row, index) => {
        const focused = index === cursor && view.editing === null;
        const editingThis = view.editing !== null && index === cursor;
        // Keyed by path + index (the results-list convention): duplicate service names
        // share one repoPath-shaped identity, and React must never drop a same-named row.
        return (
          <Box key={`${row.repoPath}:${index}`} flexDirection="column">
            <ConfigRow focused={focused || editingThis} checked={row.selected} label={row.service} meta={`${row.repoPath} ← ${row.sourceBranch}`} />
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
        focused={isMigrateRow(draft, cursor) && view.editing === null}
        checked={draft.runMigrations}
        label={UPDATE_CONFIG_MIGRATE_LABEL}
        meta="all selected services"
      />
      <ConfigRow
        focused={isCleanRestartRow(draft, cursor) && view.editing === null}
        checked={draft.cleanRestart}
        label={UPDATE_CONFIG_CLEAN_LABEL}
        meta="all selected services"
      />
      {draft.error !== null ? <Text color={colors.error}>{draft.error}</Text> : null}
      <Text color={colors['text-dim']}>{UPDATE_CONFIG_HINTS}</Text>
    </ModalDialog>
  );
}
