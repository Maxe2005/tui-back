import { useEffect, useState } from 'react';
import { Text, useInput } from 'ink';
import { KEYBINDINGS, type NavigationKey } from '../../keybindings/index.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { colors } from '../theme/theme.js';
import { ModalDialog } from './modal-dialog.js';
import { clampBoundedOffset, resolveBoundedWindow } from './bounded-list.js';

export const DEFAULT_HELP_VISIBLE_LINES = 10;

// The window/clamp logic lives in bounded-list.tsx; these two names stay exported as thin
// aliases. This component deliberately never renders the shared primitive's more-above/below
// indicator.
export const clampHelpOffset = clampBoundedOffset;
export const resolveHelpWindow = resolveBoundedWindow;

// Arrows/Home/End only (no j/k/g/G) — these keys produce an empty `input` string in Ink, only
// `key` flags are set.
export function resolveHelpScroll(
  key: NavigationKey,
  offset: number,
  visibleLines: number,
): number {
  if (key.home) {
    return resolveHelpWindow(KEYBINDINGS, 0, visibleLines).scrollOffset;
  }
  if (key.end) {
    return resolveHelpWindow(KEYBINDINGS, KEYBINDINGS.length, visibleLines).scrollOffset;
  }
  if (key.downArrow) {
    return resolveHelpWindow(KEYBINDINGS, offset + 1, visibleLines).scrollOffset;
  }
  if (key.upArrow) {
    return resolveHelpWindow(KEYBINDINGS, offset - 1, visibleLines).scrollOffset;
  }
  return offset;
}

export function KeybindingHelp({
  useStore = useAppStore,
  visibleLines = DEFAULT_HELP_VISIBLE_LINES,
}: {
  useStore?: AppStore;
  visibleLines?: number;
}) {
  const helpOpen = useStore((state) => state.helpOpen);
  const closeHelp = useStore((state) => state.closeHelp);
  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    if (helpOpen) {
      setScrollOffset(0);
    }
  }, [helpOpen]);

  useInput((_input, key) => {
    if (!helpOpen) return;
    setScrollOffset((offset) => resolveHelpScroll(key, offset, visibleLines));
  });

  const { visible } = resolveHelpWindow(
    KEYBINDINGS,
    scrollOffset,
    visibleLines,
  );

  return (
    <ModalDialog
      title="KEYBINDINGS"
      open={helpOpen}
    >
      {visible.map((entry) => (
        <Text key={entry.keys}>
          <Text color={colors['text-dim']}>[{entry.keys}]</Text>
          <Text color={colors.text}> {entry.description}</Text>
        </Text>
      ))}
    </ModalDialog>
  );
}
