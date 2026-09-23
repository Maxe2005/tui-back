// tui/zones/edts/dialogs: the EDT quick-pick — a filterable, arrow-navigable list of EDT
// topics, opened in place of `edt-switch`/`edt-modify`/`edt-delete`'s old no-argument
// fallbacks (edts-zone.tsx's `currentEdtAction` effect). Extracted following the
// switch-dialog.tsx precedent (thin `createXDialogHandlers` object + `XDialogView` function,
// Esc/Enter-only dispatch, no submit network call here — just navigation to another dialog).
//
// story 2.30 (Boundaries: "one shared quick-pick dialog ... mode: 'switch' | 'modify' |
// 'delete'"). Never a second filterable-list *component* duplicating branch-picker.tsx's
// `FilterableBranchList` (it's branch-name-shaped, this is EDT-topic-shaped) — `matchEdtsByPrefix`
// and the inline row rendering below mirror its convention (case-insensitive prefix match,
// `colors.accent` + `'› '` prefix on the highlighted row) without importing from it.
import { Box, Text, type Key } from 'ink';
import type { EdtRegistryEntry } from '../../../../../../core/ports/edt-registry.js';
import type { AppState } from '../../../store/app-store.js';
import { DimAnnotation } from '../../../shared/components/dim-annotation.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import { TextInputLine } from '../../../shared/components/text-input-line.js';
import { colors } from '../../../shared/theme/theme.js';
import {
  initialDeleteDialog,
  initialModifyDialog,
  initialSwitchDialog,
  moveSelection,
  nextTextInputValue,
  resolveSelectionDirection,
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

// Case-insensitive prefix match on topic — same convention as matchCommands/
// matchBranchesByPrefix (Boundaries).
export function matchEdtsByPrefix(query: string, edts: readonly EdtRegistryEntry[]): EdtRegistryEntry[] {
  const needle = query.toLowerCase();
  return edts.filter((entry) => entry.topic.toLowerCase().startsWith(needle));
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
    // Boundary: "Esc closes the quick-pick from any mode with no dialog opened."
    if (key.escape) {
      deps.setDialog({ kind: 'none' });
      deps.setCurrentEdtAction(null);
      return;
    }

    const pool = resolveQuickPickCandidates(current.mode, deps.edtsRows, deps.activeEdtUlid);
    const matches = matchEdtsByPrefix(current.query, pool);

    const direction = resolveSelectionDirection(key);
    if (direction !== null) {
      deps.setDialog((prev) =>
        prev.kind === 'quick-pick' ? { ...prev, cursor: moveSelection(prev.cursor, direction, matches.length) } : prev,
      );
      return;
    }

    // Boundary: "Enter on a highlighted row opens the exact same pre-targeted dialog the
    // topic-supplied path already opens (switch-confirm / modify / delete-confirm) --
    // unchanged." Selecting the active EDT under delete mode opens the existing rejection
    // dialog (initialDeleteDialog's own isActive check) — unchanged, just reached via the
    // picker instead of the focused-row fallback.
    if (key.return) {
      const target = matches[current.cursor];
      if (target === undefined) {
        return;
      }
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

    // Left/Right/Home/End/Backspace/typed-char edit the filter via nextTextInputValue (Code
    // Map) — every other key (arrows/Return/Escape already handled above, plus Tab) is a
    // defensive no-op inside nextTextInputValue itself.
    const edited = nextTextInputValue({ value: current.query, cursor: current.queryCursor }, input, key);
    // A pure caret move leaves `query`'s value unchanged — the highlighted row must survive
    // it. Only an actual filter-text change re-derives the match list and resets the row
    // cursor to the top (mirrors branch-picker.tsx's handlePickExistingKey).
    const nextCursor = edited.value === current.query ? current.cursor : 0;
    deps.setDialog((prev) =>
      prev.kind === 'quick-pick' ? { ...prev, query: edited.value, queryCursor: edited.cursor, cursor: nextCursor } : prev,
    );
  }

  return { handleQuickPickDialogInput };
}

export function QuickPickDialogView({ dialog, pool }: { dialog: QuickPickDialogState; pool: readonly EdtRegistryEntry[] }) {
  const matches = matchEdtsByPrefix(dialog.query, pool);
  return (
    <ModalDialog title={QUICK_PICK_TITLE[dialog.mode]} onConfirm={() => {}} onCancel={() => {}} open={true}>
      <Box flexDirection="column">
        <TextInputLine label="Filter" value={dialog.query} cursor={dialog.queryCursor} focused />
        {matches.length === 0 ? (
          <DimAnnotation text="No matching EDT" />
        ) : (
          <Box flexDirection="column" paddingLeft={2}>
            {matches.map((entry, index) => (
              <Text key={entry.ulid} color={index === dialog.cursor ? colors.accent : colors.text}>
                {index === dialog.cursor ? '› ' : '  '}
                {entry.topic}
              </Text>
            ))}
          </Box>
        )}
        <Text color={colors.text}>[Enter] select  [Esc] cancel</Text>
      </Box>
    </ModalDialog>
  );
}
