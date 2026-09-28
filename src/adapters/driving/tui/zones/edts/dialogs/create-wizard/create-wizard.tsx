// tui/zones/edts/dialogs/create-wizard: Story 2.36 — the create-EDT wizard modal, replacing the
// flat CREATE EDT dialog (Stories 2.9/2.22/2.27) behind the same `edt-create` / zero-EDT entry
// points. A breadcrumb shows where the developer is and what's decided; each step opens with a
// short intro; step navigation is explicit:
//   - Ctrl+→ / Ctrl+N: next step, only if the current step is valid (else its inline error)
//   - Ctrl+← / Ctrl+P: back one step, always, state kept
//   - Tab: moves within the current step only; Enter: advances on Steps 1-2, is Step 3's own
//     edit/configure key (Story 2.37), confirms on Step 4
//   - Esc: closes the innermost open element first (Step 3: a field in edit, the override box,
//     Panel A's edit mode), else cancels with nothing written — or requests quit when no EDT
//     exists yet (nothing to cancel back to)
//
// Step 4 is interim until Story 2.38 (a plain confirm). Story 2.37: Step 3's rows become
// Story 2.35's `memberPlans` on submit. The pure logic lives in wizard.logic.ts.
import { Box, Text, type Key } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../../../core/ports/edt-registry.js';
import type { AppState } from '../../../../store/app-store.js';
import { DimAnnotation } from '../../../../shared/components/dim-annotation.js';
import { FailedResultList } from '../../../../shared/components/failed-result-list.js';
import { ModalDialog } from '../../../../shared/components/modal-dialog.js';
import { colors } from '../../../../shared/theme/theme.js';
import {
  type CandidateListState,
  type CreateDialogState,
  type EdtDialogState,
  stripAssistedActionCodes,
  summarizeFailedResults,
  type WizardStep,
} from '../../edts-zone.logic.js';
import { ActivationStepView } from './step-activation.js';
import { BranchStepView, createBranchStepHandlers } from './step-branches.js';
import { handleNameStepInput, NameStepView } from './step-name.js';
import { handleServicesStepInput, ServicesStepView } from './step-services.js';
import {
  buildBreadcrumb,
  buildMemberPlans,
  buildStep3Rows,
  canAdvance,
  checkNameAvailability,
  enterBranchStep,
  resolveWizardNavKey,
  STEP_INTROS,
  type BreadcrumbTone,
} from './wizard.logic.js';

export const CREATE_WIZARD_TITLE = "EDT Wizard: Création d'un espace de travail";

export type CreateWizardDeps = {
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
  // Story 2.37: Step 3's per-service branch lists (local + remote-tracking, never fetched).
  listCreateBranches: AppState['listCreateBranches'];
};

