// tui/keybindings: the footer's context declarations. A dialog, modal, pane or screen that owns
// the keyboard registers one of these ids while it is open; the footer then shows exactly that
// context's hints (and the `?` help lists the same rows), and falls back to the zone hints when
// the last one closes. Hints are data so the footer, the help and the tests read one list.
import type { Hint } from '../shared/components/hints.js';
import { KEY_UP_DOWN } from '../shared/components/hints.js';

const MOVE: Hint = [KEY_UP_DOWN, 'move'];
const CONFIRM: Hint = ['Enter', 'confirm'];
const CANCEL: Hint = ['Esc', 'cancel'];
const BACK: Hint = ['Esc', 'back'];
const CLOSE: Hint = ['Esc', 'close'];
const TAB_SWITCH: Hint = ['←/→', 'tab'];
const WIZARD_NEXT: Hint = ['Ctrl+→/Ctrl+N', 'next step'];
const WIZARD_PREVIOUS: Hint = ['Ctrl+←/Ctrl+P', 'previous step'];

// Keys shared by both Routes right-pane tabs.
const ROUTES_PANE_KEYS: readonly Hint[] = [
  ['Ctrl+R', 'fire'],
  ['Ctrl+←/→', 'tab'],
];
const ROUTES_RULES_PANEL: readonly Hint[] = [
  ['Esc/f', 'close'],
  [KEY_UP_DOWN, 'select'],
  ['Space', 'remove'],
  ['1-9', 'remove'],
  ['n', 'nulls'],
  ['c', 'clear'],
];
const ROUTES_BODY_TREE: readonly Hint[] = [
  ['Esc', 'list'],
  ['Tab', 'section'],
  ['Enter', 'edit'],
];

export type FooterContextDeclaration = { label: string; hints: readonly Hint[] };

