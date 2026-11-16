import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { ServiceAction } from '../../../../../core/service-actions/index.js';
import { resolveMenuKey } from '../../shared/components/menu-list.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import {
  LOGS_ACTIONS_MENU_CHROME_ROWS,
  LOGS_ACTIONS_MENU_CLOSE,
  LOGS_ACTIONS_MENU_LIST_ERROR,
  LOGS_ACTIONS_MENU_TITLE,
  LogsActionsMenu,
  logsActionsMenuRows,
  toMenuItems,
  type LogsActionsMenuState,
} from './logs-actions-menu.js';

const ACTIONS: ServiceAction[] = [
  { id: 'open-in-ide', label: 'Open in IDE', key: 'Ctrl+O', availability: { available: true } },
  { id: 'restart-simple', label: 'Restart', key: 'Ctrl+R', availability: { available: false, reason: 'no container' } },
  { id: 'restart-clean', label: 'Clean restart', key: 'Ctrl+L', availability: { available: false, reason: 'no container' } },
  { id: 'terminal-service', label: 'Terminal', key: 'Ctrl+T', availability: { available: true } },
  { id: 'terminal-container', label: 'Container terminal', key: 'Ctrl+X', availability: { available: false, reason: 'no container' } },
];

function menu(overrides: Partial<LogsActionsMenuState> = {}): LogsActionsMenuState {
  return { repoPath: '/repos/a', service: 'svc-a', cursor: 0, actions: ACTIONS, error: null, ...overrides };
}

const ALL_AVAILABLE: ServiceAction[] = ACTIONS.map((action) => ({ ...action, availability: { available: true } }));

describe('toMenuItems', () => {
  it('maps every registry entry in order: disabled rows note their reason, never a key', () => {
    expect(toMenuItems(ACTIONS, 'simple')).toEqual([
      { value: 'open-in-ide', label: 'Open in IDE', note: 'O' },
      { value: 'restart-simple', label: 'Restart', note: 'no container', disabled: true },
      { value: 'restart-clean', label: 'Clean restart', note: 'no container', disabled: true },
      { value: 'terminal-service', label: 'Terminal' },
      { value: 'terminal-container', label: 'Container terminal', note: 'no container', disabled: true },
    ]);
  });

  it('notes the Logs keys only: O on Open in IDE, R on the restart matching logs.restartMode', () => {
    expect(toMenuItems(ALL_AVAILABLE, 'simple').map((item) => item.note)).toEqual(['O', 'R', undefined, undefined, undefined]);
    expect(toMenuItems(ALL_AVAILABLE, 'clean').map((item) => item.note)).toEqual(['O', undefined, 'R', undefined, undefined]);
    expect(JSON.stringify(toMenuItems(ALL_AVAILABLE, 'clean'))).not.toContain('Ctrl+');
  });

  it('with the shared reducer: Enter on a disabled row is ignored, on an enabled one chooses it, Esc closes', () => {
    const items = toMenuItems(ACTIONS, 'simple');
    expect(resolveMenuKey({ return: true }, 1, items, LOGS_ACTIONS_MENU_CLOSE)).toEqual({ type: 'ignore' });
    expect(resolveMenuKey({ return: true }, 3, items, LOGS_ACTIONS_MENU_CLOSE)).toEqual({ type: 'choose', choice: 'terminal-service' });
    expect(resolveMenuKey({ escape: true }, 3, items, LOGS_ACTIONS_MENU_CLOSE)).toEqual({ type: 'choose', choice: LOGS_ACTIONS_MENU_CLOSE });
    // Loading / error: no rows, Enter does nothing, Esc still closes.
    expect(resolveMenuKey({ return: true }, 0, [], LOGS_ACTIONS_MENU_CLOSE)).toEqual({ type: 'ignore' });
    expect(resolveMenuKey({ escape: true }, 0, [], LOGS_ACTIONS_MENU_CLOSE)).toEqual({ type: 'choose', choice: LOGS_ACTIONS_MENU_CLOSE });
  });
});

describe('logsActionsMenuRows', () => {
  it('is the dialog chrome plus one row per action, or the one loading/error line', () => {
    expect(logsActionsMenuRows(menu())).toBe(LOGS_ACTIONS_MENU_CHROME_ROWS + 5);
    expect(logsActionsMenuRows(menu({ actions: ACTIONS.slice(0, 2) }))).toBe(LOGS_ACTIONS_MENU_CHROME_ROWS + 2);
    expect(logsActionsMenuRows(menu({ actions: null }))).toBe(LOGS_ACTIONS_MENU_CHROME_ROWS + 1);
    expect(logsActionsMenuRows(menu({ actions: null, error: 'x' }))).toBe(LOGS_ACTIONS_MENU_CHROME_ROWS + 1);
  });
});

describe('LogsActionsMenu', () => {
  it('renders the title, the service and every row with its Logs key or reason', async () => {
    const output = await renderToString(createElement(LogsActionsMenu, { menu: menu(), restartMode: 'simple' }));
    expect(output).toContain(LOGS_ACTIONS_MENU_TITLE);
    expect(output).toContain('svc-a');
    expect(output).toContain('Container terminal');
    expect(output).toContain('no container');
    expect(output).not.toContain('Ctrl+');
  });

  it('renders a loading line while listing', async () => {
    const output = await renderToString(createElement(LogsActionsMenu, { menu: menu({ actions: null }), restartMode: 'simple' }));
    expect(output).toContain('Loading actions');
    expect(output).not.toContain('Open in IDE');
  });

  it('renders one error line when the listing failed', async () => {
    const output = await renderToString(
      createElement(LogsActionsMenu, {
        menu: menu({ actions: null, error: `${LOGS_ACTIONS_MENU_LIST_ERROR}\nsecond line` }),
        restartMode: 'simple',
      }),
    );
    expect(output).toContain(LOGS_ACTIONS_MENU_LIST_ERROR);
    expect(output).not.toContain('second line');
  });
});
