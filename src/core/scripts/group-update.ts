// core/scripts/group-update: the group-update use-case (story 3.1). Brings every member
// service of the active EDT up to date with its manifest sharedBranch and restarts its
// container, reporting one per-service row (`updated`/`skipped`/`failed`) — none silently
// absent. Mirrors core/edt/switch.ts's per-repo isolation: one repo's failure is a `failed`
// (or `skipped`) row, never aborts the others. Merge means `git merge`, never rebase; a
// second run with no intervening change is a safe no-op (idempotent rerun).
//
// Lock nesting order: the global `group-update` key first (cross-scope rejection, story 3.3
// included — a second trigger serializes on it), then `edt:<ulid>` (the switch-block
// precedent story 2.4 reserves: a switch away peeks this key). A lock-contention failure
// (`action-in-progress`) surfaces as `update-already-running`, never the raw lock code.
//
// Per-repo flow: `currentBranch` must equal the member's recorded branch (anything else
// is an `unexpected-branch` failure with no git write, no migration, and no restart) →
// dirty check (`skipped`) → equals `sharedBranch` ? `pull` : (`fetch` shared branch,
// `assertAllowedBranch` on the member branch, `mergeBranch`); on a `merge-conflict`
// (or a conflicting pull that leaves the repo mid-merge), `git merge --abort` restores
// the pre-run HEAD (abort cancels only the attempted merge, never developer work — full
// guided handling arrives in story 3.4). Story 3.2 inserts the migrate phase next (the
// manifest's `migrationCommand`, skipped without error when undeclared; a failure is a
// `migration-failed` row with no restart) → `container.restart`. Dirty worktrees are
// detected and reported only, never stashed or fixed.
import { basename, resolve } from 'node:path';
import { withActionLock } from '../locking.js';
import type { ContainerPort } from '../ports/container.js';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { MigrationPort } from '../ports/migration.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { err, ok, type Result, type ResultError } from '../result.js';

// The global run-in-flight key: every group-update trigger (EDT-scoped today, all-repos in
// story 3.3) serializes on it, so a second trigger is rejected, never queued or raced.
export const GROUP_UPDATE_LOCK_KEY = 'group-update';

export function edtUpdateLockKey(ulid: string): string {
  return `edt:${ulid}`;
}

export interface GroupUpdateRepoResult {
  service: string;
  outcome: 'updated' | 'skipped' | 'failed';
  detail?: { code: string; message: string };
}

export interface GroupUpdateData {
  ulid: string;
  topic: string;
  results: GroupUpdateRepoResult[];
  // Set only for the zero-member no-op — an explicit no-op message, never silent success.
  note?: string;
  scope: 'edt' | 'all';
}

export type GroupUpdateScope = 'edt' | 'all';

export interface GroupUpdateParams {
  edtRegistry: EdtRegistryPort;
  state: StatePort;
  manifest: ManifestPort;
  git: GitPort;
  container: ContainerPort;
  migration: MigrationPort;
  lock: LockPort;
  registry?: RegistryPort;
  scope?: GroupUpdateScope;
}

export async function groupUpdate(params: GroupUpdateParams): Promise<Result<GroupUpdateData>> {
  const { scope = 'edt' } = params;
  if (scope === 'all') {
    return groupUpdateAll(params);
  }
  return groupUpdateEdt(params);
}

async function groupUpdateAll(params: GroupUpdateParams): Promise<Result<GroupUpdateData>> {
  const { manifest, git, container, migration, lock, registry } = params;
  if (registry === undefined) {
    return err('internal-error', 'Registry port is required for an all-repos group update');
  }

  const listed = await registry.list();
  if (!listed.ok) {
    return listed;
  }

  // Dedupe by resolved path (first wins) — the same normalization the EDT path uses, so
  // trailing-slash/relative-segment variants of one repo still collapse. Blank entries
  // never reach the filesystem: resolving '' would target the process cwd.
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

  // Zero registry entries: explicit no-op before any lock is taken (nothing to serialize).
  if (paths.length === 0) {
    return ok({
      ulid: 'all',
      topic: 'all-repos',
      results: [],
      note: 'No managed repos found — nothing to update.',
      scope: 'all',
    });
  }

  const run = await withActionLock(lock, GROUP_UPDATE_LOCK_KEY, async () => {
    const results: GroupUpdateRepoResult[] = [];
    for (const repoPath of paths) {
      const loaded = await manifest.load(repoPath);
      if (!loaded.ok) {
        // Genuinely unmanaged — silently skipped, the list-repos manifest-not-found pattern.
        if (loaded.error.code === 'manifest-not-found') {
          continue;
        }
        results.push(failed(serviceFallback(repoPath), loaded.error));
        continue;
      }
      results.push(
        await updateWithLoadedManifest(loaded.data, git, container, migration, undefined, repoPath, loaded.data.service, undefined),
      );
    }
    // Every registered path was unmanaged — an explicit no-op, never silent success.
    if (results.length === 0) {
      return ok({
        ulid: 'all',
        topic: 'all-repos',
        results: [],
        note: 'No managed repos found — nothing to update.',
        scope: 'all' as const,
      });
    }
    return ok({ ulid: 'all', topic: 'all-repos', results, scope: 'all' as const });
  });
  if (!run.ok && run.error.code === 'action-in-progress') {
    return err(
      'update-already-running',
      'A group update is already in progress — wait for it to finish before starting another.',
    );
  }
  return run;
}

