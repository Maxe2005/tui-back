// tui/zones/edts/dialogs: the CREATE EDT dialog — topic input, member checklist, and the
// mandatory branch-setup step (Story 2.22) — extracted from edts-zone.tsx (see that file's
// header for why).
//
// Story 2.27: the branch-setup step's base-branch field now reuses the shared BranchPicker
// (Pick existing / Create new only — `hasCurrentBranch: false`, no Rename current, since
// nothing exists yet) instead of a raw <Text> field, and its suggestion is manifest-driven
// (each selected member's own sharedBranch, core/edt/list.ts) instead of the hardcoded
// DEFAULT_BASE_BRANCH literal. The branch-*name* field(s) switch to TextInputLine (closing
// the Story 2.23 gap) but stay otherwise unchanged — a plain, cursor-addressable text field,
// no picker.
import { Box, Text, type Key } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../../core/ports/edt-registry.js';
import { NO_BRANCH_CREATION, type AppState } from '../../../store/app-store.js';
import { CheckboxListItem } from '../../../shared/components/checkbox-list-item.js';
import { DimAnnotation } from '../../../shared/components/dim-annotation.js';
import { FailedResultList } from '../../../shared/components/failed-result-list.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import { TextInputLine } from '../../../shared/components/text-input-line.js';
import { BranchPicker, handleBranchPickerKey, type BranchPickerOutcome } from '../../../shared/components/branch-picker.js';
import { colors } from '../../../shared/theme/theme.js';
import {
  advanceCreateFormFocus,
  buildCreateBranchOptions,
  type CandidateListState,
  createPickerSession,
  type CreateDialogState,
  type EdtDialogState,
  isBranchStepFocus,
  jumpSelection,
  moveSelection,
  type NamingMode,
  nextTextInputValue,
  prefillBranchNames,
  prefillBaseBranches,
  resolveBaseBranchMode,
  resolveSelectionDirection,
  resolveSelectionJump,
  stripAssistedActionCodes,
  suggestBaseBranchFor,
  summarizeFailedResults,
  toggleMemberSelection,
  validateBranchEditValue,
  validateCreateBranchFields,
} from '../edts-zone.logic.js';

export type CreateDialogDeps = {
  setDialog: (updater: EdtDialogState | ((prev: EdtDialogState) => EdtDialogState)) => void;
  createEdtAction: AppState['createEdt'];
  loadEdts: AppState['loadEdts'];
  loadEdtsBranches: AppState['loadEdtsBranches'];
  logEdtAction: AppState['logEdtAction'];
  requestQuit: AppState['requestQuit'];
  setCurrentEdtAction: AppState['setCurrentEdtAction'];
  focusedEdt: EdtRegistryEntry | undefined;
  edtsRows: readonly EdtRegistryEntry[];
  candidates: readonly ServiceBranchDivergence[];
};

// Story 2.32: prefillBranchNames overwrites branchName/branchNames for any *untouched* field —
// its own paired cursor(s) must follow along, per the story's own Always boundary ("programmatic
// value overwrites ... reset cursor to value.length"). A touched field is never rewritten by
// prefillBranchNames in the first place, so its cursor stays put here too — this only ever
// resets the cursor of a field whose value prefillBranchNames itself just changed.
function withPrefillCursors(
  prev: CreateDialogState,
  filled: { branchName: string; branchNames: Record<string, string> },
): { branchNameCursor: number; branchNameCursors: Record<string, number> } {
  const branchNameCursor = prev.branchNameTouched ? prev.branchNameCursor : filled.branchName.length;
  // Code review fix: rebuilt from scratch over filled.branchNames' own key set — the same
  // wholesale-replacement convention branchNames itself is assigned with below — rather than
  // spreading prev.branchNameCursors forward, which would let a path's cursor entry outlive
  // that path's own branchNames entry (e.g. a deselected member) and accumulate for the
  // dialog's lifetime.
  const branchNameCursors: Record<string, number> = {};
  for (const path of Object.keys(filled.branchNames)) {
    const value = filled.branchNames[path] ?? '';
    branchNameCursors[path] = prev.branchNamesTouched[path] ? (prev.branchNameCursors[path] ?? value.length) : value.length;
  }
  return { branchNameCursor, branchNameCursors };
}

