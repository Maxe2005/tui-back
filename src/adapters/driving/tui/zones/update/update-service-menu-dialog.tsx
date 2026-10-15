import { Box, Text } from 'ink';
import { MenuList, type MenuItem } from '../../shared/components/menu-list.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import { colors } from '../../shared/theme/theme.js';

export const UPDATE_SERVICE_MENU_TITLE = 'SERVICE ACTIONS';

export type UpdateServiceMenuValue = 'update' | 'restart' | 'cancel';

export type ServiceMenuItem = MenuItem<UpdateServiceMenuValue>;

// Esc answers `cancel`, whether or not the menu lists it.
export const UPDATE_SERVICE_MENU_ESCAPE: UpdateServiceMenuValue = 'cancel';

export const UPDATE_SERVICE_MENU_ITEMS: readonly ServiceMenuItem[] = Object.freeze([
  { value: 'update', label: 'Update this service' },
  { value: 'restart', label: 'Clean restart' },
  { value: 'cancel', label: 'Cancel' },
]);

// The visible rows for one service: the restart row is offered only when a restart exists
// for it — a container-less service without a declared recipe has nothing to run, so the
// menu degrades to update/cancel instead of reporting a failure for a known no-op.
export function visibleServiceMenuItems(restartAvailable: boolean): readonly ServiceMenuItem[] {
  return restartAvailable ? UPDATE_SERVICE_MENU_ITEMS : UPDATE_SERVICE_MENU_ITEMS.filter((item) => item.value !== 'restart');
}

// The menu choice's store routing — pure so the zone's `useInput` branch stays a thin
// dispatcher. `update` opens the pre-run config screen pre-scoped to that single service (both
// fields pinned — `repoPath` disambiguates duplicate service names); `restart` runs the
// standalone single-service use-case for that repo alone; `cancel` (or Esc) calls nothing.
export type ServiceMenuTarget = { service: string; repoPath: string };

export type ServiceMenuAction =
  | { type: 'open-config'; service: string; repoPath: string }
  | { type: 'restart'; repoPath: string }
  | { type: 'dismiss' };

export function resolveServiceMenuChoice(choice: UpdateServiceMenuValue, target: ServiceMenuTarget): ServiceMenuAction {
  if (choice === 'update') {
    return { type: 'open-config', service: target.service, repoPath: target.repoPath };
  }
  if (choice === 'restart') {
    return { type: 'restart', repoPath: target.repoPath };
  }
  return { type: 'dismiss' };
}

export function UpdateServiceMenuDialog({
  service,
  cursor,
  items = UPDATE_SERVICE_MENU_ITEMS,
}: {
  service: string;
  cursor: number;
  items?: readonly ServiceMenuItem[];
}) {
  return (
    <ModalDialog title={UPDATE_SERVICE_MENU_TITLE} open>
      <Box flexDirection="column">
        <Text color={colors.text} wrap="truncate-end">{service}</Text>
        <MenuList items={items} cursor={cursor} />
      </Box>
    </ModalDialog>
  );
}
