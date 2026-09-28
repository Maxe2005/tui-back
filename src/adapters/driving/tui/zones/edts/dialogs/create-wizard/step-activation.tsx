// tui/zones/edts/dialogs/create-wizard: Step 4 "Activation" — interim (Story 2.36). A read-only
// recap plus a plain confirm; Story 2.38 replaces it with the explicit activation / switch
// choice. Story 2.37: the per-service recap is rebuilt from Step 3's row views (buildRowView),
// so it shows exactly the mode/base/target the submit's memberPlans are built from.
import { Box, Text } from 'ink';
import { colors } from '../../../../shared/theme/theme.js';
import type { CreateDialogState } from '../../edts-zone.logic.js';
import { buildStep3Rows, type BranchCandidate, type RowView } from './wizard.logic.js';

// The branch part of a recap line: `base → target`, except a rename (its target already reads
// `-> new`) and an [Existante] row attached under its own name, printed once.
export function recapBranches(row: RowView): string {
  if (row.mode === 'rename') {
    return `${row.base} ${row.target}`;
  }
  if (row.mode === 'existing' && row.base === row.target) {
    return row.base;
  }
  return `${row.base} → ${row.target}`;
}

export function ActivationStepView({
  dialog,
  candidates,
  showConfirm = true,
}: {
  dialog: CreateDialogState;
  candidates: readonly BranchCandidate[];
  // false once a partial-failure create already wrote the EDT — nothing left to confirm.
  showConfirm?: boolean;
}) {
  const rows = buildStep3Rows(dialog, candidates);
  return (
    <Box flexDirection="column">
      <Text color={colors.text}>Nom : {dialog.topic.trim()}</Text>
      <Text color={colors.text}>Services : {rows.map((row) => row.service).join(', ')}</Text>
      {rows.map((row) => (
        <Text key={row.path} color={colors['text-dim']}>
          {'  '}
          {row.service} : {row.modeLabel} {recapBranches(row)}
        </Text>
      ))}
      {showConfirm ? <Text color={colors.accent}>[Entrée] Créer l'EDT</Text> : null}
    </Box>
  );
}
