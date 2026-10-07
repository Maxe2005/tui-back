// tui/zones/edts/dialogs/switch-resolution: the SWITCH EDT resolution view's draft state, pure
// key reducer and row helpers, kept apart from its Ink view (switch-resolution-view.tsx). The
// draft lives in the dialog state only, never in core: the core switch is parked on the
// edt-slice seam until this view resolves `proceed` (with `buildResolutions(rows)`) or
// `cancel`. The layout mirrors the create wizard's Step 3 (see the main reducer below).
import { resolve } from 'node:path';
import type { DirtyResolution, SwitchDirtyRepo, SwitchEdtRepoResult } from '../../../../../../../core/edt/switch.js';
import type { EdtRegistryEntry } from '../../../../../../../core/ports/edt-registry.js';
import { nextTextInputValue, type TextEditKey, type TextInputState } from '../../../../shared/components/text-edit.js';
import { resolveFocusStep, stepFocus, TWO_PANEL_NAV } from '../../../../shared/keys/focus-navigation.js';
import { suggestBranchNameFromTopic } from '../../edts-zone.logic.js';
import { existingTargetError, OVERRIDE_BOX_ERRORS, protectedNameError } from '../create-wizard/override-box.logic.js';
import { isProtectedTarget } from '../create-wizard/wizard.logic.js';
import { nextBoxLine as moveBoxLine } from '../../../../shared/keys/box-line-nav.js';
import { formatHints } from '../../../../shared/components/hints.js';

export type ResolutionAction = 'adopt' | 'discard';

// A row's explicit override (the box's Apply). No override = the row follows Panel A.
export type ResolutionOverride = { kind: 'adopt'; branch: string } | { kind: 'discard' };

// A row's effective plan: `override ?? global`.
export type RowPlan = { kind: 'adopt'; branch: string; source: 'global' | 'perso' } | { kind: 'discard'; source: 'global' | 'perso' };

// The branches OTHER EDTs (every one but the outgoing EDT) register for a repo, keyed by resolved
// repoPath — plain data computed once when the view opens. Adopting onto such a branch would
// steal it from that EDT (the git gate rejects it anyway).
export type EdtBranchClaim = { branch: string; topic: string };
export type OtherEdtBranches = Readonly<Record<string, readonly EdtBranchClaim[]>>;

export function otherEdtBranches(edts: readonly EdtRegistryEntry[], outgoingUlid: string | null): OtherEdtBranches {
  const claims: Record<string, EdtBranchClaim[]> = {};
  for (const entry of edts) {
    if (entry.ulid === outgoingUlid) {
      continue;
    }
    for (const member of entry.members) {
      const path = resolve(member.repoPath);
      (claims[path] ??= []).push({ branch: member.branch, topic: entry.topic });
    }
  }
  return claims;
}

// One repo's local branch list, loaded once when the view opens (listMemberBranches). While
// loading or after a failed load, the "exists locally" check is skipped (the git gate stays
// authoritative: `branch-exists` fails that row).
export type LocalBranchList = { status: 'loading' | 'ready' | 'error'; branches: readonly string[] };

export type SwitchResolutionBoxLine = 'action' | 'branch' | 'apply';

export type SwitchResolutionBox = {
  repoPath: string;
  action: ResolutionAction;
  line: SwitchResolutionBoxLine;
  editing: boolean;
  branch: TextInputState;
  // Set when an Apply was refused; the live inline error is recomputed on every render.
  error: string | null;
};

export type SwitchResolutionDecision = { kind: 'cancel' } | { kind: 'proceed'; resolutions: Record<string, DirtyResolution> };

export type SwitchResolutionState = {
  // Identifies this draft (one per seam raise): an async branch-list load started for an
  // earlier draft never writes into a newer one.
  draftId: number;
  // The EDT being left; null on a first switch (nothing to adopt into).
  outgoingTopic: string | null;
  panel: 'global' | 'rows';
  globalLine: 'action' | 'name';
  editing: boolean; // Panel A's name line is in edit mode
  globalAction: ResolutionAction;
  globalName: TextInputState;
  globalNameTouched: boolean;
  rowCursor: number;
  overrides: Readonly<Record<string, ResolutionOverride>>;
  lists: Readonly<Record<string, LocalBranchList>>;
  // Branches registered by other EDTs, per repo (see otherEdtBranches).
  claims: OtherEdtBranches;
  box: SwitchResolutionBox | null;
  // The discard confirmation (second view), with its file-list scroll position and the
  // inline error of a refused Ctrl+E.
  confirm: { scroll: number; error: string | null } | null;
  // Ctrl+N refused: the blocking message shown under the table until a row changes.
  error: string | null;
  // Raised by the reducer; the zone dispatches it to the parked core call exactly once.
  decision: SwitchResolutionDecision | null;
};

