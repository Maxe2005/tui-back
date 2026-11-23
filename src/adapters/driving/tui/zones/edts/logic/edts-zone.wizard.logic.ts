// tui/zones/edts: create-wizard branch-step state and the create dialog state.
import type { MemberBranchPlan } from '../../../../../../core/edt/lifecycle/create.js';
import type { EdtRegistryEntry } from '../../../../../../core/ports/edt-registry.js';
import { type FailedResultRow } from '../../../shared/components/lists/failed-result-list.js';
import type { TextInputState } from '../../../shared/components/inputs/text-edit.js';
import type { OverrideBoxState } from '../dialogs/create-wizard/override-box.logic.js';
import type { CreateFormFocus } from './edts-zone.focus.logic.js';
import { summarizeFailedResults } from './edts-zone.modify.logic.js';
import type { WizardStep, ActivationState } from './edts-zone.dialogs.logic.js';

// ---- Create wizard Step 3 ----------------------------------------------------------------
// The "global strategy + per-service exceptions" state. A row override is exactly core's
// MemberBranchPlan: `create` renders as [Create (Custom)], `existing` as [Existante] — or
// [Rename] once `renameTo` is set. A path with no override follows Panel A's global rule
// ([Create (Global)]).
export type RowOverride = MemberBranchPlan;

// One service's branch lists, loaded once per Step 3 entry (a failed load is retried on the
// next entry). `pending` = requested by the entry, not yet in flight (the zone's effect picks
// it up and flips it to `loading`, see edts-zone.tsx) — keeps enterStep itself pure.
export type BranchListStatus = 'pending' | 'loading' | 'ready' | 'error';

export type BranchListState = {
  status: BranchListStatus;
  local: readonly string[];
  remote: readonly string[];
  error?: string;
  // branch -> topics of the EDTs that register it as their own for this repo,
  // computed when the lists load (a not-yet-created EDT has no ulid to exclude).
  owners?: Readonly<Record<string, readonly string[]>>;
};

export type BranchStepState = {
  globalBase: TextInputState; // '' = each service uses its own manifest sharedBranch
  globalName: TextInputState;
  // Touched-flag convention: an untouched name keeps tracking Step 1's slug.
  globalNameTouched: boolean;
  panel: 'global' | 'rows';
  globalLine: 'base' | 'name';
  editing: boolean; // Panel A's focused line is in edit mode
  rowCursor: number;
  overrides: Readonly<Record<string, RowOverride>>;
  lists: Readonly<Record<string, BranchListState>>;
  box: OverrideBoxState | null;
  // The root-EDT members already given their seeded [Create (Custom)] override — each path is
  // seeded at most once, so a row the developer reset to global stays global.
  seededPaths: readonly string[];
};

export function initialBranchStepState(): BranchStepState {
  return {
    globalBase: { value: '', cursor: 0 },
    globalName: { value: '', cursor: 0 },
    globalNameTouched: false,
    panel: 'global',
    globalLine: 'base',
    editing: false,
    rowCursor: 0,
    overrides: {},
    lists: {},
    box: null,
    seededPaths: [],
  };
}

export type CreateDialogState = {
  kind: 'create';
  // The wizard's current step.
  step: WizardStep;
  topic: string;
  // topic's own caret position — see TextInputState/nextTextInputValue in
  // shared/components/inputs/text-edit.ts.
  topicCursor: number;
  formFocus: CreateFormFocus;
  selectedMembers: readonly string[];
  memberCursor: number;
  submitting: boolean;
  error: string | null;
  // The structured per-repo breakdown for a partial failure riding inside an ok:true result
  // (summarizeFailedResults) — rendered via FailedResultList, apart from `error` above, which
  // keeps its validation/full-failure use.
  failedRows: FailedResultRow[];
  // Step 3's whole state (global strategy, per-service overrides, branch lists, override box).
  branches: BranchStepState;
  // Step 3 decides "Esc cancels the wizard" against the latest state, inside the setDialog
  // updater, where a cancel's side effects (closing, requesting a quit) cannot run. It raises
  // this flag instead; the zone's effect then runs the wizard's cancel (see create-wizard.tsx's
  // handleCancelRequest).
  cancelRequested: boolean;
  // Step 4's activation state (see ActivationState).
  activation: ActivationState;
  // The root EDT `edt-create-from` seeded this wizard from (TUI-only state): Step 2 starts on its
  // members, Step 3 seeds each inherited row on that member's root branch.
  seedFromEdt: EdtRegistryEntry | null;
};
