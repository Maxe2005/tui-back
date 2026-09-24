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
// pre-existing mid-merge/mid-rebase surfaces as its own distinct `skipped` state (never
// aborted) → dirty check (lockfile-only dirt silently discarded per the `update_repo.sh`
// convention, other dirt `skipped` without a seam) → equals `sharedBranch` ? `pull` :
// (`fetch` shared branch, `assertAllowedBranch` on the member branch, `mergeBranch`); on
// a `merge-conflict` (or a conflicting pull that leaves the repo mid-merge) without a
// seam, `git merge --abort` restores the pre-run HEAD (abort cancels only the attempted
// merge, never developer work). Story 3.4: with the `onUpdateBlocker` seam, dirty and
// conflict states pause on a driving-provided four-choice menu (stash / edited /
// cancel-repo / cancel-run) with re-verification before resuming, abort-only-own-merge,
// and a single-retry bound on conflicts. Story 3.2 inserts the migrate phase next (the
// manifest's `migrationCommand`, skipped without error when undeclared; a failure is a
// `migration-failed` row with no restart) → `container.restart`.
import { basename, resolve } from 'node:path';
import { withActionLock } from '../locking.js';
import type { ContainerPort } from '../ports/container.js';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { MigrationPort } from '../ports/migration.js';
import type { RegistryPort } from '../ports/registry.js';
import type { RestartPort } from '../ports/restart.js';
import type { StatePort } from '../ports/state.js';
import { err, ok, type Result, type ResultError } from '../result.js';

// The global run-in-flight key: every group-update trigger (EDT-scoped today, all-repos in
// story 3.3) serializes on it, so a second trigger is rejected, never queued or raced.
export const GROUP_UPDATE_LOCK_KEY = 'group-update';

export function edtUpdateLockKey(ulid: string): string {
  return `edt:${ulid}`;
}

// Story 3.7: matches one enumerated target against the confirmed selection. A selection
// item carrying `repoPath` matches by resolved path (duplicate service names in one EDT);
// otherwise it matches by service name. First match wins.
function matchSelectionItem(
  selection: readonly GroupUpdateSelectionItem[],
  candidate: { service: string; repoPath: string },
): GroupUpdateSelectionItem | undefined {
  return selection.find((item) =>
    item.repoPath !== undefined ? resolve(item.repoPath) === resolve(candidate.repoPath) : item.service === candidate.service,
  );
}

// Story 3.7: the configured merge source for one service — a non-blank per-service
// `sourceBranch` override wins, otherwise the manifest `sharedBranch`. The override is
// trimmed once here so `" release/1 "` resolves exactly like `release/1` everywhere
// (validation, fetch, merge) instead of failing the branch check on padding.
function effectiveSourceBranch(sharedBranch: string, override: string | undefined): string {
  const trimmed = override?.trim() ?? '';
  return trimmed !== '' ? trimmed : sharedBranch;
}

// Story 3.7: validates every custom `sourceBranch` against the local branch listing
// (`branchExistsLocally`, the `git rev-parse --verify`-backed adapter — no new git
// machinery) before any lock is taken, so an unresolvable branch rejects the run before
// any git/docker action. A failing check itself is an unexpected git failure and rejects
// the run the same way.
async function validateSelectionBranches(
  git: GitPort,
  targets: readonly { service: string; repoPath: string; sourceBranch: string | undefined }[],
): Promise<Result<void>> {
  for (const target of targets) {
    const branch = target.sourceBranch?.trim() ?? '';
    if (branch === '') {
      continue;
    }
    const exists = await git.branchExistsLocally(target.repoPath, branch);
    if (!exists.ok) {
      return exists;
    }
    if (!exists.data) {
      return err(
        'unknown-branch',
        `Service "${target.service}" source branch "${branch}" does not exist in ${target.repoPath} — pick a resolvable branch`,
      );
    }
  }
  return ok(undefined);
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

// Story 3.7: one pre-run configuration row. `repoPath` disambiguates duplicate service
// names (the EDT dedupe precedent); `sourceBranch` overrides the manifest `sharedBranch`
// as this service's merge source (blank/undefined falls back to `sharedBranch`).
export interface GroupUpdateSelectionItem {
  service: string;
  repoPath?: string;
  sourceBranch?: string;
}

export interface GroupUpdateParams {
  edtRegistry: EdtRegistryPort;
  state: StatePort;
  manifest: ManifestPort;
  git: GitPort;
  container: ContainerPort;
  migration: MigrationPort;
  restart: RestartPort;
  lock: LockPort;
  registry?: RegistryPort;
  scope?: GroupUpdateScope;
  // Story 3.7: the pre-run configuration. `selection` filters the enumerated targets down
  // to exactly the confirmed set — a deselected service is excluded entirely (never
  // touched, never reported). Undefined means the full default selection (every enumerated
  // target); an empty array is an explicit `no-services-selected` rejection before any
  // lock is taken. `runMigrations` defaults to true (the migrate toggle ON); `cleanRestart`
  // defaults to false — on it runs the manifest's `restartCommands` recipe in order when
  // declared (story 3.8), falling back to today's plain container restart when absent.
  selection?: GroupUpdateSelectionItem[];
  runMigrations?: boolean;
  cleanRestart?: boolean;
  // Story 3.4: the assisted-resolution seam. Absent by default (the CLI path passes no
  // seam, keeping today's skip/abort rows); the TUI backs it with a bounded modal menu.
  // Core owns classification, auto-fix, stash, re-verification, and merge finalization —
  // the driving side owns only menu rendering and the editor process (core only ever sees
  // the `edited` choice, never an editor).
  onUpdateBlocker?: OnUpdateBlocker;
}

// Story 3.4: the resolution seam shape (Design Notes). `kind` distinguishes a dirty
// worktree from a mid-run conflict from a pre-existing mid-merge/mid-rebase (surfaced
// before any menu); the driving side answers with one of four bounded choices.
export type UpdateBlockerKind = 'dirty-worktree' | 'merge-conflict' | 'mid-merge' | 'mid-rebase';

export interface UpdateBlocker {
  service: string;
  repoPath: string;
  kind: UpdateBlockerKind;
}

export type UpdateBlockerChoice = 'stash' | 'edited' | 'cancel-repo' | 'cancel-run';

export type OnUpdateBlocker = (blocker: UpdateBlocker) => Promise<UpdateBlockerChoice>;

// Story 3.4: lockfile-only dirt (the `update_repo.sh` convention) is silently discarded,
// everything else pauses on the seam. Basename-matched at any depth ("any scope").
const LOCKFILE_BASENAMES: readonly string[] = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'npm-shrinkwrap.json',
];

