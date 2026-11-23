// tui/store/slices: the Update slice's pre-run configuration — opening the config screen for
// an EDT / all-repos / single-service target, editing its draft, the `:update-service` entry
// points and quick-pick, and confirming the draft into a run.
//
// Over the ~400-line target (~535 lines): the open-target helpers, the quick-pick and the
// draft actions share the same guards and `failConfigOpen` posture, so splitting them further
// would only scatter one flow across files.
import { resolve } from 'node:path';
import { err, ok, type Result } from '../../../../../../../core/result.js';
import type { GroupUpdateScope } from '../../../../../../../core/scripts/group-update.js';
import { loadMergeSourcesFromEdt } from '../../../../../../../core/scripts/update-support/resolve-merge-sources.js';
import { resolveSingleSourceOf } from '../../shared-types/shared-types-slice.js';
import {
  applyMergeStrategy,
  confirmUpdateConfigDraft,
  createUpdateConfigDraft,
  type ConfigLayout,
  type UpdateConfigRowInput,
  type UpdateConfigDraft,
} from '../../../../zones/update/config/update-config-dialog.logic.js';
import {
  parseUpdateServiceArg,
  type OpenUpdateConfigTarget,
  type UpdateSlice,
  type UpdateSliceContext,
  type UpdateSliceGet,
  type UpdateSliceSet,
} from '../update-slice.types.js';

export function createUpdateConfigActions(
  ctx: UpdateSliceContext,
  set: UpdateSliceSet,
  get: UpdateSliceGet,
): Pick<
  UpdateSlice,
  | 'updateConfig'
  | 'updateServiceSelectRequest'
  | 'updateServicePick'
  | 'openUpdateConfig'
  | 'openUpdateServiceDialog'
  | 'clearUpdateServiceSelectionRequest'
  | 'openUpdateServicePick'
  | 'closeUpdateServicePick'
  | 'setUpdateConfig'
  | 'listMergeSourceEdts'
  | 'chooseMergeSourceEdt'
  | 'closeUpdateConfig'
  | 'confirmUpdateConfig'