export const SWITCH_RESOLUTION_FOOTER = formatHints([['Tab', 'switch pane'], ['Enter', 'configure row'], ['Ctrl+N', 'confirm'], ['Esc', 'cancel switch']]);

export const RESOLUTION_MODE_LABELS = {
  adoptGlobal: '[Adopt (Global)]',
  adoptPerso: '[Adopt (Custom)]',
  discard: '[Discard]',
} as const;

export const RESOLUTION_ERRORS = {
  // `currentBranch === 'HEAD'` also covers a branch core could not read.
  detachedHead: 'Detached HEAD or unreadable branch — only Discard is possible',
  unreadableManifest: 'unreadable manifest — cannot validate the branch; choose Discard or cancel',
  noOutgoing: 'No outgoing EDT — only [Discard] is possible',
  blocked: 'Fix the invalid rows before confirming',
} as const;

// Ctrl+E refused: this discard row's file list could not be read by the pre-flight, so what
// would be destroyed cannot be shown (nor pinned through `confirmedPaths`).
export function unlistedDiscardError(service: string): string {
  return `file list unavailable for ${service} — cancel and retry the switch`;
}

// The rows needing a decision: dirty state-2/3 repos (state-1 rows are auto-stashed).
export function resolutionRepos(dirty: readonly SwitchDirtyRepo[]): SwitchDirtyRepo[] {
  return dirty.filter((repo) => repo.scope !== 'outgoing-member');
}

export function autoStashedRepos(dirty: readonly SwitchDirtyRepo[]): SwitchDirtyRepo[] {
  return dirty.filter((repo) => repo.scope === 'outgoing-member');
}

export function initialSwitchResolution(
  outgoingTopic: string | null,
  dirty: readonly SwitchDirtyRepo[],
  claims: OtherEdtBranches = {},
  draftId = 0,
): SwitchResolutionState {
  const name = outgoingTopic !== null ? suggestBranchNameFromTopic(outgoingTopic) : '';
  const lists: Record<string, LocalBranchList> = {};
  for (const repo of resolutionRepos(dirty)) {
    lists[repo.repoPath] = { status: 'loading', branches: [] };
  }
  return {
    draftId,
    outgoingTopic,
    panel: 'global',
    globalLine: 'action',
    editing: false,
    globalAction: outgoingTopic !== null ? 'adopt' : 'discard',
    globalName: { value: name, cursor: name.length },
    globalNameTouched: false,
    rowCursor: 0,
    overrides: {},
    lists,
    claims,
    box: null,
    confirm: null,
    error: null,
    decision: null,
  };
}

export function claimOf(branch: string, claims: readonly EdtBranchClaim[]): EdtBranchClaim | undefined {
  return claims.find((claim) => claim.branch === branch);
}

// The branch a global (or box-prefilled) adopt targets: the global name when the repo sits on a
// shared branch or on a branch another EDT registers for it, its current branch otherwise.
export function globalAdoptTarget(repo: SwitchDirtyRepo, globalName: string, claims: readonly EdtBranchClaim[] = []): string {
  return repo.currentBranchShared || claimOf(repo.currentBranch, claims) !== undefined ? globalName.trim() : repo.currentBranch;
}

export type ResolutionGlobal = {
  hasOutgoing: boolean;
  action: ResolutionAction;
  name: string;
  overrides: Readonly<Record<string, ResolutionOverride>>;
  claims: OtherEdtBranches;
};

export type ResolutionRow = {
  repo: SwitchDirtyRepo;
  hasOutgoing: boolean;
  // The branches other EDTs register for this repo.
  claims: readonly EdtBranchClaim[];
  plan: RowPlan;
};