export function createCreateWizardHandlers(deps: CreateWizardDeps) {
  const branchStep = createBranchStepHandlers({ setDialog: deps.setDialog, candidates: deps.candidates, cancel });

  // Moved unchanged from the retired create-dialog.tsx (Story 2.36 Always boundary: same
  // createEdt params, logging and FailedResultList as before — Story 2.38 fixes the activation
  // and action-log target).
  async function submitCreate(current: CreateDialogState) {
    if (current.submitting) {
      return;
    }
    // Review patch (story 2.9): reject an empty topic inline rather than letting it reach
    // createEdt, whose `missing-argument` error is a raw CLI usage string.
    if (current.topic.trim() === '') {
      deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, error: 'Topic must not be empty' } : prev));
      return;
    }
    // Story 2.37: Step 3's rows become Story 2.35's memberPlans, one per member. confirmStep4
    // already re-ran canAdvance(3), so a null here is only a defensive guard.
    const memberPlans = buildMemberPlans(buildStep3Rows(current, deps.candidates));
    if (memberPlans === null) {
      const check = canAdvance(3, current, deps.edtsRows, deps.candidates);
      const error = check.ok ? 'Étape 3 invalide' : check.error;
      deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, error } : prev));
      return;
    }
    deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, submitting: true, error: null, failedRows: [] } : prev));
    const result = await deps.createEdtAction({ topic: current.topic, members: [...current.selectedMembers], memberPlans });
    if (result.ok) {
      // Awaited (not fire-and-forget) so `edtsRows` reflects the newly-created EDT before this
      // function returns — Escape's cancel-vs-quit choice depends on it.
      await deps.loadEdts();
      void deps.loadEdtsBranches();
      // Story 2.25: structured per-repo rows (FailedResultList); create never wires a retry.
      const failedRows = stripAssistedActionCodes(summarizeFailedResults(result.data.results));
      if (failedRows.length > 0) {
        deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, submitting: false, failedRows } : prev));
        if (deps.focusedEdt) {
          await deps.logEdtAction(deps.focusedEdt.ulid, 'create', 'failed', failedRows.map((row) => row.message).join('; '));
        }
        return;
      }
      deps.setDialog({ kind: 'none' });
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
      if (deps.focusedEdt) {
        await deps.logEdtAction(deps.focusedEdt.ulid, 'create', 'failed', result.error.message);
      }
    }
  }

  // Moving to any step clears the previous step's error/failure rows and closes Step 3's box;
  // entering Step 3 re-seeds it (untouched name tracks the slug, unloaded/failed lists are
  // queued as `pending` — the zone's effect then runs loadPendingBranchLists).
  function enterStep(state: CreateDialogState, target: WizardStep): CreateDialogState {
    const base: CreateDialogState = {
      ...state,
      step: target,
      error: null,
      failedRows: [],
      branches: { ...state.branches, box: null, editing: false },
    };
    if (target === 1) {
      return { ...base, formFocus: 'topic' };
    }
    if (target === 2) {
      return { ...base, formFocus: 'members' };
    }
    if (target === 3) {
      return { ...base, branches: enterBranchStep(base.branches, base.topic, base.selectedMembers) };
    }
    return base;
  }

  // Story 2.37: loads each queued (`pending`) service's lists once. Flipped to `loading` first
  // so the zone's effect never queues the same path twice; a result is applied only while that
  // path is still `loading` in a create dialog (a closed/reopened wizard drops it).
  function loadPendingBranchLists(paths: readonly string[]) {
    if (paths.length === 0) {
      return;
    }
    deps.setDialog((prev) => {
      if (prev.kind !== 'create') {
        return prev;
      }
      const lists = { ...prev.branches.lists };
      for (const path of paths) {
        const entry = lists[path];
        if (entry !== undefined && entry.status === 'pending') {
          lists[path] = { ...entry, status: 'loading' };
        }
      }
      return { ...prev, branches: { ...prev.branches, lists } };
    });
    for (const path of paths) {
      void deps.listCreateBranches(path).then((result) => {
        deps.setDialog((prev) => {
          if (prev.kind !== 'create' || prev.branches.lists[path]?.status !== 'loading') {
            return prev;
          }
          const loaded = result.ok
            ? { status: 'ready' as const, local: result.data.local, remote: result.data.remote }
            : { status: 'error' as const, local: [], remote: [], error: result.error.message };
          return { ...prev, branches: { ...prev.branches, lists: { ...prev.branches.lists, [path]: loaded } } };
        });
      });
    }
  }

  // Validated inside the updater, against `prev` — never the keypress-time closure — so edits
  // and a step key arriving in the same input chunk can't validate one state and advance another.
  function goNext() {
    deps.setDialog((prev) => {
      if (prev.kind !== 'create' || prev.step === 4) {
        return prev;
      }
      const check = canAdvance(prev.step, prev, deps.edtsRows, deps.candidates);
      return check.ok ? enterStep(prev, (prev.step + 1) as WizardStep) : { ...prev, error: check.error };
    });
  }

  // Step 4's confirm re-checks Steps 1-3 first (e.g. the name became taken by an EDT created
  // from the CLI meanwhile), surfacing the wizard's own message rather than the core's.
  function confirmStep4(current: CreateDialogState) {
    for (const step of [1, 2, 3] as const) {
      const check = canAdvance(step, current, deps.edtsRows, deps.candidates);
      if (!check.ok) {
        const error = check.error;
        deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, error } : prev));
        return;
      }
    }
    void submitCreate(current);
  }

  function close() {
    deps.setDialog({ kind: 'none' });
    deps.setCurrentEdtAction(null);
  }

  function goBack() {
    deps.setDialog((prev) => (prev.kind === 'create' && prev.step > 1 ? enterStep(prev, (prev.step - 1) as WizardStep) : prev));
  }

  // Review patch (story 2.9): with an EDT list to go back to, Escape cancels; with none (the
  // forced zero-EDT prompt) it requests a quit instead of leaving no way out short of Ctrl+C.
  function cancel() {
    if (deps.edtsRows.length > 0) {
      close();
      return;
    }
    deps.requestQuit();
  }

  function handleCreateInput(current: CreateDialogState, input: string, key: Key) {
    // Every key is inert while a submit is in flight (never tear down or re-enter it).
    if (current.submitting) {
      return;
    }
    // A partial-failure create already wrote the EDT: the per-repo failure rows stay on screen
    // until acknowledged (Enter or Esc closes), and nothing can re-submit or navigate away.
    if (isCreatedWithFailures(current)) {
      if (key.return || key.escape) {
        close();
      }
      return;
    }
    const nav = resolveWizardNavKey(input, key);
    if (nav === 'next') {
      goNext();
      return;
    }
    if (nav === 'back') {
      goBack();
      return;
    }
    // Story 2.37: Step 3 owns every other key — Enter edits/configures (never advances), Esc
    // closes its innermost element first and only then cancels the wizard.
    if (current.step === 3) {
      branchStep.handleBranchStepInput(current, input, key);
      return;
    }
    if (key.escape) {
      cancel();
      return;
    }
    if (key.return) {
      if (current.step === 4) {
        confirmStep4(current);
      } else {
        goNext();
      }
      return;
    }
    if (current.step === 1) {
      handleNameStepInput(deps.setDialog, input, key);
      return;
    }
    if (current.step === 2) {
      handleServicesStepInput(deps.setDialog, deps.candidates, current, input, key);
    }
  }

  return { handleCreateInput, loadPendingBranchLists };
}

