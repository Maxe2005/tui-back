import { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { useInput } from '../hooks/use-input.js';
import { KEYBINDINGS, type Keybinding } from '../../keybindings/index.js';
import type { NavigationKey } from '../keys/navigation-key.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { colors } from '../theme/theme.js';
import { useFooterContext } from '../hooks/use-footer-context.js';
import { ModalDialog } from './modal-dialog.js';
import { TruncatedText } from './truncated-text.js';
import { clampBoundedOffset, resolveBoundedWindow } from './bounded-list.js';

export const DEFAULT_HELP_VISIBLE_LINES = 10;

// The window/clamp logic lives in bounded-list.tsx; these two names stay exported as thin
// aliases. This component deliberately never renders the shared primitive's more-above/below
// indicator.
export const clampHelpOffset = clampBoundedOffset;
export const resolveHelpWindow = resolveBoundedWindow;

// The shared NavigationKey has no page flags; widened here only, so PgUp/PgDn page the list.
export type HelpScrollKey = NavigationKey & { pageUp?: boolean; pageDown?: boolean };

// Arrows/Home/End/PgUp/PgDn only (no j/k/g/G) — these keys produce an empty `input` string in
// Ink, only `key` flags are set. `rows` is the list being scrolled: the filtered rows.
export function resolveHelpScroll(
  key: HelpScrollKey,
  offset: number,
  visibleLines: number,
  rows: readonly Keybinding[] = KEYBINDINGS,
): number {
  if (key.home) {
    return resolveHelpWindow(rows, 0, visibleLines).scrollOffset;
  }
  if (key.end) {
    return resolveHelpWindow(rows, rows.length, visibleLines).scrollOffset;
  }
  if (key.pageDown) {
    return resolveHelpWindow(rows, offset + visibleLines, visibleLines).scrollOffset;
  }
  if (key.pageUp) {
    return resolveHelpWindow(rows, offset - visibleLines, visibleLines).scrollOffset;
  }
  if (key.downArrow) {
    return resolveHelpWindow(rows, offset + 1, visibleLines).scrollOffset;
  }
  if (key.upArrow) {
    return resolveHelpWindow(rows, offset - 1, visibleLines).scrollOffset;
  }
  return offset;
}

// Case-insensitive plain substring match on a row's keys, description or section; order kept.
// An empty query returns `rows` itself. Headings are derived afterwards by withSectionHeadings,
// so a section heading only shows when one of its rows matched.
export function filterKeybindings(rows: readonly Keybinding[], query: string): readonly Keybinding[] {
  if (query.length === 0) {
    return rows;
  }
  const needle = query.toLowerCase();
  return rows.filter((entry) =>
    [entry.keys, entry.description, entry.section ?? ''].some((field) => field.toLowerCase().includes(needle)),
  );
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
  const helpFilter = useStore((state) => state.helpFilter);
  const [scrollOffset, setScrollOffset] = useState(0);
  useFooterContext('help', helpOpen ? 'help' : null, useStore);

  // Back to the top on every opening and every filter change. The filter text itself is edited by
  // the app-shell's help dispatch; this component only reacts to it.
  useEffect(() => {
    if (helpOpen) {
      setScrollOffset(0);
    }
  }, [helpOpen, helpFilter]);

  const rows = useMemo(() => filterKeybindings(KEYBINDINGS, helpFilter), [helpFilter]);

  useInput((_input, key) => {
    if (!helpOpen) return;
    setScrollOffset((offset) => resolveHelpScroll(key, offset, visibleLines, rows));
  });

  const { visible } = resolveHelpWindow(rows, scrollOffset, visibleLines);

  return (
    // pageKeys off: PgUp/PgDn page the (filtered) list below, never also the dialog body.
    <ModalDialog
      title="KEYBINDINGS"
      open={helpOpen}
      pageKeys={false}
    >
      <Box flexShrink={0}>
        {helpFilter.length > 0 ? (
          <TruncatedText color={colors.text}>{`filter: ${helpFilter}`}</TruncatedText>
        ) : (
          <TruncatedText color={colors['text-dim']}>type to filter</TruncatedText>
        )}
      </Box>
      <Box flexDirection="column" flexShrink={0} minHeight={visibleLines}>
        {rows.length === 0 ? (
          <TruncatedText color={colors['text-dim']}>{`no keybinding matches "${helpFilter}"`}</TruncatedText>
        ) : (
          withSectionHeadings(visible).map((item) =>
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
          )
        )}
      </Box>
    </ModalDialog>
  );
}