export function createCreateDialogHandlers(deps: CreateDialogDeps) {
  async function submitCreate(current: CreateDialogState) {
    if (current.submitting) {
      return;
    }
    // Review patch (story 2.9): reject an empty topic inline (mirroring the branch-edit
    // dialog's own inline validation) rather than letting it reach createEdt, whose
    // `missing-argument` error is a raw CLI usage string ("Usage: tui-back edt create
    // --topic <topic> ...") — confusing surfaced verbatim in a keyboard-only TUI form.
    if (current.topic.trim() === '') {
      deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, error: 'Topic must not be empty' } : prev));
      return;
    }
    // Boundary: "submitCreate always builds a real CreateBranchOptions when >=1 member
    // selected ... zero members still pass NO_BRANCH_CREATION." Validated inline via
    // validateBranchEditValue, reused as-is (Boundaries) — blocks confirm and keeps the
    // dialog open, exactly like the topic check above and like modifyEdt's own branch-edit
    // dialog already does, never reaching createEdtAction unvalidated. Story 2.27: also
    // validates every selected member's own base-branch field (baseBranches).
    const branchFieldError = validateCreateBranchFields(
      current.namingMode,
      current.selectedMembers,
      current.branchName,
      current.branchNames,
      current.baseBranches,
    );
    if (branchFieldError !== null) {
      deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, error: branchFieldError } : prev));
      return;
    }
    const branchOptions = buildCreateBranchOptions(
      current.selectedMembers,
      current.namingMode,
      current.branchName,
      current.branchNames,
      current.baseBranches,
      NO_BRANCH_CREATION,
    );
    deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, submitting: true, error: null, failedRows: [] } : prev));
    const result = await deps.createEdtAction({ topic: current.topic, members: [...current.selectedMembers], branchOptions });
    if (result.ok) {
      // Awaited (not fire-and-forget) so `edtsRows` reflects the newly-created EDT before
      // this function returns — the create dialog's Escape handling below depends on it to
      // tell whether there's now something to cancel back to.
      await deps.loadEdts();
      void deps.loadEdtsBranches();
      // Story 2.25: structured per-repo rows (FailedResultList), never the old `; `-joined
      // string — `logEdtAction`'s failure `detail` stays that same joined shape though
      // (Boundaries: "action history formatting is out of scope"). stripAssistedActionCodes:
      // Create never wires a retry action (Never boundary).
      const failedRows = stripAssistedActionCodes(summarizeFailedResults(result.data.results));
      if (failedRows.length > 0) {
        deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, submitting: false, failedRows } : prev));
        // Log failed action
        if (deps.focusedEdt) {
          await deps.logEdtAction(deps.focusedEdt.ulid, 'create', 'failed', failedRows.map((row) => row.message).join('; '));
        }
        return;
      }
      deps.setDialog({ kind: 'none' });
      // Log successful action
      if (deps.focusedEdt) {
        await deps.logEdtAction(
          deps.focusedEdt.ulid,
          'create',
          'success',
          `Created EDT "${current.topic}" with ${current.selectedMembers.length} member(s)`,
        );
      }
    } else {
      deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, submitting: false, error: result.error.message } : prev));
      // Log failed action
      if (deps.focusedEdt) {
        await deps.logEdtAction(deps.focusedEdt.ulid, 'create', 'failed', result.error.message);
      }
    }
  }

  // Story 2.27: opens a fresh base-branch picker session for whichever field is "current" —
  // `selectedMembers[0]` when resolveBaseBranchMode is 'shared' (single repo, or >=2 members
  // whose sharedBranch is unanimous), or `selectedMembers[index]` when forced per-member
  // (diverging sharedBranch). Mirrors Modify's openBranchPickerForModify re-open-on-each-entry
  // convention — every entry into the field gets a fresh session, pre-filled from whatever is
  // already committed (touched) or the manifest suggestion otherwise.
  function openBaseBranchPickerAt(state: CreateDialogState, index: number): CreateDialogState {
    const mode = resolveBaseBranchMode(state.selectedMembers, deps.candidates);
    const path = mode === 'shared' ? state.selectedMembers[0] : state.selectedMembers[index];
    if (path === undefined) {
      // Code review: matches applyBaseBranchOutcome's equivalent guard — without formFocus
      // advancing here too, this edge case (currently unreachable: the step is gated on >=1
      // selected member) would leave the dialog stuck on an unresponsive 'branch-base' focus
      // with a null picker session.
      return { ...state, formFocus: 'branch-mode', branchPicker: null };
    }
    const suggestion =
      mode === 'shared'
        ? state.baseBranch
        : state.baseBranchesTouched[path]
          ? (state.baseBranches[path] ?? '')
          : suggestBaseBranchFor(path, deps.candidates);
    // No sensible nested default for the picker's own "Create new" sub-base field here (this
    // session's confirmed value never triggers a real git write — see applyBaseBranchOutcome's
    // own comment) — left blank, still fully typable.
    const session = createPickerSession(path, { suggestedName: suggestion, defaultBaseBranch: '', hasCurrentBranch: false, currentBranch: '' });
    return {
      ...state,
      baseBranchIndex: index,
      // Story 2.27: opens straight onto the Name field, not the picker's own inner "base for a
      // brand-new base branch" sub-field (createBranchPickerState's own default,
      // baseFocused: true, is meant for the other 3 entry points' real branch-creation flow) —
      // that nested field is unused clutter here, so a single Enter confirms the value.
      branchPicker: { ...session, state: { ...session.state, baseFocused: false } },
    };
  }

  // Story 2.27: applies a confirmed base-branch picker outcome. Unlike Modify/service-actions/
  // add-to-edt, this never performs a git write — 'set'/'create'/'rename' are all collapsed to
  // "the resulting string" (outcome.branch / outcome.branchName / outcome.newName), which
  // becomes the base-branch suggestion `submitCreate` later feeds into
  // `git.createBranch(member, name, base)` per selected member (core/edt/create.ts). Picking a
  // base-branch candidate is never itself a mutation — creating/renaming a real branch as a
  // side effect of merely choosing a base would be a surprising, unrequested write (this
  // dialog's own Never/Always boundaries: "every base-branch suggestion stays fully editable,
  // never forced" — nothing here is ever auto-applied to a repo before the developer's own
  // final Enter-to-submit on the whole form).
  function applyBaseBranchOutcome(current: CreateDialogState, outcome: BranchPickerOutcome) {
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
      // Per-member mode cycles through every selected member's own field before the step is
      // "done" (I/O matrix: "Individual naming, diverging ... each member's base-branch field
      // independently suggests its own sharedBranch") — mirrors branch-name's individual-mode
      // index-advance, just driven by confirm rather than Tab (Tab is the picker's own mode
      // switch while this field is open).
      if (mode === 'per-member') {
        const nextIndex = prev.baseBranchIndex + 1;
        if (nextIndex < prev.selectedMembers.length) {
          return openBaseBranchPickerAt(applied, nextIndex);
        }
      }
      return { ...applied, formFocus: 'branch-mode', branchPicker: null, baseBranchIndex: 0 };
    });
  }

  // Story 2.27: while the base-branch field's own BranchPicker session is open, it owns every
  // keystroke exactly the way Modify's own branchPicker sub-state does (handleModifyDialogInput)
  // — Tab cycles the picker's Pick existing/Create new mode (the shared BranchPicker's own
  // established convention), never the create dialog's outer field-to-field Tab-advance.
  function handleCreateBaseBranchInput(current: CreateDialogState, input: string, key: Key) {
    const session = current.branchPicker;
    if (session === null) {
      return;
    }
    // No "other members' branches" sub-list here — there is no EDT yet to draw one from
    // (Boundaries: this step never offers Rename current either, for the same reason).
    const result = handleBranchPickerKey(session.state, session.branches, [], input, key);
    if (result.type === 'cancel') {
      // Nothing nested left to close (handleBranchPickerKey already special-cases a nested
      // rename/other-members sub-view as an 'update', not 'cancel') — step back to the member
      // checklist, the same convention every other branch-step field's own Escape already
      // uses (see handleCreateInput below).
      deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, formFocus: 'members', branchPicker: null, baseBranchIndex: 0 } : prev));
      return;
    }
    if (result.type === 'submit') {
      applyBaseBranchOutcome(current, result.outcome);
      return;
    }
    deps.setDialog((prev) =>
      prev.kind === 'create' && prev.branchPicker !== null ? { ...prev, branchPicker: { ...prev.branchPicker, state: result.state } } : prev,
    );
  }

  function handleCreateBranchStepInput(current: CreateDialogState, input: string, key: Key) {
    if (key.return) {
      void submitCreate(current);
      return;
    }
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
    // formFocus === 'branch-name'. Touched only flips true when the developer's own edit
    // actually changes the *value* (review fix, story 2.22) — a pure cursor move (Left/Right/
    // Home/End, story 2.32) or a no-op keypress never freezes a field out of future auto-fill.
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
      };
    });
  }

  function handleCreateInput(current: CreateDialogState, input: string, key: Key) {
    // Story 2.27: the base-branch field's own BranchPicker session owns every keystroke while
    // it's the current field — including Tab/Escape, both intercepted here before their own
    // generic handling below (see handleCreateBaseBranchInput's own doc comment).
    if (current.formFocus === 'branch-base') {
      handleCreateBaseBranchInput(current, input, key);
      return;
    }
    if (key.tab) {
      deps.setDialog((prev) => {
        if (prev.kind !== 'create') {
          return prev;
        }
        const hasMembers = prev.selectedMembers.length >= 1;
        const nameFieldCount = prev.namingMode === 'individual' ? prev.selectedMembers.length : 1;
        const { focus, nameIndex } = advanceCreateFormFocus(prev.formFocus, hasMembers, prev.namingMode, prev.branchNameIndex, nameFieldCount);
        // Boundary: fields pre-fill "via suggestBranchNameFromTopic(topic)" the moment the
        // branch-setup step becomes reachable — never forced past this point (prefillBranchNames
        // never touches a field the developer has already touched, even one cleared to '').
        // Story 2.27: prefillBaseBranches mirrors this exactly for the base-branch field(s).
        const filled = isBranchStepFocus(focus)
          ? prefillBranchNames(prev.namingMode, prev.topic, prev.selectedMembers, prev.branchName, prev.branchNames, prev.branchNameTouched, prev.branchNamesTouched)
          : { branchName: prev.branchName, branchNames: prev.branchNames };
        const baseFilled = isBranchStepFocus(focus)
          ? prefillBaseBranches(prev.selectedMembers, deps.candidates, prev.baseBranch, prev.baseBranches, prev.baseBranchTouched, prev.baseBranchesTouched)
          : { baseBranch: prev.baseBranch, baseBranches: prev.baseBranches };
        const next: CreateDialogState = {
          ...prev,
          formFocus: focus,
          branchNameIndex: nameIndex,
          branchName: filled.branchName,
          branchNames: filled.branchNames,
          baseBranch: baseFilled.baseBranch,
          baseBranches: baseFilled.baseBranches,
          ...withPrefillCursors(prev, filled),
        };
        // Opens a fresh base-branch picker session every time this step is (re-)entered.
        return focus === 'branch-base' ? openBaseBranchPickerAt(next, 0) : next;
      });
      return;
    }
    if (key.escape) {
      if (current.submitting) {
        // Guard against tearing down a submit in flight, same as every other dialog's
        // Escape handling.
        return;
      }
      // Story 2.22: Escape from inside the branch-setup step steps back to the member
      // checklist (e.g. to change the selection) rather than tearing down the whole dialog —
      // the same "back", never a dead end, convention Modify's own branch-picker sub-view
      // uses for its own Escape.
      if (isBranchStepFocus(current.formFocus)) {
        deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, formFocus: 'members' } : prev));
        return;
      }
      // Review patch (story 2.9): the create dialog used to treat Escape as unconditionally
      // inert here, reasoning the forced, zero-EDT create prompt "has nothing meaningful to
      // cancel back to" (UX-DR20). That's only true the very first time it opens — once an
      // EDT list actually exists (e.g. this same dialog reopened after a partial-failure
      // create left it on-screen with an inline error, see submitCreate), Escape does have
      // something to cancel back to. When it genuinely doesn't, request a quit instead of
      // leaving the user with no way out short of Ctrl+C (which skips onQuit's lock
      // release in src/bin/tui.ts).
      if (deps.edtsRows.length > 0) {
        deps.setDialog({ kind: 'none' });
        deps.setCurrentEdtAction(null);
        return;
      }
      deps.requestQuit();
      return;
    }
    if (isBranchStepFocus(current.formFocus)) {
      handleCreateBranchStepInput(current, input, key);
      return;
    }
    if (current.formFocus === 'members') {
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, memberCursor: jumpSelection(jump, deps.candidates.length) } : prev));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        deps.setDialog((prev) =>
          prev.kind === 'create' ? { ...prev, memberCursor: moveSelection(prev.memberCursor, direction, deps.candidates.length) } : prev,
        );
        return;
      }
      if (input === ' ') {
        const path = deps.candidates[current.memberCursor]?.path;
        if (path !== undefined) {
          deps.setDialog((prev) => {
            if (prev.kind !== 'create') {
              return prev;
            }
            const nextSelected = toggleMemberSelection(prev.selectedMembers, path);
            // Boundary: the branch-name field(s) pre-fill as soon as >=1 member is selected —
            // fires here (not only on Tab into the step) so a direct Enter-to-submit from the
            // checklist, without ever visiting the step UI, still carries a sane default name
            // rather than an unvalidated empty one. Story 2.27: prefillBaseBranches mirrors
            // this exactly for the base-branch field(s).
            const filled = prefillBranchNames(
              prev.namingMode,
              prev.topic,
              nextSelected,
              prev.branchName,
              prev.branchNames,
              prev.branchNameTouched,
              prev.branchNamesTouched,
            );
            const baseFilled = prefillBaseBranches(
              nextSelected,
              deps.candidates,
              prev.baseBranch,
              prev.baseBranches,
              prev.baseBranchTouched,
              prev.baseBranchesTouched,
            );
            return {
              ...prev,
              selectedMembers: nextSelected,
              branchName: filled.branchName,
              branchNames: filled.branchNames,
              baseBranch: baseFilled.baseBranch,
              baseBranches: baseFilled.baseBranches,
              ...withPrefillCursors(prev, filled),
            };
          });
        }
        return;
      }
      if (key.return) {
        void submitCreate(current);
        return;
      }
      return;
    }
    // formFocus === 'topic'
    if (key.return) {
      void submitCreate(current);
      return;
    }
    deps.setDialog((prev) => {
      if (prev.kind !== 'create') {
        return prev;
      }
      const next = nextTextInputValue({ value: prev.topic, cursor: prev.topicCursor }, input, key);
      return { ...prev, topic: next.value, topicCursor: next.cursor };
    });
  }

  return { handleCreateInput };
}

