import { focusNavKeysLabel } from '../shared/keys/focus-navigation.js';

export type Keybinding = {
  keys: string;
  description: string;
};

// The subset of Ink's `Key` type every list-navigation pure function reads, shared so the
// shape can't drift across call sites. Arrow/Home/End/Tab keys produce an empty `input`
// string in Ink — only these flags are set.
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
    keys: focusNavKeysLabel('tab'),
    description: 'Cycle focus (between panes, form fields / resizable boundaries); Shift+Tab reverses',
  },
  {
    keys: 'Ctrl+W',
    description:
      'Keyboard resize-mode on the active zone\'s splitter (Tab cycles boundaries, Shift+Tab reverses, arrows resize, Enter/Esc exits)',
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
  // Wizard-scoped — only while the create-EDT wizard modal owns the keystroke.
  {
    keys: 'Ctrl+→ / Ctrl+N',
    description: 'Create-EDT wizard: next step (only if the current step is valid)',
  },
  {
    keys: 'Ctrl+← / Ctrl+P',
    description: 'Create-EDT wizard: previous step (always allowed, choices kept)',
  },
  // Scoped to the create-EDT wizard's Step 3 — the generic Tab/Enter rows above stay true
  // elsewhere; these spell out what the two keys do on that step.
  {
    keys: 'Tab (wizard Step 3)',
    description: 'Create-EDT wizard, Step 3: switch between the global strategy and the per-service table',
  },
  {
    keys: 'Enter (wizard Step 3)',
    description: 'Create-EDT wizard, Step 3: edit the focused global line / configure the focused service row (never advances)',
  },
  // Back to global in every per-service box or table; the branch picker's rename is Ctrl+T.
  {
    keys: 'Ctrl+R',
    description: 'Per-service box or table (wizard Step 3, switch resolution, Update config): revert the service to the global strategy',
  },
  // Scoped to the create-EDT wizard's Step 4 (activation choice, first-EDT pause panel and its
  // overwrite confirmation).
  {
    keys: 'Space / ↑ ↓ (wizard Step 4)',
    description: 'Create-EDT wizard, Step 4: choose between switching to the new EDT now and creating it without switching',
  },
  {
    keys: 'R (wizard Step 4 pause)',
    description: 'Create-EDT wizard, Step 4 paused on files at risk: re-run the pre-flight after fixing them by hand',
  },
  {
    keys: 'E (wizard Step 4 pause)',
    description: 'Create-EDT wizard, Step 4 paused on files at risk: open the overwrite confirmation listing every file',
  },
  {
    keys: 'Esc (wizard Step 4 pause)',
    description: 'Create-EDT wizard, Step 4 paused on files at risk: stop — the EDT stays created but not active',
  },
  {
    keys: 'Ctrl+E (wizard Step 4 overwrite)',
    description: 'Create-EDT wizard, overwrite confirmation: discard exactly the listed files and activate (↑/↓ scroll, Enter/Esc go back)',
  },
  // Scoped to the SWITCH EDT resolution view (dirty services outside the EDT being left) —
  // same Tab/Enter/Ctrl+R meanings as the wizard's Step 3 it mirrors.
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
    description: 'Switch EDT, dirty services: confirm (blocked while a row is invalid; any [Discard] row asks a second confirmation)',
  },
  {
    keys: 'Space / ← → (switch resolution)',
    description: 'Switch EDT, global strategy and "Configure" box: toggle the action between Adopt and Discard',
  },
  {
    keys: '↑ / ↓ (switch discard confirmation)',
    description: 'Switch EDT, discard confirmation: scroll the list of files to be destroyed',
  },
  {
    keys: 'Ctrl+E (switch resolution)',
    description: 'Switch EDT, discard confirmation: destroy the listed files and proceed (Enter/Esc go back)',
  },
  {
    keys: 'Esc (switch resolution)',
    description: 'Switch EDT, dirty services: close the open field/box first, otherwise cancel the switch (nothing touched)',
  },
  // Scoped to the Logs zone's pane grid.
  {
    keys: 'W (Logs)',
    description: 'Logs: toggle line wrap on every open pane (bare w stays on the focused pane)',
  },
  {
    keys: 'i (Logs)',
    description: 'Logs: toggle the focused pane between following and ignoring the global filter',
  },
  {
    keys: 'R (Logs)',
    description: 'Logs: restart the focused pane\'s service',
  },
  {
    keys: 'm / a / p (Update)',
    description: 'Update: configure a group update for the EDT members / for every managed repo / for the highlighted service',
  },
  {
    keys: 'Ctrl+N (Update config)',
    description: 'Update config, two-panel screen: start the run (Enter starts it in the plain list)',
  },
  {
    keys: 'R (load error)',
    description: 'EDTs, Update and Logs: retry a failed list load',
  },
  {
    keys: 'Ctrl+R (Routes)',
    description: 'Routes: fire the request of the open pane',
  },
  {
    keys: 'Ctrl+T (branch picker)',
    description: 'Branch picker: rename the highlighted branch',
  },
];
