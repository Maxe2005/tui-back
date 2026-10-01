// tui/zones/edts/dialogs/create-wizard: Story 2.36 — the pure, directly unit-tested logic of the
// 4-step create-EDT wizard (Nom -> Services -> Branches -> Activation), kept apart from the Ink
// views/handlers the same way edts-zone.logic.ts is kept apart from edts-zone.tsx.
//
// Story 2.37: Step 3 is the global branch strategy + per-service exceptions table — its pure
// resolution, row-view, validation and plan helpers live here too. Story 2.38: Step 4's pure
// helpers (labels, the non-member return list, the log detail); its key reducer lives in
// activation.logic.ts.
import type { MemberBranchPlan } from '../../../../../../../core/edt/create.js';
import type { SwitchEdtRepoResult } from '../../../../../../../core/edt/switch.js';
import type { ServiceBranchDivergence } from '../../../../../../../core/edt/list.js';
import { isSharedBranch } from '../../../../../../../core/edt/shared-branches.js';
import type { EdtRegistryEntry } from '../../../../../../../core/ports/edt-registry.js';
import type { FailedResultRow } from '../../../../shared/components/failed-result-list.js';
import {
  suggestBranchNameFromTopic,
  type BranchListState,
  type BranchStepState,
  type CreateDialogState,
  type RowOverride,
  type WizardStep,
} from '../../edts-zone.logic.js';

export const WIZARD_STEPS: readonly WizardStep[] = [1, 2, 3, 4];

export const STEP_LABELS: Readonly<Record<WizardStep, string>> = {
  1: '1. Nom',
  2: '2. Services',
  3: '3. Branches',
  4: '4. Activation',
};

export const STEP_INTROS: Readonly<Record<WizardStep, string>> = {
  1: 'Choisissez un nom unique pour ce nouvel espace de travail (EDT).',
  2: 'Sélectionnez les services qui feront partie de cet EDT — au moins un.',
  3: 'Choisissez une règle de branche commune, puis ajustez les services qui font exception.',
  4: "Vérifiez le récapitulatif, puis choisissez si ce nouvel EDT devient l'espace actif.",
};

export const EMPTY_NAME_ERROR = 'Le nom ne doit pas être vide';
export const TAKEN_NAME_ERROR = 'Ce nom est déjà pris par un autre EDT';
export const NO_SERVICE_ERROR = 'Sélectionnez au moins un service';

export type NameAvailability = 'empty' | 'available' | 'taken';

// Trimmed, case-sensitive exact match against the loaded EDT topics — the same comparison
// core/edt/create.ts's own duplicate-topic rejection makes, so the live check never disagrees
// with what the core would later accept.
export function checkNameAvailability(topic: string, edts: readonly Pick<EdtRegistryEntry, 'topic'>[]): NameAvailability {
  const trimmed = topic.trim();
  if (trimmed === '') {
    return 'empty';
  }
  return edts.some((entry) => entry.topic === trimmed) ? 'taken' : 'available';
}

export type AdvanceCheck = { ok: true } | { ok: false; error: string };

// Whether the developer may leave `step` forward. Step 4 is the last step — there is nothing to
// advance into, its own Enter is the final confirm (see create-wizard.tsx).
export function canAdvance(
  step: WizardStep,
  state: CreateDialogState,
  edts: readonly Pick<EdtRegistryEntry, 'topic'>[],
  candidates: readonly BranchCandidate[],
): AdvanceCheck {
  if (step === 1) {
    const availability = checkNameAvailability(state.topic, edts);
    if (availability === 'empty') {
      return { ok: false, error: EMPTY_NAME_ERROR };
    }
    return availability === 'taken' ? { ok: false, error: TAKEN_NAME_ERROR } : { ok: true };
  }
  if (step === 2) {
    return state.selectedMembers.length >= 1 ? { ok: true } : { ok: false, error: NO_SERVICE_ERROR };
  }
  if (step === 3) {
    // Story 2.37: every row needs a resolved base (not loading, not introuvable), a non-empty
    // target and no protected target — first blocked row wins, named by its service.
    const blocked = buildStep3Rows(state, candidates).find((row) => row.error !== null);
    return blocked === undefined ? { ok: true } : { ok: false, error: `${blocked.service} : ${blocked.error}` };
  }
  return { ok: true };
}