export function globalOf(state: SwitchResolutionState): ResolutionGlobal {
  return {
    hasOutgoing: state.outgoingTopic !== null,
    action: state.globalAction,
    name: state.globalName.value,
    overrides: state.overrides,
    claims: state.claims,
  };
}

function planFor(repo: SwitchDirtyRepo, global: ResolutionGlobal, claims: readonly EdtBranchClaim[]): RowPlan {
  const override = global.overrides[repo.repoPath];
  if (override !== undefined) {
    return override.kind === 'adopt' ? { kind: 'adopt', branch: override.branch.trim(), source: 'perso' } : { kind: 'discard', source: 'perso' };
  }
  if (!global.hasOutgoing || global.action === 'discard') {
    return { kind: 'discard', source: 'global' };
  }
  return { kind: 'adopt', branch: globalAdoptTarget(repo, global.name, claims), source: 'global' };
}

// One row per dirty state-2/3 repo, in the seam's order.
export function buildRows(dirty: readonly SwitchDirtyRepo[], global: ResolutionGlobal): ResolutionRow[] {
  return resolutionRepos(dirty).map((repo) => {
    const claims = global.claims[repo.repoPath] ?? [];
    return { repo, hasOutgoing: global.hasOutgoing, claims, plan: planFor(repo, global, claims) };
  });
}

export function modeLabel(plan: RowPlan): string {
  if (plan.kind === 'discard') {
    return RESOLUTION_MODE_LABELS.discard;
  }
  return plan.source === 'global' ? RESOLUTION_MODE_LABELS.adoptGlobal : RESOLUTION_MODE_LABELS.adoptPerso;
}

export function scopeLabel(repo: SwitchDirtyRepo): string {
  if (repo.scope === 'member-of-other-edt') {
    return repo.owningEdtTopics.length > 0 ? `member of ${repo.owningEdtTopics.join(', ')}` : 'member of another EDT';
  }
  return 'outside any EDT';
}

export function claimedBranchError(topic: string): string {
  return `used by the EDT “${topic}” — reusing it would break that EDT`;
}

// Advisory (the git gate stays authoritative). Order: detached HEAD, unreadable manifest (no
// sharedBranch to check against — never a silently weakened check), then empty, protected
// (FR-7, the same isProtectedTarget rule Step 3 uses), registered by another EDT for this repo,
// already existing locally (≠ current).
export function validateAdoptBranch(
  repo: SwitchDirtyRepo,
  branch: string,
  lists: LocalBranchList | undefined,
  claims: readonly EdtBranchClaim[] = [],
): string | null {
  if (repo.currentBranch === 'HEAD') {
    return RESOLUTION_ERRORS.detachedHead;
  }
  if (repo.sharedBranch === null) {
    return RESOLUTION_ERRORS.unreadableManifest;
  }
  const name = branch.trim();
  if (name === '') {
    return OVERRIDE_BOX_ERRORS.nameRequired;
  }
  // The repo's own manifest-defined set (protectedBranches ∪ sharedBranch).
  if (isProtectedTarget(name, { sharedBranch: repo.sharedBranch, protectedBranches: repo.protectedBranches })) {
    return protectedNameError(name, repo.service);
  }
  const claim = claimOf(name, claims);
  if (claim !== undefined) {
    return claimedBranchError(claim.topic);
  }
  if (lists?.status === 'ready' && lists.branches.includes(name) && name !== repo.currentBranch) {
    return existingTargetError(name);
  }
  return null;
}

export function validateRow(row: ResolutionRow, localBranchesByPath: Readonly<Record<string, LocalBranchList>>): string | null {
  if (row.plan.kind === 'discard') {
    return null;
  }
  if (!row.hasOutgoing) {
    return RESOLUTION_ERRORS.noOutgoing;
  }
  return validateAdoptBranch(row.repo, row.plan.branch, localBranchesByPath[row.repo.repoPath], row.claims);
}

