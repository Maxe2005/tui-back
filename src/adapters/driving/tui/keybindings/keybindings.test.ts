import { describe, it, expect } from 'vitest';
import { KEYBINDINGS } from './index.js';

const EXPECTED = [
  ['↑ / ↓', 'Move highlight up/down within a list'],
  ['Home / End', 'Jump to top/bottom of the current list'],
  ['Space', 'Toggle (multi-select / checkbox-list-item)'],
  [
    'Enter',
    'Confirm, always (open row, confirm modal, confirm multi-select)',
  ],
  [
    'Esc',
    'Cancel, always (close modal, exit splitter resize-mode, clear active filter)',
  ],
  ['Tab', 'Cycle (between form fields / resizable boundaries)'],
  [
    'Ctrl+W',
    "Keyboard resize-mode on the active zone's splitter (Tab cycles boundaries, arrows resize, Enter/Esc exits)",
  ],
  ['/', 'Open filter within the current zone'],
  [':', 'Open command entry'],
  ['?', 'Open the keybinding-help screen'],
  ['q', "Quit (confirms first if a run is in progress; disable in :settings' General tab)"],
  [':quit', "Quit, regardless of the 'q' shortcut setting"],
  [
    'd / e / u / l / r / s',
    'Switch directly to Dashboard / EDTs / Update / Logs / Routes / shared-types',
  ],
  [
    '← / →',
    'Switch to previous/next zone tab, wrapping at the ends',
  ],
  ['Ctrl+→ / Ctrl+N', 'Create-EDT wizard: next step (only if the current step is valid)'],
  ['Ctrl+← / Ctrl+P', 'Create-EDT wizard: previous step (always allowed, choices kept)'],
  ['Tab (wizard Step 3)', 'Create-EDT wizard, Step 3: switch between the global strategy and the per-service table'],
  [
    'Enter (wizard Step 3)',
    'Create-EDT wizard, Step 3: edit the focused global line / configure the focused service row (never advances)',
  ],
  ['Ctrl+R', 'Create-EDT wizard, "Configurer" box: revert the service to the global branch strategy'],
  ['Space / ↑ ↓ (wizard Step 4)', 'Create-EDT wizard, Step 4: choose between switching to the new EDT now and creating it without switching'],
  ['R (wizard Step 4 pause)', 'Create-EDT wizard, Step 4 paused on files at risk: re-run the pre-flight after fixing them by hand'],
  ['E (wizard Step 4 pause)', 'Create-EDT wizard, Step 4 paused on files at risk: open the overwrite confirmation listing every file'],
  ['Esc (wizard Step 4 pause)', 'Create-EDT wizard, Step 4 paused on files at risk: stop — the EDT stays created but not active'],
  ['Ctrl+E (wizard Step 4 overwrite)', 'Create-EDT wizard, overwrite confirmation: discard exactly the listed files and activate (↑/↓ scroll, Enter/Esc go back)'],
  ['Tab (switch resolution)', 'Switch EDT, dirty services: switch between the global strategy and the per-service table'],
  ['Enter (switch resolution)', 'Switch EDT, dirty services: edit the global branch name / configure the focused service row'],
  [
    'Ctrl+N (switch resolution)',
    'Switch EDT, dirty services: confirm (blocked while a row is invalid; any [Écraser] row asks a second confirmation)',
  ],
  ['Ctrl+R (switch resolution)', 'Switch EDT, "Configurer" box: return the service to the global strategy'],
  ['Space / ← → (switch resolution)', 'Switch EDT, global strategy and "Configurer" box: toggle the action between Adopter and Écraser'],
  ['↑ / ↓ (switch discard confirmation)', 'Switch EDT, discard confirmation: scroll the list of files to be destroyed'],
  ['Ctrl+E (switch resolution)', 'Switch EDT, discard confirmation: destroy the listed files and proceed (Enter/Esc go back)'],
  [
    'Esc (switch resolution)',
    'Switch EDT, dirty services: close the open field/box first, otherwise cancel the switch (nothing touched)',
  ],
  ['W (Logs)', 'Logs: toggle line wrap on every open pane (bare w stays on the focused pane)'],
] as const;

describe('KEYBINDINGS (canonical contract, EXPERIENCE.md Interaction Primitives)', () => {
  it('lists exactly the canonical bindings in documented order', () => {
    expect(KEYBINDINGS).toHaveLength(EXPECTED.length);
    expect(KEYBINDINGS.map((entry) => entry.keys)).toEqual(
      EXPECTED.map(([keys]) => keys),
    );
  });

  it('carries the canonical description per binding', () => {
    expect(KEYBINDINGS.map((entry) => entry.description)).toEqual(
      EXPECTED.map(([, description]) => description),
    );
  });

  it('has no duplicate keys values — the help screen cannot repeat a row', () => {
    const keysValues = KEYBINDINGS.map((entry) => entry.keys);
    expect(new Set(keysValues).size).toBe(keysValues.length);
  });
});
