// tui/shared/keys: line-to-line movement inside a small form box (wizard override box, switch
// resolution box, update service box): Up/Down/Home/End clamp, Tab/Shift+Tab cycle through the
// shared focus-navigation primitive. Value flips never ride on Tab.
import { resolveFocusMove, type FocusNavKey } from './focus-navigation.js';
import { nextCursorForKey, type CursorKey } from './list-cursor.js';

export function nextBoxLine<T>(lines: readonly T[], current: T, input: string, key: CursorKey & FocusNavKey): T | null {
  const cycled = resolveFocusMove(input, key, { mode: 'tab', stops: lines }, current);
  if (cycled !== null) {
    return cycled;
  }
  const index = nextCursorForKey(key, Math.max(lines.indexOf(current), 0), lines.length);
  return index === null ? null : (lines[index] ?? current);
}