// Steps 1..k, where k is the first step whose own canAdvance fails (capped at 4): every step up
// to and including the first blocked one can be reached, nothing past it.
export function reachableSteps(
  state: CreateDialogState,
  edts: readonly Pick<EdtRegistryEntry, 'topic'>[],
  candidates: readonly BranchCandidate[],
): WizardStep[] {
  const reachable: WizardStep[] = [];
  for (const step of WIZARD_STEPS) {
    reachable.push(step);
    if (!canAdvance(step, state, edts, candidates).ok) {
      break;
    }
  }
  return reachable;
}

// A completed step's breadcrumb text: what was decided in it.
export function stepSummary(step: WizardStep, state: CreateDialogState): string {
  if (step === 1) {
    return `${STEP_LABELS[1]}: ${state.topic.trim()}`;
  }
  if (step === 2) {
    return `${STEP_LABELS[2]} (${state.selectedMembers.length})`;
  }
  if (step === 3) {
    // Story 2.37: the global name, plus how many services carry their own exception.
    const exceptions = state.selectedMembers.filter((path) => state.branches.overrides[path] !== undefined).length;
    const suffix = exceptions === 0 ? '' : ` (+${exceptions} exception${exceptions > 1 ? 's' : ''})`;
    return `${STEP_LABELS[3]}: ${state.branches.globalName.value.trim()}${suffix}`;
  }
  return STEP_LABELS[4];
}

export type BreadcrumbTone = 'current' | 'done' | 'pending' | 'unreachable';

export type BreadcrumbItem = { step: WizardStep; text: string; tone: BreadcrumbTone };

export function buildBreadcrumb(
  state: CreateDialogState,
  edts: readonly Pick<EdtRegistryEntry, 'topic'>[],
  candidates: readonly BranchCandidate[],
): BreadcrumbItem[] {
  const reachable = reachableSteps(state, edts, candidates);
  return WIZARD_STEPS.map((step) => {
    if (step === state.step) {
      return { step, text: `▶ ${STEP_LABELS[step]} ◀`, tone: 'current' };
    }
    if (step < state.step) {
      return { step, text: stepSummary(step, state), tone: 'done' };
    }
    return { step, text: STEP_LABELS[step], tone: reachable.includes(step) ? 'pending' : 'unreachable' };
  });
}

export type WizardNavKey = {
  ctrl?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
};

// Wizard-scoped step navigation: Ctrl+→ / Ctrl+N forward, Ctrl+← / Ctrl+P back. Ink delivers
// Ctrl+letter as `input === '<letter>'` with `key.ctrl: true`, and Ctrl+Arrow (xterm's
// `\x1b[1;5C`/`D`) as the arrow flag with `key.ctrl: true`. Ctrl+N/Ctrl+P are the fallbacks
// for terminals that never send the ctrl modifier on arrow keys.
export function resolveWizardNavKey(input: string, key: WizardNavKey): 'next' | 'back' | null {
  if (key.ctrl !== true) {
    return null;
  }
  if (key.rightArrow || input === 'n') {
    return 'next';
  }
  if (key.leftArrow || input === 'p') {
    return 'back';
  }
  return null;
}

// Story 2.37 -----------------------------------------------------------------------------
// Step 3: global branch strategy + per-service exceptions.

// The per-service facts Step 3 reads from the candidate pool (core/edt/list.ts).
export type BranchCandidate = Pick<ServiceBranchDivergence, 'path' | 'service' | 'sharedBranch'>;

// FR-7, advisory: the same rule the git gate enforces (core/edt/shared-branches.ts) — the
// fixed shared set or this service's own manifest sharedBranch. The gate stays authoritative.
export function isProtectedTarget(name: string, sharedBranch: string): boolean {
  return isSharedBranch(name.trim(), sharedBranch);
}

// The local name an `existing` plan ends up on, as core derives it: a local branch keeps its
// name; a remote-only ref drops its remote segment (`origin/feat/q` -> `feat/q`).
export function localNameOf(branch: string, lists: Pick<BranchListState, 'local' | 'remote'> | undefined): string {
  const trimmed = branch.trim();
  if (lists === undefined || lists.local.includes(trimmed)) {
    return trimmed;
  }
  if (lists.remote.includes(trimmed) && trimmed.includes('/')) {
    return trimmed.slice(trimmed.indexOf('/') + 1);
  }
  return trimmed;
}

export type BaseResolution =
  | { kind: 'resolved'; base: string }
  | { kind: 'loading' }
  | { kind: 'load-error'; message: string }
  | { kind: 'not-found' };

