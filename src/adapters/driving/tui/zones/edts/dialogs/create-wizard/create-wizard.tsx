// tui/zones/edts/dialogs/create-wizard: the create-EDT wizard modal (Nom -> Services -> Branches
// -> Activation) behind `edt-create` and the zero-EDT prompt. Ctrl+→/Ctrl+N advances only from a
// valid step, Ctrl+←/Ctrl+P goes back keeping state; Esc closes the innermost element first, else
// cancels with nothing written (or requests quit when no EDT exists yet). Every action-log entry
// goes to the NEW EDT's ulid; pure logic lives in wizard.logic.ts and activation.logic.ts.
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
  initialActivationState,
  stripAssistedActionCodes,
  summarizeFailedResults,
  type WizardStep,
} from '../../edts-zone.logic.js';
import { overwriteFrom, reduceActivationKey } from './activation.logic.js';
import { ActivationStepView } from './step-activation.js';
import { BranchStepView, createBranchStepHandlers } from './step-branches.js';
import { handleNameStepInput, NameStepView } from './step-name.js';
import { handleServicesStepInput, ServicesStepView } from './step-services.js';
import {
  buildBreadcrumb,
  buildMemberPlans,
  buildStep3Rows,
  activationErrorResults,
  canAdvance,
  checkNameAvailability,
  describeCreateForLog,
  enterBranchStep,
  isActivationAcknowledge,
  isStep3Busy,
  pruneToCandidates,
  resolveWizardNavKey,
  STEP_INTROS,
  summarizeActivationResults,
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
  // Step 3's per-service branch lists (local + remote-tracking, never fetched).
  listCreateBranches: AppState['listCreateBranches'];
  // The first EDT's explicit activation (core/edt/activate.ts, via the store).
  activateEdtAction: AppState['activateEdt'];
  // "Switch now" — replaces the wizard with the switch dialog on the new EDT and runs the
  // protected switch at once (the zone resolves the entry from the reloaded store).
  startSwitch: (created: { ulid: string; topic: string }) => void;
};

