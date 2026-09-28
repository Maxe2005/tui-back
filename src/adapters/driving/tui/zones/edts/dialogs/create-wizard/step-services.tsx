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
  prefillBaseBranches,
  prefillBranchNames,
  resolveSelectionDirection,
  resolveSelectionJump,
  toggleMemberSelection,
} from '../../edts-zone.logic.js';
import { withPrefillCursors } from './wizard.logic.js';

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
    const nextSelected = toggleMemberSelection(prev.selectedMembers, path);
    // The branch fields keep tracking the selection (untouched fields only) exactly as the
    // pre-wizard dialog did, so Step 3 always opens on a sane default.
    const filled = prefillBranchNames(
      prev.namingMode,
      prev.topic,
      nextSelected,
      prev.branchName,
      prev.branchNames,
      prev.branchNameTouched,
      prev.branchNamesTouched,
    );
    const baseFilled = prefillBaseBranches(nextSelected, candidates, prev.baseBranch, prev.baseBranches, prev.baseBranchTouched, prev.baseBranchesTouched);
    return {
      ...prev,
      selectedMembers: nextSelected,
      error: nextSelected.length > 0 ? null : prev.error,
      branchName: filled.branchName,
      branchNames: filled.branchNames,
      baseBranch: baseFilled.baseBranch,
      baseBranches: baseFilled.baseBranches,
      ...withPrefillCursors(prev, filled),
    };
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
    </Box>
  );
}