// Resolves Panel A's global base for one service. The lists must be loaded first (a load
// error blocks the row). An empty input means "this service's own manifest sharedBranch",
// resolved against the lists exactly like a typed base (a sharedBranch missing from the repo
// must fail here, not later in core's createBranch): the exact local branch wins, then
// `origin/<x>` in the remote list (an input that already is an exact remote-tracking ref is
// accepted as-is), else not-found. Never fetches.
export function resolveGlobalBase(input: string, lists: BranchListState | undefined, sharedBranch: string): BaseResolution {
  if (lists === undefined || lists.status === 'pending' || lists.status === 'loading') {
    return { kind: 'loading' };
  }
  if (lists.status === 'error') {
    return { kind: 'load-error', message: lists.error ?? '' };
  }
  const wanted = input.trim() === '' ? sharedBranch.trim() : input.trim();
  if (wanted === '') {
    return { kind: 'not-found' };
  }
  if (lists.local.includes(wanted)) {
    return { kind: 'resolved', base: wanted };
  }
  if (lists.remote.includes(`origin/${wanted}`)) {
    return { kind: 'resolved', base: `origin/${wanted}` };
  }
  if (lists.remote.includes(wanted)) {
    return { kind: 'resolved', base: wanted };
  }
  return { kind: 'not-found' };
}

export type RowMode = 'global' | 'perso' | 'existing' | 'rename';

export const ROW_MODE_LABELS: Readonly<Record<RowMode, string>> = {
  global: '[Créer (Global)]',
  perso: '[Créer (Perso)]',
  existing: '[Existante]',
  rename: '[Renommer]',
};

export const ROW_ERRORS = {
  loading: 'chargement des branches en cours',
  loadError: 'échec du chargement des branches',
  notFound: 'branche introuvable',
  emptyName: 'nom de branche vide',
  protected: 'branche protégée (FR-7)',
  exists: 'branche déjà existante',
  noopRename: 'renommage sans effet',
  shadowed: 'branche locale du même nom déjà existante',
} as const;

// Why a plan's target cannot work, checked inline (advisory — the git gate and core stay
// authoritative). Shared by the Panel B rows and the override box's Apply, which word it
// differently. `lists` must be loaded for the existence checks; without them only the
// name-only checks run.
export type PlanIssue =
  | { kind: 'empty-name' }
  | { kind: 'protected-name'; name: string } // a new/renamed target in the FR-7 set
  | { kind: 'protected-source'; branch: string } // a local protected branch: attach and rename are both gated
  | { kind: 'protected-existing'; name: string } // attaching (no rename) lands on a protected local name
  | { kind: 'exists'; name: string } // the new/renamed target already exists locally
  | { kind: 'noop-rename'; name: string } // renameTo equals the branch's own local name
  | { kind: 'shadowed'; name: string }; // remote-only pick whose local name already exists

export function checkPlan(plan: MemberBranchPlan, lists: BranchListState | undefined, sharedBranch: string): PlanIssue | null {
  const known = lists !== undefined && lists.status === 'ready' ? lists : undefined;
  const existsLocally = (name: string) => known !== undefined && known.local.includes(name);
  if (plan.kind === 'create') {
    const name = plan.name.trim();
    if (name === '') {
      return { kind: 'empty-name' };
    }
    if (isProtectedTarget(name, sharedBranch)) {
      return { kind: 'protected-name', name };
    }
    return existsLocally(name) ? { kind: 'exists', name } : null;
  }
  const branch = plan.branch.trim();
  // Unknown lists: assume local (the conservative reading — the gate would reject it anyway).
  const isLocal = known === undefined || known.local.includes(branch);
  if (isLocal && isProtectedTarget(branch, sharedBranch)) {
    // The adapter's renameBranch gates the old name too, so a rename cannot rescue it.
    return { kind: 'protected-source', branch };
  }
  const localName = localNameOf(branch, known);
  if (plan.renameTo !== undefined) {
    const renameTo = plan.renameTo.trim();
    if (renameTo === '') {
      return { kind: 'empty-name' };
    }
    if (isProtectedTarget(renameTo, sharedBranch)) {
      return { kind: 'protected-name', name: renameTo };
    }
    if (renameTo === localName) {
      return { kind: 'noop-rename', name: renameTo };
    }
    return existsLocally(renameTo) ? { kind: 'exists', name: renameTo } : null;
  }
  if (isProtectedTarget(localName, sharedBranch)) {
    return { kind: 'protected-existing', name: localName };
  }
  if (!isLocal && existsLocally(localName)) {
    return { kind: 'shadowed', name: localName };
  }
  return null;
}

