// tui/zones/edts: base-view and form focus cycling, member selection and branch-name suggestions.
import { stepFocus, type FocusNavDeclaration, type FocusNavDirection } from '../../../shared/keys/focus-navigation.js';
import type { TextInputState } from '../../../shared/components/inputs/text-edit.js';
import type { BranchStepState } from './edts-zone.wizard.logic.js';
import { partitionServicesByEdtMembership } from './edts-zone.format.logic.js';

// Tab's second consumer (the first is cycleFormFocus below, inside a form): cycling which of the
// three simultaneously-visible base-view lists arrows/Home/End move — EDTS, EDT SERVICES and
// OTHER SERVICES (partitioned by the *selected* EDT's membership, see
// partitionServicesByEdtMembership). Default focus is the EDT selector.
export type PaneFocus = 'edts' | 'edt-services' | 'other-services';

export const PANE_FOCUS_NAV: FocusNavDeclaration<PaneFocus> = {
  mode: 'tab',
  stops: ['edts', 'edt-services', 'other-services'],
};

export function cyclePaneFocus(current: PaneFocus, direction: FocusNavDirection = 'next'): PaneFocus {
  return stepFocus(PANE_FOCUS_NAV.stops, current, direction);
}

// Tab's first consumer: cycling a form's topic-input ↔ member-checklist while a
// create/switch/modify dialog is open.
export type FormFocus = 'topic' | 'members';

export const FORM_FOCUS_NAV: FocusNavDeclaration<FormFocus> = { mode: 'tab', stops: ['topic', 'members'] };

export function cycleFormFocus(current: FormFocus, direction: FocusNavDirection = 'next'): FormFocus {
  return stepFocus(FORM_FOCUS_NAV.stops, current, direction);
}

// The hand-rolled controlled text-input interpreter (`TextEditKey`/`TextInputState`/
// `nextTextInputValue`) lives in shared/components/inputs/text-edit.ts — a leaf module, so the shared
// branch-autocomplete input can reuse it without closing an import cycle back through
// branch-picker.

// The checkbox-list-item pure toggle (Space): member selection for the create/modify forms.
export function toggleMemberSelection(selected: readonly string[], path: string): string[] {
  return selected.includes(path) ? selected.filter((candidate) => candidate !== path) : [...selected, path];
}

// Rejects an empty value in the branch-edit flow inline so it never reaches modifyEdt
// unvalidated. Returns the inline error message, or null when valid.
export function validateBranchEditValue(value: string): string | null {
  return value.trim() === '' ? 'Branch name must not be empty' : null;
}

// ---- New-member branch suggestion --------------------------------------------------------
// Suggestion for a not-yet-member candidate newly checked in the Modify dialog: reuse the EDT's
// shared branch when every existing member agrees on one (>=1 member exists), otherwise fall back
// to the topic-slug suggestion the create flow uses.
export function suggestBranchForNewMember(existingMembers: readonly { branch: string }[], topic: string): string {
  const first = existingMembers[0];
  if (first !== undefined && existingMembers.every((member) => member.branch === first.branch)) {
    return first.branch;
  }
  return suggestBranchNameFromTopic(topic);
}

// ---- Branch-name suggestion --------------------------------------------------------------

// Slugifies a topic into a branch-name suggestion — lowercase, then any run of non-alphanumeric
// characters collapses to a single '-', trimmed of leading/trailing '-' (e.g. "Fix Auth Bug!!" ->
// "fix-auth-bug"). Pure and total: an all-punctuation topic slugifies to '' — exactly what
// validateBranchEditValue catches, never silently patched over with a fallback name.
export function suggestBranchNameFromTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The create dialog's form focus; Step 3's own focus lives in BranchStepState below (panel /
// globalLine / editing / rowCursor / box).
export type CreateFormFocus = FormFocus;
