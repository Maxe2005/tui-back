// tui/zones/edts/dialogs/create-wizard: Step 3 "Branches" — interim (Story 2.36). Hosts the
// pre-wizard dialog's mandatory branch-setup fields (Story 2.22) and their base-branch
// BranchPicker (Story 2.27) unchanged, moved here verbatim from the retired create-dialog.tsx;
// Story 2.37 replaces them with the global strategy + per-service table.
//
// The base-branch field reuses the shared BranchPicker (Pick existing / Create new only —
// `hasCurrentBranch: false`, no Rename current, since nothing exists yet) and its suggestion is
// manifest-driven (each selected member's own sharedBranch, core/edt/list.ts). The branch-name
// field(s) are plain TextInputLines.
import { Box, Text, type Key } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../../../core/edt/list.js';
import { TextInputLine } from '../../../../shared/components/text-input-line.js';
import { BranchPicker, handleBranchPickerKey, type BranchPickerOutcome } from '../../../../shared/components/branch-picker.js';
import { colors } from '../../../../shared/theme/theme.js';
import {
  advanceCreateFormFocus,
  createPickerSession,
  type CreateDialogState,
  type EdtDialogState,
  type NamingMode,
  nextTextInputValue,
  prefillBaseBranches,
  prefillBranchNames,
  resolveBaseBranchMode,
  suggestBaseBranchFor,
} from '../../edts-zone.logic.js';
import { withPrefillCursors } from './wizard.logic.js';

export type BranchStepDeps = {
  setDialog: (updater: EdtDialogState | ((prev: EdtDialogState) => EdtDialogState)) => void;
  candidates: readonly ServiceBranchDivergence[];
};