function isLockfileOnly(paths: readonly string[]): boolean {
  return (
    paths.length > 0 &&
    paths.every((candidate) => LOCKFILE_BASENAMES.includes(basename(candidate.replace(/\/+$/, ''))))
  );
}

// Story 3.4: the message tag for seam-driven stashes (message-tagged, not stack-position —
// the switch.ts precedent — safe alongside the developer's own unrelated stashes).
const UPDATE_STASH_MESSAGE = 'tui-back:update';

export async function groupUpdate(params: GroupUpdateParams): Promise<Result<GroupUpdateData>> {
  const { scope = 'edt' } = params;
  if (scope === 'all') {
    return groupUpdateAll(params);
  }
  return groupUpdateEdt(params);
}

async function groupUpdateAll(params: GroupUpdateParams): Promise<Result<GroupUpdateData>> {
  const { manifest, git, container, migration, restart, lock, registry, selection } = params;
  const runMigrations = params.runMigrations ?? true;
  const cleanRestart = params.cleanRestart ?? false;
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

  // Story 3.7: narrow the enumerated paths down to the confirmed selection before any
  // lock is taken — deselected services are excluded entirely (never touched, never
  // reported). Reads only (manifest loads for service-name matching, local branch
  // checks); no git write, no migration, no restart below this point runs for an
  // excluded service — or at all when the selection rejects the run outright.
  let targets: { repoPath: string; sourceBranch: string | undefined }[] = paths.map((repoPath) => ({
    repoPath,
    sourceBranch: undefined,
  }));
  if (selection !== undefined) {
    if (selection.length === 0) {
      return err('no-services-selected', 'No services selected — select at least one service before confirming.');
    }
    const narrowed = await narrowAllTargets(manifest, paths, selection);
    if (narrowed.length === 0) {
      return err('no-services-selected', 'None of the selected services match a managed repo — nothing to update.');
    }
    const branchCheck = await validateSelectionBranches(
      git,
      narrowed.map((target) => ({ service: target.service, repoPath: target.repoPath, sourceBranch: target.sourceBranch })),
    );
    if (!branchCheck.ok) {
      return branchCheck;
    }
    targets = narrowed;
  }

  const run = await withActionLock(lock, GROUP_UPDATE_LOCK_KEY, async () => {
    const results: GroupUpdateRepoResult[] = [];
    for (const target of targets) {
      const { repoPath } = target;
      const loaded = await manifest.load(repoPath);
      if (!loaded.ok) {
        // Genuinely unmanaged — silently skipped, the list-repos manifest-not-found pattern.
        if (loaded.error.code === 'manifest-not-found') {
          continue;
        }
        results.push(failed(serviceFallback(repoPath), loaded.error));
        continue;
      }
      // Story 3.4: `cancel-run` stops the loop but still returns `ok` with rows so far
      // (a cancelled repo is `skipped`, never `failed`).
      const outcome = await updateWithLoadedManifest(
        loaded.data,
        git,
        container,
        migration,
        restart,
        undefined,
        repoPath,
        loaded.data.service,
        undefined,
        params.onUpdateBlocker,
        effectiveSourceBranch(loaded.data.sharedBranch, target.sourceBranch),
        runMigrations,
        cleanRestart,
      );
      results.push(outcome.row);
      if (outcome.cancelRun) {
        break;
      }
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

// Story 3.7: narrows all-repos enumeration to the confirmed selection. Items carrying
// `repoPath` match by resolved path; the rest match by loaded manifest service (an
// unloadable manifest falls back to the path-basename service, the same label the run
// loop would report its failure under, so a genuine load error still surfaces as a
// `failed` row rather than going silent). First match wins; unmatched items are dropped.
async function narrowAllTargets(
  manifest: ManifestPort,
  paths: readonly string[],
  selection: readonly GroupUpdateSelectionItem[],
): Promise<{ service: string; repoPath: string; sourceBranch: string | undefined }[]> {
  const services = new Map<string, string>();
  for (const repoPath of paths) {
    const loaded = await manifest.load(repoPath);
    services.set(repoPath, loaded.ok ? loaded.data.service : serviceFallback(repoPath));
  }
  const seen = new Set<string>();
  const targets: { service: string; repoPath: string; sourceBranch: string | undefined }[] = [];
  for (const repoPath of paths) {
    const item = matchSelectionItem(selection, { service: services.get(repoPath) ?? serviceFallback(repoPath), repoPath });
    if (item === undefined) {
      continue;
    }
    const key = resolve(repoPath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push({ service: services.get(repoPath) ?? serviceFallback(repoPath), repoPath, sourceBranch: item.sourceBranch });
  }
  return targets;
}

async function groupUpdateEdt(params: GroupUpdateParams): Promise<Result<GroupUpdateData>> {
  const { edtRegistry, state, manifest, git, container, migration, restart, lock, selection } = params;
  const runMigrations = params.runMigrations ?? true;
  const cleanRestart = params.cleanRestart ?? false;

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

  // Story 3.7: narrow the EDT members down to the confirmed selection before any lock
  // is taken — deselected services are excluded entirely (never touched, never
  // reported). Reads only (a local branch check per custom sourceBranch); the
  // unexpected-branch gate and assertAllowedBranch gating below are unchanged.
  let configured: { member: (typeof active.members)[number]; sourceBranch: string | undefined }[] | null = null;
  if (selection !== undefined) {
    if (selection.length === 0) {
      return err('no-services-selected', 'No services selected — select at least one service before confirming.');
    }
    const seenSelection = new Set<string>();
    const kept: { member: (typeof active.members)[number]; sourceBranch: string | undefined }[] = [];
    for (const member of active.members) {
      const key = resolve(member.repoPath);
      if (seenSelection.has(key)) {
        continue;
      }
      seenSelection.add(key);
      const item = matchSelectionItem(selection, member);
      if (item === undefined) {
        continue;
      }
      kept.push({ member, sourceBranch: item.sourceBranch });
    }
    if (kept.length === 0) {
      return err('no-services-selected', `None of the selected services are members of EDT "${active.topic}" — nothing to update.`);
    }
    const branchCheck = await validateSelectionBranches(
      git,
      kept.map(({ member, sourceBranch }) => ({ service: member.service, repoPath: member.repoPath, sourceBranch })),
    );
    if (!branchCheck.ok) {
      return branchCheck;
    }
    configured = kept;
  }

  const run = await withActionLock(lock, GROUP_UPDATE_LOCK_KEY, () =>
    withActionLock(lock, edtUpdateLockKey(active.ulid), async () => {
      // Duplicate repoPath entries in one EDT would be merged/restarted twice — dedupe by
      // repoPath (first wins) before the loop so every targeted repo is touched exactly
      // once. Paths are resolved before comparing, the same normalization switch.ts uses,
      // so trailing-slash/relative-segment variants of one repo still collapse.
      const seen = new Set<string>();
      const shortlist =
        configured !== null
          ? configured
          : active.members.map((member) => ({ member, sourceBranch: undefined as string | undefined }));
      const enlisted = shortlist.filter(({ member }) => {
        const key = resolve(member.repoPath);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      const results: GroupUpdateRepoResult[] = [];
      for (const { member, sourceBranch } of enlisted) {
        // Story 3.4: `cancel-run` stops the loop but still returns `ok` with rows so far.
        const outcome = await updateMember(
          manifest,
          git,
          container,
          migration,
          restart,
          active.ulid,
          member,
          params.onUpdateBlocker,
          sourceBranch,
          runMigrations,
          cleanRestart,
        );
        results.push(outcome.row);
        if (outcome.cancelRun) {
          break;
        }
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
  restart: RestartPort,
  edtUlid: string,
  member: { service: string; repoPath: string; branch: string },
  onUpdateBlocker?: OnUpdateBlocker,
  sourceBranch?: string,
  runMigrations = true,
  cleanRestart = false,
): Promise<RepoOutcome> {
  const { service, repoPath, branch } = member;

  const loaded = await manifest.load(repoPath);
  if (!loaded.ok) {
    return { row: failed(service, loaded.error), cancelRun: false };
  }

  return updateWithLoadedManifest(
    loaded.data,
    git,
    container,
    migration,
    restart,
    edtUlid,
    repoPath,
    service,
    branch,
    onUpdateBlocker,
    effectiveSourceBranch(loaded.data.sharedBranch, sourceBranch),
    runMigrations,
    cleanRestart,
  );
}

// Story 3.4: the per-repo outcome plus the `cancel-run` loop-stop signal. The cancelled
// repo itself is always a `skipped` row, never `failed` — the outer loops push the row
// and break, still returning `ok` with rows so far.
interface RepoOutcome {
  row: GroupUpdateRepoResult;
  cancelRun: boolean;
}

function skipped(service: string, code: string, message: string): RepoOutcome {
  return { row: { service, outcome: 'skipped', detail: { code, message } }, cancelRun: false };
}

function failedOutcome(service: string, error: ResultError): RepoOutcome {
  return { row: failed(service, error), cancelRun: false };
}

// Shared per-service flow for both scopes (story 3.3 reuses the EDT mechanic unchanged):
// pull/merge → migrate → restart. The EDT scope passes its recorded `branch` plus its ulid
// (unexpected-branch gate + gated write); the all-repos scope passes neither, operating on
// `currentBranch` as-is (`==sourceBranch` → `pull`, else `fetch` + ungated
// `assertAllowedBranch` + `mergeBranch`). Story 3.7: `sourceBranch` is the configured merge
// source (manifest `sharedBranch` unless a per-service override was confirmed); the migrate
// phase runs only when `runMigrations` is on; story 3.8: `cleanRestart` runs the
// manifest's `restartCommands` recipe in order when declared, else today's plain
// container restart.
//
// Story 3.4 layers assisted resolution onto this flow: lockfile-only dirt is silently
// discarded (the `update_repo.sh` convention, seam or not); a pre-existing
// mid-merge/mid-rebase surfaces as its own distinct state before any menu (never aborted
// by any choice); any other dirty worktree or mid-run conflict pauses on the
// `onUpdateBlocker` seam when present (absent seam preserves today's skip/abort rows).
// Every resumed repo is re-verified before continuing; one repo's resolution never touches
// another repo.
async function updateWithLoadedManifest(
  loaded: Manifest,
  git: GitPort,
  container: ContainerPort,
  migration: MigrationPort,
  restart: RestartPort,
  edtUlid: string | undefined,
  repoPath: string,
  service: string,
  expectedBranch: string | undefined,
  onUpdateBlocker?: OnUpdateBlocker,
  sourceBranch?: string,
  runMigrations = true,
  cleanRestart = false,
): Promise<RepoOutcome> {
  const { container: containerName, migrationCommand, restartCommands } = loaded;
  // Story 3.7: the configured merge source — the manifest `sharedBranch` unless the
  // pre-run screen confirmed a per-service override (trimmed once inside
  // `effectiveSourceBranch`, so padding never reaches fetch/merge). Merge stays
  // `git merge`, never rebase.
  const mergeSource = effectiveSourceBranch(loaded.sharedBranch, sourceBranch);

  const current = await git.currentBranch(repoPath);
  if (!current.ok) {
    return failedOutcome(service, current.error);
  }

  // EDT scope only: the repo must sit on the member's own recorded branch — merging into
  // (or pulling) whatever happens to be checked out would update the wrong line of work.
  // No git write and no restart below this point runs for this repo.
  if (expectedBranch !== undefined && current.data !== expectedBranch) {
    return {
      row: {
        service,
        outcome: 'failed',
        detail: {
          code: 'unexpected-branch',
          message: `Repo ${repoPath} is on branch "${current.data}" but the EDT expects "${expectedBranch}" — left untouched`,
        },
      },
      cancelRun: false,
    };
  }

  // Story 3.4 — pre-existing mid-merge/mid-rebase is detected as its own distinct case
  // before the dirty gate and before any pull/merge of this run. Core aborts only merges
  // the current run started — this state is never aborted, only reported (seam or not)
  // with the menu applying after the report.
  const settledPreexisting = await settlePreexistingMidState(service, repoPath, git, onUpdateBlocker);
  if (!settledPreexisting.resumed) {
    return settledPreexisting.cancelRun
      ? { row: settledPreexisting.row, cancelRun: true }
      : { row: settledPreexisting.row, cancelRun: false };
  }

  // Story 3.4 — dirty gate: lockfile-only dirt is discarded silently (seam or not) and
  // the repo proceeds; any other dirt pauses on the seam when present, else keeps today's
  // `skipped`/`dirty-worktree` row.
  const dirtyPaths = await git.listDirtyPaths(repoPath);
  if (!dirtyPaths.ok) {
    return failedOutcome(service, dirtyPaths.error);
  }
  if (dirtyPaths.data.length > 0) {
    if (isLockfileOnly(dirtyPaths.data)) {
      const discarded = await git.discardPaths(repoPath, dirtyPaths.data);
      if (!discarded.ok) {
        return failedOutcome(service, discarded.error);
      }
      const rechecked = await git.listDirtyPaths(repoPath);
      if (!rechecked.ok) {
        return failedOutcome(service, rechecked.error);
      }
      // Still dirty after the auto-fix (e.g. untracked lockfiles a path-scoped checkout
      // cannot restore) — handled as ordinary dirt below, never looped silently.
      if (rechecked.data.length > 0) {
        const outcome = await resolveDirtyBlocker(service, repoPath, git, onUpdateBlocker);
        if (!outcome.resumed) {
          return outcome.cancelRun ? { row: outcome.row, cancelRun: true } : { row: outcome.row, cancelRun: false };
        }
      }
    } else {
      const outcome = await resolveDirtyBlocker(service, repoPath, git, onUpdateBlocker);
      if (!outcome.resumed) {
        return outcome.cancelRun ? { row: outcome.row, cancelRun: true } : { row: outcome.row, cancelRun: false };
      }
    }
  }

  if (current.data === mergeSource) {
    const pulled = await git.pull(repoPath);
    if (!pulled.ok) {
      // A conflicting pull leaves the repo mid-merge exactly like a conflicting merge
      // does — without a seam, abort back to the pre-run HEAD and report it as such
      // (today's behavior); with a seam, the bounded resolution menu applies. Any other
      // pull failure keeps its own code.
      const merging = await git.isMergeInProgress(repoPath);
      if (merging.ok && merging.data) {
        const settlement = await resolveMidRunConflict(
          service,
          git,
          repoPath,
          { code: 'merge-conflict', message: pulled.error.message },
          onUpdateBlocker,
          'pull',
          mergeSource,
        );
        // A resumed conflict rejoins the pipeline below (migrate → restart); a settled
        // one already carries its row.
        if (settlement.done) {
          return settlement.outcome;
        }
      } else {
        return failedOutcome(service, pulled.error);
      }
    }
  } else {
    const fetched = await git.fetch(repoPath, mergeSource);
    if (!fetched.ok) {
      return failedOutcome(service, fetched.error);
    }
    // Re-verify before any git write (AD-8) — never assume the member branch is still safe.
    // All-repos scope passes no edtId: the shared-branch gate still applies, the cross-EDT
    // half is skipped.
    const allowed = await git.assertAllowedBranch(repoPath, current.data, edtUlid);
    if (!allowed.ok) {
      return failedOutcome(service, allowed.error);
    }
    const merged = await git.mergeBranch(repoPath, mergeSource);
    if (!merged.ok) {
      if (merged.error.code === 'merge-conflict') {
        const settlement = await resolveMidRunConflict(
          service,
          git,
          repoPath,
          merged.error,
          onUpdateBlocker,
          'merge',
          mergeSource,
        );
        if (settlement.done) {
          return settlement.outcome;
        }
      } else {
        return failedOutcome(service, merged.error);
      }
    }
  }

  // Story 3.2 — the migrate phase runs between the pull/merge and the restart: the
  // manifest-declared `migrationCommand` (skipped without error when absent or blank) runs
  // with the repo as its working directory. A failing migration keeps the repo on its
  // merged code but skips the restart — a `failed` row with `migration-failed` detail
  // naming the service (via the row), the command, and the error output — and never blocks
  // or rolls back the other services (each failure short-circuits only its own service).
  // Story 3.7: the run-wide migrate toggle gates the whole phase — off means no
  // `migration.run` executes for this service even when a command is declared.
  if (runMigrations && migrationCommand !== undefined && migrationCommand.trim() !== '') {
    const migrated = await migration.run(repoPath, migrationCommand);
    if (!migrated.ok) {
      return failedOutcome(service, {
        code: 'migration-failed',
        message: `Repo ${repoPath} migration "${migrationCommand}" failed: ${migrated.error.message}`,
      });
    }
  }

  // Story 3.8 — the restart phase: with `cleanRestart` on and a declared non-empty
  // `restartCommands` recipe, each command runs in the repo's working directory in
  // declared order via the restart port, stopping on the first failure — a `failed` row
  // naming the service (via the row), the command, and the error output, never blocking
  // or rolling back the other services. Otherwise (toggle off, or no recipe declared)
  // today's plain container restart runs untouched — never both ports for the same
  // service in the same action.
  if (cleanRestart && restartCommands !== undefined && restartCommands.length > 0) {
    for (const command of restartCommands) {
      const restarted = await restart.run(repoPath, command);
      if (!restarted.ok) {
        return failedOutcome(service, {
          code: 'restart-failed',
          message: `Repo ${repoPath} restart "${command}" failed: ${restarted.error.message}`,
        });
      }
    }
  } else {
    const restarted = await container.restart(containerName);
    if (!restarted.ok) {
      // Every row's detail names its repoPath — with duplicate service names in one EDT,
      // the code alone can't tell two rows apart.
      return failedOutcome(service, {
        code: restarted.error.code,
        message: `Repo ${repoPath} container "${containerName}" failed to restart: ${restarted.error.message}`,
      });
    }
  }

  return { row: { service, outcome: 'updated' }, cancelRun: false };
}

// Aborts a conflicting merge (or pull) back to the pre-run HEAD and reports it as
// `merge-conflict`. An abort failure keeps the `merge-conflict` code — the repo is still
// conflicted — surfacing both messages so the abort failure isn't silent.
async function failConflicted(
  service: string,
  git: GitPort,
  repoPath: string,
  conflict: ResultError,
): Promise<RepoOutcome> {
  const aborted = await git.abortMerge(repoPath);
  if (!aborted.ok) {
    return failedOutcome(service, {
      code: 'merge-conflict',
      message: `${conflict.message} (merge --abort also failed: ${aborted.error.message})`,
    });
  }
  return failedOutcome(service, conflict);
}

// Story 3.4 — asks the driving-provided seam for a blocker choice. A throwing seam (a
// driving-side bug — dispatch maps top-level throws to `internal-error`) is folded into a
// per-service `failed` row here instead, so one repo's menu failure never strands the
// others' rows; an unknown choice string is the same class of driving bug.
async function askSeam(
  onUpdateBlocker: OnUpdateBlocker,
  blocker: UpdateBlocker,
): Promise<{ choice: UpdateBlockerChoice } | { error: ResultError }> {
  try {
    const choice = await onUpdateBlocker(blocker);
    if (choice !== 'stash' && choice !== 'edited' && choice !== 'cancel-repo' && choice !== 'cancel-run') {
      return {
        error: {
          code: 'internal-error',
          message: `Update blocker seam returned an unknown choice for repo ${blocker.repoPath}`,
        },
      };
    }
    return { choice };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { error: { code: 'internal-error', message: `Update blocker seam failed for repo ${blocker.repoPath}: ${detail}` } };
  }
}

// Story 3.4 — re-verifies a repo before resuming it after a `stash`/`edited` choice:
// no mid-merge, no mid-rebase, and zero dirty paths. Real conflict content is never
// auto-resolved here — this only reads state.
async function reverifyClean(git: GitPort, repoPath: string): Promise<Result<boolean>> {
  const merging = await git.isMergeInProgress(repoPath);
  if (!merging.ok) {
    return merging;
  }
  if (merging.data) {
    return ok(false);
  }
  const rebasing = await git.isRebaseInProgress(repoPath);
  if (!rebasing.ok) {
    return rebasing;
  }
  if (rebasing.data) {
    return ok(false);
  }
  const paths = await git.listDirtyPaths(repoPath);
  if (!paths.ok) {
    return paths;
  }
  return ok(paths.data.length === 0);
}

type BlockerSettlement =
  | { resumed: true }
  | { resumed: false; row: GroupUpdateRepoResult; cancelRun: boolean };

// Story 3.4 — pre-existing mid-merge/mid-rebase settlement. Without a seam this is a
// distinct `skipped` row (never today's dirty/conflict codes, never aborted); with a seam
// the same four-choice menu applies after the report, and cancel choices never abort the
// pre-existing state (only merges this run started are ever aborted). Resumption means
// the mid-state cleared — ordinary dirt left behind falls through to the dirty gate,
// which re-reads the tree fresh.
async function settlePreexistingMidState(
  service: string,
  repoPath: string,
  git: GitPort,
  onUpdateBlocker: OnUpdateBlocker | undefined,
): Promise<BlockerSettlement> {
  const merging = await git.isMergeInProgress(repoPath);
  if (!merging.ok) {
    return { resumed: false, row: failed(service, merging.error), cancelRun: false };
  }
  const rebasing = await git.isRebaseInProgress(repoPath);
  if (!rebasing.ok) {
    return { resumed: false, row: failed(service, rebasing.error), cancelRun: false };
  }
  if (!merging.data && !rebasing.data) {
    return { resumed: true };
  }
  const kind: UpdateBlockerKind = rebasing.data ? 'mid-rebase' : 'mid-merge';
  const stateName = kind === 'mid-rebase' ? 'mid-rebase' : 'mid-merge';
  if (onUpdateBlocker === undefined) {
    return {
      resumed: false,
      row: {
        service,
        outcome: 'skipped',
        detail: { code: kind, message: `Repo ${repoPath} is ${stateName} — left untouched` },
      },
      cancelRun: false,
    };
  }
  for (;;) {
    const asked = await askSeam(onUpdateBlocker, { service, repoPath, kind });
    if ('error' in asked) {
      return { resumed: false, row: failed(service, asked.error), cancelRun: false };
    }
    if (asked.choice === 'cancel-repo') {
      return {
        resumed: false,
        row: {
          service,
          outcome: 'skipped',
          detail: { code: kind, message: `Repo ${repoPath} ${stateName} update cancelled by developer — left as-is` },
        },
        cancelRun: false,
      };
    }
    if (asked.choice === 'cancel-run') {
      return {
        resumed: false,
        row: {
          service,
          outcome: 'skipped',
          detail: { code: kind, message: `Repo ${repoPath} ${stateName} update cancelled by developer — left as-is` },
        },
        cancelRun: true,
      };
    }
    if (asked.choice === 'stash') {
      // A stash during a mid-merge/mid-rebase may fail (git refuses) — either way the
      // re-verification below decides: still mid-state re-presents the menu.
      await git.stashSave(repoPath, UPDATE_STASH_MESSAGE);
    }
    // `edited` is driving-side only (the editor spawn) — core only re-verifies.
    const stillMerging = await git.isMergeInProgress(repoPath);
    if (!stillMerging.ok) {
      return { resumed: false, row: failed(service, stillMerging.error), cancelRun: false };
    }
    const stillRebasing = await git.isRebaseInProgress(repoPath);
    if (!stillRebasing.ok) {
      return { resumed: false, row: failed(service, stillRebasing.error), cancelRun: false };
    }
    if (!stillMerging.data && !stillRebasing.data) {
      return { resumed: true };
    }
    // Still mid-state → re-present the menu.
  }
}

// Story 3.4 — ordinary (non-lockfile) dirty-worktree settlement. Without a seam this is
// today's `skipped`/`dirty-worktree` row with zero writes; with a seam the run waits on
// the four-choice menu and resumes only after a passing re-verification (`stash` stashes
// via the git port, `edited` re-verifies a driving-side edit; still dirty re-presents).
async function resolveDirtyBlocker(
  service: string,
  repoPath: string,
  git: GitPort,
  onUpdateBlocker: OnUpdateBlocker | undefined,
): Promise<BlockerSettlement> {
  if (onUpdateBlocker === undefined) {
    return {
      resumed: false,
      row: {
        service,
        outcome: 'skipped',
        detail: { code: 'dirty-worktree', message: `Repo ${repoPath} has uncommitted changes — left untouched` },
      },
      cancelRun: false,
    };
  }
  for (;;) {
    const asked = await askSeam(onUpdateBlocker, { service, repoPath, kind: 'dirty-worktree' });
    if ('error' in asked) {
      return { resumed: false, row: failed(service, asked.error), cancelRun: false };
    }
    if (asked.choice === 'cancel-repo') {
      return {
        resumed: false,
        row: {
          service,
          outcome: 'skipped',
          detail: { code: 'dirty-worktree', message: `Repo ${repoPath} update cancelled by developer — left untouched` },
        },
        cancelRun: false,
      };
    }
    if (asked.choice === 'cancel-run') {
      return {
        resumed: false,
        row: {
          service,
          outcome: 'skipped',
          detail: { code: 'dirty-worktree', message: `Repo ${repoPath} update cancelled by developer — left untouched` },
        },
        cancelRun: true,
      };
    }
    if (asked.choice === 'stash') {
      // A failed stash leaves the dirt behind — the re-verification below re-presents
      // the menu rather than failing the repo for a transient stash error.
      await git.stashSave(repoPath, UPDATE_STASH_MESSAGE);
    }
    // `edited` is driving-side only — core only re-verifies before resuming.
    const verify = await reverifyClean(git, repoPath);
    if (!verify.ok) {
      return { resumed: false, row: failed(service, verify.error), cancelRun: false };
    }
    if (verify.data) {
      return { resumed: true };
    }
    // Still dirty/conflicted → re-present the menu.
  }
}

// Story 3.4 — mid-run conflict settlement (a merge — or pull — this run started now leaves
// the repo mid-merge). Without a seam this is today's abort-and-report `failed`/
// `merge-conflict` row; with a seam there is no abort yet — one prompt, then a bounded
// single retry: a still-conflicted retry ends as one `failed`/`merge-conflict` row with no
// second prompt. Cancel choices abort the own-started merge (never a pre-existing one —
// this state is by construction own-started) and land a `skipped` row. A resumed conflict
// rejoins the caller's pipeline (migrate → restart) via `{ done: false }`.
type ConflictSettlement = { done: true; outcome: RepoOutcome } | { done: false };

async function resolveMidRunConflict(
  service: string,
  git: GitPort,
  repoPath: string,
  conflict: ResultError,
  onUpdateBlocker: OnUpdateBlocker | undefined,
  via: 'pull' | 'merge',
  sharedBranch: string,
): Promise<ConflictSettlement> {
  if (onUpdateBlocker === undefined) {
    return { done: true, outcome: await failConflicted(service, git, repoPath, conflict) };
  }
  const asked = await askSeam(onUpdateBlocker, { service, repoPath, kind: 'merge-conflict' });
  if ('error' in asked) {
    return { done: true, outcome: await failConflicted(service, git, repoPath, asked.error) };
  }
  if (asked.choice === 'cancel-repo' || asked.choice === 'cancel-run') {
    // Own-started merge aborted, repo left at pre-run HEAD; a cancelled repo is `skipped`,
    // never `failed` — even when the abort itself fails, the code stays informative.
    const aborted = await git.abortMerge(repoPath);
    const row: GroupUpdateRepoResult = aborted.ok
      ? {
          service,
          outcome: 'skipped',
          detail: { code: 'merge-conflict', message: `Repo ${repoPath} update cancelled by developer — merge aborted` },
        }
      : {
          service,
          outcome: 'skipped',
          detail: {
            code: 'merge-conflict',
            message: `Repo ${repoPath} update cancelled by developer (merge --abort also failed: ${aborted.error.message})`,
          },
        };
    return asked.choice === 'cancel-run' ? { done: true, outcome: { row, cancelRun: true } } : { done: true, outcome: { row, cancelRun: false } };
  }
  if (asked.choice === 'stash') {
    await git.stashSave(repoPath, UPDATE_STASH_MESSAGE);
    // A stash cannot clear a mid-merge by itself — re-verify, and only a clean tree earns
    // the single bounded resume below; anything still blocked ends the retry bound here.
    const verify = await reverifyClean(git, repoPath);
    if (!verify.ok) {
      return { done: true, outcome: await failConflicted(service, git, repoPath, verify.error) };
    }
    if (!verify.data) {
      return { done: true, outcome: await failConflicted(service, git, repoPath, conflict) };
    }
    return resumeOnceAfterConflict(service, git, repoPath, via, sharedBranch);
  }
  // `edited` — the developer resolved by hand driving-side. Verify zero unmerged paths,
  // then finalize the merge commit and rejoin the pipeline (migrate → restart). A
  // still-conflicted tree earns the single bounded re-merge, never a second prompt.
  const unmerged = await git.hasUnmergedPaths(repoPath);
  if (!unmerged.ok) {
    return { done: true, outcome: await failConflicted(service, git, repoPath, unmerged.error) };
  }
  if (!unmerged.data) {
    const finalized = await git.finalizeMerge(repoPath);
    if (!finalized.ok) {
      // Never abort here: the tree carries the developer's own in-the-moment resolution
      // (staged, uncommitted) — discarding it via --abort without an explicit choice
      // would violate the never-discard rule. Leave the repo as-is for hand finishing.
      return { done: true, outcome: failedOutcome(service, finalized.error) };
    }
    // Finalized — the merge commit exists; rejoin the pipeline (migrate → restart).
    return { done: false };
  }
  return resumeOnceAfterConflict(service, git, repoPath, via, sharedBranch);
}

// Story 3.4 — the single bounded resume after a conflict choice: one re-pull/re-merge,
// still conflicted → abort + one `failed`/`merge-conflict` row, no second prompt. A clean
// resume rejoins the caller's pipeline via `{ done: false }` (migrate → restart still run).
async function resumeOnceAfterConflict(
  service: string,
  git: GitPort,
  repoPath: string,
  via: 'pull' | 'merge',
  sharedBranch: string,
): Promise<ConflictSettlement> {
  if (via === 'pull') {
    const retried = await git.pull(repoPath);
    if (!retried.ok) {
      const stillMerging = await git.isMergeInProgress(repoPath);
      if (stillMerging.ok && stillMerging.data) {
        return { done: true, outcome: await failConflicted(service, git, repoPath, { code: 'merge-conflict', message: retried.error.message }) };
      }
      return { done: true, outcome: failedOutcome(service, retried.error) };
    }
    return { done: false };
  }
  const retried = await git.mergeBranch(repoPath, sharedBranch);
  if (!retried.ok) {
    if (retried.error.code === 'merge-conflict') {
      return { done: true, outcome: await failConflicted(service, git, repoPath, retried.error) };
    }
    return { done: true, outcome: failedOutcome(service, retried.error) };
  }
  return { done: false };
}
