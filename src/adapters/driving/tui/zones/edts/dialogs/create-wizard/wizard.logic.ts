// tui/zones/edts/dialogs/create-wizard: Story 2.36 — the pure, directly unit-tested logic of the
// 4-step create-EDT wizard (Nom -> Services -> Branches -> Activation), kept apart from the Ink
// views/handlers the same way edts-zone.logic.ts is kept apart from edts-zone.tsx.
//
// Steps 3-4 are interim until Stories 2.37/2.38: Step 3 validates today's branch-setup fields
// (validateCreateBranchFields, reused as-is), Step 4 is a plain confirm.
import type { EdtRegistryEntry } from '../../../../../../../core/ports/edt-registry.js';
import { validateCreateBranchFields, type CreateDialogState, type WizardStep } from '../../edts-zone.logic.js';

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
  3: 'Définissez la branche de travail créée pour chaque service sélectionné.',
  4: "Vérifiez le récapitulatif, puis confirmez la création de l'EDT.",
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
  return edts.some((entry) => entry.topic.trim() === trimmed) ? 'taken' : 'available';
}

export type AdvanceCheck = { ok: true } | { ok: false; error: string };

// Whether the developer may leave `step` forward. Step 4 is the last step — there is nothing to
// advance into, its own Enter is the final confirm (see create-wizard.tsx).
export function canAdvance(step: WizardStep, state: CreateDialogState, edts: readonly Pick<EdtRegistryEntry, 'topic'>[]): AdvanceCheck {
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
    const error = validateCreateBranchFields(state.namingMode, state.selectedMembers, state.branchName, state.branchNames, state.baseBranches);
    return error === null ? { ok: true } : { ok: false, error };
  }
  return { ok: true };
}

// Steps 1..k, where k is the first step whose own canAdvance fails (capped at 4): every step up
// to and including the first blocked one can be reached, nothing past it.
export function reachableSteps(state: CreateDialogState, edts: readonly Pick<EdtRegistryEntry, 'topic'>[]): WizardStep[] {
  const reachable: WizardStep[] = [];
  for (const step of WIZARD_STEPS) {
    reachable.push(step);
    if (!canAdvance(step, state, edts).ok) {
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
    return state.namingMode === 'grouped' ? `${STEP_LABELS[3]}: ${state.branchName}` : `${STEP_LABELS[3]} (individuelles)`;
  }
  return STEP_LABELS[4];
}

export type BreadcrumbTone = 'current' | 'done' | 'pending' | 'unreachable';

export type BreadcrumbItem = { step: WizardStep; text: string; tone: BreadcrumbTone };

export function buildBreadcrumb(state: CreateDialogState, edts: readonly Pick<EdtRegistryEntry, 'topic'>[]): BreadcrumbItem[] {
  const reachable = reachableSteps(state, edts);
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

// Story 2.32 (moved here from create-dialog.tsx): prefillBranchNames overwrites
// branchName/branchNames for any *untouched* field — its own paired cursor(s) must follow along
// ("programmatic value overwrites ... reset cursor to value.length"). A touched field is never
// rewritten by prefillBranchNames, so its cursor stays put. Rebuilt from scratch over
// filled.branchNames' own key set so a deselected member's cursor entry never outlives it.
export function withPrefillCursors(
  prev: CreateDialogState,
  filled: { branchName: string; branchNames: Record<string, string> },
): { branchNameCursor: number; branchNameCursors: Record<string, number> } {
  const branchNameCursor = prev.branchNameTouched ? prev.branchNameCursor : filled.branchName.length;
  const branchNameCursors: Record<string, number> = {};
  for (const path of Object.keys(filled.branchNames)) {
    const value = filled.branchNames[path] ?? '';
    branchNameCursors[path] = prev.branchNamesTouched[path] ? (prev.branchNameCursors[path] ?? value.length) : value.length;
  }
  return { branchNameCursor, branchNameCursors };
}
