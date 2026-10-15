import type { ZoneId } from '../zones/zones.js';
import { formatHints, type Hint } from '../shared/components/hints.js';
import { FOOTER_CONTEXTS } from './footer-contexts.js';
import { focusNavKeysLabel } from '../shared/keys/focus-navigation.js';
export type { NavigationKey } from '../shared/keys/navigation-key.js';

// `footer` marks a row the footer advertises too (with `zones` when only those zones show it,
// `when: 'resizable'` when only a zone declaring a splitter boundary does), so the footer and the
// ? help are generated from this one list. Context rows (dialogs, panes, screens) come from
// FOOTER_CONTEXTS and are appended below.
export type Keybinding = {
  keys: string;
  description: string;
  // Rows of the same section are listed under one heading in the `?` help.
  section?: string;
  footer?: { key: string; verb: string; zones?: readonly ZoneId[]; when?: 'resizable' };
};

// The retry key StateLine advertises beside a load error; zones bind R to their reload.
export const CONTEXT_SECTION = 'Keys per dialog, pane and screen';

export const RETRY_HINT: Hint = ['R', 'retry'];

export const KEYBINDINGS: readonly Keybinding[] = [
  {
    keys: '↑ / ↓',
    description: 'Move highlight up/down within a list',
    footer: { key: '↑/↓', verb: 'move' },
  },
  {
    keys: 'Home / End',
    description: 'Jump to top/bottom of the current list',
    footer: { key: 'Home/End', verb: 'top/bottom' },
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
    footer: { key: 'Tab/Shift+Tab', verb: 'focus', zones: ['edts', 'logs'] },
  },
  {
    keys: 'Ctrl+W',
    description:
      'Keyboard resize-mode on the active zone\'s splitter (Tab cycles boundaries, Shift+Tab reverses, arrows resize, Enter/Esc exits)',
    footer: { key: 'Ctrl+W', verb: 'resize', when: 'resizable' },
  },
  {
    keys: '/',
    description: 'Logs / Routes: open the filter',
    footer: { key: '/', verb: 'filter', zones: ['logs', 'routes'] },
  },
  {
    keys: ':',
    description: 'Open command entry',
    footer: { key: ':', verb: 'cmd' },
  },
  {
    keys: '?',
    description: 'Open the keybinding-help screen',
    footer: { key: '?', verb: 'help' },
  },
  {
    keys: 'q',
    description: "Quit (confirms first if a run is in progress; disable in :settings' General tab)",
    footer: { key: 'q', verb: 'quit' },
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
    footer: { key: '←/→', verb: 'zone' },
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
  {
    keys: 'R (Dashboard)',
    description: 'Dashboard: refresh every section (also retries a failed section)',
    footer: { key: 'R', verb: 'refresh', zones: ['dashboard'] },
  },
  {
    keys: '↑ / ↓ (Dashboard)',
    description: 'Dashboard: move the cursor over the active EDT\'s services',
    footer: { key: '↑/↓', verb: 'service', zones: ['dashboard'] },
  },
  {
    keys: 'Enter (Dashboard)',
    description: 'Dashboard: open the focused service in the Logs zone',
    footer: { key: 'Enter', verb: 'open', zones: ['dashboard'] },
  },
  {
    keys: 'a (Dashboard)',
    description: 'Dashboard: step through the Attention lines, moving the cursor to the line\'s service',
    footer: { key: 'a', verb: 'attention', zones: ['dashboard'] },
  },
  {
    keys: 'Ctrl+O (Dashboard)',
    description: 'Dashboard: open the focused service repo in your editor',
    footer: { key: 'Ctrl+O', verb: 'IDE', zones: ['dashboard'] },
  },
  {
    keys: 'Ctrl+R (Dashboard)',
    description: 'Dashboard: restart the focused service (R stays refresh)',
    footer: { key: 'Ctrl+R', verb: 'restart', zones: ['dashboard'] },
  },
  {
    keys: 'Ctrl+L (Dashboard)',
    description: 'Dashboard: clean-restart the focused service through its recipe',
    footer: { key: 'Ctrl+L', verb: 'clean restart', zones: ['dashboard'] },
  },
  // Scoped to the Logs zone's pane grid.
  {
    keys: 'W (Logs)',
    description: 'Logs: toggle line wrap on every open pane (bare w stays on the focused pane)',
    footer: { key: 'W', verb: 'wrap all', zones: ['logs'] },
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
    keys: 'O (Logs)',
    description: 'Logs: open the focused pane\'s service repo in your editor (also for services without a container)',
  },
  {
    keys: 'm / a / p (Update)',
    description: 'Update: configure a group update for the EDT members / for every managed repo / for the highlighted service',
    footer: { key: 'm/a/p', verb: 'configure', zones: ['update'] },
  },
  {
    keys: 'f (Update)',
    description: 'Update: open the full-screen report of the highlighted service (Enter on a failed recap row too)',
    footer: { key: 'f', verb: 'full report', zones: ['update'] },
  },
  {
    keys: 'i (Update)',
    description: 'Update: reopen the incident queue of the running update (also `:update-incidents`)',
    footer: { key: 'i', verb: 'incidents', zones: ['update'] },
  },
  {
    keys: 'Enter (Update config)',
    description: 'Update config: Enter on the [ Start run ] line starts the run; on a table row it opens the per-service box',
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
  {
    keys: 'PgUp / PgDn',
    description: 'Scroll a dialog taller than the window; page the Update last-run recap and full report',
  },
  ...Object.values(FOOTER_CONTEXTS).map((context) => ({
    keys: context.label,
    description: context.hints.length > 0 ? formatHints(context.hints) : 'No keys while it runs',
    section: CONTEXT_SECTION,
  })),
];
