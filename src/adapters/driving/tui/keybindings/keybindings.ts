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
    description: "Quit (confirms first if a run is in progress; disable in :settings' General tab)",
  },
  {
    keys: ':quit',
    description: 'Quit, regardless of the \'q\' shortcut setting',
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
  // Story 2.36: wizard-scoped — only while the create-EDT wizard modal owns the keystroke.
  {
    keys: 'Ctrl+→ / Ctrl+N',
    description: 'Create-EDT wizard: next step (only if the current step is valid)',
  },
  {
    keys: 'Ctrl+← / Ctrl+P',
    description: 'Create-EDT wizard: previous step (always allowed, choices kept)',
  },
  // Story 2.37: scoped to the create-EDT wizard's Step 3 — the generic Tab/Enter rows above
  // stay true elsewhere; these spell out what the two keys do on that step.
  {
    keys: 'Tab (wizard Step 3)',
    description: 'Create-EDT wizard, Step 3: switch between the global strategy and the per-service table',
  },
  {
    keys: 'Enter (wizard Step 3)',
    description: 'Create-EDT wizard, Step 3: edit the focused global line / configure the focused service row (never advances)',
  },
  // Story 2.37: scoped to the create-EDT wizard's Step 3 "Configurer <service>" box — no
  // collision: BranchPicker's own Ctrl+R (rename a row) lives in other modals, and the wizard
  // no longer hosts a BranchPicker.
  {
    keys: 'Ctrl+R',
    description: 'Create-EDT wizard, "Configurer" box: revert the service to the global branch strategy',
  },
  // Story 2.41: scoped to the SWITCH EDT resolution view (dirty services outside the EDT being
  // left) — same Tab/Enter/Ctrl+R meanings as the wizard's Step 3 it mirrors.
  {
    keys: 'Tab (switch resolution)',
    description: 'Switch EDT, dirty services: switch between the global strategy and the per-service table',
  },
  {
    keys: 'Enter (switch resolution)',
    description: 'Switch EDT, dirty services: edit the global branch name / configure the focused service row',
  },
  {
    keys: 'Ctrl+N (switch resolution)',
    description: 'Switch EDT, dirty services: confirm (blocked while a row is invalid; any [Écraser] row asks a second confirmation)',
  },
  {
    keys: 'Ctrl+R (switch resolution)',
    description: 'Switch EDT, "Configurer" box: return the service to the global strategy',
  },
  {
    keys: 'Ctrl+E (switch resolution)',
    description: 'Switch EDT, discard confirmation: destroy the listed files and proceed (Enter/Esc go back)',
  },
  {
    keys: 'Esc (switch resolution)',
    description: 'Switch EDT, dirty services: close the open field/box first, otherwise cancel the switch (nothing touched)',
  },
];
