// shared/components/failed-result-list: the structured per-repo breakdown of a partial
// failure — one line per failed repo, never a joined string — plus an extensible registry
// mapping a failure `code` to an optional guided resolution action. A new action only needs a
// registry entry, never a change to `FailedResultList` itself.
import { Box, Text } from 'ink';
import { colors } from '../theme/theme.js';

export type FailedResultRow = {
  service: string;
  code?: string;
  message: string;
};

export type AssistedAction = {
  label: string;
};

// The extensible registry: `branch-owned-by-other-edt` (assertAllowedBranch's cross-EDT
// rejection) -> "try a different branch", and `branch-exists` (createBranch/renameBranch) ->
// "try a different name", reopening the picker's field pre-filled with the collided value.
const ASSISTED_ACTIONS: Record<string, AssistedAction> = {
  'branch-owned-by-other-edt': { label: 'try a different branch' },
  'branch-exists': { label: 'try a different name' },
};

export function resolveAssistedAction(code: string | undefined): AssistedAction | null {
  // A plain object-literal lookup would resolve an inherited Object.prototype key (e.g. a
  // future code named "constructor" or "toString") to a truthy non-AssistedAction value —
  // hasOwnProperty guards against that.
  if (code === undefined || !Object.prototype.hasOwnProperty.call(ASSISTED_ACTIONS, code)) {
    return null;
  }
  return ASSISTED_ACTIONS[code] ?? null;
}

export type FailedResultListProps = {
  rows: readonly FailedResultRow[];
};

// One line per failed repo (`service: message`) — an unregistered code renders as a plain
// line. A row whose code resolves to a registered action grows an inline `[Enter] <label>`
// affordance; dispatching it on Enter is the caller's job (edts-zone.tsx's useInput) — this
// component only renders, it never captures input.
export function FailedResultList({ rows }: FailedResultListProps) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {rows.map((row, index) => {
        const action = resolveAssistedAction(row.code);
        return (
          <Text key={`${row.service}-${index}`} color={colors.error}>
            {row.service}: {row.message}
            {action !== null ? `  [Enter] ${action.label}` : ''}
          </Text>
        );
      })}
    </Box>
  );
}
