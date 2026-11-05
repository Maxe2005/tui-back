import { describe, it, expect } from 'vitest';
import { FOOTER_CONTEXTS, KEYBINDINGS, activeFooterContext } from './index.js';
import { formatHints } from '../shared/components/hints.js';

const describeHints = (hints: Parameters<typeof formatHints>[0]) => (hints.length > 0 ? formatHints(hints) : 'No keys while it runs');
const CONTEXT_ROWS = Object.values(FOOTER_CONTEXTS).map((context) => [context.label, describeHints(context.hints)] as const);

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
  ['Tab / Shift+Tab', 'Cycle focus (between panes, form fields / resizable boundaries); Shift+Tab reverses'],
  [
    'Ctrl+W',
    "Keyboard resize-mode on the active zone's splitter (Tab cycles boundaries, Shift+Tab reverses, arrows resize, Enter/Esc exits)",
  ],
  ['/', 'Logs / Routes: open the filter'],
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
  ['Ctrl+R', 'Per-service box or table (wizard Step 3, switch resolution, Update config): revert the service to the global strategy'],
  ['Space / ↑ ↓ (wizard Step 4)', 'Create-EDT wizard, Step 4: choose between switching to the new EDT now and creating it without switching'],
  ['R (wizard Step 4 pause)', 'Create-EDT wizard, Step 4 paused on files at risk: re-run the pre-flight after fixing them by hand'],
  ['E (wizard Step 4 pause)', 'Create-EDT wizard, Step 4 paused on files at risk: open the overwrite confirmation listing every file'],
  ['Esc (wizard Step 4 pause)', 'Create-EDT wizard, Step 4 paused on files at risk: stop — the EDT stays created but not active'],
  ['Ctrl+E (wizard Step 4 overwrite)', 'Create-EDT wizard, overwrite confirmation: discard exactly the listed files and activate (↑/↓ scroll, Enter/Esc go back)'],
  ['Tab (switch resolution)', 'Switch EDT, dirty services: switch between the global strategy and the per-service table'],
  ['Enter (switch resolution)', 'Switch EDT, dirty services: edit the global branch name / configure the focused service row'],
  [
    'Ctrl+N (switch resolution)',
    'Switch EDT, dirty services: confirm (blocked while a row is invalid; any [Discard] row asks a second confirmation)',
  ],
  ['Space / ← → (switch resolution)', 'Switch EDT, global strategy and "Configure" box: toggle the action between Adopt and Discard'],
  ['↑ / ↓ (switch discard confirmation)', 'Switch EDT, discard confirmation: scroll the list of files to be destroyed'],
  ['Ctrl+E (switch resolution)', 'Switch EDT, discard confirmation: destroy the listed files and proceed (Enter/Esc go back)'],
  [
    'Esc (switch resolution)',
    'Switch EDT, dirty services: close the open field/box first, otherwise cancel the switch (nothing touched)',
  ],
  ['R (Dashboard)', 'Dashboard: refresh every section (also retries a failed section)'],
  ['↑ / ↓ (Dashboard)', "Dashboard: move the cursor over the active EDT's services"],
  ['Enter (Dashboard)', 'Dashboard: open the focused service in the Logs zone'],
  ['a (Dashboard)', "Dashboard: step through the Attention lines, moving the cursor to the line's service"],
  ['A (Dashboard)', 'Dashboard: open the realign dialog over the drifted services (also `:realign`)'],
  ['H (Dashboard)', 'Dashboard: heal — restart services that are not up, after confirmation'],
  ['E (Dashboard)', 'Dashboard: enter the active EDT in the EDTs zone (e opens the EDT quick-pick, or the create wizard when none exists)'],
  ['Ctrl+O (Dashboard)', 'Dashboard: open the focused service repo in your editor'],
  ['Ctrl+R (Dashboard)', 'Dashboard: restart the focused service (R stays refresh)'],
  ['Ctrl+L (Dashboard)', 'Dashboard: clean-restart the focused service through its recipe'],
  ['Ctrl+T (Dashboard)', 'Dashboard: open a terminal in the focused service repo'],
  ['Ctrl+X (Dashboard)', "Dashboard: open a terminal inside the focused service's running container"],
  ['W (Logs)', 'Logs: toggle line wrap on every open pane (bare w stays on the focused pane)'],
  ['i (Logs)', 'Logs: toggle the focused pane between following and ignoring the global filter'],
  ['R (Logs)', "Logs: restart the focused pane's service (mode from settings: logs.restartMode)"],
  ['O (Logs)', "Logs: open the focused pane's service repo in your editor (also for services without a container)"],
  ['a (Logs)', "Logs: open the focused pane's service actions menu (open in IDE, restart, clean restart, terminals), with each unavailable action's reason"],
  ['m / a / p (Update)', 'Update: configure a group update for the EDT members / for every managed repo / for the highlighted service'],
  ['f (Update)', 'Update: open the full-screen report of the highlighted service (Enter on a failed recap row too)'],
  ['i (Update)', 'Update: reopen the incident queue of the running update (also `:update-incidents`)'],
  ['Enter (Update config)', 'Update config: Enter on the [ Start run ] line starts the run; on a table row it opens the per-service box'],
  ['R (load error)', 'EDTs, Update and Logs: retry a failed list load'],
  ['Ctrl+R (Routes)', 'Routes: fire the request of the open pane'],
  ['Ctrl+T (branch picker)', 'Branch picker: rename the highlighted branch'],
  ['PgUp / PgDn', 'Scroll a dialog taller than the window; page the Update last-run recap and full report'],
  ['P (Shared Types)', 'Shared Types: publish a new version of the shared-types source repo'],
  ['Enter (Shared Types)', 'Shared Types: on the version row, edit the version; from a consumer or option row, propagate it to the checked consuming services; on a choice screen, select the highlighted choice'],
  ['H (Shared Types)', "Shared Types: browse the source repo's published versions and pick one"],
  ['R (Shared Types)', 'Shared Types: reload the source repo and consuming services after a load error; relaunch a failed publish; retry the highlighted failed service in the results'],
] as const;