export function createBranchStepHandlers(deps: BranchStepDeps) {
  // Opens a fresh base-branch picker session for whichever field is "current" —
  // `selectedMembers[0]` when resolveBaseBranchMode is 'shared' (single repo, or >=2 members
  // whose sharedBranch is unanimous), or `selectedMembers[index]` when forced per-member
  // (diverging sharedBranch). Every entry into the field gets a fresh session, pre-filled from
  // whatever is already committed (touched) or the manifest suggestion otherwise.
  function openBaseBranchPickerAt(state: CreateDialogState, index: number): CreateDialogState {
    const mode = resolveBaseBranchMode(state.selectedMembers, deps.candidates);
    const path = mode === 'shared' ? state.selectedMembers[0] : state.selectedMembers[index];
    if (path === undefined) {
      return { ...state, formFocus: 'branch-mode', branchPicker: null };
    }
    const suggestion =
      mode === 'shared'
        ? state.baseBranch
        : state.baseBranchesTouched[path]
          ? (state.baseBranches[path] ?? '')
          : suggestBaseBranchFor(path, deps.candidates);
    // No sensible nested default for the picker's own "Create new" sub-base field here (this
    // session's confirmed value never triggers a real git write) — left blank, still typable.
    const session = createPickerSession(path, { suggestedName: suggestion, defaultBaseBranch: '', hasCurrentBranch: false, currentBranch: '' });
    return {
      ...state,
      baseBranchIndex: index,
      // Opens straight onto the Name field, not the picker's own inner "base for a brand-new
      // base branch" sub-field — that nested field is unused clutter here, so a single Enter
      // confirms the value.
      branchPicker: { ...session, state: { ...session.state, baseFocused: false } },
    };
  }

  // Entering Step 3 (forward or back from Step 4): fields pre-fill via
  // suggestBranchNameFromTopic(topic) / the manifest sharedBranch — never forcing a field the
  // developer already touched — and a fresh base-branch picker session opens.
  function enterBranchStep(state: CreateDialogState): CreateDialogState {
    const filled = prefillBranchNames(
      state.namingMode,
      state.topic,
      state.selectedMembers,
      state.branchName,
      state.branchNames,
      state.branchNameTouched,
      state.branchNamesTouched,
    );
    const baseFilled = prefillBaseBranches(
      state.selectedMembers,
      deps.candidates,
      state.baseBranch,
      state.baseBranches,
      state.baseBranchTouched,
      state.baseBranchesTouched,
    );
    const next: CreateDialogState = {
      ...state,
      formFocus: 'branch-base',
      branchNameIndex: 0,
      branchName: filled.branchName,
      branchNames: filled.branchNames,
      baseBranch: baseFilled.baseBranch,
      baseBranches: baseFilled.baseBranches,
      ...withPrefillCursors(state, filled),
    };
    return openBaseBranchPickerAt(next, 0);
  }

  // Applies a confirmed base-branch picker outcome. Never performs a git write — 'set'/'create'/
  // 'rename' all collapse to "the resulting string", which becomes the base branch submitCreate
  // later feeds into `git.createBranch(member, name, base)` per selected member.
  function applyBaseBranchOutcome(outcome: BranchPickerOutcome) {
    const value = outcome.kind === 'set' ? outcome.branch : outcome.kind === 'create' ? outcome.branchName : outcome.newName;
    deps.setDialog((prev) => {
      if (prev.kind !== 'create') {
        return prev;
      }
      const mode = resolveBaseBranchMode(prev.selectedMembers, deps.candidates);
      const path = mode === 'shared' ? prev.selectedMembers[0] : prev.selectedMembers[prev.baseBranchIndex];
      if (path === undefined) {
        return { ...prev, formFocus: 'branch-mode', branchPicker: null };
      }
      const nextBaseBranches =
        mode === 'shared' ? Object.fromEntries(prev.selectedMembers.map((member) => [member, value])) : { ...prev.baseBranches, [path]: value };
      const nextBaseBranchesTouched =
        mode === 'shared'
          ? Object.fromEntries(prev.selectedMembers.map((member) => [member, true]))
          : { ...prev.baseBranchesTouched, [path]: true };
      const applied: CreateDialogState = {
        ...prev,
        baseBranch: mode === 'shared' ? value : prev.baseBranch,
        baseBranchTouched: mode === 'shared' ? true : prev.baseBranchTouched,
        baseBranches: nextBaseBranches,
        baseBranchesTouched: nextBaseBranchesTouched,
      };
      // Per-member mode cycles through every selected member's own field before the field is
      // "done", driven by confirm (Tab is the picker's own mode switch while it is open).
      if (mode === 'per-member') {
        const nextIndex = prev.baseBranchIndex + 1;
        if (nextIndex < prev.selectedMembers.length) {
          return openBaseBranchPickerAt(applied, nextIndex);
        }
      }
      return { ...applied, formFocus: 'branch-mode', branchPicker: null, baseBranchIndex: 0 };
    });
  }

  // While the base-branch picker session is open it owns every keystroke (Tab cycles its own
  // Pick existing/Create new mode) except the wizard's own Ctrl step-navigation keys, which the
  // wizard dispatcher intercepts first.
  function handleBaseBranchInput(current: CreateDialogState, input: string, key: Key) {
    const session = current.branchPicker;
    if (session === null) {
      return;
    }
    const result = handleBranchPickerKey(session.state, session.branches, [], input, key);
    if (result.type === 'cancel') {
      // Story 2.36: Esc closes this innermost sub-field only — the wizard stays on Step 3.
      deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, formFocus: 'branch-mode', branchPicker: null, baseBranchIndex: 0 } : prev));
      return;
    }
    if (result.type === 'submit') {
      applyBaseBranchOutcome(result.outcome);
      return;
    }
    deps.setDialog((prev) =>
      prev.kind === 'create' && prev.branchPicker !== null ? { ...prev, branchPicker: { ...prev.branchPicker, state: result.state } } : prev,
    );
  }

  // Tab cycles Step 3's own fields only: base -> mode -> name field(s) -> base (advanceCreateFormFocus's
  // exit to `topic` is mapped back onto the base-branch field, reopening its picker).
  function cycleBranchFocus() {
    deps.setDialog((prev) => {
      if (prev.kind !== 'create') {
        return prev;
      }
      const nameFieldCount = prev.namingMode === 'individual' ? prev.selectedMembers.length : 1;
      const { focus, nameIndex } = advanceCreateFormFocus(prev.formFocus, true, prev.namingMode, prev.branchNameIndex, nameFieldCount);
      if (focus === 'topic' || focus === 'branch-base') {
        return openBaseBranchPickerAt({ ...prev, formFocus: 'branch-base', branchNameIndex: 0 }, 0);
      }
      return { ...prev, formFocus: focus, branchNameIndex: nameIndex };
    });
  }

  // Space toggles the naming mode; typing edits the focused branch-name field. Touched only
  // flips true when the developer's own edit actually changes the *value* — a pure cursor move
  // never freezes a field out of future auto-fill.
  function handleBranchFieldInput(current: CreateDialogState, input: string, key: Key) {
    if (current.formFocus === 'branch-mode') {
      if (input === ' ') {
        deps.setDialog((prev) => {
          if (prev.kind !== 'create') {
            return prev;
          }
          const nextMode: NamingMode = prev.namingMode === 'grouped' ? 'individual' : 'grouped';
          const filled = prefillBranchNames(
            nextMode,
            prev.topic,
            prev.selectedMembers,
            prev.branchName,
            prev.branchNames,
            prev.branchNameTouched,
            prev.branchNamesTouched,
          );
          return {
            ...prev,
            namingMode: nextMode,
            branchName: filled.branchName,
            branchNames: filled.branchNames,
            branchNameIndex: 0,
            ...withPrefillCursors(prev, filled),
          };
        });
      }
      return;
    }
    if (current.formFocus !== 'branch-name') {
      return;
    }
    if (current.namingMode === 'grouped') {
      const next = nextTextInputValue({ value: current.branchName, cursor: current.branchNameCursor }, input, key);
      if (next.value === current.branchName && next.cursor === current.branchNameCursor) {
        return;
      }
      deps.setDialog((prev) =>
        prev.kind === 'create'
          ? {
              ...prev,
              branchName: next.value,
              branchNameCursor: next.cursor,
              branchNameTouched: next.value !== current.branchName ? true : prev.branchNameTouched,
              // A value change clears a stale "can't leave Step 3" error.
              error: next.value !== current.branchName ? null : prev.error,
            }
          : prev,
      );
      return;
    }
    const path = current.selectedMembers[current.branchNameIndex];
    if (path === undefined) {
      return;
    }
    const existingValue = current.branchNames[path] ?? '';
    const existingCursor = current.branchNameCursors[path] ?? existingValue.length;
    const next = nextTextInputValue({ value: existingValue, cursor: existingCursor }, input, key);
    if (next.value === existingValue && next.cursor === existingCursor) {
      return;
    }
    deps.setDialog((prev) => {
      if (prev.kind !== 'create') {
        return prev;
      }
      return {
        ...prev,
        branchNames: { ...prev.branchNames, [path]: next.value },
        branchNameCursors: { ...prev.branchNameCursors, [path]: next.cursor },
        branchNamesTouched: next.value !== existingValue ? { ...prev.branchNamesTouched, [path]: true } : prev.branchNamesTouched,
        error: next.value !== existingValue ? null : prev.error,
      };
    });
  }

  return { enterBranchStep, handleBaseBranchInput, cycleBranchFocus, handleBranchFieldInput };
}

