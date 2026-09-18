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
] as const;

describe('KEYBINDINGS (canonical contract, EXPERIENCE.md Interaction Primitives)', () => {
  it('lists exactly the 14 canonical bindings in documented order (AC2, story 2.12)', () => {
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
