import { useEffect, useState } from 'react';
import { Text, useInput } from 'ink';
import { KEYBINDINGS, type NavigationKey } from '../../keybindings/index.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { colors } from '../theme/theme.js';
import { ModalDialog } from './modal-dialog.js';

export const DEFAULT_HELP_VISIBLE_LINES = 10;

export function clampHelpOffset(offset: number, maxOffset: number): number {
  const safeOffset = Number.isFinite(offset) ? Math.floor(offset) : 0;
  const safeMax = Number.isFinite(maxOffset) ? Math.max(0, Math.floor(maxOffset)) : 0;
  if (safeOffset < 0) return 0;
  if (safeOffset > safeMax) return safeMax;
  return safeOffset;
}

export function resolveHelpWindow<T>(
  items: readonly T[],
  scrollOffset: number,
  visibleLines: number,
): { visible: readonly T[]; scrollOffset: number } {
  const safeLines = Number.isFinite(visibleLines)
    ? Math.max(0, Math.floor(visibleLines))
    : 0;
  const maxOffset = Math.max(0, items.length - safeLines);
  const offset = clampHelpOffset(scrollOffset, maxOffset);
  return {
    visible: items.slice(offset, offset + safeLines),
    scrollOffset: offset,
  };
}

// Story 2.7: canonical navigation contract retires j/k/g/G in favor of arrows/Home/End —
// arrow/Home/End keys produce an empty `input` string in Ink, only `key` flags are set.
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
      onConfirm={() => {}}
      onCancel={closeHelp}
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