export function createCreateWizardHandlers(deps: CreateWizardDeps) {
  const branchStep = createBranchStepHandlers({ setDialog: deps.setDialog, candidates: deps.candidates });

  function patchCreate(patch: (prev: CreateDialogState) => Partial<CreateDialogState>) {
    deps.setDialog((prev) => (prev.kind === 'create' ? { ...prev, ...patch(prev) } : prev));
  }

  function patchActivation(patch: Partial<CreateDialogState['activation']>, extra: Partial<CreateDialogState> = {}) {
    patchCreate((prev) => ({ ...extra, activation: { ...prev.activation, ...patch } }));
  }

  // Create, then branch on Step 4's choice. A total create failure has no new EDT, so nothing is
  // logged; every other outcome is logged to the new EDT's ulid.
  async function submitCreate(current: CreateDialogState) {
    if (current.submitting || current.activation.created !== null) {
      return;
    }
    // Reject an empty topic inline rather than letting it reach createEdt, whose
    // `missing-argument` error is a raw CLI usage string.
    if (current.topic.trim() === '') {
      patchCreate(() => ({ error: 'Topic must not be empty' }));
      return;
    }
    // Step 3's rows become memberPlans, one per member. confirmStep4 already re-ran canAdvance(3),
    // so a null here is only a defensive guard.
    const memberPlans = buildMemberPlans(buildStep3Rows(current, deps.candidates));
    if (memberPlans === null) {
      const check = canAdvance(3, current, deps.edtsRows, deps.candidates);
      const error = check.ok ? 'Étape 3 invalide' : check.error;
      patchCreate(() => ({ error }));
      return;
    }
    patchCreate(() => ({ submitting: true, error: null, failedRows: [] }));
    const result = await deps.createEdtAction({ topic: current.topic, members: [...current.selectedMembers], memberPlans });
    if (!result.ok) {
      patchCreate(() => ({ submitting: false, error: result.error.message }));
      return;
    }
    const created = { ulid: result.data.ulid, topic: result.data.topic };
    const memberCount = current.selectedMembers.length;
    // A seeded create names its root EDT in every log detail.
    const rootTopic = current.seedFromEdt?.topic;
    // Awaited (not fire-and-forget) so the store's `edts` holds the new EDT before the switch
    // handoff resolves it, and `edtsRows` reflects it for Escape's cancel-vs-quit choice.
    await deps.loadEdts();
    void deps.loadEdtsBranches();
    // Structured per-repo rows (FailedResultList); create never wires a retry.
    const failedRows = stripAssistedActionCodes(summarizeFailedResults(result.data.results));
    if (failedRows.length > 0) {
      // Never activate after a partial-failure create: the EDT stays inactive.
      patchActivation({ created, outcome: 'not-activated' }, { submitting: false, failedRows });
      await deps.logEdtAction(
        created.ulid,
        'create',
        'failed',
        `${describeCreateForLog(current.topic.trim(), memberCount, 'not-activated', rootTopic)}: ${failedRows.map((row) => row.message).join('; ')}`,
      );
      return;
    }
    if (current.activation.firstEdt) {
      patchActivation({ created });
      await runActivation(created, memberCount, rootTopic);
      return;
    }
    if (current.activation.choice === 'switch') {
      await deps.logEdtAction(created.ulid, 'create', 'success', describeCreateForLog(current.topic.trim(), memberCount, 'switch', rootTopic));
      deps.startSwitch(created);
      return;
    }
    deps.setDialog({ kind: 'none' });
    deps.setCurrentEdtAction(null);
    await deps.logEdtAction(created.ulid, 'create', 'success', describeCreateForLog(current.topic.trim(), memberCount, 'stay', rootTopic));
  }

  // The first EDT's activation (and every Retry/Overwrite after a pause) — only ever activateEdt,
  // never createEdt again.
  async function runActivation(
    created: { ulid: string; topic: string },
    memberCount: number,
    rootTopic: string | undefined,
    overwrite?: Record<string, string[]>,
  ) {
    patchActivation({ decision: null }, { submitting: true, error: null, failedRows: [] });
    const result = await deps.activateEdtAction(overwrite !== undefined ? { topic: created.topic, overwrite } : { topic: created.topic });
    if (!result.ok) {
      // The per-repo checkouts may already have run (e.g. the state write failed after them):
      // their rows are kept on screen, next to the error.
      const results = activationErrorResults(result.error.details);
      const failedRows = results !== null ? summarizeActivationResults(results) : [];
      patchActivation({ blocked: null, confirm: null, outcome: 'not-activated' }, { submitting: false, error: result.error.message, failedRows });
      const rows = failedRows.length > 0 ? ` — ${failedRows.map((row) => `${row.service}: ${row.message}`).join('; ')}` : '';
      await deps.logEdtAction(
        created.ulid,
        'create',
        'failed',
        `${describeCreateForLog(created.topic, memberCount, 'not-activated', rootTopic)}: ${result.error.message}${rows}`,
      );
      return;
    }
    if (result.data.status === 'blocked') {
      // The pause panel (refreshed on every blocked retry); nothing logged yet.
      patchActivation({ blocked: result.data.blocked, confirm: null }, { submitting: false });
      return;
    }
    void deps.loadEdts();
    void deps.loadEdtsBranches();
    const { results } = result.data;
    const failedRows = stripAssistedActionCodes(summarizeFailedResults(results));
    const discarded = results
      .filter((row) => row.outcome === 'discarded')
      .map((row) => `${row.service} (${(row.detail?.discardedPaths ?? []).join(', ')})`);
    const parts = [describeCreateForLog(created.topic, memberCount, 'activated', rootTopic)];
    if (discarded.length > 0) {
      parts.push(`discarded: ${discarded.join('; ')}`);
    }
    if (failedRows.length > 0) {
      parts.push(`failed: ${failedRows.map((row) => `${row.service}: ${row.message}`).join('; ')}`);
    }
    if (failedRows.length > 0) {
      // Per-repo failures stay on screen until acknowledged.
      patchActivation({ blocked: null, confirm: null }, { submitting: false, failedRows });
    } else {
      deps.setDialog({ kind: 'none' });
      deps.setCurrentEdtAction(null);
    }
    await deps.logEdtAction(created.ulid, 'create', failedRows.length > 0 ? 'failed' : 'success', parts.join(' — '));
  }

  // Runs the decision Step 4's reducer raised (the zone's effect calls this once per decision,
  // outside any state updater).
  function dispatchActivationDecision(current: CreateDialogState) {
    const { decision, created, blocked } = current.activation;
    if (decision === null || created === null) {
      return;
    }
    const memberCount = current.selectedMembers.length;
    const rootTopic = current.seedFromEdt?.topic;
    if (decision.kind === 'stop') {
      patchActivation({ decision: null, blocked: null, confirm: null, outcome: 'stopped' });
      void deps.logEdtAction(created.ulid, 'create', 'success', describeCreateForLog(created.topic, memberCount, 'stopped', rootTopic));
      return;
    }
    void runActivation(created, memberCount, rootTopic, decision.kind === 'overwrite' ? overwriteFrom(blocked ?? []) : undefined);
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
      // Root members gone from the pool are dropped first (non-empty pool only), then the seeded
      // wizard's inherited rows are seeded/refreshed.
      const selectedMembers = pruneToCandidates(base.selectedMembers, deps.candidates);
      return {
        ...base,
        selectedMembers,
        branches: enterBranchStep(base.branches, base.topic, selectedMembers, base.seedFromEdt),
      };
    }
    // A first EDT is one created while no EDT exists — captured on entering Step 4.
    return { ...base, activation: initialActivationState(deps.edtsRows.length === 0) };
  }

  // Loads each queued (`pending`) service's lists once. Flipped to `loading` first
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
      // A rejected promise (a throw inside the store action) becomes an error result, so the
      // row never stays `loading` forever.
      void deps
        .listCreateBranches(path)
        .catch((error: unknown) => ({
          ok: false as const,
          error: { code: 'list-branches-failed', message: error instanceof Error ? error.message : String(error) },
        }))
        .then((result) => {
          deps.setDialog((prev) => {
            if (prev.kind !== 'create' || prev.branches.lists[path]?.status !== 'loading') {
              return prev;
            }
            const loaded = result.ok
              ? { status: 'ready' as const, local: result.data.local, remote: result.data.remote }
              : { status: 'error' as const, local: [], remote: [], error: result.error.message };
            // The rows changed under a possibly-stale "can't leave Step 3" message (e.g.
            // "chargement des branches en cours"): clear it, the rows show the live state.
            return {
              ...prev,
              error: prev.step === 3 ? null : prev.error,
              branches: { ...prev.branches, lists: { ...prev.branches.lists, [path]: loaded } },
            };
          });
        });
    }
  }

  // Validated inside the updater, against `prev` — never the keypress-time closure — so edits
  // and a step key arriving in the same input chunk can't validate one state and advance another.
  function goNext() {
    deps.setDialog((prev) => {
      if (prev.kind !== 'create' || prev.step === 4 || isStep3Busy(prev)) {
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
    deps.setDialog((prev) => (prev.kind === 'create' && prev.step > 1 && !isStep3Busy(prev) ? enterStep(prev, (prev.step - 1) as WizardStep) : prev));
  }

  // With an EDT list to go back to, Escape cancels; with none (the forced zero-EDT prompt) it
  // requests a quit instead of leaving no way out short of Ctrl+C.
  function cancel() {
    if (deps.edtsRows.length > 0) {
      close();
      return;
    }
    deps.requestQuit();
  }

  // Runs a cancel Step 3 requested from inside its state updater (see
  // CreateDialogState.cancelRequested). The flag is lowered first so a quit request (the
  // wizard stays open) can be raised again by the next Esc.
  function handleCancelRequest() {
    deps.setDialog((prev) => (prev.kind === 'create' && prev.cancelRequested ? { ...prev, cancelRequested: false } : prev));
    cancel();
  }

  function handleCreateInput(current: CreateDialogState, input: string, key: Key) {
    // Every key is inert while a submit is in flight (never tear down or re-enter it).
    if (current.submitting) {
      return;
    }
    // The EDT already exists and only an acknowledgment is left (partial-failure create,
    // stopped or failed activation, per-repo activation failures): Enter or Esc closes.
    if (isActivationAcknowledge(current)) {
      if (key.return || key.escape) {
        close();
      }
      return;
    }
    // Once created, Step 4 owns every key (pause panel, overwrite confirmation) — reduced against
    // the latest state; a decision it raises runs from the zone's effect.
    if (current.activation.created !== null) {
      deps.setDialog((prev) =>
        prev.kind === 'create' ? { ...prev, activation: reduceActivationKey(prev.activation, input, key) } : prev,
      );
      return;
    }
    const nav = resolveWizardNavKey(input, key);
    // Innermost-first — step navigation is inert while Step 3's box is open or a field is in edit
    // (goNext/goBack re-check this against the latest state).
    if (nav !== null && isStep3Busy(current)) {
      return;
    }
    if (nav === 'next') {
      goNext();
      return;
    }
    if (nav === 'back') {
      goBack();
      return;
    }
    // Step 3 owns every other key — Enter edits/configures (never advances), Esc closes its
    // innermost element first and only then cancels the wizard.
    if (current.step === 3) {
      branchStep.handleBranchStepInput(input, key);
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
      return;
    }
    // Step 4's radio (Space/↑↓).
    if (current.step === 4) {
      deps.setDialog((prev) =>
        prev.kind === 'create' ? { ...prev, activation: reduceActivationKey(prev.activation, input, key) } : prev,
      );
    }
  }

  return { handleCreateInput, loadPendingBranchLists, handleCancelRequest, dispatchActivationDecision };
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
  // Step 3's Panel B table height budget (NFR-7).
  maxVisibleRows: number;
}) {
  const breadcrumb = buildBreadcrumb(dialog, edtsRows, candidates);
  const cancelHint = edtsRows.length > 0 ? '[Esc] Annuler' : '[Esc] Quitter';
  const acknowledge = isActivationAcknowledge(dialog);
  // Step navigation only exists before the create; afterwards Step 4's own footers apply.
  const created = dialog.activation.created !== null;
  return (
    <ModalDialog title={CREATE_WIZARD_TITLE} open={true}>
      <Box flexDirection="column">
        <Box flexWrap="wrap">
          {breadcrumb.map((item, index) => (
            <Text key={item.step} color={BREADCRUMB_COLORS[item.tone]} bold={item.tone === 'current'} dimColor={item.tone === 'unreachable'}>
              {index > 0 ? ' ── ' : ''}[{item.text}]
            </Text>
          ))}
        </Box>
        {dialog.seedFromEdt !== null ? <Text color={colors['text-dim']}>Depuis l'EDT : {dialog.seedFromEdt.topic}</Text> : null}
        <Text color={colors['text-dim']}>{STEP_INTROS[dialog.step]}</Text>
        {dialog.step === 1 ? <NameStepView dialog={dialog} availability={checkNameAvailability(dialog.topic, edtsRows)} /> : null}
        {dialog.step === 2 ? <ServicesStepView dialog={dialog} candidates={candidates} candidateState={candidateState} /> : null}
        {dialog.step === 3 ? <BranchStepView dialog={dialog} candidates={candidates} maxRows={maxRows} maxVisibleRows={maxVisibleRows} /> : null}
        {dialog.step === 4 ? <ActivationStepView dialog={dialog} candidates={candidates} maxVisibleRows={maxVisibleRows} /> : null}
        {dialog.failedRows.length > 0 ? <FailedResultList rows={dialog.failedRows} /> : null}
        {dialog.error ? <DimAnnotation text={dialog.error} /> : null}
        {dialog.submitting ? <DimAnnotation text={created ? 'Activation…' : 'Création…'} /> : null}
        {acknowledge ? (
          <Text color={colors['text-dim']}>
            {dialog.activation.outcome === null ? 'EDT créé et activé, avec des échecs par service ci-dessus • ' : ''}[Entrée/Esc] Fermer
          </Text>
        ) : created ? null : (
          <Text color={colors['text-dim']}>
            [Ctrl+→/Ctrl+N] Étape suivante • [Ctrl+←/Ctrl+P] Étape précédente • {cancelHint}
          </Text>
        )}
      </Box>
    </ModalDialog>
  );
}
