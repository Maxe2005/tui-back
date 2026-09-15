// shared/components/failed-result-list: story 2.25 — replaces summarizeFailedResults'
// `; `-joined string (edts-zone.tsx) with a structured per-repo breakdown, rendered here at
// all 6 partial-failure call sites (create, switch, modify, remove-from-edt, service-actions
// branch-change, add-to-edt). One line per failed repo, never a joined string (the story's
// whole point), plus a small extensible registry mapping a failure `code` to an optional
// guided resolution action — today exactly one entry: `branch-owned-by-other-edt` (the real
// rejection code `adapters/driven/git/index.ts`'s `assertAllowedBranch` returns when a
// branchName is already registered as a *different* EDT's own branch for that repo — never
// the speculative `branch-already-claimed` name floated earlier in planning) -> "try a
// different branch". A future failure code gaining its own action only needs a new entry in
// this registry — never a change to `FailedResultList` itself (Boundaries).
//
// Follows dim-annotation.tsx's colocated-test precedent (no separate __tests__ directory).
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

// The extensible registry (Boundaries: "Record<string, AssistedAction>, one entry today").
const ASSISTED_ACTIONS: Record<string, AssistedAction> = {
  'branch-owned-by-other-edt': { label: 'try a different branch' },
};

export function resolveAssistedAction(code: string | undefined): AssistedAction | null {
  // Review patch (story 2.25): a plain object-literal lookup would resolve an inherited
  // Object.prototype key (e.g. a hypothetical future code named "constructor" or
  // "toString") to a truthy non-AssistedAction value — hasOwnProperty guards against that.
  if (code === undefined || !Object.prototype.hasOwnProperty.call(ASSISTED_ACTIONS, code)) {
    return null;
  }
  return ASSISTED_ACTIONS[code] ?? null;
}

export type FailedResultListProps = {
  rows: readonly FailedResultRow[];
};

// One line per failed repo (`service: message`) — an unregistered code (including
// `branch-owned-by-other-edt` surfacing inside a Create/Switch result, which the caller never
// wires an action for — see edts-zone.tsx's Never boundary) renders as a plain line, exactly
// like a genuinely unknown code. A row whose code resolves to a registered action grows an
// inline `[Enter] <label>` affordance; dispatching that action on an actual Enter keypress is
// the caller's job (edts-zone.tsx's own useInput dispatcher, mirroring how every other
// keystroke in this codebase is centralized in the zone rather than in a leaf component) —
// this component only ever renders, it never captures input itself.
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
