// tui/shared/command-bar: story 2.14 — the `:` command-entry bar. A `modal-dialog` + text
// input + filtered `list-row` candidate list over the static commands/commands.ts registry.
// Self-contained `useInput` (mirrors repo-registry-screen.tsx's phase-dispatch shape): typing,
// filtering, Tab-autocomplete, Enter-run/unknown-message, and Esc-cancel are all handled here,
// not routed through AppShell's central useInput callback — AppShell only tracks the single
// `commandBarOpen` boolean that mounts/unmounts this component.
//
// Testability convention (render-to-string.tsx): the shared renderToString harness's fake
// stdin never emits data, so a useInput callback itself is never invoked by any test using
// that harness — every key-handling decision below is a pure, directly-testable function;
// useInput only interprets the raw Ink Key and dispatches the pure result (mirrors
// repo-registry-screen.tsx's typeRootInputChar/backspaceRootInput and
// edts-zone.tsx's resolveSelectionDirection). Real-keypress coverage lives in
// app-shell.interaction.test.tsx, same as Story 2.12's Left/Right coverage.
import { useState } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { ListRow } from './components/list-row.js';
import { ModalDialog } from './components/modal-dialog.js';
import { colors } from './theme/theme.js';
import { useAppStore, type AppStore } from '../store/app-store.js';
import { COMMANDS, matchCommands, findExactCommand } from '../commands/commands.js';

// Query free-text entry. Ctrl/meta combos (e.g. Ctrl+W resize-mode, reserved elsewhere in the
// app) and empty-input control keys (Tab/Enter/Esc/backspace — all handled separately by their
// own key flags) are never appended as literal characters. Mirrors
// repo-registry-screen.tsx's typeRootInputChar exactly.
export function typeCommandQueryChar(current: string, input: string, key: Pick<Key, 'ctrl' | 'meta'>): string {
  if (input.length === 0 || key.ctrl || key.meta) {
    return current;
  }
  return current + input;
}

export function backspaceCommandQuery(current: string): string {
  return current.slice(0, -1);
}

export type CommandBarProps = {
  useStore?: AppStore;
  onClose: () => void;
};

export function CommandBar({ useStore = useAppStore, onClose }: CommandBarProps) {
  const [query, setQuery] = useState('');
  const [unknownCommand, setUnknownCommand] = useState(false);

  const matches = matchCommands(query, COMMANDS);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.return) {
      const exact = findExactCommand(query, COMMANDS);
      if (exact) {
        exact.run(useStore);
        onClose();
      } else {
        setUnknownCommand(true);
      }
      return;
    }

    if (key.tab) {
      if (matches.length === 1) {
        setQuery(matches[0]!.name);
        setUnknownCommand(false);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((current) => backspaceCommandQuery(current));
      setUnknownCommand(false);
      return;
    }

    const nextQuery = typeCommandQueryChar(query, input, key);
    if (nextQuery !== query) {
      setQuery(nextQuery);
      setUnknownCommand(false);
    }
  });

  return (
    <ModalDialog title="COMMAND" open onConfirm={() => {}} onCancel={onClose}>
      <Box flexDirection="column">
        <Text color={colors.text}>
          :<Text color={colors.accent}>{query}</Text>
          <Text color={colors['text-dim']}>█</Text>
        </Text>

        {unknownCommand ? (
          <Text color={colors.error}>Unknown command.</Text>
        ) : null}

        {matches.length === 0 ? (
          <Text color={colors['text-dim']}>No matching command.</Text>
        ) : (
          <Box flexDirection="column">
            {matches.map((command) => (
              <ListRow key={command.name} label={command.name} />
            ))}
          </Box>
        )}
      </Box>
    </ModalDialog>
  );
}
