// tui/zones/edts/dialogs: the EDT quick-pick — a filterable list of EDT topics opened by a
// no-argument `edt-switch`/`edt-modify`/`edt-delete`/`edt-create-from`. The pick interaction is
// shared/components/filterable-pick-list.tsx; this file owns only the per-mode candidate pool
// and which pre-targeted dialog a selection opens.
import { Box, Text, type Key } from 'ink';
import { isSystemEdt } from '../../../../../../core/edt/shared-edt.js';
import type { EdtRegistryEntry } from '../../../../../../core/ports/edt-registry.js';
import type { AppState } from '../../../store/app-store.js';
import {
  FilterablePickList,
  handleFilterablePickListKey,
  type FilterablePickItem,
} from '../../../shared/components/pickers/filterable-pick-list.js';
import { ModalDialog } from '../../../shared/components/dialogs/modal-dialog.js';
import { colors } from '../../../shared/theme/theme.js';
import {
  initialCreateDialog,
  SYSTEM_EDT_NOTICE,
  initialDeleteDialog,
  initialModifyDialog,
  initialSwitchDialog,
  type EdtDialogState,
  type QuickPickDialogState,
  type QuickPickMode,
} from '../logic/edts-zone.logic.js';
import { ClampedParagraph } from '../../../shared/components/display/truncated-text.js';

// The candidate pool for a given mode: switch mode filters out the active EDT (the system "Shared
// branches" EDT stays, being switchable); modify, delete and create-from modes offer every user EDT,
// active included (any EDT can be the root of a new one) but never the read-only system EDT.
export function resolveQuickPickCandidates(
  mode: QuickPickMode,
  edtsRows: readonly EdtRegistryEntry[],
  activeEdtUlid: string | null,
): EdtRegistryEntry[] {
  if (mode === 'switch') {
    return edtsRows.filter((entry) => entry.ulid !== activeEdtUlid);
  }
  return edtsRows.filter((entry) => !isSystemEdt(entry));
}

// The pool as shared pick items: filtered and labelled by topic only (no secondary text),
// keyed by ulid.
export function toQuickPickItems(pool: readonly EdtRegistryEntry[]): FilterablePickItem<EdtRegistryEntry>[] {
  return pool.map((entry) => ({ key: entry.ulid, label: entry.topic, value: entry }));
}

const QUICK_PICK_TITLE: Record<QuickPickMode, string> = {
  switch: 'SELECT EDT TO SWITCH',
  modify: 'SELECT EDT TO MODIFY',
  delete: 'SELECT EDT TO DELETE',
  'create-from': 'SELECT EDT TO COPY',
};

export type QuickPickDialogDeps = {
  setDialog: (updater: EdtDialogState | ((prev: EdtDialogState) => EdtDialogState)) => void;
  setCurrentEdtAction: AppState['setCurrentEdtAction'];
  edtsRows: readonly EdtRegistryEntry[];
  activeEdtUlid: string | null;
};

export function createQuickPickDialogHandlers(deps: QuickPickDialogDeps) {
  function handleQuickPickDialogInput(current: QuickPickDialogState, input: string, key: Key) {
    const items = toQuickPickItems(resolveQuickPickCandidates(current.mode, deps.edtsRows, deps.activeEdtUlid));
    const result = handleFilterablePickListKey(current, items, input, key);

    // Esc closes the quick-pick from any mode with no dialog opened.
    if (result.type === 'cancel') {
      deps.setDialog({ kind: 'none' });
      deps.setCurrentEdtAction(null);
      return;
    }

    // Enter on a highlighted row opens the same pre-targeted dialog the topic-supplied path opens
    // (switch-confirm / modify / delete-confirm / create wizard). Selecting the active EDT under
    // delete mode opens the existing rejection dialog (initialDeleteDialog's isActive check).
    if (result.type === 'select') {
      const target = result.item.value;
      if (current.mode === 'switch') {
        deps.setDialog(initialSwitchDialog(target));
      } else if (current.mode === 'modify') {
        deps.setDialog(initialModifyDialog(target));
      } else if (current.mode === 'create-from') {
        // The creation wizard seeded from the chosen root EDT.
        deps.setDialog(initialCreateDialog(target));
      } else {
        deps.setDialog(initialDeleteDialog(target, target.ulid === deps.activeEdtUlid));
      }
      deps.setCurrentEdtAction(null);
      return;
    }

    // Re-run the reducer against the latest dialog state rather than applying the result
    // computed from `current` (this render's snapshot): two keypresses delivered before a
    // re-render (key-repeat) must each build on the previous one, never overwrite it.
    deps.setDialog((prev) => {
      if (prev.kind !== 'quick-pick') {
        return prev;
      }
      const latest = handleFilterablePickListKey(prev, items, input, key);
      if (latest.type !== 'update') {
        return prev;
      }
      // The not-found error clears on the first filter edit.
      const notFound = latest.state.query !== prev.query ? null : prev.notFound;
      return { ...prev, ...latest.state, notFound };
    });
  }

  return { handleQuickPickDialogInput };
}

export function QuickPickDialogView({ dialog, pool, systemOnly = false }: { dialog: QuickPickDialogState; pool: readonly EdtRegistryEntry[]; systemOnly?: boolean }) {
  return (
    <ModalDialog title={QUICK_PICK_TITLE[dialog.mode]} open={true}>
      <Box flexDirection="column">
        {dialog.notFound !== null ? <ClampedParagraph color={colors.error} maxLines={4}>{`${dialog.notFound}`}</ClampedParagraph> : null}
        {systemOnly && pool.length === 0 ? <ClampedParagraph color={colors.warning} maxLines={4}>{SYSTEM_EDT_NOTICE}</ClampedParagraph> : null}
        <FilterablePickList
          label="Filter"
          state={dialog}
          items={toQuickPickItems(pool)}
          emptyText="No EDT to select"
          noMatchText="No matching EDT"
        />
      </Box>
    </ModalDialog>
  );
}
