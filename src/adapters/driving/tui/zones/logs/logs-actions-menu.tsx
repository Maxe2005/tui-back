// tui/zones/logs: the `a` actions menu of a Logs pane — the shared service-action registry's
// entries for that pane's service, rendered as a MenuList with each disabled row's reason.
// Purely presentational: the rows come from the registry (no availability rule here) and every
// keystroke is routed by LogsZone's useInput through resolveMenuKey.
import { Box, Text } from 'ink';
import type { RestartMode, ServiceAction } from '../../../../../core/service-actions/index.js';
import { OPEN_IN_IDE_ACTION_ID, RESTART_ACTION_IDS } from '../../store/slices/service-action-ids.js';
import { MenuList, type MenuItem } from '../../shared/components/menu-list.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import { StateLine } from '../../shared/components/state-line.js';
import { colors } from '../../shared/theme/theme.js';

export const LOGS_ACTIONS_MENU_TITLE = 'SERVICE ACTIONS';

// What Esc answers — never a registry id (ids are non-empty).
export const LOGS_ACTIONS_MENU_CLOSE = '';

export const LOGS_ACTIONS_MENU_LIST_ERROR = 'The service actions could not be loaded.';

// The open menu: `actions` is null while loading or after a list failure (`error` set).
export type LogsActionsMenuState = {
  repoPath: string;
  service: string;
  cursor: number;
  actions: ServiceAction[] | null;
  error: string | null;
};

// ModalDialog's chrome (double border + padding top/bottom + title + separator = 6 rows) plus
// the service-name line.
export const LOGS_ACTIONS_MENU_CHROME_ROWS = 7;

// The rows the menu renders: its chrome plus one per action, or the one loading/error line.
export function logsActionsMenuRows(menu: LogsActionsMenuState): number {
  const body = menu.error === null && menu.actions !== null ? menu.actions.length : 1;
  return LOGS_ACTIONS_MENU_CHROME_ROWS + body;
}

// The Logs key that runs an entry outside the menu, if any: `O` for Open in IDE, `R` for the
// restart matching `logs.restartMode`. The registry's own keys are the Dashboard's, inert here.
export function logsShortcutFor(actionId: string, restartMode: RestartMode): string | undefined {
  if (actionId === OPEN_IN_IDE_ACTION_ID) {
    return 'O';
  }
  return actionId === RESTART_ACTION_IDS[restartMode] ? 'R' : undefined;
}

// One row per registry entry, in registry order: an available row notes its Logs key (none when
// it has no shortcut here), a disabled one notes its reason instead and Enter never chooses it.
export function toMenuItems(actions: readonly ServiceAction[], restartMode: RestartMode): MenuItem[] {
  return actions.map((action): MenuItem => {
    if (!action.availability.available) {
      return { value: action.id, label: action.label, note: action.availability.reason, disabled: true };
    }
    const key = logsShortcutFor(action.id, restartMode);
    return key === undefined ? { value: action.id, label: action.label } : { value: action.id, label: action.label, note: key };
  });
}

export function LogsActionsMenu({ menu, restartMode }: { menu: LogsActionsMenuState; restartMode: RestartMode }) {
  return (
    <ModalDialog title={LOGS_ACTIONS_MENU_TITLE} open>
      <Box flexDirection="column">
        <Text color={colors.text} wrap="truncate-end">{menu.service}</Text>
        {menu.error !== null ? (
          <Text color={colors.error} wrap="truncate-end">{menu.error.split('\n')[0]}</Text>
        ) : menu.actions === null ? (
          <StateLine kind="loading" subject="actions" />
        ) : (
          <MenuList items={toMenuItems(menu.actions, restartMode)} cursor={menu.cursor} />
        )}
      </Box>
    </ModalDialog>
  );
}
