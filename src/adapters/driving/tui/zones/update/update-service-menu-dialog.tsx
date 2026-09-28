import { Box, Text } from 'ink';
import { ListRow } from '../../shared/components/list-row.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import { colors } from '../../shared/theme/theme.js';

export const UPDATE_SERVICE_MENU_TITLE = 'SERVICE ACTIONS';

export const UPDATE_SERVICE_MENU_ITEMS = Object.freeze([
  { value: 'update', label: 'Update this service' },
  { value: 'restart', label: 'Clean restart' },
  { value: 'cancel', label: 'Cancel' },
] as const);

export type UpdateServiceMenuValue = (typeof UPDATE_SERVICE_MENU_ITEMS)[number]['value'];

export type ServiceMenuKey = {
  upArrow?: boolean;
  downArrow?: boolean;
  home?: boolean;
  end?: boolean;
  return?: boolean;
  escape?: boolean;
};

export type ServiceMenuStep = { type: 'move'; cursor: number } | { type: 'choose'; choice: UpdateServiceMenuValue } | { type: 'ignore' };

export function resolveServiceMenuKey(input: string, key: ServiceMenuKey, cursor: number): ServiceMenuStep {
  const length = UPDATE_SERVICE_MENU_ITEMS.length;
  if (key.home === true) {
    return { type: 'move', cursor: 0 };
  }
  if (key.end === true) {
    return { type: 'move', cursor: length - 1 };
  }
  if (key.upArrow === true) {
    return { type: 'move', cursor: Math.max(0, cursor - 1) };
  }
  if (key.downArrow === true) {
    return { type: 'move', cursor: Math.min(length - 1, cursor + 1) };
  }
  if (key.return === true) {
    const item = UPDATE_SERVICE_MENU_ITEMS[cursor];
    if (item === undefined) {
      return { type: 'ignore' };
    }
    return { type: 'choose', choice: item.value };
  }
  if (key.escape === true) {
    return { type: 'choose', choice: 'cancel' };
  }
  return { type: 'ignore' };
}

// The menu choice's store routing — pure so the zone's `useInput` branch stays a thin
// dispatcher (the zone convention: useInput is never driven in tests). `update` opens the
// 3.7 config screen pre-scoped to that single service (both fields pinned — `repoPath`
// disambiguates duplicate service names); `restart` runs the standalone single-service
// use-case for that repo alone; `cancel` (or Esc, which resolves to `cancel`) calls
// nothing.
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

export function UpdateServiceMenuDialog({ service, cursor }: { service: string; cursor: number }) {  return (
    <ModalDialog title={UPDATE_SERVICE_MENU_TITLE} open onConfirm={() => {}} onCancel={() => {}}>
      <Box flexDirection="column">
        <Text color={colors.text}>{service}</Text>
        {UPDATE_SERVICE_MENU_ITEMS.map((item, index) => (
          <ListRow key={item.value} label={item.label} selected={index === cursor} />
        ))}
      </Box>
    </ModalDialog>
  );
}