export function buildResolutions(rows: readonly ResolutionRow[]): Record<string, DirtyResolution> {
  const resolutions: Record<string, DirtyResolution> = {};
  for (const row of rows) {
    if (row.plan.kind === 'adopt') {
      resolutions[row.repo.repoPath] = { kind: 'adopt', branch: row.plan.branch };
    } else {
      // Pins the discard to the files the confirmation listed — core refuses it if the fresh
      // capture holds anything else.
      const paths = row.repo.dirtyPaths;
      resolutions[row.repo.repoPath] = paths !== undefined ? { kind: 'discard', confirmedPaths: [...paths] } : { kind: 'discard' };
    }
  }
  return resolutions;
}

// The row whose error the detail line spells out: the one under the cursor when it is
// invalid, otherwise the first invalid row.
export function blockedRow(
  rows: readonly ResolutionRow[],
  lists: Readonly<Record<string, LocalBranchList>>,
  cursor: number,
): { row: ResolutionRow; error: string } | undefined {
  const focused = rows[cursor];
  const focusedError = focused !== undefined ? validateRow(focused, lists) : null;
  if (focused !== undefined && focusedError !== null) {
    return { row: focused, error: focusedError };
  }
  for (const row of rows) {
    const error = validateRow(row, lists);
    if (error !== null) {
      return { row, error };
    }
  }
  return undefined;
}

// ---- The "Configure <service>" box --------------------------------------------------------

export function boxLines(box: Pick<SwitchResolutionBox, 'action'>): SwitchResolutionBoxLine[] {
  return box.action === 'adopt' ? ['action', 'branch', 'apply'] : ['action', 'apply'];
}

// Opens the box on a row: its action is the row's current plan; its branch field is always
// pre-filled with the row's computed adopt target.
export function openResolutionBox(row: ResolutionRow, globalName: string): SwitchResolutionBox {
  const branch = row.plan.kind === 'adopt' ? row.plan.branch : globalAdoptTarget(row.repo, globalName, row.claims);
  return {
    repoPath: row.repo.repoPath,
    action: row.hasOutgoing ? row.plan.kind : 'discard',
    line: 'action',
    editing: false,
    branch: { value: branch, cursor: branch.length },
    error: null,
  };
}

// The box's live inline error (null when Apply would be accepted).
export function boxError(box: SwitchResolutionBox, row: ResolutionRow, lists: LocalBranchList | undefined): string | null {
  if (box.action === 'discard') {
    return null;
  }
  if (!row.hasOutgoing) {
    return RESOLUTION_ERRORS.noOutgoing;
  }
  return validateAdoptBranch(row.repo, box.branch.value, lists, row.claims);
}

type BoxKeyResult =
  | { type: 'update'; box: SwitchResolutionBox }
  | { type: 'close' }
  | { type: 'revert' }
  | { type: 'apply'; override: ResolutionOverride };

function nextBoxLine(box: SwitchResolutionBox): SwitchResolutionBoxLine {
  const lines = boxLines(box);
  return lines[Math.min(lines.indexOf(box.line) + 1, lines.length - 1)] ?? 'apply';
}

function isCtrl(input: string, key: TextEditKey, letter: string): boolean {
  return key.ctrl === true && input.toLowerCase() === letter;
}

export function reduceResolutionBoxKey(
  box: SwitchResolutionBox,
  row: ResolutionRow,
  lists: LocalBranchList | undefined,
  input: string,
  key: TextEditKey,
): BoxKeyResult {
  if (isCtrl(input, key, 'r')) {
    return { type: 'revert' };
  }
  if (box.editing) {
    if (key.escape) {
      return { type: 'update', box: { ...box, editing: false } };
    }
    if (key.return) {
      return { type: 'update', box: { ...box, editing: false, line: nextBoxLine(box) } };
    }
    const branch = nextTextInputValue(box.branch, input, key);
    return { type: 'update', box: { ...box, branch, error: branch.value !== box.branch.value ? null : box.error } };
  }
  if (key.escape) {
    return { type: 'close' };
  }
  const moved = moveBoxLine(boxLines(box), box.line, input, key);
  if (moved !== null) {
    return { type: 'update', box: { ...box, line: moved } };
  }
  if (box.line === 'action') {
    if (input === ' ' || key.leftArrow || key.rightArrow) {
      // With no outgoing EDT only Discard is offered.
      return row.hasOutgoing ? { type: 'update', box: { ...box, action: box.action === 'adopt' ? 'discard' : 'adopt', error: null } } : { type: 'update', box };
    }
    return { type: 'update', box: key.return ? { ...box, line: nextBoxLine(box) } : box };
  }
  if (box.line === 'branch') {
    return { type: 'update', box: key.return ? { ...box, editing: true, error: null } : box };
  }
  // [ Apply ]
  if (!key.return) {
    return { type: 'update', box };
  }
  const error = boxError(box, row, lists);
  if (error !== null) {
    return { type: 'update', box: { ...box, error } };
  }
  return { type: 'apply', override: box.action === 'adopt' ? { kind: 'adopt', branch: box.branch.value.trim() } : { kind: 'discard' } };
}

