// tui/shared/keys: the single focus-navigation primitive. A zone or dialog declares a mode and an
// ordered list of stops; this module turns a key into a step direction and a direction into the
// next stop. Ink parses Shift+Tab (ESC[Z) as `tab` with `shift: true`, so Shift+Tab always
// reverses Tab. The Ctrl modes reuse tab-navigation.ts rather than duplicating its key decoding.

import { resolveTabNavKey, type TabNavDirection } from './tab-navigation.js';

export type FocusNavMode = 'tab' | 'horizontal' | 'vertical' | 'ctrl-np';

export type FocusNavDirection = TabNavDirection;

export type FocusNavKey = {
  tab?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
};

export type FocusNavDeclaration<T> = {
  mode: FocusNavMode;
  stops: readonly T[];
};

// The two panels (global line / per-service table) the create wizard's Step 3 and the switch
// resolution view toggle between.
export const TWO_PANEL_NAV: FocusNavDeclaration<'global' | 'rows'> = { mode: 'tab', stops: ['global', 'rows'] };

export function resolveFocusStep(input: string, key: FocusNavKey, mode: FocusNavMode): FocusNavDirection | null {
  switch (mode) {
    case 'tab':
      if (key.tab !== true || key.ctrl === true || key.meta === true) {
        return null;
      }
      return key.shift === true ? 'back' : 'next';
    case 'horizontal':
      if (key.rightArrow === true) {
        return 'next';
      }
      return key.leftArrow === true ? 'back' : null;
    case 'vertical':
      if (key.downArrow === true) {
        return 'next';
      }
      return key.upArrow === true ? 'back' : null;
    case 'ctrl-np':
      return resolveTabNavKey(input, key);
  }
}

// Wrapping step through the stops. A current stop missing from the list falls back to the first
// stop going forward and the last going back.
export function stepFocus<T>(stops: readonly T[], current: T, direction: FocusNavDirection): T {
  if (stops.length === 0) {
    return current;
  }
  const index = stops.indexOf(current);
  if (index === -1) {
    return direction === 'next' ? stops[0]! : stops[stops.length - 1]!;
  }
  const delta = direction === 'next' ? 1 : -1;
  return stops[(index + delta + stops.length) % stops.length]!;
}

// Resolves the key and, when it belongs to the declared mode, the next stop; null otherwise.
export function resolveFocusMove<T>(
  input: string,
  key: FocusNavKey,
  declaration: FocusNavDeclaration<T>,
  current: T,
): T | null {
  const direction = resolveFocusStep(input, key, declaration.mode);
  return direction === null ? null : stepFocus(declaration.stops, current, direction);
}

export type FocusNavHint = { keys: string; description: string };

export function focusNavKeysLabel(mode: FocusNavMode): string {
  switch (mode) {
    case 'tab':
      return 'Tab / Shift+Tab';
    case 'horizontal':
      return '← / →';
    case 'vertical':
      return '↑ / ↓';
    case 'ctrl-np':
      return 'Ctrl+P / Ctrl+N';
  }
}

export function focusNavFooterHint(mode: FocusNavMode, label: string): string {
  return `[${focusNavKeysLabel(mode).replace(' / ', '/')}] ${label}`;
}

export function focusNavHint(mode: FocusNavMode, description: string): FocusNavHint {
  return { keys: focusNavKeysLabel(mode), description };
}
