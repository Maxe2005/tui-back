// tui/shared/keys: the Ctrl+→ / Ctrl+N (next) · Ctrl+← / Ctrl+P (back) navigation key shared by
// the EDT create wizard and the Routes right pane's sub-tabs. Ink delivers Ctrl+letter as
// `input === '<letter>'` with `key.ctrl: true`, and Ctrl+Arrow as the arrow flag with
// `key.ctrl: true`; Ctrl+N/Ctrl+P cover terminals that never send ctrl on arrow keys.

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
