// tui/zones/edts/dialogs/create-wizard: Step 4 "Activation" — interim (Story 2.36). A read-only
// recap plus a plain confirm running today's submit unchanged; Story 2.38 replaces it with the
// explicit activation / switch choice.
import { Box, Text } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../../../core/edt/list.js';
import { colors } from '../../../../shared/theme/theme.js';
import type { CreateDialogState } from '../../edts-zone.logic.js';

export function ActivationStepView({
  dialog,
  candidates,
  showConfirm = true,
}: {
  dialog: CreateDialogState;
  candidates: readonly ServiceBranchDivergence[];
  // false once a partial-failure create already wrote the EDT — nothing left to confirm.
  showConfirm?: boolean;
}) {
  const serviceName = (path: string) => candidates.find((candidate) => candidate.path === path)?.service ?? path;
  return (
    <Box flexDirection="column">
      <Text color={colors.text}>Nom : {dialog.topic.trim()}</Text>
      <Text color={colors.text}>Services : {dialog.selectedMembers.map(serviceName).join(', ')}</Text>
      {dialog.selectedMembers.map((path) => {
        const name = dialog.namingMode === 'grouped' ? dialog.branchName : (dialog.branchNames[path] ?? '');
        return (
          <Text key={path} color={colors['text-dim']}>
            {'  '}
            {serviceName(path)} : {name} (depuis {dialog.baseBranches[path] ?? ''})
          </Text>
        );
      })}
      {showConfirm ? <Text color={colors.accent}>[Entrée] Créer l'EDT</Text> : null}
    </Box>
  );
}