// failedRows are only ever set by submitCreate after an ok:true (partial-failure) create.
export function isCreatedWithFailures(dialog: CreateDialogState): boolean {
  return dialog.step === 4 && dialog.failedRows.length > 0;
}

const BREADCRUMB_COLORS: Readonly<Record<BreadcrumbTone, string>> = {
  current: colors.accent,
  done: colors.text,
  pending: colors.text,
  unreachable: colors['text-dim'],
};

export function CreateWizardView({
  dialog,
  candidates,
  candidateState,
  edtsRows,
  maxRows,
  maxVisibleRows,
}: {
  dialog: CreateDialogState;
  candidates: readonly ServiceBranchDivergence[];
  candidateState: CandidateListState;
  edtsRows: readonly EdtRegistryEntry[];
  maxRows: number;
  // Story 2.37: Step 3's Panel B table height budget (NFR-7).
  maxVisibleRows: number;
}) {
  const breadcrumb = buildBreadcrumb(dialog, edtsRows, candidates);
  const cancelHint = edtsRows.length > 0 ? '[Esc] Annuler' : '[Esc] Quitter';
  const createdWithFailures = isCreatedWithFailures(dialog);
  return (
    <ModalDialog title={CREATE_WIZARD_TITLE} onConfirm={() => {}} onCancel={() => {}} open={true}>
      <Box flexDirection="column">
        <Box flexWrap="wrap">
          {breadcrumb.map((item, index) => (
            <Text key={item.step} color={BREADCRUMB_COLORS[item.tone]} bold={item.tone === 'current'} dimColor={item.tone === 'unreachable'}>
              {index > 0 ? ' ── ' : ''}[{item.text}]
            </Text>
          ))}
        </Box>
        <Text color={colors['text-dim']}>{STEP_INTROS[dialog.step]}</Text>
        {dialog.step === 1 ? <NameStepView dialog={dialog} availability={checkNameAvailability(dialog.topic, edtsRows)} /> : null}
        {dialog.step === 2 ? <ServicesStepView dialog={dialog} candidates={candidates} candidateState={candidateState} /> : null}
        {dialog.step === 3 ? <BranchStepView dialog={dialog} candidates={candidates} maxRows={maxRows} maxVisibleRows={maxVisibleRows} /> : null}
        {dialog.step === 4 ? <ActivationStepView dialog={dialog} candidates={candidates} showConfirm={!createdWithFailures} /> : null}
        {dialog.failedRows.length > 0 ? <FailedResultList rows={dialog.failedRows} /> : dialog.error ? <DimAnnotation text={dialog.error} /> : null}
        {dialog.submitting ? <DimAnnotation text="Création…" /> : null}
        {createdWithFailures ? (
          <Text color={colors['text-dim']}>EDT créé, avec des échecs par service ci-dessus • [Entrée/Esc] Fermer</Text>
        ) : (
          <Text color={colors['text-dim']}>
            [Ctrl+→/Ctrl+N] Étape suivante • [Ctrl+←/Ctrl+P] Étape précédente • {cancelHint}
          </Text>
        )}
      </Box>
    </ModalDialog>
  );
}
