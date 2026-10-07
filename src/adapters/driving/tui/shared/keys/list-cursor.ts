// tui/shared/keys: the one list-cursor reducer — Up/Down clamp (no wrap), Home/End jump to top/bottom.
// Pure functions so lists are unit-testable (renderToString's fake stdin never invokes useInput).

import type { NavigationKey } from '../../keybindings/index.js';

// Arrow/Home/End keys produce an empty `input` in Ink, so only `key` flags are read.
export type SelectionDirection = 'up' | 'down';

export function resolveSelectionDirection(key: Pick<NavigationKey, 'upArrow' | 'downArrow'>): SelectionDirection | null {
  if (key.downArrow) {
    return 'down';
  }
  if (key.upArrow) {
    return 'up';
  }
  return null;
}

export function moveSelection(current: number, direction: SelectionDirection, length: number): number {
  if (length === 0) {
    return 0;
  }
  const next = direction === 'down' ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), length - 1);
}

// Home/End jump to top/bottom, a pure function for the same testability reason as
// resolveSelectionDirection.
export type SelectionJump = 'top' | 'bottom';

export function resolveSelectionJump(key: Pick<NavigationKey, 'home' | 'end'>): SelectionJump | null {
  if (key.home) {
    return 'top';
  }
  if (key.end) {
    return 'bottom';
  }
  return null;
}

export function jumpSelection(jump: SelectionJump, length: number): number {
  if (length === 0) {
    return 0;
  }
  return jump === 'top' ? 0 : length - 1;
}

export type CursorKey = { upArrow?: boolean; downArrow?: boolean; home?: boolean; end?: boolean };

// One call for a whole list: the next cursor for an Up/Down/Home/End key, or null when the key is
// not a cursor key (so the caller can fall through to its other bindings).
export function nextCursorForKey(key: CursorKey, current: number, length: number): number | null {
  const normalized = {
    upArrow: key.upArrow === true,
    downArrow: key.downArrow === true,
    home: key.home === true,
    end: key.end === true,
  };
  const jump = resolveSelectionJump(normalized);
  if (jump !== null) {
    return jumpSelection(jump, length);
  }
  const direction = resolveSelectionDirection(normalized);
  return direction === null ? null : moveSelection(current, direction, length);
}
