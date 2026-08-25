export type Keybinding = {
  keys: string;
  description: string;
};

// Story 2.7: the subset of Ink's `Key` type every list-navigation pure function reads
// (resolveSelectionDirection/resolveSelectionJump in edts-zone.tsx, resolveHelpScroll in
// keybinding-help.tsx). Shared here so the shape can't drift out of sync across call sites —
// arrow/Home/End keys produce an empty `input` string in Ink, only these flags are set.
// Story 2.9 adds `tab`: its first two real consumers are the EDTs zone's Tab-cycle
// (topic-input ↔ member-checklist inside a form; EDT-selector ↔ SERVICES-list focus in the
// base view) — Tab already produces an empty `input` in Ink too, only `key.tab` is set.
export type NavigationKey = {
  upArrow: boolean;
  downArrow: boolean;
  home: boolean;
  end: boolean;
  tab: boolean;
};

export const KEYBINDINGS: readonly Keybinding[] = [
  {
    keys: '↑ / ↓',
    description: 'Move highlight up/down within a list',
  },
  {
    keys: 'Home / End',
    description: 'Jump to top/bottom of the current list',
  },
  {
    keys: 'Space',
    description: 'Toggle (multi-select / checkbox-list-item)',
  },
  {
    keys: 'Enter',
    description:
      'Confirm, always (open row, confirm modal, confirm multi-select)',
  },
  {
    keys: 'Esc',
    description:
      'Cancel, always (close modal, exit splitter resize-mode, clear active filter)',
  },
  {
    keys: 'Tab',
    description: 'Cycle (between form fields / resizable boundaries)',
  },
  {
    keys: 'Ctrl+W',
    description:
      'Keyboard resize-mode on the active splitter (arrows resize, Enter/Esc exits)',
  },
  {
    keys: '/',
    description: 'Open filter within the current zone',
  },
  {
    keys: ':',
    description: 'Open command entry',
  },
  {
    keys: '?',
    description: 'Open the keybinding-help screen',
  },
  {
    keys: 'q',
    description: 'Quit (confirms first if a run is in progress)',
  },
  {
    keys: 'd / e / u / l / r / s',
    description:
      'Switch directly to Dashboard / EDTs / Update / Logs / Routes / shared-types',
  },
  {
    keys: '← / →',
    description: 'Switch to previous/next zone tab, wrapping at the ends',
  },
];
