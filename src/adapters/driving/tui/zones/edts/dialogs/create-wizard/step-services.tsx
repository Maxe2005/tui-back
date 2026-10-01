// tui/zones/edts/dialogs/create-wizard: Step 2 "Services" (Story 2.36) — every registered
// managed repo as a checkbox-list-item (Space toggles, ↑/↓/Home/End move), with the existing
// loading/error/empty candidate states.
import { Box, Text, type Key } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../../../core/edt/list.js';
import { CheckboxListItem } from '../../../../shared/components/checkbox-list-item.js';
import { colors } from '../../../../shared/theme/theme.js';
import {
  type CandidateListState,
  type CreateDialogState,
  type EdtDialogState,
  jumpSelection,
  moveSelection,
  resolveSelectionDirection,
  resolveSelectionJump,
  toggleMemberSelection,
} from '../../edts-zone.logic.js';
import { missingSeedMembers } from './wizard.logic.js';

export function handleServicesStepInput(
  setDialog: (updater: (prev: EdtDialogState) => EdtDialogState) => void,
  candidates: readonly ServiceBranchDivergence[],
  current: CreateDialogState,
  input: string,
  key: Key,
) {
  const jump = resolveSelectionJump(key);
  if (jump !== null) {
    setDialog((prev) => (prev.kind === 'create' ? { ...prev, memberCursor: jumpSelection(jump, candidates.length) } : prev));
    return;
  }
  const direction = resolveSelectionDirection(key);
  if (direction !== null) {
    setDialog((prev) => (prev.kind === 'create' ? { ...prev, memberCursor: moveSelection(prev.memberCursor, direction, candidates.length) } : prev));
    return;
  }
  if (input !== ' ' || key.ctrl || key.meta) {
    return;
  }
  const path = candidates[current.memberCursor]?.path;
  if (path === undefined) {
    return;
  }
  setDialog((prev) => {
    if (prev.kind !== 'create') {
      return prev;
    }
    // Story 2.37: Step 3 seeds itself on entry (enterBranchStep) — nothing to prefill here.
    const nextSelected = toggleMemberSelection(prev.selectedMembers, path);
    return { ...prev, selectedMembers: nextSelected, error: nextSelected.length > 0 ? null : prev.error };
  });
}

export function ServicesStepView({
  dialog,
  candidates,
  candidateState,
}: {
  dialog: CreateDialogState;
  candidates: readonly ServiceBranchDivergence[];
  candidateState: CandidateListState;
}) {
  // Story 2.31: root members no longer in the pool (pruned on entering Step 3).
  const missing = candidateState === 'ready' ? missingSeedMembers(dialog.seedFromEdt, candidates) : [];
  return (
    <Box flexDirection="column">
      {candidateState === 'loading' ? <Text color={colors['text-dim']}>Loading services…</Text> : null}
      {candidateState === 'error' ? <Text color={colors.error}>Failed to load services — cannot show candidates.</Text> : null}
      {candidateState === 'empty' ? <Text color={colors['text-dim']}>No registered services available.</Text> : null}
      {candidateState === 'ready'
        ? candidates.map((candidate, index) => (
            <Box key={candidate.path}>
              <Text color={colors.accent}>{index === dialog.memberCursor ? '›' : ' '}</Text>
              <CheckboxListItem label={candidate.service} state={dialog.selectedMembers.includes(candidate.path) ? 'checked' : 'unchecked'} />
            </Box>
          ))
        : null}
      {missing.length > 0 ? (
        <Text color={colors['text-dim']}>Services de l'EDT source introuvables (ignorés) : {missing.join(', ')}</Text>
      ) : null}
    </Box>
  );
}
