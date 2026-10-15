import { useEffect, useState } from 'react';
import { Text } from 'ink';
import { useInput } from '../hooks/use-input.js';
import { KEYBINDINGS, type Keybinding } from '../../keybindings/index.js';
import type { NavigationKey } from '../keys/navigation-key.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { colors } from '../theme/theme.js';
import { useFooterContext } from '../hooks/use-footer-context.js';
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

export type HelpItem = { kind: 'heading'; text: string } | { kind: 'row'; entry: Keybinding };

// A heading line before the first visible row of a section (also when the window starts inside
// it), so the per-context rows stay apart from the plain key rows.
export function withSectionHeadings(rows: readonly Keybinding[]): HelpItem[] {
  const items: HelpItem[] = [];
  rows.forEach((entry, index) => {
    if (entry.section !== undefined && entry.section !== rows[index - 1]?.section) {
      items.push({ kind: 'heading', text: entry.section.toUpperCase() });
    }
    items.push({ kind: 'row', entry });
  });
  return items;
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
  useFooterContext('help', helpOpen ? 'help' : null, useStore);

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
      {withSectionHeadings(visible).map((item) =>
        item.kind === 'heading' ? (
          <Text key={`heading:${item.text}`} bold color={colors.accent}>
            {item.text}
          </Text>
        ) : (
          <Text key={item.entry.keys}>
            <Text color={colors['text-dim']}>[{item.entry.keys}]</Text>
            <Text color={colors.text}> {item.entry.description}</Text>
          </Text>
        ),
      )}
    </ModalDialog>
  );
}
