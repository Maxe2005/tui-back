// tui/shared/keys: the Ctrl+→ / Ctrl+N (next) · Ctrl+← / Ctrl+P (back) navigation key,
// generalized from the EDT create wizard's step navigation (story 2.36) so the Routes
// right pane's sub-tabs (story 6.9) share the exact same convention. Ink delivers
// Ctrl+letter as `input === '<letter>'` with `key.ctrl: true`, and Ctrl+Arrow (xterm's
// `\x1b[1;5C`/`D`) as the arrow flag with `key.ctrl: true`. Ctrl+N/Ctrl+P are the fallbacks
// for terminals that never send the ctrl modifier on arrow keys.

export type TabNavKey = {
  ctrl?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
};

export type TabNavDirection = 'next' | 'back';

export function resolveTabNavKey(input: string, key: TabNavKey): TabNavDirection | null {
  if (key.ctrl !== true) {
    return null;
  }
  if (key.rightArrow || input === 'n') {
    return 'next';
  }
  if (key.leftArrow || input === 'p') {
    return 'back';
  }
  return null;
}

// Steps through an ordered tab list without wrapping: past either end the current tab
// stays. A current tab missing from the list falls back to the first one.
export function stepTab<T>(tabs: readonly T[], current: T, direction: TabNavDirection): T {
  if (tabs.length === 0) {
    return current;
  }
  const index = tabs.indexOf(current);
  if (index === -1) {
    return tabs[0];
  }
  const next = direction === 'next' ? index + 1 : index - 1;
  return tabs[Math.min(Math.max(next, 0), tabs.length - 1)];
}