export function BranchStepView({ dialog, candidates }: { dialog: CreateDialogState; candidates: readonly ServiceBranchDivergence[] }) {
  const baseBranchMode = resolveBaseBranchMode(dialog.selectedMembers, candidates);
  const branchPicker = dialog.branchPicker;
  const serviceName = (path: string) => candidates.find((candidate) => candidate.path === path)?.service ?? path;
  return (
    <Box flexDirection="column">
      {dialog.formFocus === 'branch-base' && branchPicker !== null ? (
        <Box flexDirection="column">
          <Text color={colors.accent}>
            Base branch
            {baseBranchMode === 'per-member' ? ` for ${serviceName(branchPicker.repoPath)}` : ''}:
          </Text>
          <BranchPicker
            state={branchPicker.state}
            branches={branchPicker.branches}
            branchesStatus={branchPicker.branchesStatus}
            otherMemberBranches={[]}
            hideNestedBaseField
          />
        </Box>
      ) : (
        <Text color={dialog.formFocus === 'branch-base' ? colors.accent : colors.text}>
          Base branch:{' '}
          {baseBranchMode === 'per-member'
            ? // Labelled by service — a diverging per-member summary like "main, master" would
              // otherwise give no indication which value belongs to which service.
              dialog.selectedMembers.map((path) => `${serviceName(path)}: ${dialog.baseBranches[path] ?? ''}`).join(', ')
            : dialog.baseBranch}
        </Text>
      )}
      <Text color={dialog.formFocus === 'branch-mode' ? colors.accent : colors.text}>
        Naming: {dialog.namingMode === 'grouped' ? 'Grouped (same branch for every service)' : 'Individual (one branch per service)'} [Space] toggle
      </Text>
      {dialog.namingMode === 'grouped' ? (
        <TextInputLine label="Branch name" value={dialog.branchName} cursor={dialog.branchNameCursor} focused={dialog.formFocus === 'branch-name'} />
      ) : (
        dialog.selectedMembers.map((path, index) => {
          const value = dialog.branchNames[path] ?? '';
          return (
            <TextInputLine
              key={path}
              label={serviceName(path)}
              value={value}
              cursor={dialog.branchNameCursors[path] ?? value.length}
              focused={dialog.formFocus === 'branch-name' && index === dialog.branchNameIndex}
            />
          );
        })
      )}
    </Box>
  );
}
