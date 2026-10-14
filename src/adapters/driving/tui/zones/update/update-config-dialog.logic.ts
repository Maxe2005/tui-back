// tui/zones/update: pure logic for the pre-run configuration screen every group-update trigger
// opens before any git/docker action — a service checklist pre-selected per trigger scope, a
// per-service source branch defaulting to the manifest `sharedBranch`, and two run-wide toggles
// (migrate ON, clean restart OFF). Deselecting excludes a service entirely; confirming with
// zero selected is rejected inline. Every keystroke behavior is a pure, unit-tested function.
import { DEFAULT_SETTINGS, type Settings } from '../../../../../core/ports/settings.js';
import type { GroupUpdateScope, GroupUpdateSelectionItem } from '../../../../../core/scripts/group-update.js';
import type { SharedTypesMode } from '../../../../../core/shared-types/smart-update.js';
import type { MergeSourceError, MergeSourceOrigin, MergeSourceRow } from '../../../../../core/scripts/resolve-merge-sources.js';
import type { TextEditKey, TextInputState } from '../../shared/components/text-edit.js';
import type { BranchAutocompleteState } from '../../shared/components/branch-autocomplete-input.js';

export type { TextInputState, TextEditKey };
export type { BranchAutocompleteState };

// One configured service row — `sourceBranch` is the confirmed merge source for this
// service (pre-filled from the manifest `sharedBranch`, editable per row).
export interface UpdateConfigRow {
  service: string;
  repoPath: string;
  sourceBranch: string;
  // The manifest `sharedBranch`: what the row follows under the shared strategy and what
  // the manual editor is pre-filled with.
  sharedBranch: string;
  origin: MergeSourceOrigin;
  // Set while a from-EDT row cannot resolve; blocks the run only when the row is selected.
  sourceError?: RowSourceError;
  selected: boolean;
  // What the manifest declares: an undeclared action can never run, whatever is asked.
  migrationDeclared: boolean;
  recipeDeclared: boolean;
  // Per-service answers to the two run-wide toggles.
  migrations: ToggleOverride;
  cleanRestart: ToggleOverride;
}

export type RowSourceError = MergeSourceError | 'no-edt-chosen';
export type ToggleOverride = 'follow' | 'off' | 'on';

// Where non-manual rows take their source from: each manifest `sharedBranch`, or the
// branch recorded for the service in another EDT. `resolved` is that EDT's resolution,
// kept so a manual row can be reset without re-reading git.
export type MergeStrategy =
  | { kind: 'shared' }
  // From EDT selected but no EDT picked yet: every row is blocked until one is.
  | { kind: 'edt-pending' }
  | { kind: 'edt'; ulid: string; topic: string; resolved: MergeSourceRow[] };

// `simple`: the plain checklist (single-service config). `edt-panels`/`all-panels`: the two
// panels — the merge-source lines exist only in EDT scope.
export type ConfigLayout = 'service-panels' | 'edt-panels' | 'all-panels';

// The store-owned draft (live run state lives in Zustand): the run `scope`, one row per
// targeted service, the two run-wide toggles, and the current inline `error` (null when
// the draft validates). The keyboard cursor and the in-progress branch edit are zone-local
// `useState` (see UpdateConfigViewState) — never store state.
export interface UpdateConfigDraft {
  scope: GroupUpdateScope;
  rows: UpdateConfigRow[];
  runMigrations: boolean;
  cleanRestart: boolean;
  error: string | null;
  layout: ConfigLayout;
  strategy: MergeStrategy;
  // Run-wide `shared-types` handling (per run, never persisted). The row exists only when the
  // active EDT has exactly one source repo and it is one of this draft's rows: that row's
  // repoPath, else null (row hidden, mode forced off).
  sharedTypes: SharedTypesMode;
  sharedTypesSource: string | null;
}

export interface UpdateConfigRowInput {
  service: string;
  repoPath: string;
  sourceBranch: string;
  migrationDeclared?: boolean;
  recipeDeclared?: boolean;
}

// The run-wide starting values, taken from `settings.update` (per-run edits never go back).
export type UpdateConfigGlobalDefaults = Pick<Settings['update'], 'runMigrations' | 'cleanRestart' | 'mergeSource'>;

