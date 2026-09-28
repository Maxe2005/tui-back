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
    'Keyboard resize-mode on the active splitter (arrows resize, Enter/Esc exits)',
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
  ['Tab (switch resolution)', 'Switch EDT, dirty services: switch between the global strategy and the per-service table'],
  ['Enter (switch resolution)', 'Switch EDT, dirty services: edit the global branch name / configure the focused service row'],
  [
    'Ctrl+N (switch resolution)',
    'Switch EDT, dirty services: confirm (blocked while a row is invalid; any [Écraser] row asks a second confirmation)',
  ],
  ['Ctrl+R (switch resolution)', 'Switch EDT, "Configurer" box: return the service to the global strategy'],
  ['Ctrl+E (switch resolution)', 'Switch EDT, discard confirmation: destroy the listed files and proceed (Enter/Esc go back)'],
  [
    'Esc (switch resolution)',
    'Switch EDT, dirty services: close the open field/box first, otherwise cancel the switch (nothing touched)',
  ],
] as const;

describe('KEYBINDINGS (canonical contract, EXPERIENCE.md Interaction Primitives)', () => {
  it('lists exactly the 25 canonical bindings in documented order (AC2, story 2.12; wizard keys, stories 2.36/2.37; switch resolution keys, story 2.41)', () => {
    expect(KEYBINDINGS).toHaveLength(EXPECTED.length);
    expect(KEYBINDINGS.map((entry) => entry.keys)).toEqual(
      EXPECTED.map(([keys]) => keys),
    );
  });

  it('carries the canonical description per binding (AC2)', () => {
    expect(KEYBINDINGS.map((entry) => entry.description)).toEqual(
      EXPECTED.map(([, description]) => description),
    );
  });

  it('has no duplicate keys values — the help screen cannot repeat a row', () => {
    const keysValues = KEYBINDINGS.map((entry) => entry.keys);
    expect(new Set(keysValues).size).toBe(keysValues.length);
  });
});
