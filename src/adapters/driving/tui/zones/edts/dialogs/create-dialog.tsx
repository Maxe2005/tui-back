// tui/zones/edts/dialogs: the CREATE EDT dialog — topic input, member checklist, and the
// mandatory branch-setup step (Story 2.22) — extracted from edts-zone.tsx (see that file's
// header for why).
import { Box, Text, type Key } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../../core/ports/edt-registry.js';
import { NO_BRANCH_CREATION, type AppState } from '../../../store/app-store.js';
import { CheckboxListItem } from '../../../shared/components/checkbox-list-item.js';
import { DimAnnotation } from '../../../shared/components/dim-annotation.js';
import { FailedResultList } from '../../../shared/components/failed-result-list.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import { TextInputLine } from '../../../shared/components/text-input-line.js';
import { colors } from '../../../shared/theme/theme.js';
import {
  advanceCreateFormFocus,
  buildCreateBranchOptions,
  type CandidateListState,
  type CreateDialogState,
  type EdtDialogState,
  isBranchStepFocus,
  jumpSelection,
  moveSelection,
  type NamingMode,
  nextTextInputValue,
  prefillBranchNames,
  resolveSelectionDirection,
  resolveSelectionJump,
  stripAssistedActionCodes,
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
    // dialog already does, never reaching createEdtAction unvalidated.
    const branchFieldError = validateCreateBranchFields(current.namingMode, current.selectedMembers, current.branchName, current.branchNames);
    if (branchFieldError !== null) {
      deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, error: branchFieldError } : prev));
      return;
    }
    const branchOptions = buildCreateBranchOptions(
      current.selectedMembers,
      current.baseBranch,
      current.namingMode,
      current.branchName,
      current.branchNames,
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

  function handleCreateBranchStepInput(current: CreateDialogState, input: string, key: Key) {
    if (key.return) {
      void submitCreate(current);
      return;
    }
    if (current.formFocus === 'branch-base') {
      deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, baseBranch: nextTextInputValue(prev.baseBranch, input, key) } : prev));
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
          return { ...prev, namingMode: nextMode, branchName: filled.branchName, branchNames: filled.branchNames, branchNameIndex: 0 };
        });
      }
      return;
    }
    // formFocus === 'branch-name'. Touched only flips true when the developer's own edit
    // actually changes the value (review fix, story 2.22) — a no-op keypress (e.g. an arrow
    // key nextTextInputValue itself ignores) never freezes a field out of future auto-fill.
    if (current.namingMode === 'grouped') {
      const next = nextTextInputValue(current.branchName, input, key);
      if (next === current.branchName) {
        return;
      }
      deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, branchName: next, branchNameTouched: true } : prev));
      return;
    }
    const path = current.selectedMembers[current.branchNameIndex];
    if (path === undefined) {
      return;
    }
    const existing = current.branchNames[path] ?? '';
    const next = nextTextInputValue(existing, input, key);
    if (next === existing) {
      return;
    }
    deps.setDialog((prev) => {
      if (prev.kind !== 'create') {
        return prev;
      }
      return {
        ...prev,
        branchNames: { ...prev.branchNames, [path]: next },
        branchNamesTouched: { ...prev.branchNamesTouched, [path]: true },
      };
    });
  }

  function handleCreateInput(current: CreateDialogState, input: string, key: Key) {
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
        const filled = isBranchStepFocus(focus)
          ? prefillBranchNames(prev.namingMode, prev.topic, prev.selectedMembers, prev.branchName, prev.branchNames, prev.branchNameTouched, prev.branchNamesTouched)
          : { branchName: prev.branchName, branchNames: prev.branchNames };
        return { ...prev, formFocus: focus, branchNameIndex: nameIndex, branchName: filled.branchName, branchNames: filled.branchNames };
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
            // rather than an unvalidated empty one.
            const filled = prefillBranchNames(
              prev.namingMode,
              prev.topic,
              nextSelected,
              prev.branchName,
              prev.branchNames,
              prev.branchNameTouched,
              prev.branchNamesTouched,
            );
            return { ...prev, selectedMembers: nextSelected, branchName: filled.branchName, branchNames: filled.branchNames };
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
    deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, topic: nextTextInputValue(prev.topic, input, key) } : prev));
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
  return (
    <ModalDialog title="CREATE EDT" onConfirm={() => {}} onCancel={() => {}} open={true}>
      <Box flexDirection="column">
        {isBranchStepFocus(dialog.formFocus) ? (
          // Story 2.22: the mandatory branch-setup step — base-branch input + naming-mode
          // toggle + name field(s), gated on >=1 member already selected (Boundaries: "no
          // enable/disable choice"). Plain <Text> field convention (this step predates the
          // merge of Story 2.23's TextInputLine into this file).
          <>
            <Text color={dialog.formFocus === 'branch-base' ? colors.accent : colors.text}>Base branch: {dialog.baseBranch}</Text>
            <Text color={dialog.formFocus === 'branch-mode' ? colors.accent : colors.text}>
              Naming: {dialog.namingMode === 'grouped' ? 'Grouped (same branch for every service)' : 'Individual (one branch per service)'} [Space]{' '}
              toggle
            </Text>
            {dialog.namingMode === 'grouped' ? (
              <Text color={dialog.formFocus === 'branch-name' ? colors.accent : colors.text}>Branch name: {dialog.branchName}</Text>
            ) : (
              dialog.selectedMembers.map((path, index) => {
                const label = candidates.find((candidate) => candidate.path === path)?.service ?? path;
                return (
                  <Text key={path} color={dialog.formFocus === 'branch-name' && index === dialog.branchNameIndex ? colors.accent : colors.text}>
                    {label}: {dialog.branchNames[path] ?? ''}
                  </Text>
                );
              })
            )}
          </>
        ) : (
          <>
            <TextInputLine label="Topic" value={dialog.topic} focused={dialog.formFocus === 'topic'} />
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