export function rowIssueMessage(issue: PlanIssue): string {
  switch (issue.kind) {
    case 'empty-name':
      return ROW_ERRORS.emptyName;
    case 'protected-name':
    case 'protected-source':
    case 'protected-existing':
      return ROW_ERRORS.protected;
    case 'exists':
      return ROW_ERRORS.exists;
    case 'noop-rename':
      return ROW_ERRORS.noopRename;
    case 'shadowed':
      return ROW_ERRORS.shadowed;
  }
}

// One Panel B row, ready to render: display texts for the Base / Source and Branche cible
// columns, the blocking error (if any, on the column it belongs to), and the resulting plan.
export type RowView = {
  path: string;
  service: string;
  mode: RowMode;
  modeLabel: string;
  base: string;
  baseStatus: 'ok' | 'loading' | 'error';
  target: string;
  targetError: string | null;
  error: string | null;
  plan: MemberBranchPlan | null;
};

export function buildRowView(
  row: { path: string; service: string; override?: RowOverride },
  global: { base: string; name: string },
  lists: BranchListState | undefined,
  sharedBranch: string,
): RowView {
  const { path, service, override } = row;
  if (override === undefined) {
    const resolution = resolveGlobalBase(global.base, lists, sharedBranch);
    const name = global.name.trim();
    const issue = checkPlan({ kind: 'create', base: '', name }, lists, sharedBranch);
    const targetError = issue === null ? null : rowIssueMessage(issue);
    const common = { path, service, mode: 'global' as const, modeLabel: ROW_MODE_LABELS.global, target: name, targetError };
    if (resolution.kind === 'loading') {
      return { ...common, base: 'Chargement…', baseStatus: 'loading', error: ROW_ERRORS.loading, plan: null };
    }
    if (resolution.kind === 'load-error') {
      // The real cause (e.g. git's own message), not only the generic label.
      const message = resolution.message.trim() === '' ? ROW_ERRORS.loadError : `${ROW_ERRORS.loadError} : ${resolution.message.trim()}`;
      return { ...common, base: message, baseStatus: 'error', error: message, plan: null };
    }
    if (resolution.kind === 'not-found') {
      return { ...common, base: ROW_ERRORS.notFound, baseStatus: 'error', error: ROW_ERRORS.notFound, plan: null };
    }
    return {
      ...common,
      base: resolution.base,
      baseStatus: 'ok',
      error: targetError,
      plan: targetError === null ? { kind: 'create', base: resolution.base, name } : null,
    };
  }
  // Overrides were validated by the box's Apply, but are re-checked here: the lists can have
  // been reloaded since, and a row must never hand core a plan the box would now refuse.
  const issue = checkPlan(override, lists, sharedBranch);
  const targetError = issue === null ? null : rowIssueMessage(issue);
  if (override.kind === 'create') {
    return {
      path,
      service,
      mode: 'perso',
      modeLabel: ROW_MODE_LABELS.perso,
      base: override.base,
      baseStatus: 'ok',
      target: override.name.trim(),
      targetError,
      error: targetError,
      plan: targetError === null ? override : null,
    };
  }
  const renamed = override.renameTo !== undefined;
  const finalName = renamed ? (override.renameTo ?? '').trim() : localNameOf(override.branch, lists);
  const mode: RowMode = renamed ? 'rename' : 'existing';
  return {
    path,
    service,
    mode,
    modeLabel: ROW_MODE_LABELS[mode],
    base: override.branch,
    baseStatus: 'ok',
    target: renamed ? `-> ${finalName}` : finalName,
    targetError,
    error: targetError,
    plan: targetError === null ? override : null,
  };
}

// Every selected service's row, in selection order.
export function buildStep3Rows(state: CreateDialogState, candidates: readonly BranchCandidate[]): RowView[] {
  const { branches } = state;
  const global = { base: branches.globalBase.value, name: branches.globalName.value };
  return state.selectedMembers.map((path) => {
    const candidate = candidates.find((entry) => entry.path === path);
    const override = branches.overrides[path];
    return buildRowView(
      { path, service: candidate?.service ?? path, ...(override !== undefined ? { override } : {}) },
      global,
      branches.lists[path],
      candidate?.sharedBranch ?? '',
    );
  });
}