export const FOOTER_CONTEXTS = {
  confirm: { label: 'Confirm dialog', hints: [CONFIRM, CANCEL] },
  'force-confirm': { label: 'Forced action', hints: [['Enter', 'force switch anyway'], CANCEL] },
  close: { label: 'Result dialog', hints: [['Enter/Esc', 'close']] },
  dismiss: { label: 'Read-only dialog', hints: [CLOSE] },
  'issues-list': { label: 'Service listing issues', hints: [[KEY_UP_DOWN, 'browse issues'], CLOSE] },
  // An action is running and the dialog ignores every key until it lands.
  busy: { label: 'Action in progress', hints: [] },
  menu: { label: 'Menu or pick list', hints: [MOVE, ['Enter', 'select'], CANCEL] },
  checklist: { label: 'Checklist dialog', hints: [MOVE, ['Space', 'toggle'], CONFIRM, CANCEL] },
  'branch-input': {
    label: 'Suggestion field',
    hints: [[KEY_UP_DOWN, 'suggestions'], ['Enter', 'fill in / confirm'], CANCEL],
  },
  'modify-topic': { label: 'Modify EDT, topic', hints: [['Tab', 'focus'], ['Enter', 'save'], CANCEL] },
  'modify-members': {
    label: 'Modify EDT, members',
    hints: [MOVE, ['Space', 'toggle'], ['Tab', 'focus'], ['Enter', 'edit branch / save'], CANCEL],
  },
  wizard: { label: 'Create-EDT wizard', hints: [WIZARD_NEXT, WIZARD_PREVIOUS, CANCEL] },
  'wizard-first': { label: 'Create-EDT wizard (first EDT)', hints: [WIZARD_NEXT, WIZARD_PREVIOUS, ['Esc', 'quit']] },
  'wizard-branches': {
    label: 'Create-EDT wizard, branches',
    hints: [['Tab', 'switch pane'], ['Enter', 'configure row'], WIZARD_NEXT, WIZARD_PREVIOUS, CANCEL],
  },
  'wizard-branches-first': {
    label: 'Create-EDT wizard, branches (first EDT)',
    hints: [['Tab', 'switch pane'], ['Enter', 'configure row'], WIZARD_NEXT, WIZARD_PREVIOUS, ['Esc', 'quit']],
  },
  'wizard-activation': {
    label: 'Create-EDT wizard, activation',
    hints: [['Space/↑/↓', 'choose'], ['Enter', 'create the EDT'], WIZARD_PREVIOUS, CANCEL],
  },
  'wizard-activation-first': {
    label: 'Create-EDT wizard, activation (first EDT)',
    hints: [['Enter', 'create and activate the EDT'], WIZARD_PREVIOUS, ['Esc', 'quit']],
  },
  'wizard-pause': {
    label: 'Create-EDT wizard, files at risk',
    hints: [['R', 'retry'], ['E', 'overwrite'], ['Esc', 'stop (the EDT stays created but inactive)']],
  },
  'overwrite-confirm': {
    label: 'Overwrite confirmation',
    hints: [[KEY_UP_DOWN, 'scroll'], ['Ctrl+E', 'overwrite for good'], ['Enter/Esc', 'back']],
  },
  'override-box': {
    label: 'Create-EDT wizard, service box',
    hints: [['↑/↓/Tab', 'move'], ['Enter', 'edit / apply'], ['Space/←/→', 'mode'], ['Ctrl+R', 'back to global strategy'], CLOSE],
  },
  'switch-resolution': {
    label: 'Switch EDT, dirty services',
    hints: [['Tab', 'switch pane'], ['Enter', 'configure row'], ['Ctrl+N', 'confirm'], ['Esc', 'cancel switch']],
  },
  'switch-box': {
    label: 'Switch EDT, service box',
    hints: [['↑/↓/Tab', 'move'], ['Space/←/→', 'action'], ['Enter', 'edit / apply'], ['Ctrl+R', 'back to global strategy'], CLOSE],
  },
  'update-config-global': {
    label: 'Update config, global settings',
    hints: [['Tab', 'table'], MOVE, ['Space', 'change'], ['Enter', 'edit EDT / run on Start run'], CANCEL],
  },
  'update-config-table': {
    label: 'Update config, services table',
    hints: [['Tab', 'settings'], MOVE, ['Space', 'select'], ['Enter', 'configure'], ['Ctrl+R', 'back to global'], CANCEL],
  },
  'update-box': {
    label: 'Update config, service box',
    hints: [['↑/↓/Tab', 'move'], ['Enter', 'edit / apply'], ['Space/←/→', 'change'], ['Ctrl+R', 'back to global'], CLOSE],
  },
  'branch-picker-pick': {
    label: 'Branch picker, pick existing',
    hints: [['Tab', 'switch mode'], [KEY_UP_DOWN, 'move'], ['Enter', 'fill in / set branch'], ['Ctrl+T', 'rename this branch'], CANCEL],
  },
  'branch-picker-base': {
    label: 'Branch picker, base branch',
    hints: [['Tab', 'switch mode'], [KEY_UP_DOWN, 'move'], ['Enter', 'fill in / next field'], CANCEL],
  },
  'branch-picker-name': {
    label: 'Branch picker, new name',
    hints: [['Tab', 'switch mode'], ['Enter', 'create'], CANCEL],
  },
  'branch-picker-name-members': {
    label: 'Branch picker, new name (other members)',
    hints: [['Tab', 'switch mode'], ['↓', "other members' branches"], ['Enter', 'create'], CANCEL],
  },
  'branch-picker-members': {
    label: "Branch picker, other members' branches",
    hints: [MOVE, ['Enter', 'pick'], CLOSE],
  },
  'branch-picker-rename': {
    label: 'Branch picker, rename current',
    hints: [['Tab', 'switch mode'], ['Enter', 'rename'], CANCEL],
  },
  help: { label: 'Keybinding help', hints: [[KEY_UP_DOWN, 'scroll'], ['Esc/?', 'close']] },
  command: { label: 'Command entry', hints: [['Tab', 'complete'], ['Enter', 'run'], ['Esc', 'close']] },
  'logs-filter-edit': {
    label: 'Logs filter editor',
    hints: [['Tab', 'text/regex'], ['Ctrl+←/→', 'level'], [KEY_UP_DOWN, 'history'], ['Enter', 'apply'], CANCEL],
  },
  'logs-filter-history': {
    label: 'Logs filter history',
    hints: [['↑/↓/←/→', 'browse history'], ['Enter', 'recall'], CLOSE],
  },
  'logs-fullscreen-no-container': {
    label: 'Logs fullscreen pane (no container)',
    hints: [
      ['Esc', 'back'],
      [KEY_UP_DOWN, 'scroll'],
      ['c', 'clear'],
      ['t/o/p', 'toggle timestamps/stdout/stderr'],
      ['w', 'wrap/truncate'],
      ['/', 'global filter'],
      ['f', 'pane filter'],
      ['i', 'toggle global engagement'],
    ],
  },
  'logs-fullscreen': {
    label: 'Logs fullscreen pane',
    hints: [
      ['Esc', 'back'],
      [KEY_UP_DOWN, 'scroll'],
      ['c', 'clear'],
      ['t/o/p', 'toggle timestamps/stdout/stderr'],
      ['w', 'wrap/truncate'],
      ['R', 'restart'],
      ['/', 'global filter'],
      ['f', 'pane filter'],
      ['i', 'toggle global engagement'],
    ],
  },
  'routes-filter': { label: 'Routes filter', hints: [['Enter', 'apply'], ['Esc', 'clear']] },
  'routes-list': {
    label: 'Routes list',
    hints: [['Enter', 'request'], ['/ f', 'filter'], ['s', 'saved'], ['Home/End', 'jump']],
  },
  'routes-list-editable': {
    label: 'Routes list (body editable)',
    hints: [['Enter', 'request'], ['/ f', 'filter'], ['s', 'saved'], ['e', 'edit body'], ['Home/End', 'jump']],
  },
  'routes-response-raw': {
    label: 'Routes response (raw)',
    hints: [['Esc', 'request'], [KEY_UP_DOWN, 'scroll'], ...ROUTES_PANE_KEYS],
  },
  'routes-response-empty': {
    label: 'Routes response (no tree)',
    hints: [['Esc', 'request'], ...ROUTES_PANE_KEYS],
  },
  'routes-response-tree': {
    label: 'Routes response tree',
    hints: [
      ['Esc', 'request'],
      [KEY_UP_DOWN, 'move'],
      ['←/→', 'fold'],
      ['h/H', 'filter'],
      ['f', 'rules'],
      ['+/-', 'level'],
      ...ROUTES_PANE_KEYS,
    ],
  },
  'routes-saved': {
    label: 'Routes saved requests',
    hints: [['Enter', 'load'], ['/', 'filter'], ['d', 'delete'], ['r', 'retry'], ['Esc', 'list'], ['Ctrl+←/→', 'tab']],
  },
  'routes-save-name': { label: 'Routes save request', hints: [['Enter', 'save'], CANCEL] },
  'routes-save-duplicate': {
    label: 'Routes save request (name taken)',
    hints: [['Enter', 'retry'], ['Ctrl+O', 'overwrite'], CANCEL],
  },
  'routes-rules-panel': { label: 'Routes filter rules', hints: ROUTES_RULES_PANEL },
  'routes-body-raw': { label: 'Routes raw body editor', hints: [['Esc', 'done'], ['Enter', 'newline']] },
  'routes-body-tree': {
    label: 'Routes body editor',
    hints: [
      ...ROUTES_BODY_TREE,
      ['d', 'delete'],
      ['t', 'type'],
      ['r', 'raw'],
      ['←/→', 'fold'],
      ['h/H', 'filter'],
      ...ROUTES_PANE_KEYS,
    ],
  },
  'routes-body-tree-add': {
    label: 'Routes body editor (add target)',
    hints: [
      ...ROUTES_BODY_TREE,
      ['a', 'add'],
      ['d', 'delete'],
      ['t', 'type'],
      ['r', 'raw'],
      ['←/→', 'fold'],
      ['h/H', 'filter'],
      ...ROUTES_PANE_KEYS,
    ],
  },
  'routes-section': {
    label: 'Routes request section',
    hints: [['Esc', 'list'], ['Tab', 'section'], ['s', 'save'], ...ROUTES_PANE_KEYS],
  },
  'routes-rows-readonly': {
    label: 'Routes request rows',
    hints: [['Esc', 'list'], ['Tab', 'section'], [KEY_UP_DOWN, 'move'], ['Enter', 'edit'], ['s', 'save'], ...ROUTES_PANE_KEYS],
  },
  'routes-rows': {
    label: 'Routes request rows (editable)',
    hints: [
      ['Esc', 'list'],
      ['Tab', 'section'],
      [KEY_UP_DOWN, 'move'],
      ['Enter', 'edit'],
      ['a', 'add'],
      ['d', 'delete'],
      ['s', 'save'],
      ...ROUTES_PANE_KEYS,
    ],
  },
  'routes-rows-empty': {
    label: 'Routes request rows (empty)',
    hints: [['Esc', 'list'], ['Tab', 'section'], ['a', 'add'], ['s', 'save'], ...ROUTES_PANE_KEYS],
  },
  'registry-path': {
    label: 'Repo registry path',
    hints: [['Enter', 'scan'], ['Ctrl+L', 'clean stale entries'], CLOSE],
  },
  'registry-candidates': {
    label: 'Repo registry candidates',
    hints: [MOVE, ['Space', 'toggle'], ['Enter', 'register selection'], CLOSE],
  },
  'registry-stale': {
    label: 'Repo registry stale entries',
    hints: [MOVE, ['Space', 'toggle'], ['Enter', 'remove selection'], CLOSE],
  },
  'reset-select': {
    label: 'Reset categories',
    hints: [MOVE, ['Space', 'toggle'], ['Enter', 'review'], CANCEL],
  },
  'reset-select-empty': {
    label: 'Reset categories (none checked)',
    hints: [MOVE, ['Space', 'toggle'], CANCEL],
  },
  'reset-summary': { label: 'Reset summary', hints: [['Enter', 'continue'], CANCEL] },
  'reset-wait': { label: 'Reset summary (not ready)', hints: [CANCEL] },
  'reset-confirm': { label: 'Reset confirmation', hints: [['Enter', 'delete'], CANCEL] },
  'settings-general': {
    label: 'Settings General tab',
    hints: [MOVE, ['Space', 'toggle'], ['Enter', 'edit'], TAB_SWITCH, CLOSE],
  },
  'settings-palette': {
    label: 'Settings Command Palette tab',
    hints: [[KEY_UP_DOWN, 'adjust'], ['1-9', 'set'], TAB_SWITCH, CLOSE],
  },
  'settings-groups': {
    label: 'Settings group list',
    hints: [MOVE, ['Enter', 'open'], TAB_SWITCH, CLOSE],
  },
  'settings-toggle': {
    label: 'Settings toggle group',
    hints: [MOVE, ['Space', 'toggle'], BACK],
  },
  'settings-adjust': {
    label: 'Settings numeric group',
    hints: [['←/→', 'adjust'], ['1-9', 'set'], BACK],
  },
  'settings-run': {
    label: 'Settings action group',
    hints: [MOVE, ['Enter', 'clear'], BACK],
  },
} as const satisfies Record<string, FooterContextDeclaration>;

export type FooterContextId = keyof typeof FOOTER_CONTEXTS;

// Who may register a footer context. Overlays sit above the zone they cover, so they win over a
// zone that registers or re-registers while one is open.
export type FooterOwner = 'help' | 'command-bar' | 'registry' | 'settings' | 'reset' | 'edts' | 'update' | 'logs' | 'routes';

export const FOOTER_OVERLAY_OWNERS: readonly FooterOwner[] = ['help', 'command-bar', 'registry', 'settings', 'reset'];

export type FooterContextEntry = { owner: FooterOwner; id: FooterContextId };

// The context the footer shows: the last registered overlay, else the last registered zone.
export function activeFooterContext(entries: readonly FooterContextEntry[]): FooterContextId | undefined {
  const overlay = entries.findLast((entry) => FOOTER_OVERLAY_OWNERS.includes(entry.owner));
  return (overlay ?? entries.at(-1))?.id;
}

export function footerContextHints(id: FooterContextId): readonly Hint[] {
  return FOOTER_CONTEXTS[id].hints;
}
