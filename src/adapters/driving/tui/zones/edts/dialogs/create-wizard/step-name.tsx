// tui/zones/edts/dialogs/create-wizard: Step 1 "Nom" (Story 2.36) — one autofocused
// TextInputLine for the EDT name, with its availability re-checked on every keystroke
// (checkNameAvailability: trimmed, case-sensitive, against the loaded EDT list).
import { Box, Text, type Key } from 'ink';
import { TextInputLine } from '../../../../shared/components/text-input-line.js';
import { colors } from '../../../../shared/theme/theme.js';
import { nextTextInputValue } from '../../../../shared/components/text-edit.js';
import type { CreateDialogState, EdtDialogState } from '../../edts-zone.logic.js';
import type { NameAvailability } from './wizard.logic.js';

export function handleNameStepInput(
  setDialog: (updater: (prev: EdtDialogState) => EdtDialogState) => void,
  input: string,
  key: Key,
) {
  setDialog((prev) => {
    if (prev.kind !== 'create') {
      return prev;
    }
    const next = nextTextInputValue({ value: prev.topic, cursor: prev.topicCursor }, input, key);
    if (next.value === prev.topic && next.cursor === prev.topicCursor) {
      return prev;
    }
    // A value change clears a stale "can't advance" error — the live status line below takes over.
    return { ...prev, topic: next.value, topicCursor: next.cursor, error: next.value !== prev.topic ? null : prev.error };
  });
}

export function NameStepView({ dialog, availability }: { dialog: CreateDialogState; availability: NameAvailability }) {
  return (
    <Box flexDirection="column">
      <TextInputLine label="Nom" value={dialog.topic} cursor={dialog.topicCursor} focused={true} />
      {availability === 'available' ? <Text color={colors.success}>✔ disponible</Text> : null}
      {availability === 'taken' ? <Text color={colors.error}>✖ déjà pris</Text> : null}
    </Box>
  );
}