// Story 2.35's `memberPlans`, one per row — null while any row is still invalid. Overrides
// pass through as-is (buildRowView's plan for an override is the override itself).
export function buildMemberPlans(rows: readonly RowView[]): Record<string, MemberBranchPlan> | null {
  const plans: Record<string, MemberBranchPlan> = {};
  for (const row of rows) {
    if (row.plan === null) {
      return null;
    }
    plans[row.path] = row.plan;
  }
  return plans;
}

// Story 2.37 (review): while Step 3's override box is open or a Panel A / box field is in
// edit, wizard step navigation is inert — the innermost element owns the keys, and moving
// away would silently drop edits that were never applied.
export function isStep3Busy(state: Pick<CreateDialogState, 'step' | 'branches'>): boolean {
  return state.step === 3 && (state.branches.box !== null || state.branches.editing);
}

// Entering Step 3 (forward from Step 2 or back from Step 4): an untouched global name tracks
// Step 1's slug again; every selected service without a loaded list (never loaded, or failed
// last time) is queued for a load; focus resets to Panel A, nothing in edit, box closed.
// Overrides and loaded lists are kept.
//
// Story 2.31: with a `seed` (edt-create-from's root EDT), each selected root member never
// seeded before gets a [Créer (Perso)] override on its root-EDT branch, named after the global
// name this entry settles on — once per path (`seededPaths`), so a row reset to global stays
// global. A seeded override still exactly `{create, <root branch>, <previous global name>}` is
// untouched, so it follows the new global name, the same way an untouched global name tracks
// the slug. Non-root members get no override ([Créer (Global)]).
export function enterBranchStep(
  branches: BranchStepState,
  topic: string,
  selectedMembers: readonly string[],
  seed: EdtRegistryEntry | null = null,
): BranchStepState {
  const slug = suggestBranchNameFromTopic(topic);
  const globalName = branches.globalNameTouched ? branches.globalName : { value: slug, cursor: slug.length };
  const seeded = applyRootSeed(branches, globalName.value, selectedMembers, seed);
  const lists = { ...branches.lists };
  for (const path of selectedMembers) {
    const current = lists[path];
    if (current === undefined || current.status === 'error') {
      lists[path] = { status: 'pending', local: [], remote: [] };
    }
  }
  return {
    ...branches,
    ...seeded,
    globalName,
    lists,
    panel: 'global',
    globalLine: 'base',
    editing: false,
    rowCursor: Math.min(branches.rowCursor, Math.max(selectedMembers.length - 1, 0)),
    box: null,
  };
}

// Story 2.31: the seeding/refresh half of enterBranchStep (see its comment).
function applyRootSeed(
  branches: BranchStepState,
  nextGlobalName: string,
  selectedMembers: readonly string[],
  seed: EdtRegistryEntry | null,
): Pick<BranchStepState, 'overrides' | 'seededPaths'> {
  if (seed === null) {
    return { overrides: branches.overrides, seededPaths: branches.seededPaths };
  }
  const previousGlobalName = branches.globalName.value;
  const overrides: Record<string, RowOverride> = { ...branches.overrides };
  const seededPaths = [...branches.seededPaths];
  for (const member of seed.members) {
    const path = member.repoPath;
    if (!seededPaths.includes(path)) {
      if (selectedMembers.includes(path)) {
        overrides[path] = { kind: 'create', base: member.branch, name: nextGlobalName };
        seededPaths.push(path);
      }
      continue;
    }
    const current = overrides[path];
    if (current !== undefined && current.kind === 'create' && current.base === member.branch && current.name === previousGlobalName) {
      overrides[path] = { ...current, name: nextGlobalName };
    }
  }
  return { overrides, seededPaths };
}

// Story 2.31: the root members absent from the candidate pool (unregistered or unreachable
// since the root was created), by service name — Step 2's dim note.
export function missingSeedMembers(seed: EdtRegistryEntry | null, candidates: readonly Pick<BranchCandidate, 'path'>[]): string[] {
  if (seed === null) {
    return [];
  }
  const known = new Set(candidates.map((candidate) => candidate.path));
  return seed.members.filter((member) => !known.has(member.repoPath)).map((member) => member.service);
}

// Story 2.31: drops selected paths the candidate pool doesn't have (a root member gone since) —
// only while the pool is non-empty, so a not-yet-loaded pool never wipes the selection.
export function pruneToCandidates(selectedMembers: readonly string[], candidates: readonly Pick<BranchCandidate, 'path'>[]): readonly string[] {
  if (candidates.length === 0) {
    return selectedMembers;
  }
  const known = new Set(candidates.map((candidate) => candidate.path));
  const pruned = selectedMembers.filter((path) => known.has(path));
  return pruned.length === selectedMembers.length ? selectedMembers : pruned;
}

