// tui/zones/logs: the `a` actions menu of a Logs pane — the shared service-action registry's
// entries for that pane's service, rendered as a MenuList with each disabled row's reason.
// Purely presentational: the rows come from the registry (no availability rule here) and every
// keystroke is routed by LogsZone's useInput through resolveMenuKey.
import { Box, Text } from 'ink';
import type { ServiceAction } from '../../../../../core/service-actions/index.js';
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

// One row per registry entry, in registry order: an available row notes its key, a disabled
// one notes its reason instead and Enter never chooses it.
export function toMenuItems(actions: readonly ServiceAction[]): MenuItem[] {
  return actions.map((action) =>
    action.availability.available
      ? { value: action.id, label: action.label, note: action.key }
      : { value: action.id, label: action.label, note: action.availability.reason, disabled: true },
  );
}

export function LogsActionsMenu({ menu }: { menu: LogsActionsMenuState }) {
  return (
    <ModalDialog title={LOGS_ACTIONS_MENU_TITLE} open>
      <Box flexDirection="column">
        <Text color={colors.text} wrap="truncate-end">{menu.service}</Text>
        {menu.error !== null ? (
          <Text color={colors.error} wrap="truncate-end">{menu.error.split('\n')[0] ?? menu.error}</Text>
        ) : menu.actions === null ? (
          <StateLine kind="loading" subject="actions" />
        ) : (
          <MenuList items={toMenuItems(menu.actions)} cursor={menu.cursor} />
        )}
      </Box>
    </ModalDialog>
  );
}