// ---- The main reducer ----------------------------------------------------------------------
//   - Panel A "GLOBAL STRATEGY" (focused on open): the default action, Adopt into <outgoing
//     topic> or Discard (`Space`/`←→`), plus, when Adopt, the global branch name (pre-filled
//     with the outgoing topic's slug) applied to every row on a SHARED branch. With no outgoing
//     EDT only Discard is offered.
//   - Panel B "AFFECTED SERVICES": one row per dirty state-2/3 service; `Enter` opens the
//     "Configure <service>" box, `[ Apply ]` makes the row Custom (or Discard), `Ctrl+R`
//     returns it to the global strategy.
//   - `Ctrl+N` confirms: blocked while any row is invalid; with any Discard row it first opens
//     the discard confirmation (files per service, default back, `Ctrl+E` confirms).
//   - `Esc` closes the innermost element first (a field in edit, the box, the confirmation); on
//     the main view it cancels the whole switch.

function withRowsChanged(prev: SwitchResolutionState, next: SwitchResolutionState): SwitchResolutionState {
  const changed =
    next.globalAction !== prev.globalAction || next.globalName.value !== prev.globalName.value || next.overrides !== prev.overrides;
  return changed ? { ...next, error: null } : next;
}

export function reduceSwitchResolutionKey(
  state: SwitchResolutionState,
  dirty: readonly SwitchDirtyRepo[],
  input: string,
  key: TextEditKey,
): SwitchResolutionState {
  if (state.decision !== null) {
    return state;
  }
  const global = globalOf(state);
  const rows = buildRows(dirty, global);

  // The discard confirmation: default is back; only Ctrl+E confirms.
  if (state.confirm !== null) {
    if (isCtrl(input, key, 'e')) {
      const unlisted = rows.find((row) => row.plan.kind === 'discard' && row.repo.dirtyPaths === undefined);
      if (unlisted !== undefined) {
        return { ...state, confirm: { ...state.confirm, error: unlistedDiscardError(unlisted.repo.service) } };
      }
      return { ...state, decision: { kind: 'proceed', resolutions: buildResolutions(rows) } };
    }
    if (key.escape || key.return) {
      return { ...state, confirm: null };
    }
    if (key.upArrow || key.downArrow) {
      // One line per discarded service plus one per file (the view's discardConfirmLines).
      const lineCount = rows
        .filter((row) => row.plan.kind === 'discard')
        .reduce((total, row) => total + 1 + (row.repo.dirtyPaths?.length ?? 0), 0);
      const scroll = Math.min(Math.max(state.confirm.scroll + (key.downArrow ? 1 : -1), 0), Math.max(lineCount - 1, 0));
      return { ...state, confirm: { ...state.confirm, scroll } };
    }
    return state;
  }

  // The box owns every key while open.
  const box = state.box;
  if (box !== null) {
    const boxRow = rows.find((row) => row.repo.repoPath === box.repoPath);
    if (boxRow === undefined) {
      return { ...state, box: null };
    }
    const result = reduceResolutionBoxKey(box, boxRow, state.lists[box.repoPath], input, key);
    if (result.type === 'update') {
      return { ...state, box: result.box };
    }
    if (result.type === 'close') {
      return { ...state, box: null };
    }
    if (result.type === 'revert') {
      const overrides = { ...state.overrides };
      delete overrides[box.repoPath];
      return withRowsChanged(state, { ...state, overrides, box: null });
    }
    return withRowsChanged(state, { ...state, overrides: { ...state.overrides, [box.repoPath]: result.override }, box: null });
  }

  if (isCtrl(input, key, 'n')) {
    if (rows.some((row) => validateRow(row, state.lists) !== null)) {
      return { ...state, editing: false, error: RESOLUTION_ERRORS.blocked };
    }
    if (rows.some((row) => row.plan.kind === 'discard')) {
      return { ...state, editing: false, confirm: { scroll: 0, error: null } };
    }
    return { ...state, editing: false, decision: { kind: 'proceed', resolutions: buildResolutions(rows) } };
  }

  const panelStep = resolveFocusStep(input, key, 'tab');
  if (panelStep !== null) {
    return { ...state, panel: stepFocus(TWO_PANEL_NAV.stops, state.panel, panelStep), editing: false };
  }

  if (state.panel === 'global') {
    if (state.editing) {
      if (key.escape || key.return) {
        return { ...state, editing: false };
      }
      const next = nextTextInputValue(state.globalName, input, key);
      const touched = next.value !== state.globalName.value ? true : state.globalNameTouched;
      return withRowsChanged(state, { ...state, globalName: next, globalNameTouched: touched });
    }
    if (key.escape) {
      return { ...state, decision: { kind: 'cancel' } };
    }
    if (key.upArrow || key.downArrow) {
      const globalLine = key.downArrow && state.globalAction === 'adopt' ? 'name' : 'action';
      return { ...state, globalLine };
    }
    if (state.globalLine === 'action') {
      if (input === ' ' || key.leftArrow || key.rightArrow) {
        if (!global.hasOutgoing) {
          return state;
        }
        return withRowsChanged(state, { ...state, globalAction: state.globalAction === 'adopt' ? 'discard' : 'adopt' });
      }
      if (key.return && state.globalAction === 'adopt') {
        return { ...state, globalLine: 'name' };
      }
      return state;
    }
    return key.return ? { ...state, editing: true } : state;
  }

  // Panel B.
  if (key.escape) {
    return { ...state, decision: { kind: 'cancel' } };
  }
  if (key.upArrow || key.downArrow) {
    const rowCursor = Math.min(Math.max(state.rowCursor + (key.downArrow ? 1 : -1), 0), Math.max(rows.length - 1, 0));
    return { ...state, rowCursor };
  }
  if (key.return) {
    const row = rows[state.rowCursor];
    return row === undefined ? state : { ...state, box: openResolutionBox(row, state.globalName.value) };
  }
  return state;
}