// Every targeted service starts pre-selected with its branch pre-filled (rows always `follow`
// the globals); the globals start from `options.defaults` — migrate ON / clean restart OFF /
// shared when absent.
export function createUpdateConfigDraft(
  scope: GroupUpdateScope,
  rows: readonly UpdateConfigRowInput[],
  options: { layout?: ConfigLayout; sharedTypesSource?: string | null; defaults?: UpdateConfigGlobalDefaults } = {},
): UpdateConfigDraft {
  const defaults = options.defaults ?? DEFAULT_SETTINGS.update;
  const draft: UpdateConfigDraft = {
    scope,
    rows: rows.map((row) => ({
      service: row.service,
      repoPath: row.repoPath,
      sourceBranch: row.sourceBranch,
      sharedBranch: row.sourceBranch,
      origin: 'shared',
      selected: true,
      migrationDeclared: row.migrationDeclared ?? true,
      recipeDeclared: row.recipeDeclared ?? true,
      migrations: 'follow',
      cleanRestart: 'follow',
    })),
    runMigrations: defaults.runMigrations,
    cleanRestart: defaults.cleanRestart,
    error: null,
    layout: options.layout ?? 'service-panels',
    strategy: { kind: 'shared' },
    sharedTypes: 'off',
    sharedTypesSource: options.sharedTypesSource ?? null,
  };
  // The merge-source line exists only in the EDT layout: a persisted `edt-pending` default
  // opens it on From EDT with no EDT picked yet (every non-manual row blocked until one is).
  return defaults.mergeSource === 'edt-pending' && draft.layout === 'edt-panels'
    ? applyMergeStrategy(draft, { kind: 'edt-pending' })
    : draft;
}

// Re-resolves every non-manual row under `strategy`; manual rows keep their branch. Rows
// the chosen EDT cannot resolve get an empty source plus the reason.
export function applyMergeStrategy(draft: UpdateConfigDraft, strategy: MergeStrategy): UpdateConfigDraft {
  return {
    ...draft,
    strategy,
    rows: draft.rows.map((row) => (row.origin === 'manual' ? row : followStrategy(row, strategy))),
    error: null,
  };
}

function followStrategy(row: UpdateConfigRow, strategy: MergeStrategy): UpdateConfigRow {
  const { sourceError: _dropped, ...rest } = row;
  if (strategy.kind === 'shared') {
    return { ...rest, sourceBranch: row.sharedBranch, origin: 'shared' };
  }
  if (strategy.kind === 'edt-pending') {
    return { ...rest, sourceBranch: '', origin: 'edt', sourceError: 'no-edt-chosen' };
  }
  const resolved = strategy.resolved.find((candidate) => candidate.repoPath === row.repoPath);
  return {
    ...rest,
    sourceBranch: resolved?.source ?? '',
    origin: 'edt',
    ...(resolved?.error !== undefined ? { sourceError: resolved.error } : {}),
  };
}

export type ConfirmedUpdateConfig = {
  scope: GroupUpdateScope;
  selection: GroupUpdateSelectionItem[];
  runMigrations: boolean;
  cleanRestart: boolean;
  // Present only when the phase applies: not `off` and the source repo is a selected row.
  sharedTypes?: SharedTypesMode;
  sharedTypesSource?: string | null;
};

// Confirms the draft into the exact configuration the run starts with: every selected
// service plus its branch, and the two uniform toggles. Zero selected is rejected with an
// explicit message (the screen stays open — the caller keeps the dialog mounted); so is a
// blank branch on any selected row (unreachable through the editor above, which rejects
// blanks at commit, but never trusted blindly).
export function confirmUpdateConfigDraft(
  draft: UpdateConfigDraft,
): { ok: true; config: ConfirmedUpdateConfig } | { ok: false; error: string } {
  const selected = draft.rows.filter((row) => row.selected);
  if (selected.length === 0) {
    return { ok: false, error: 'No services selected — select at least one service before starting the run.' };
  }
  const unresolved = selected.filter((row) => row.sourceError !== undefined);
  if (unresolved.length > 0) {
    const names = unresolved.map((row) => row.service).join(', ');
    return { ok: false, error: `Unresolved merge source for: ${names} — pick a branch or deselect.` };
  }
  for (const row of selected) {
    if (row.sourceBranch.trim() === '') {
      return { ok: false, error: `Service "${row.service}" has an empty source branch — enter a branch or deselect it.` };
    }
  }
  // The phase applies only while the source repo is one of the selected rows.
  const sharedTypesActive =
    draft.sharedTypes !== 'off' && draft.sharedTypesSource !== null && selected.some((row) => row.repoPath === draft.sharedTypesSource);
  return {
    ok: true,
    config: {
      scope: draft.scope,
      selection: selected.map((row) => ({
        service: row.service,
        repoPath: row.repoPath,
        sourceBranch: row.sourceBranch,
        ...(row.migrations !== 'follow' ? { runMigrations: row.migrations === 'on' } : {}),
        ...(row.cleanRestart !== 'follow' ? { cleanRestart: row.cleanRestart === 'on' } : {}),
      })),
      runMigrations: draft.runMigrations,
      cleanRestart: draft.cleanRestart,
      ...(sharedTypesActive ? { sharedTypes: draft.sharedTypes, sharedTypesSource: draft.sharedTypesSource } : {}),
    },
  };
}