export function CreateDialogView({
  dialog,
  candidates,
  candidateState,
}: {
  dialog: CreateDialogState;
  candidates: readonly ServiceBranchDivergence[];
  candidateState: CandidateListState;
}) {
  const baseBranchMode = resolveBaseBranchMode(dialog.selectedMembers, candidates);
  const branchPicker = dialog.branchPicker;
  return (
    <ModalDialog title="CREATE EDT" onConfirm={() => {}} onCancel={() => {}} open={true}>
      <Box flexDirection="column">
        {isBranchStepFocus(dialog.formFocus) ? (
          // Story 2.22: the mandatory branch-setup step — gated on >=1 member already selected
          // (Boundaries: "no enable/disable choice"). Story 2.27: base-branch is now the shared
          // BranchPicker (Pick existing / Create new only); branch-name field(s) are
          // TextInputLine.
          <>
            {dialog.formFocus === 'branch-base' && branchPicker !== null ? (
              <Box flexDirection="column">
                <Text color={colors.accent}>
                  Base branch
                  {baseBranchMode === 'per-member'
                    ? ` for ${candidates.find((candidate) => candidate.path === branchPicker.repoPath)?.service ?? branchPicker.repoPath}`
                    : ''}
                  :
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
                  ? // Code review: label each value by service — otherwise a diverging per-member
                    // summary like "main, master" gives no indication which value belongs to
                    // which service, unlike the focused view's "Base branch for svc-a:" header.
                    dialog.selectedMembers
                        .map((path) => `${candidates.find((candidate) => candidate.path === path)?.service ?? path}: ${dialog.baseBranches[path] ?? ''}`)
                        .join(', ')
                  : dialog.baseBranch}
              </Text>
            )}
            <Text color={dialog.formFocus === 'branch-mode' ? colors.accent : colors.text}>
              Naming: {dialog.namingMode === 'grouped' ? 'Grouped (same branch for every service)' : 'Individual (one branch per service)'} [Space]{' '}
              toggle
            </Text>
            {dialog.namingMode === 'grouped' ? (
              <TextInputLine
                label="Branch name"
                value={dialog.branchName}
                cursor={dialog.branchNameCursor}
                focused={dialog.formFocus === 'branch-name'}
              />
            ) : (
              dialog.selectedMembers.map((path, index) => {
                const label = candidates.find((candidate) => candidate.path === path)?.service ?? path;
                const value = dialog.branchNames[path] ?? '';
                return (
                  <TextInputLine
                    key={path}
                    label={label}
                    value={value}
                    cursor={dialog.branchNameCursors[path] ?? value.length}
                    focused={dialog.formFocus === 'branch-name' && index === dialog.branchNameIndex}
                  />
                );
              })
            )}
          </>
        ) : (
          <>
            <TextInputLine label="Topic" value={dialog.topic} cursor={dialog.topicCursor} focused={dialog.formFocus === 'topic'} />
            {candidateState === 'loading' ? <Text color={colors['text-dim']}>Loading services…</Text> : null}
            {candidateState === 'error' ? <Text color={colors.error}>Failed to load services — cannot show candidates.</Text> : null}
            {candidateState === 'empty' ? <Text color={colors['text-dim']}>No registered services available.</Text> : null}
            {candidateState === 'ready'
              ? candidates.map((candidate, index) => (
                  <Box key={candidate.path}>
                    <Text color={colors.accent}>{dialog.formFocus === 'members' && index === dialog.memberCursor ? '›' : ' '}</Text>
                    <CheckboxListItem label={candidate.service} state={dialog.selectedMembers.includes(candidate.path) ? 'checked' : 'unchecked'} />
                  </Box>
                ))
              : null}
          </>
        )}
        {dialog.failedRows.length > 0 ? <FailedResultList rows={dialog.failedRows} /> : dialog.error ? <DimAnnotation text={dialog.error} /> : null}
        {dialog.submitting ? <DimAnnotation text="Creating…" /> : null}
      </Box>
    </ModalDialog>
  );
}