describe('KEYBINDINGS (canonical contract, EXPERIENCE.md Interaction Primitives)', () => {
  it('lists exactly the canonical bindings in documented order', () => {
    expect(KEYBINDINGS).toHaveLength(EXPECTED.length + CONTEXT_ROWS.length);
    expect(KEYBINDINGS.map((entry) => entry.keys)).toEqual(
      [...EXPECTED, ...CONTEXT_ROWS].map(([keys]) => keys),
    );
  });

  it('carries the canonical description per binding', () => {
    expect(KEYBINDINGS.map((entry) => entry.description)).toEqual(
      [...EXPECTED, ...CONTEXT_ROWS].map(([, description]) => description),
    );
  });

  it('lists every footer context in the help exactly as the footer shows it', () => {
    for (const [label, hints] of CONTEXT_ROWS) {
      expect(KEYBINDINGS.find((entry) => entry.keys === label)?.description).toBe(hints);
    }
  });

  it('has no duplicate keys values — the help screen cannot repeat a row', () => {
    const keysValues = KEYBINDINGS.map((entry) => entry.keys);
    expect(new Set(keysValues).size).toBe(keysValues.length);
  });
});

describe('activeFooterContext', () => {
  it('lets an overlay outrank a zone whichever registered first', () => {
    expect(activeFooterContext([])).toBeUndefined();
    expect(activeFooterContext([{ owner: 'edts', id: 'confirm' }])).toBe('confirm');
    expect(activeFooterContext([{ owner: 'help', id: 'help' }, { owner: 'edts', id: 'confirm' }])).toBe('help');
    expect(activeFooterContext([{ owner: 'edts', id: 'confirm' }, { owner: 'command-bar', id: 'command' }])).toBe('command');
    expect(activeFooterContext([{ owner: 'help', id: 'help' }, { owner: 'command-bar', id: 'command' }])).toBe('command');
  });

  it('keeps the no-key context out of the footer as an empty line and in the help with its reason', () => {
    expect(FOOTER_CONTEXTS.busy.hints).toEqual([]);
    expect(KEYBINDINGS.find((entry) => entry.keys === FOOTER_CONTEXTS.busy.label)?.description).toBe('No keys while it runs');
  });
});