> {
  const { deps } = ctx;
  // Resolves one repo's branch default for the config screen — the manifest
  // `sharedBranch`, falling back to the schema default (`development`) when the manifest
  // fails to load so the row still renders and the run itself reports the load failure
  // as that service's `failed` row.
  async function resolveBranchDefault(repoPath: string): Promise<string> {
    return (await resolveRowManifest(repoPath)).sourceBranch;
  }

  // What one row needs from its manifest: the shared branch plus whether the migration
  // command and the clean-restart recipe are declared (an undeclared action never runs).
  async function resolveRowManifest(
    repoPath: string,
  ): Promise<{ sourceBranch: string; migrationDeclared: boolean; recipeDeclared: boolean }> {
    const loaded = deps ? await deps.manifest.load(repoPath) : null;
    if (loaded === null || !loaded.ok) {
      // Unreadable manifest: claim nothing (the run reports the load failure on its own row).
      return { sourceBranch: 'development', migrationDeclared: false, recipeDeclared: false };
    }
    return {
      sourceBranch: loaded.data.sharedBranch,
      migrationDeclared: (loaded.data.migrationCommand?.trim() ?? '') !== '',
      recipeDeclared: (loaded.data.restartCommands?.length ?? 0) > 0,
    };
  }

  function failConfigOpen(code: string, message: string): void {
    set({ updateStatus: 'error', updateError: message, updateErrorCode: code });
  }

  // Opens the screen over a clean banner: a stale `done`/`error` outcome from the previous
  // run must not linger underneath the new configuration. Per-run history
  // (`updateResults`, `lastServiceOutcomes`) is kept — only the banner fields reset.
  // The `shared-types` row exists only when the active EDT has exactly one source repo and it
  // is one of the rows: that row's repoPath, else null (row hidden).
  async function resolveSharedTypesSource(rows: readonly UpdateConfigRowInput[]): Promise<string | null> {
    try {
      const resolved = await resolveSingleSourceOf(deps);
      if (!resolved.ok) {
        return null;
      }
      const wanted = resolve(resolved.source.repoPath);
      return rows.find((row) => resolve(row.repoPath) === wanted)?.repoPath ?? null;
    } catch {
      return null;
    }
  }

  async function openConfigDraft(
    scope: GroupUpdateScope,
    rows: UpdateConfigRowInput[],
    options?: { layout?: ConfigLayout },
  ): Promise<void> {
    const sharedTypesSource = await resolveSharedTypesSource(rows);
    set({
      updateConfig: createUpdateConfigDraft(scope, rows, {
        ...options,
        sharedTypesSource,
        defaults: get().settings.update,
      }),
      updateStatus: 'idle',
      updateError: null,
      updateErrorCode: null,
      updateNote: null,
    });
  }

  // Pre-scopes the screen to the active EDT's members (deduped by resolved
  // repoPath, first wins — the core use-case's own rule).
  async function openEdtConfig(): Promise<void> {
    if (!deps) {
      return;
    }
    const currentActive = await deps.state.readActiveEdt();
    if (!currentActive.ok) {
      failConfigOpen(currentActive.error.code, currentActive.error.message);
      return;
    }
    if (currentActive.data === null) {
      failConfigOpen('no-active-edt', 'No active EDT — switch to an EDT before running tui-back update');
      return;
    }
    const listed = await deps.edtRegistry.list();
    if (!listed.ok) {
      failConfigOpen(listed.error.code, listed.error.message);
      return;
    }
    const active = listed.data.find((candidate) => candidate.ulid === currentActive.data);
    if (active === undefined) {
      failConfigOpen('edt-not-found', `Active EDT "${currentActive.data}" is no longer registered`);
      return;
    }
    const seen = new Set<string>();
    const members = active.members.filter((member) => {
      const key = resolve(member.repoPath);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    const rows = [];
    for (const member of members) {
      rows.push({ service: member.service, repoPath: member.repoPath, ...(await resolveRowManifest(member.repoPath)) });
    }
    if (rows.length === 0) {
      failConfigOpen('no-services-selected', `EDT "${active.topic}" has no member services — nothing to update.`);
      return;
    }
    await openConfigDraft('edt', rows, { layout: 'edt-panels' });
  }

  // The managed-repo enumeration shared by openAllReposConfig and
  // openUpdateServicePick (one definition so the all-repos config and the service
  // quick-pick can never list different services): the list-repos posture — unmanaged
  // paths silently skipped; any other load failure still yields a row under its
  // path-basename service so the run reports it instead of dropping it silently;
  // deduped by resolved repoPath, first wins.
  async function listManagedServiceRows(): Promise<
    { ok: true; rows: { service: string; repoPath: string; sourceBranch: string }[] } | { ok: false; code: string; message: string }
  > {
    if (!deps) {
      return { ok: false, code: 'store-not-wired', message: 'No ports wired into the TUI store' };
    }
    const listed = await deps.registry.list();
    if (!listed.ok) {
      return { ok: false, code: listed.error.code, message: listed.error.message };
    }
    const seen = new Set<string>();
    const paths = listed.data
      .filter((candidate) => candidate.trim() !== '')
      .filter((candidate) => {
        const key = resolve(candidate);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    const rows = [];
    for (const repoPath of paths) {
      const loaded = await deps.manifest.load(repoPath);
      if (!loaded.ok) {
        if (loaded.error.code === 'manifest-not-found') {
          continue;
        }
        const base = repoPath.split('/').pop();
        rows.push({ service: base !== undefined && base !== '' ? base : repoPath, repoPath, sourceBranch: 'development' });
        continue;
      }
      rows.push({ service: loaded.data.service, repoPath, ...(await resolveRowManifest(repoPath)) });
    }
    return { ok: true, rows };
  }

  // Pre-scopes the screen to every managed repo (the list-repos posture:
  // unmanaged paths silently skipped; any other load failure still renders a row under
  // its path-basename service so the run reports it instead of dropping it silently).
  async function openAllReposConfig(): Promise<void> {
    const enumerated = await listManagedServiceRows();
    if (!enumerated.ok) {
      // An unwired store degrades to the same explicit error state openUpdateConfig's
      // own guard reports — never a throw, never a screen.
      failConfigOpen(enumerated.code, enumerated.message);
      return;
    }
    if (enumerated.rows.length === 0) {
      failConfigOpen('no-services-selected', 'No managed repos found — nothing to update.');
      return;
    }
    await openConfigDraft('all', enumerated.rows, { layout: 'all-panels' });
  }

  // The reusable pre-scoped entry point (the single-service update reuses it): exactly one
  // row. An explicit `repoPath` pins the repo directly; otherwise the service resolves
  // through the active EDT's members first, then every managed repo. The run scope follows
  // where the service was found.
  async function openSingleServiceConfig(service: string, repoPath?: string): Promise<void> {
    if (!deps) {
      return;
    }
    if (repoPath !== undefined) {
      const loaded = await deps.manifest.load(repoPath);
      if (!loaded.ok) {
        failConfigOpen(loaded.error.code, loaded.error.message);
        return;
      }
      const scope = await scopeForRepoPath(repoPath);
      if (!scope.ok) {
        failConfigOpen(scope.error.code, scope.error.message);
        return;
      }
      await openConfigDraft(scope.data, [
        { service: loaded.data.service, repoPath, sourceBranch: loaded.data.sharedBranch },
      ]);
      return;
    }
    const currentActive = await deps.state.readActiveEdt();
    if (currentActive.ok && currentActive.data !== null) {
      const listed = await deps.edtRegistry.list();
      if (!listed.ok) {
        failConfigOpen(listed.error.code, listed.error.message);
        return;
      }
      const active = listed.data.find((candidate) => candidate.ulid === currentActive.data);
      const wanted = service.toLowerCase();
      const member = active?.members.find((candidate) => candidate.service.toLowerCase() === wanted);
      if (member !== undefined) {
        await openConfigDraft('edt', [
          { service: member.service, repoPath: member.repoPath, sourceBranch: await resolveBranchDefault(member.repoPath) },
        ]);
        return;
      }
    }
    const registered = await deps.registry.list();
    if (!registered.ok) {
      failConfigOpen(registered.error.code, registered.error.message);
      return;
    }
    for (const candidate of registered.data) {
      if (candidate.trim() === '') {
        continue;
      }
      const loaded = await deps.manifest.load(candidate);
      if (loaded.ok && loaded.data.service.toLowerCase() === service.toLowerCase()) {
        await openConfigDraft('all', [
          { service: loaded.data.service, repoPath: candidate, sourceBranch: loaded.data.sharedBranch },
        ]);
        return;
      }
    }
    failConfigOpen('service-not-found', `Service "${service}" is neither a member of the active EDT nor a managed repo`);
  }

  // The run scope for a pinned repoPath: `edt` when it is a member of the active EDT,
  // `all` otherwise (the core use-case's unexpected-branch gate only applies under `edt`).
  // A null active pointer still resolves to `all` (no EDT to gate against), but a failing
  // state read or registry list rejects the open with the underlying error instead of
  // silently downgrading the gate away.
  async function scopeForRepoPath(repoPath: string): Promise<Result<GroupUpdateScope>> {
    if (!deps) {
      return err('internal-error', 'No ports wired into the TUI store');
    }
    const currentActive = await deps.state.readActiveEdt();
    if (!currentActive.ok) {
      return err(currentActive.error.code, currentActive.error.message);
    }
    if (currentActive.data === null) {
      return ok('all');
    }
    const listed = await deps.edtRegistry.list();
    if (!listed.ok) {
      return err(listed.error.code, listed.error.message);
    }
    const active = listed.data.find((candidate) => candidate.ulid === currentActive.data);
    const wanted = resolve(repoPath);
    return ok(active !== undefined && active.members.some((member) => resolve(member.repoPath) === wanted) ? 'edt' : 'all');
  }

  return {
    updateConfig: null,
    updateServiceSelectRequest: false,
    updateServicePick: null,
    openUpdateConfig: async (target: OpenUpdateConfigTarget) => {
      if (!deps || !deps.container || !deps.migration || !deps.restart) {
        set({
          updateStatus: 'error',
          updateError: 'No ports wired into the TUI store',
          updateErrorCode: 'store-not-wired',
        });
        return;
      }
      if (get().updateStatus === 'running') {
        // The in-flight run keeps its `running` status — a rejected trigger only raises a notice.
        set({ updateNotice: { code: 'update-already-running', message: 'A group update is already in progress — wait for it to finish before starting another.' } });
        return;
      }
      if (Object.keys(get().serviceRestartInFlight).length > 0) {
        set({
          updateStatus: 'error',
          updateError: 'A service restart is already in progress — wait for it to finish before starting a group update.',
          updateErrorCode: 'update-already-running',
        });
        return;
      }
      if (typeof target === 'string') {
        if (target === 'all') {
          await openAllReposConfig();
        } else {
          await openEdtConfig();
        }
        return;
      }
      await openSingleServiceConfig(target.service, target.repoPath);
    },
    openUpdateServiceDialog: async (fullQuery: string) => {
      if (!deps || !deps.container || !deps.migration || !deps.restart) {
        set({
          updateStatus: 'error',
          updateError: 'No ports wired into the TUI store',
          updateErrorCode: 'store-not-wired',
        });
        return;
      }
      if (get().updateStatus === 'running') {
        // The in-flight run keeps its `running` status — a rejected trigger only raises a notice.
        set({ updateNotice: { code: 'update-already-running', message: 'A group update is already in progress — wait for it to finish before starting another.' } });
        return;
      }
      if (Object.keys(get().serviceRestartInFlight).length > 0) {
        set({
          updateStatus: 'error',
          updateError: 'A service restart is already in progress — wait for it to finish before starting a group update.',
          updateErrorCode: 'update-already-running',
        });
        return;
      }
      const service = parseUpdateServiceArg(fullQuery);
      if (service !== null) {
        // A previously raised no-arg request must not survive: the zone would consume it
        // into a second screen on top of this one.
        set({ updateServiceSelectRequest: false });
        await openSingleServiceConfig(service);
        return;
      }
      // No argument: the Update zone consumes this — its highlighted row pre-scopes the
      // config when one is selected, else the filterable service quick-pick opens.
      set({ updateServiceSelectRequest: true });
    },
    clearUpdateServiceSelectionRequest: () => {
      if (get().updateServiceSelectRequest) {
        set({ updateServiceSelectRequest: false });
      }
    },
    openUpdateServicePick: async () => {
      if (!deps || !deps.container || !deps.migration || !deps.restart) {
        set({
          updateStatus: 'error',
          updateError: 'No ports wired into the TUI store',
          updateErrorCode: 'store-not-wired',
        });
        return;
      }
      if (get().updateStatus === 'running') {
        // The in-flight run keeps its `running` status — a rejected trigger only raises a notice.
        set({ updateNotice: { code: 'update-already-running', message: 'A group update is already in progress — wait for it to finish before starting another.' } });
        return;
      }
      if (Object.keys(get().serviceRestartInFlight).length > 0) {
        set({
          updateStatus: 'error',
          updateError: 'A service restart is already in progress — wait for it to finish before starting a group update.',
          updateErrorCode: 'update-already-running',
        });
        return;
      }
      const generation = ++ctx.servicePickGeneration;
      const enumerated = await listManagedServiceRows();
      if (generation !== ctx.servicePickGeneration) {
        // Cancelled (or superseded by a newer open) while enumerating — never pop a
        // stale pick open over whatever the developer sees now.
        return;
      }
      if (!enumerated.ok) {
        failConfigOpen(enumerated.code, enumerated.message);
        return;
      }
      if (enumerated.rows.length === 0) {
        failConfigOpen('no-services-selected', 'No managed repos found — nothing to update.');
        return;
      }
      // Opening the pick runs no git/docker action and starts no run — like the config
      // screen, over a clean banner.
      set({
        updateServicePick: enumerated.rows.map((row) => ({ service: row.service, repoPath: row.repoPath })),
        updateStatus: 'idle',
        updateError: null,
        updateErrorCode: null,
        updateNote: null,
      });
    },
    closeUpdateServicePick: () => {
      ctx.servicePickGeneration += 1;
      if (get().updateServicePick !== null) {
        set({ updateServicePick: null });
      }
    },
    setUpdateConfig: (draft: UpdateConfigDraft) => {
      if (get().updateConfig === null) {
        return;
      }
      set({ updateConfig: draft });
    },
    listMergeSourceEdts: async () => {
      if (!deps) {
        return [];
      }
      const [active, listed] = await Promise.all([deps.state.readActiveEdt(), deps.edtRegistry.list()]);
      // Without a readable active EDT the one being updated could be offered as its own
      // source, so nothing is offered.
      if (!listed.ok || !active.ok) {
        return [];
      }
      return listed.data.filter((entry) => entry.ulid !== active.data).map((entry) => ({ ulid: entry.ulid, topic: entry.topic }));
    },
    chooseMergeSourceEdt: async (ulid: string) => {
      const draft = get().updateConfig;
      if (!deps || draft === null) {
        return;
      }
      const [listed, active] = await Promise.all([deps.edtRegistry.list(), deps.state.readActiveEdt()]);
      const source = listed.ok ? listed.data.find((entry) => entry.ulid === ulid) : undefined;
      if (source === undefined) {
        set({ updateConfig: { ...draft, error: 'The chosen EDT no longer exists.' } });
        return;
      }
      if (!active.ok || source.ulid === active.data) {
        set({ updateConfig: { ...draft, error: 'An EDT cannot be its own merge source.' } });
        return;
      }
      const resolved = await loadMergeSourcesFromEdt(deps.git, draft.rows, source);
      const current = get().updateConfig;
      // The resolution is dropped when the screen closed, changed layout or went back to
      // shared branches while git was being read — the developer's newer choice wins.
      if (!resolved.ok || current === null || current.layout !== draft.layout || current.strategy.kind === 'shared') {
        return;
      }
      set({ updateConfig: applyMergeStrategy(current, { kind: 'edt', ulid, topic: source.topic, resolved: resolved.data }) });
    },
    closeUpdateConfig: () => {
      set({ updateConfig: null });
    },
    confirmUpdateConfig: async () => {
      const draft = get().updateConfig;
      if (draft === null) {
        return;
      }
      if (get().updateStatus === 'running') {
        set({
          updateConfig: {
            ...draft,
            error: 'A group update is already in progress — wait for it to finish before starting another.',
          },
        });
        return;
      }
      if (Object.keys(get().serviceRestartInFlight).length > 0) {
        set({
          updateConfig: {
            ...draft,
            error: 'A service restart is already in progress — wait for it to finish before starting a group update.',
          },
        });
        return;
      }
      const confirmed = confirmUpdateConfigDraft(draft);
      if (!confirmed.ok) {
        set({ updateConfig: { ...draft, error: confirmed.error } });
        return;
      }
      const snapshot = draft;
      set({ updateConfig: null });
      await get().runGroupUpdate(confirmed.config.scope, {
        selection: confirmed.config.selection,
        runMigrations: confirmed.config.runMigrations,
        cleanRestart: confirmed.config.cleanRestart,
        ...(confirmed.config.sharedTypes !== undefined ? { sharedTypes: confirmed.config.sharedTypes, sharedTypesSource: confirmed.config.sharedTypesSource ?? null } : {}),
      });
      // A core pre-lock rejection (`unknown-branch`, `no-services-selected` — both are
      // only ever returned before any lock is taken, so nothing ran) restores the screen
      // with the message inline instead of destroying the confirmed selection, toggles,
      // and branch edits. The run banner resets to idle around it, mirroring the
      // zero-selection inline pattern above.
      const rejection = get().updateErrorCode;
      if (get().updateStatus === 'error' && (rejection === 'unknown-branch' || rejection === 'no-services-selected')) {
        set({
          updateConfig: { ...snapshot, error: get().updateError ?? 'The run was rejected before starting.' },
          updateStatus: 'idle',
          updateError: null,
          updateErrorCode: null,
          updateNote: null,
          updateScope: null,
          updateUlid: null,
        });
      }
    },
  };
}