// ---- Results & logging -----------------------------------------------------------------------

// How many discarded paths the log lists per service before summarizing the rest.
export const LOGGED_DISCARDED_PATHS = 20;

function loggedPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, LOGGED_DISCARDED_PATHS).join(', ');
  return paths.length > LOGGED_DISCARDED_PATHS ? `${shown} (+${paths.length - LOGGED_DISCARDED_PATHS} more)` : shown;
}

// The dialog stays open on a results summary when anything beyond a plain switch happened.
export function needsResultsView(results: readonly SwitchEdtRepoResult[]): boolean {
  return results.some((row) => row.outcome !== 'switched');
}

// The action-log detail: adopted branches and discarded paths.
export function describeSwitchForLog(targetTopic: string, forced: boolean, results: readonly SwitchEdtRepoResult[]): string {
  const parts = [`Switched to EDT "${targetTopic}"${forced ? ' (forced)' : ''}`];
  const adopted = results
    .filter((row) => row.outcome === 'adopted')
    .map((row) => `${row.service} → ${row.detail?.adoptedBranch ?? '?'}`);
  if (adopted.length > 0) {
    parts.push(`adopted: ${adopted.join(', ')}`);
  }
  const discarded = results
    .filter((row) => row.outcome === 'discarded')
    .map((row) => `${row.service} (${loggedPaths(row.detail?.discardedPaths ?? [])})`);
  if (discarded.length > 0) {
    parts.push(`discarded: ${discarded.join('; ')}`);
  }
  const failed = results.filter((row) => row.outcome === 'failed').map((row) => `${row.service}: ${row.detail?.message ?? 'Failed'}`);
  if (failed.length > 0) {
    parts.push(`failed: ${failed.join('; ')}`);
  }
  return parts.join(' — ');
}