// ---- Step 4: Activation (Story 2.38) --------------------------------------------------------

export const ACTIVATION_LABELS = {
  firstEdt: 'Définir cet EDT comme espace actif immédiatement',
  firstEdtExplanation: "Aucun EDT n'existe encore : il n'y a pas d'EDT sortant dont le travail serait à préserver.",
  switchNow: 'Basculer immédiatement sur ce nouvel EDT',
  stay: "Créer sans basculer (rester sur l'EDT courant)",
  stashInfo: "Le travail non commité des services de l'EDT sortant est préservé automatiquement (stash).",
  otherDirtyInfo:
    "Le travail non commité de tout autre service vous est listé : vous choisirez de l'adopter dans l'EDT sortant ou de l'écraser.",
  membersInfo: 'Les services membres passent sur leurs branches configurées.',
  nonMembersInfo: 'Les services non membres reviennent sur leur propre branche partagée :',
  stopped: "EDT créé mais non actif : l'activation a été interrompue.",
  notActivated: "EDT créé mais non activé.",
} as const;

// The next step shown under the "created but not active" terminal messages.
export function activateLaterHint(topic: string): string {
  return `Activez-le plus tard via :edt-switch ${topic.trim()}`;
}

export type NonMemberReturn = { service: string; sharedBranch: string };

// The services that are NOT members of the new EDT, each with the shared branch a switch sends
// it back to (FR-8) — the info block lists them by name.
export function nonMemberReturns(candidates: readonly BranchCandidate[], members: readonly string[]): NonMemberReturn[] {
  const selected = new Set(members);
  return candidates
    .filter((candidate) => !selected.has(candidate.path))
    .map((candidate) => ({ service: candidate.service, sharedBranch: candidate.sharedBranch }));
}

// The Step 4 terminal state: the EDT exists and only an acknowledgment (Enter/Esc closes) is
// left — a partial-failure create, a stopped or failed activation, or an activation that
// reported per-repo failures.
export function isActivationAcknowledge(state: Pick<CreateDialogState, 'step' | 'failedRows' | 'activation'>): boolean {
  return state.step === 4 && (state.activation.outcome !== null || state.failedRows.length > 0);
}

// The action-log detail of a create, with how its activation ended. Story 2.31: a seeded
// create names its root EDT (`Created EDT "x" from "root" with …`).
export function describeCreateForLog(
  topic: string,
  memberCount: number,
  activation: 'activated' | 'stopped' | 'not-activated' | 'switch' | 'stay',
  rootTopic?: string,
): string {
  const from = rootTopic !== undefined ? ` from "${rootTopic}"` : '';
  const created = `Created EDT "${topic}"${from} with ${memberCount} member(s)`;
  switch (activation) {
    case 'activated':
      return `${created} and activated it`;
    case 'stopped':
      return `${created} — not activated (stopped on uncommitted changes)`;
    case 'not-activated':
      return `${created} — not activated`;
    case 'switch':
      // Logged before the switch runs: the switch dialog logs its own outcome.
      return `${created} (switch requested)`;
    case 'stay':
      return `${created} — active EDT unchanged`;
  }
}

// The per-repo `results` an activateEdt error carries in its details (a state-write failure, or
// a pointer set by someone else meanwhile) — the checkouts already ran, so they must be shown.
export function activationErrorResults(details: unknown): SwitchEdtRepoResult[] | null {
  if (typeof details !== 'object' || details === null || !('results' in details)) {
    return null;
  }
  const results = (details as { results: unknown }).results;
  return Array.isArray(results) ? (results as SwitchEdtRepoResult[]) : null;
}

// Every per-repo row of an activation that did not complete, for FailedResultList: failures as
// they are, and what already happened to the other repos (discarded files, checkouts).
export function summarizeActivationResults(results: readonly SwitchEdtRepoResult[]): FailedResultRow[] {
  return results.map((row) => {
    if (row.outcome === 'failed') {
      return { service: row.service, message: row.detail?.message ?? 'Failed' };
    }
    if (row.outcome === 'discarded') {
      const paths = row.detail?.discardedPaths ?? [];
      return { service: row.service, message: `fichiers écrasés (${paths.length}) : ${paths.join(', ')} — puis basculé sur sa branche cible` };
    }
    return { service: row.service, message: 'basculé sur sa branche cible' };
  });
}
