// tui/zones/edts/dialogs: the EDT quick-pick — a filterable, arrow-navigable list of EDT
// topics, opened in place of `edt-switch`/`edt-modify`/`edt-delete`'s old no-argument
// fallbacks (edts-zone.tsx's `currentEdtAction` effect). Extracted following the
// switch-dialog.tsx precedent (thin `createXDialogHandlers` object + `XDialogView` function,
// no submit network call here — just navigation to another dialog).
//
// story 2.30 (Boundaries: "one shared quick-pick dialog ... mode: 'switch' | 'modify' |
// 'delete'"). The pick interaction itself (substring filter, highlight movement, filter-text
// editing, bounded rows) is shared/components/filterable-pick-list.tsx — the same component
// the Update zone's service pick renders through. This file only owns what is EDT-specific:
// the per-mode candidate pool and which pre-targeted dialog a selection opens.
import type { Key } from 'ink';
import type { EdtRegistryEntry } from '../../../../../../core/ports/edt-registry.js';
import type { AppState } from '../../../store/app-store.js';
import {
  FilterablePickList,
  handleFilterablePickListKey,
  type FilterablePickItem,
} from '../../../shared/components/filterable-pick-list.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import {
  initialDeleteDialog,
  initialModifyDialog,
  initialSwitchDialog,
  type EdtDialogState,
  type QuickPickDialogState,
  type QuickPickMode,
} from '../edts-zone.logic.js';

// The candidate pool for a given mode (Boundaries: "Switch mode filters out the active EDT
// (today's 'first non-active EDT' invariant, preserved as the candidate pool). Modify and
// delete modes filter over every EDT, active included.").
export function resolveQuickPickCandidates(
  mode: QuickPickMode,
  edtsRows: readonly EdtRegistryEntry[],
  activeEdtUlid: string | null,
): EdtRegistryEntry[] {
  if (mode === 'switch') {
    return edtsRows.filter((entry) => entry.ulid !== activeEdtUlid);
  }
  return [...edtsRows];
}

// The pool as shared pick items: filtered and labelled by topic only (no secondary text),
// keyed by ulid.
export function toQuickPickItems(pool: readonly EdtRegistryEntry[]): FilterablePickItem<EdtRegistryEntry>[] {
  return pool.map((entry) => ({ key: entry.ulid, label: entry.topic, value: entry }));
}

const QUICK_PICK_TITLE: Record<QuickPickMode, string> = {
  switch: 'SWITCH EDT — SELECT',
  modify: 'MODIFY EDT — SELECT',
  delete: 'DELETE EDT — SELECT',
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

    // Boundary: "Esc closes the quick-pick from any mode with no dialog opened."
    if (result.type === 'cancel') {
      deps.setDialog({ kind: 'none' });
      deps.setCurrentEdtAction(null);
      return;
    }

    // Boundary: "Enter on a highlighted row opens the exact same pre-targeted dialog the
    // topic-supplied path already opens (switch-confirm / modify / delete-confirm) --
    // unchanged." Selecting the active EDT under delete mode opens the existing rejection
    // dialog (initialDeleteDialog's own isActive check) — unchanged, just reached via the
    // picker instead of the focused-row fallback.
    if (result.type === 'select') {
      const target = result.item.value;
      if (current.mode === 'switch') {
        deps.setDialog(initialSwitchDialog(target));
      } else if (current.mode === 'modify') {
        deps.setDialog(initialModifyDialog(target));
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
      return latest.type === 'update' ? { ...prev, ...latest.state } : prev;
    });
  }

  return { handleQuickPickDialogInput };
}

export function QuickPickDialogView({ dialog, pool }: { dialog: QuickPickDialogState; pool: readonly EdtRegistryEntry[] }) {
  return (
    <ModalDialog title={QUICK_PICK_TITLE[dialog.mode]} onConfirm={() => {}} onCancel={() => {}} open={true}>
      <FilterablePickList
        label="Filter"
        state={dialog}
        items={toQuickPickItems(pool)}
        emptyText="No EDT to select"
        noMatchText="No matching EDT"
      />
    </ModalDialog>
  );
}