function serviceFallback(repoPath: string): string {
  const base = basename(repoPath);
  return base !== '' ? base : repoPath;
}

async function groupUpdateEdt(params: GroupUpdateParams): Promise<Result<GroupUpdateData>> {
  const { edtRegistry, state, manifest, git, container, migration, lock } = params;

  const currentActive = await state.readActiveEdt();
  if (!currentActive.ok) {
    return currentActive;
  }
  if (currentActive.data === null) {
    return err('no-active-edt', 'No active EDT — switch to an EDT before running tui-back update');
  }

  const listed = await edtRegistry.list();
  if (!listed.ok) {
    return listed;
  }
  const active = listed.data.find((candidate) => candidate.ulid === currentActive.data);
  if (active === undefined) {
    return err('edt-not-found', `Active EDT "${currentActive.data}" is no longer registered`);
  }

  // Zero-member scope is an explicit no-op message, never silent success — resolved before
  // any lock is taken since a no-op run writes nothing that needs serializing.
  if (active.members.length === 0) {
    return ok({
      ulid: active.ulid,
      topic: active.topic,
      results: [],
      note: `EDT "${active.topic}" has no member services — nothing to update.`,
      scope: 'edt' as const,
    });
  }

  const run = await withActionLock(lock, GROUP_UPDATE_LOCK_KEY, () =>
    withActionLock(lock, edtUpdateLockKey(active.ulid), async () => {
      // Duplicate repoPath entries in one EDT would be merged/restarted twice — dedupe by
      // repoPath (first wins) before the loop so every targeted repo is touched exactly
      // once. Paths are resolved before comparing, the same normalization switch.ts uses,
      // so trailing-slash/relative-segment variants of one repo still collapse.
      const seen = new Set<string>();
      const members = active.members.filter((member) => {
        const key = resolve(member.repoPath);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      const results: GroupUpdateRepoResult[] = [];
      for (const member of members) {
        results.push(await updateMember(manifest, git, container, migration, active.ulid, member));
      }
      // A fully successful run clears a previously set `interrupted` status so the re-run
      // offer doesn't persist forever: results exist and none failed (a `skipped` row
      // doesn't block the clear — the services that could update did). The zero-member
      // no-op returns before any lock is taken, so it never reaches — or clears — here.
      if (results.length > 0 && results.every((row) => row.outcome !== 'failed') && active.status === 'interrupted') {
        const reactivated = await edtRegistry.setStatus(active.ulid, 'active');
        if (!reactivated.ok) {
          // The merges above already applied — keep their rows as error details rather
          // than discarding them (the switch.ts writeActiveEdt-failure precedent).
          return err(reactivated.error.code, reactivated.error.message, { results });
        }
      }
      return ok({ ulid: active.ulid, topic: active.topic, results, scope: 'edt' as const });
    }),
  );
  if (!run.ok && run.error.code === 'action-in-progress') {
    return err(
      'update-already-running',
      'A group update is already in progress — wait for it to finish before starting another.',
    );
  }
  return run;
}

// Marks an EDT `interrupted` after an abandoned run (TUI quit-mid-run confirmation) via the
// existing setStatus — the next Update-zone idle render offers a re-run, which is a true
// resume in effect because already-applied merges are no-ops.
export async function markGroupUpdateInterrupted(
  edtRegistry: EdtRegistryPort,
  ulid: string,
): Promise<Result<void>> {
  return edtRegistry.setStatus(ulid, 'interrupted');
}

function failed(service: string, error: ResultError): GroupUpdateRepoResult {
  return { service, outcome: 'failed', detail: { code: error.code, message: error.message } };
}

async function updateMember(
  manifest: ManifestPort,
  git: GitPort,
  container: ContainerPort,
  migration: MigrationPort,
  edtUlid: string,
  member: { service: string; repoPath: string; branch: string },
): Promise<GroupUpdateRepoResult> {
  const { service, repoPath, branch } = member;

  const loaded = await manifest.load(repoPath);
  if (!loaded.ok) {
    return failed(service, loaded.error);
  }

  return updateWithLoadedManifest(loaded.data, git, container, migration, edtUlid, repoPath, service, branch);
}

// Shared per-service flow for both scopes (story 3.3 reuses the EDT mechanic unchanged):
// pull/merge → migrate → restart. The EDT scope passes its recorded `branch` plus its ulid
// (unexpected-branch gate + gated write); the all-repos scope passes neither, operating on
// `currentBranch` as-is (`==sharedBranch` → `pull`, else `fetch` + ungated
// `assertAllowedBranch` + `mergeBranch`).
async function updateWithLoadedManifest(
  loaded: Manifest,
  git: GitPort,
  container: ContainerPort,
  migration: MigrationPort,
  edtUlid: string | undefined,
  repoPath: string,
  service: string,
  expectedBranch: string | undefined,
): Promise<GroupUpdateRepoResult> {
  const { container: containerName, sharedBranch, migrationCommand } = loaded;

  const current = await git.currentBranch(repoPath);
  if (!current.ok) {
    return failed(service, current.error);
  }

  // EDT scope only: the repo must sit on the member's own recorded branch — merging into
  // (or pulling) whatever happens to be checked out would update the wrong line of work.
  // No git write and no restart below this point runs for this repo.
  if (expectedBranch !== undefined && current.data !== expectedBranch) {
    return {
      service,
      outcome: 'failed',
      detail: {
        code: 'unexpected-branch',
        message: `Repo ${repoPath} is on branch "${current.data}" but the EDT expects "${expectedBranch}" — left untouched`,
      },
    };
  }

  const dirty = await git.hasUncommittedChanges(repoPath);
  if (!dirty.ok) {
    return failed(service, dirty.error);
  }
  if (dirty.data) {
    return {
      service,
      outcome: 'skipped',
      detail: { code: 'dirty-worktree', message: `Repo ${repoPath} has uncommitted changes — left untouched` },
    };
  }

  if (current.data === sharedBranch) {
    const pulled = await git.pull(repoPath);
    if (!pulled.ok) {
      // A conflicting pull leaves the repo mid-merge exactly like a conflicting merge
      // does — abort back to the pre-run HEAD and report it as such; any other pull
      // failure keeps its own code.
      const merging = await git.isMergeInProgress(repoPath);
      if (merging.ok && merging.data) {
        return failConflicted(service, git, repoPath, { code: 'merge-conflict', message: pulled.error.message });
      }
      return failed(service, pulled.error);
    }
  } else {
    const fetched = await git.fetch(repoPath, sharedBranch);
    if (!fetched.ok) {
      return failed(service, fetched.error);
    }
    // Re-verify before any git write (AD-8) — never assume the member branch is still safe.
    // All-repos scope passes no edtId: the shared-branch gate still applies, the cross-EDT
    // half is skipped.
    const allowed = await git.assertAllowedBranch(repoPath, current.data, edtUlid);
    if (!allowed.ok) {
      return failed(service, allowed.error);
    }
    const merged = await git.mergeBranch(repoPath, sharedBranch);
    if (!merged.ok) {
      if (merged.error.code === 'merge-conflict') {
        return failConflicted(service, git, repoPath, merged.error);
      }
      return failed(service, merged.error);
    }
  }

  // Story 3.2 — the migrate phase runs between the pull/merge and the restart: the
  // manifest-declared `migrationCommand` (skipped without error when absent or blank) runs
  // with the repo as its working directory. A failing migration keeps the repo on its
  // merged code but skips the restart — a `failed` row with `migration-failed` detail
  // naming the service (via the row), the command, and the error output — and never blocks
  // or rolls back the other services (each failure short-circuits only its own service).
  if (migrationCommand !== undefined && migrationCommand.trim() !== '') {
    const migrated = await migration.run(repoPath, migrationCommand);
    if (!migrated.ok) {
      return failed(service, {
        code: 'migration-failed',
        message: `Repo ${repoPath} migration "${migrationCommand}" failed: ${migrated.error.message}`,
      });
    }
  }

  const restarted = await container.restart(containerName);
  if (!restarted.ok) {
    // Every row's detail names its repoPath — with duplicate service names in one EDT,
    // the code alone can't tell two rows apart.
    return failed(service, {
      code: restarted.error.code,
      message: `Repo ${repoPath} container "${containerName}" failed to restart: ${restarted.error.message}`,
    });
  }

  return { service, outcome: 'updated' };
}

// Aborts a conflicting merge (or pull) back to the pre-run HEAD and reports it as
// `merge-conflict`. An abort failure keeps the `merge-conflict` code — the repo is still
// conflicted — surfacing both messages so the abort failure isn't silent.
async function failConflicted(
  service: string,
  git: GitPort,
  repoPath: string,
  conflict: ResultError,
): Promise<GroupUpdateRepoResult> {
  const aborted = await git.abortMerge(repoPath);
  if (!aborted.ok) {
    return failed(service, {
      code: 'merge-conflict',
      message: `${conflict.message} (merge --abort also failed: ${aborted.error.message})`,
    });
  }
  return failed(service, conflict);
}
