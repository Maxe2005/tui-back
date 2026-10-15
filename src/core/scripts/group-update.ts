// core/scripts/group-update: brings every member service of the active EDT (or every repo, in
// all-repos scope) up to date with its merge source, runs its migration and restarts it — one
// `updated`/`skipped`/`failed` row per service, none silently absent, one failure never
// aborting the others. Merge means `git merge`, never rebase; a rerun with no change is a
// no-op. Lock order: global `group-update` key, then `edt:<ulid>` (which switch peeks).
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
import { runPool, type PoolControl, type StageControl } from './run-pool.js';
export type { StageControl };

// The global run-in-flight key: every group-update trigger (EDT-scoped or all-repos)
// serializes on it, so a second trigger is rejected, never queued or raced.
export const GROUP_UPDATE_LOCK_KEY = 'group-update';

export function edtUpdateLockKey(ulid: string): string {
  return `edt:${ulid}`;
}

// Matches one enumerated target against the confirmed selection. A selection
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

// The configured merge source for one service — a non-blank per-service
// `sourceBranch` override wins, otherwise the manifest `sharedBranch`. The override is
// trimmed once here so `" release/1 "` resolves exactly like `release/1` everywhere
// (validation, fetch, merge) instead of failing the branch check on padding.
function effectiveSourceBranch(sharedBranch: string, override: string | undefined): string {
  const trimmed = override?.trim() ?? '';
  return trimmed !== '' ? trimmed : sharedBranch;
}

// Validates every custom `sourceBranch` against the local branch listing
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

// What the pull/merge and migrate phases did for one service — best-effort, only on the rows
// that completed them.
export interface GroupUpdateRunDetail {
  merge: { kind: 'up-to-date' } | { kind: 'advanced'; files?: number; insertions?: number; deletions?: number };
  migrations: { kind: 'none' } | { kind: 'ran'; command: string; outputExcerpt: string };
  // Only on a row whose merge conflicted and an auto-resolver ran: `auto-resolved` (settled
  // with no menu), `partial` (settled in part, the rest left to the developer), `left-to-user`
  // (the resolver could not settle its part).
  conflict?: 'auto-resolved' | 'partial' | 'left-to-user';
}

export interface GroupUpdateRepoResult {
  service: string;
  outcome: 'updated' | 'skipped' | 'failed';
  detail?: { code: string; message: string };
  run?: Partial<GroupUpdateRunDetail>;
}

const OUTPUT_EXCERPT_LINES = 3;
const OUTPUT_EXCERPT_MAX_CHARS = 200;

// Last non-empty lines of the trimmed output (ANSI escapes stripped), capped from the tail so
// the final line — usually the informative one — survives a chatty migration.
function outputExcerpt(output: string): string {
  const lines = output
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
  return lines.slice(-OUTPUT_EXCERPT_LINES).join('\n').slice(-OUTPUT_EXCERPT_MAX_CHARS);
}

// Compares HEAD before/after the pull/merge. A failing read on either side yields no detail;
// a failing diff keeps `advanced` without counts. Never affects the row's outcome.
async function readMergeDetail(
  git: GitPort,
  repoPath: string,
  before: string | undefined,
): Promise<GroupUpdateRunDetail['merge'] | undefined> {
  if (before === undefined) {
    return undefined;
  }
  const after = await git.headRevision(repoPath);
  if (!after.ok) {
    return undefined;
  }
  if (after.data === before) {
    return { kind: 'up-to-date' };
  }
  const stat = await git.diffStat(repoPath, before, after.data);
  if (!stat.ok) {
    return { kind: 'advanced' };
  }
  return { kind: 'advanced', files: stat.data.files, insertions: stat.data.insertions, deletions: stat.data.deletions };
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

// One pre-run configuration row. `repoPath` disambiguates duplicate service
// names (the EDT dedupe precedent); `sourceBranch` overrides the manifest `sharedBranch`
// as this service's merge source (blank/undefined falls back to `sharedBranch`).
export interface GroupUpdateSelectionItem {
  service: string;
  repoPath?: string;
  sourceBranch?: string;
  // Per-service overrides of the run-wide toggles; undefined follows the run-wide value.
  runMigrations?: boolean;
  cleanRestart?: boolean;
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
  // The pre-run configuration. `selection` filters the enumerated targets down to exactly the
  // confirmed set — a deselected service is excluded entirely (never touched, never
  // reported). Undefined means every enumerated target; an empty array is an explicit
  // `no-services-selected` rejection before any lock is taken. `runMigrations` defaults to
  // true; `cleanRestart` defaults to false — on, it runs the manifest's `restartCommands`
  // recipe in order when declared, falling back to the plain container restart.
  selection?: GroupUpdateSelectionItem[];
  runMigrations?: boolean;
  cleanRestart?: boolean;
  // The assisted-resolution seam. Absent on the CLI path (dirty/conflict repos are skipped or
  // aborted); the TUI backs it with a bounded modal menu. Core owns classification, auto-fix,
  // stash, re-verification and merge finalization — the driving side owns only the menu and
  // the editor process (core only ever sees the `edited` choice).
  onUpdateBlocker?: OnUpdateBlocker;
  // The live per-service step observer. Absent on the CLI path; the TUI store backs it with
  // its live phase map. Emitted at phase boundaries (pulling/merging → migrating →
  // restarting), never allowed to throw into the pipeline — a throwing observer is swallowed
  // per emission.
  onPhase?: OnUpdatePhase;
  // Fires once per service as soon as its row is final (before the run ends), so a driving
  // side can show a finished service while others still run. Observer-only, like onPhase.
  onServiceResult?: OnServiceResult;
  // How many services are processed at once (bounded pool). Default 1 — the sequential run.
  concurrency?: number;
  // Optional stage of a target: stages run in ascending order, each fully finished before the
  // next starts (a later story runs `shared-types` alone first). Absent: one stage.
  ordering?: (target: { service: string; repoPath: string }) => number;
  // Awaited once each stage has finished (also after the last), with that stage's final rows;
  // it may cancel the run so the remaining stages are reported as cancelled. Generic seam: core
  // knows nothing about what the driving side does between stages. A throwing hook cancels.
  afterStage?: (stage: number, rows: GroupUpdateRepoResult[], control: StageControl) => void | Promise<void>;
  // Optional conflict auto-resolution seam (generic: core never knows what it resolves). Called
  // on a service whose merge/pull conflicted, before each menu presentation and again after the
  // developer's `edited` choice, so it must be idempotent. It reports whether it settled
  // something and, when it could not settle its part, an issue note shown on the incident.
  autoResolveConflict?: AutoResolveConflict;
}

export interface AutoResolveResult {
  touched: boolean;
  issue?: string;
}

export type AutoResolveConflict = (target: { service: string; repoPath: string }) => Promise<AutoResolveResult>;

// The resolution seam shape. `kind` distinguishes a dirty worktree from a mid-run conflict
// from a pre-existing mid-merge/mid-rebase (surfaced before any menu); the driving side
// answers with one of four bounded choices.
export type UpdateBlockerKind = 'dirty-worktree' | 'merge-conflict' | 'mid-merge' | 'mid-rebase' | 'unpushed-commits';

export interface UpdateBlocker {
  service: string;
  repoPath: string;
  kind: UpdateBlockerKind;
  // Merge-conflict re-presentations only: how many resolution attempts already failed for
  // this conflict (absent on the first prompt) and why the last one did not settle it —
  // the driving side shows both so an endless retry loop stays legible.
  retry?: number;
  retryReason?: string;
  // `unpushed-commits` only: the local branch that could not be fetched into and the
  // `<hash> <subject>` lines of its commits origin does not have.
  branch?: string;
  commits?: string[];
  // `merge-conflict` only: why the auto-resolver could not settle its part of the conflict.
  autoResolveNote?: string;
}

// `fetch` answers an `unpushed-commits` blocker only: core runs a plain `git fetch origin
// <branch>` (local branch untouched) and carries on with the local branch as it stands.
export type UpdateBlockerChoice = 'stash' | 'edited' | 'cancel-repo' | 'cancel-run' | 'fetch';

export type OnUpdateBlocker = (blocker: UpdateBlocker) => Promise<UpdateBlockerChoice>;

// The live per-service step vocabulary. One optional callback, set by the store, no-op by
// default — no event bus.
export type UpdatePhase = 'pulling' | 'merging' | 'migrating' | 'restarting';

export type OnUpdatePhase = (service: string, phase: UpdatePhase) => void;

export type OnServiceResult = (row: GroupUpdateRepoResult) => void;

// Same never-break-the-pipeline contract as emitPhase.
function emitServiceResult(onServiceResult: OnServiceResult | undefined, row: GroupUpdateRepoResult): void {
  if (onServiceResult === undefined) {
    return;
  }
  try {
    const result = onServiceResult(row) as unknown;
    if (result instanceof Promise) {
      result.catch(() => {
        // Observer-only — the run continues.
      });
    }
  } catch {
    // Observer-only — the run continues.
  }
}

// A driving-side phase observer must never break the pipeline — a throwing observer (a
// driving-side bug) is swallowed per emission so one repo's live view never strands the
// others' rows. An observer that returns a rejected promise despite its `void` contract is
// sunk the same way, so it never surfaces as an unhandled rejection.
function emitPhase(onPhase: OnUpdatePhase | undefined, service: string, phase: UpdatePhase): void {
  if (onPhase === undefined) {
    return;
  }
  try {
    const result = onPhase(service, phase) as unknown;
    if (result instanceof Promise) {
      result.catch(() => {
        // Observer-only — the run continues with the phase untracked.
      });
    }
  } catch {
    // Observer-only — the run continues with the phase untracked.
  }
}

// The normalized row-detail code for a failed migration — a named export instead of a magic
// string, so the TUI's live issue log cannot drift from core's contract.
export const MIGRATION_FAILED_CODE = 'migration-failed';

// Lockfile-only dirt (the `update_repo.sh` convention) is silently discarded, everything else
// pauses on the seam. Basename-matched at any depth.
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

// The message tag for seam-driven stashes (message-tagged, not stack-position — safe alongside
// the developer's own unrelated stashes).
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

  // Narrow the enumerated paths down to the confirmed selection before any lock is taken —
  // deselected services are excluded entirely (never touched, never reported). Reads only
  // (manifest loads for service-name matching, local branch checks); no git write, no
  // migration, no restart below this point runs for an excluded service — or at all when the
  // selection rejects the run outright.
  let targets: { repoPath: string; sourceBranch: string | undefined; runMigrations?: boolean; cleanRestart?: boolean }[] = paths.map((repoPath) => ({
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
    const rows = await runPool<(typeof targets)[number], GroupUpdateRepoResult>(
      targets,
      {
        concurrency: params.concurrency ?? 1,
        keyOf: (target) => resolve(target.repoPath),
        ...(params.ordering !== undefined
          ? { stageOf: (target) => params.ordering?.({ service: serviceFallback(target.repoPath), repoPath: target.repoPath }) ?? 0 }
          : {}),
        ...(params.afterStage !== undefined
          ? { afterStage: (stage: number, stageRows: (GroupUpdateRepoResult | undefined)[], control: StageControl) => params.afterStage?.(stage, stageRows.filter((row): row is GroupUpdateRepoResult => row !== undefined), control) }
          : {}),
        onCancelled: async (target) => {
          const loaded = await manifest.load(target.repoPath);
          if (!loaded.ok && loaded.error.code === 'manifest-not-found') {
            return undefined;
          }
          const service = loaded.ok ? loaded.data.service : serviceFallback(target.repoPath);
          const row = loaded.ok ? runCancelledRow(service, target.repoPath, 'before it started') : failed(service, loaded.error);
          emitServiceResult(params.onServiceResult, row);
          return row;
        },
        onError: (target, error) => {
          const row = failed(serviceFallback(target.repoPath), unexpectedError(error));
          emitServiceResult(params.onServiceResult, row);
          return row;
        },
      },
      async (target, control) => {
        const { repoPath } = target;
        const loaded = await manifest.load(repoPath);
        if (!loaded.ok) {
          // Genuinely unmanaged — silently skipped, the list-repos manifest-not-found pattern.
          if (loaded.error.code === 'manifest-not-found') {
            return undefined;
          }
          return failed(serviceFallback(repoPath), loaded.error);
        }
        // `cancel-run` stops the pool but still returns `ok` with rows so far (a cancelled repo
        // is `skipped`, never `failed`).
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
          pausingSeam(params.onUpdateBlocker, control),
          effectiveSourceBranch(loaded.data.sharedBranch, target.sourceBranch),
          target.runMigrations ?? runMigrations,
          target.cleanRestart ?? cleanRestart,
          params.onPhase,
          control.cancelled,
          params.autoResolveConflict,
        );
        if (outcome.cancelRun) {
          control.cancel();
        }
        emitServiceResult(params.onServiceResult, outcome.row);
        return outcome.row;
      },
    );
    const results = rows.filter((row): row is GroupUpdateRepoResult => row !== undefined);
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

// Narrows all-repos enumeration to the confirmed selection. Items carrying
// `repoPath` match by resolved path; the rest match by loaded manifest service (an
// unloadable manifest falls back to the path-basename service, the same label the run
// loop would report its failure under, so a genuine load error still surfaces as a
// `failed` row rather than going silent). First match wins; unmatched items are dropped.
async function narrowAllTargets(
  manifest: ManifestPort,
  paths: readonly string[],
  selection: readonly GroupUpdateSelectionItem[],
): Promise<{ service: string; repoPath: string; sourceBranch: string | undefined; runMigrations?: boolean; cleanRestart?: boolean }[]> {
  const services = new Map<string, string>();
  for (const repoPath of paths) {
    const loaded = await manifest.load(repoPath);
    services.set(repoPath, loaded.ok ? loaded.data.service : serviceFallback(repoPath));
  }
  const seen = new Set<string>();
  const targets: { service: string; repoPath: string; sourceBranch: string | undefined; runMigrations?: boolean; cleanRestart?: boolean }[] = [];
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
    targets.push({
      service: services.get(repoPath) ?? serviceFallback(repoPath),
      repoPath,
      sourceBranch: item.sourceBranch,
      ...(item.runMigrations !== undefined ? { runMigrations: item.runMigrations } : {}),
      ...(item.cleanRestart !== undefined ? { cleanRestart: item.cleanRestart } : {}),
    });
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

  // Narrow the EDT members down to the confirmed selection before any lock is taken —
  // deselected services are excluded entirely (never touched, never reported). Reads only (a
  // local branch check per custom sourceBranch); the unexpected-branch gate and
  // assertAllowedBranch gating below still apply.
  type ConfiguredMember = {
    member: (typeof active.members)[number];
    sourceBranch: string | undefined;
    runMigrations?: boolean;
    cleanRestart?: boolean;
  };
  let configured: ConfiguredMember[] | null = null;
  if (selection !== undefined) {
    if (selection.length === 0) {
      return err('no-services-selected', 'No services selected — select at least one service before confirming.');
    }
    const seenSelection = new Set<string>();
    const kept: ConfiguredMember[] = [];
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
      kept.push({
        member,
        sourceBranch: item.sourceBranch,
        ...(item.runMigrations !== undefined ? { runMigrations: item.runMigrations } : {}),
        ...(item.cleanRestart !== undefined ? { cleanRestart: item.cleanRestart } : {}),
      });
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
          : active.members.map((member): ConfiguredMember => ({ member, sourceBranch: undefined }));
      const enlisted = shortlist.filter(({ member }) => {
        const key = resolve(member.repoPath);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      const rows = await runPool<ConfiguredMember, GroupUpdateRepoResult>(
        enlisted,
        {
          concurrency: params.concurrency ?? 1,
          keyOf: ({ member }) => resolve(member.repoPath),
          ...(params.ordering !== undefined
            ? { stageOf: ({ member }) => params.ordering?.({ service: member.service, repoPath: member.repoPath }) ?? 0 }
            : {}),
          ...(params.afterStage !== undefined
            ? { afterStage: (stage: number, stageRows: (GroupUpdateRepoResult | undefined)[], control: StageControl) => params.afterStage?.(stage, stageRows.filter((row): row is GroupUpdateRepoResult => row !== undefined), control) }
            : {}),
          onCancelled: ({ member }) => {
            const row = runCancelledRow(member.service, member.repoPath, 'before it started');
            emitServiceResult(params.onServiceResult, row);
            return row;
          },
          onError: ({ member }, error) => {
            const row = failed(member.service, unexpectedError(error));
            emitServiceResult(params.onServiceResult, row);
            return row;
          },
        },
        async ({ member, sourceBranch, runMigrations: memberMigrations, cleanRestart: memberCleanRestart }, control) => {
          // `cancel-run` stops the pool but still returns `ok` with rows so far.
          const outcome = await updateMember(
            manifest,
            git,
            container,
            migration,
            restart,
            active.ulid,
            member,
            pausingSeam(params.onUpdateBlocker, control),
            sourceBranch,
            memberMigrations ?? runMigrations,
            memberCleanRestart ?? cleanRestart,
            params.onPhase,
            control.cancelled,
            params.autoResolveConflict,
          );
          if (outcome.cancelRun) {
            control.cancel();
          }
          emitServiceResult(params.onServiceResult, outcome.row);
          return outcome.row;
        },
      );
      const results = rows.filter((row): row is GroupUpdateRepoResult => row !== undefined);
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

// The shared restart step, called by `updateWithLoadedManifest` and the standalone
// single-service use-case. Recipe (cleanRestart on + non-empty `restartCommands`): each
// command runs in the repo's working directory in declared order via the restart port,
// stopping on the first failure (normalized to a `restart-failed` detail naming the repo, the
// command, and the error output). Otherwise the plain container restart runs — never both
// ports for the same service in the same action.
export interface RestartStepInput {
  container: ContainerPort;
  restart: RestartPort;
  containerName: string | undefined;
  restartCommands: string[] | undefined;
  repoPath: string;
  cleanRestart: boolean;
  // The service label the phase observer reports under, plus the observer itself — emitted
  // once at the restart boundary so the group and standalone paths share the same
  // `restarting` signal (a mid-recipe stop still reports the failure below, never a second
  // phase).
  service: string;
  onPhase?: OnUpdatePhase;
}

export async function runRestartStep(input: RestartStepInput): Promise<Result<void>> {
  const { container, restart, containerName, restartCommands, repoPath, cleanRestart, service, onPhase } = input;
  emitPhase(onPhase, service, 'restarting');
  if (cleanRestart && restartCommands !== undefined && restartCommands.length > 0) {
    for (const command of restartCommands) {
      const restarted = await restart.run(repoPath, command);
      if (!restarted.ok) {
        return err(
          'restart-failed',
          `Repo ${repoPath} restart "${command}" failed: ${restarted.error.message}`,
        );
      }
    }
    return ok(undefined);
  }
  if (containerName === undefined || containerName.trim() === '') {
    return err('no-container', `Repo ${repoPath} declares no container — nothing to restart`);
  }
  const restarted = await container.restart(containerName);
  if (!restarted.ok) {
    // Every row's detail names its repoPath — with duplicate service names in one EDT,
    // the code alone can't tell two rows apart.
    return err(
      restarted.error.code,
      `Repo ${repoPath} container "${containerName}" failed to restart: ${restarted.error.message}`,
    );
  }
  return ok(undefined);
}

// The row of a service the run was cancelled for: `skipped`, never `failed`, so the summary
// still accounts for it.
function runCancelledRow(service: string, repoPath: string, when: string): GroupUpdateRepoResult {
  return {
    service,
    outcome: 'skipped',
    detail: { code: 'run-cancelled', message: `Repo ${repoPath} update cancelled with the run ${when}` },
  };
}

// Wraps the blocker seam so a service waiting on the developer gives its pool slot to the next
// service, and takes one again (behind the waiting ones) once answered. A pool of one keeps
// its slot: that run stays strictly sequential, a blocker waits for the developer exactly as
// before.
function pausingSeam(seam: OnUpdateBlocker | undefined, control: PoolControl): OnUpdateBlocker | undefined {
  if (seam === undefined) {
    return undefined;
  }
  if (control.concurrency <= 1) {
    return seam;
  }
  return async (blocker) => {
    control.release();
    try {
      return await seam(blocker);
    } finally {
      await control.reacquire();
    }
  };
}

// A worker that threw (never-throw invariant, AD-3) becomes that service's failed row.
function unexpectedError(error: unknown): ResultError {
  const detail = error instanceof Error ? error.message : String(error);
  return { code: 'internal-error', message: detail };
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
  onPhase?: OnUpdatePhase,
  shouldStop?: () => boolean,
  autoResolveConflict?: AutoResolveConflict,
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
    onPhase,
    shouldStop,
    autoResolveConflict,
  );
}

// The per-repo outcome plus the `cancel-run` loop-stop signal. The cancelled
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

// Shared per-service flow for both scopes: pull/merge → migrate → restart. The EDT scope
// passes its recorded `branch` plus its ulid (unexpected-branch gate + gated write); the
// all-repos scope passes neither, operating on `currentBranch` as-is (`==sourceBranch` →
// `pull`, else `fetch` + ungated `assertAllowedBranch` + `mergeBranch`). The migrate phase runs
// only when `runMigrations` is on; `cleanRestart` runs the `restartCommands` recipe when
// declared.
//
// Assisted resolution: lockfile-only dirt is silently discarded (seam or not); a pre-existing
// mid-merge/mid-rebase surfaces as its own state before any menu and is never aborted; any
// other dirty worktree or mid-run conflict pauses on the `onUpdateBlocker` seam when present
// (without it, the repo is skipped or its merge aborted). Every resumed repo is re-verified
// before continuing; one repo's resolution never touches another repo.
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
  onPhase?: OnUpdatePhase,
  shouldStop?: () => boolean,
  autoResolveConflict?: AutoResolveConflict,
): Promise<RepoOutcome> {
  const { container: containerName, migrationCommand, restartCommands } = loaded;
  // A cancelled run lets in-flight services finish their current step, then stops them before
  // the next one — no subprocess is ever killed.
  const stopped = (when: string): RepoOutcome | undefined =>
    shouldStop?.() === true ? { row: runCancelledRow(service, repoPath, when), cancelRun: false } : undefined;
  const stoppedEarly = stopped('before it started');
  if (stoppedEarly !== undefined) {
    return stoppedEarly;
  }
  // The configured merge source — the manifest `sharedBranch` unless the pre-run screen
  // confirmed a per-service override (trimmed once inside `effectiveSourceBranch`, so padding
  // never reaches fetch/merge). Merge stays `git merge`, never rebase.
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

  // A pre-existing mid-merge/mid-rebase is detected as its own case before the dirty gate and
  // before any pull/merge of this run. Core aborts only merges the current run started — this
  // state is never aborted, only reported (seam or not), with the menu applying after the
  // report.
  const settledPreexisting = await settlePreexistingMidState(service, repoPath, git, onUpdateBlocker);
  if (!settledPreexisting.resumed) {
    return settledPreexisting.cancelRun
      ? { row: settledPreexisting.row, cancelRun: true }
      : { row: settledPreexisting.row, cancelRun: false };
  }

  // Dirty gate: lockfile-only dirt is discarded silently (seam or not) and the repo proceeds;
  // any other dirt pauses on the seam when present, else is a `skipped`/`dirty-worktree` row.
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

  const stoppedBeforeMerge = stopped('before its merge');
  if (stoppedBeforeMerge !== undefined) {
    return stoppedBeforeMerge;
  }
  const headBefore = await git.headRevision(repoPath);
  let conflictOutcome: GroupUpdateRunDetail['conflict'];

  if (current.data === mergeSource) {
    // The live current-step signal for the pull path.
    emitPhase(onPhase, service, 'pulling');
    const pulled = await git.pull(repoPath);
    if (!pulled.ok) {
      // A conflicting pull leaves the repo mid-merge exactly like a conflicting merge does —
      // without a seam, abort back to the pre-run HEAD and report it as such; with a seam,
      // the bounded resolution menu applies. Any other pull failure keeps its own code.
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
          autoResolveConflict,
          shouldStop,
        );
        // A resumed conflict rejoins the pipeline below (migrate → restart); a settled
        // one already carries its row.
        if (settlement.done) {
          return settlement.outcome;
        }
        conflictOutcome = settlement.conflict;
      } else {
        return failedOutcome(service, pulled.error);
      }
    }
  } else {
    // The live current-step signal for the fetch+merge path.
    emitPhase(onPhase, service, 'merging');
    const fetched = await git.fetch(repoPath, mergeSource);
    if (!fetched.ok) {
      const settlement = await resolveUnpushedCommits(service, git, repoPath, mergeSource, fetched.error, onUpdateBlocker);
      if (!settlement.resumed) {
        return { row: settlement.row, cancelRun: settlement.cancelRun };
      }
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
          autoResolveConflict,
          shouldStop,
        );
        if (settlement.done) {
          return settlement.outcome;
        }
        conflictOutcome = settlement.conflict;
      } else {
        return failedOutcome(service, merged.error);
      }
    }
  }

  const mergeDetail = await readMergeDetail(git, repoPath, headBefore.ok ? headBefore.data : undefined);
  const runDetail: Partial<GroupUpdateRunDetail> = {};
  if (mergeDetail !== undefined) {
    runDetail.merge = mergeDetail;
  }
  runDetail.migrations = { kind: 'none' };
  if (conflictOutcome !== undefined) {
    runDetail.conflict = conflictOutcome;
  }

  // The migrate phase runs between the pull/merge and the restart: the manifest-declared
  // `migrationCommand` (skipped without error when absent or blank) runs with the repo as its
  // working directory, and only when the run-wide migrate toggle is on. A failing migration
  // keeps the repo on its merged code but skips the restart — a `failed` row with
  // `migration-failed` detail naming the command and the error output — and never blocks or
  // rolls back the other services.
  const stoppedBeforeMigration = stopped('after its merge — migration and restart not run');
  if (stoppedBeforeMigration !== undefined) {
    return stoppedBeforeMigration;
  }
  if (runMigrations && migrationCommand !== undefined && migrationCommand.trim() !== '') {
    // The live current-step signal for the migrate phase.
    emitPhase(onPhase, service, 'migrating');
    const migrated = await migration.run(repoPath, migrationCommand);
    if (!migrated.ok) {
      return failedOutcome(service, {
        code: MIGRATION_FAILED_CODE,
        message: `Repo ${repoPath} migration "${migrationCommand}" failed: ${migrated.error.message}`,
      });
    }
    runDetail.migrations = { kind: 'ran', command: migrationCommand, outputExcerpt: outputExcerpt(migrated.data.output) };
  }

  const stoppedBeforeRestart = stopped('before its restart');
  if (stoppedBeforeRestart !== undefined) {
    return stoppedBeforeRestart;
  }
  // The restart phase, shared with the standalone single-service use-case via runRestartStep
  // (which also emits the `restarting` phase).
  const restarted = await runRestartStep({ container, restart, containerName, restartCommands, repoPath, cleanRestart, service, onPhase });
  if (!restarted.ok) {
    if (restarted.error.code === 'no-container') {
      // Nothing to restart is not a skipped update: the merge and migrations ran, so the row is
      // `updated` (a container-less shared-types source must still reach its publish phase).
      return { row: { service, outcome: 'updated', run: runDetail }, cancelRun: false };
    }
    return failedOutcome(service, restarted.error);
  }

  return { row: { service, outcome: 'updated', run: runDetail }, cancelRun: false };
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

// Asks the driving-provided seam for a blocker choice. A throwing seam (a driving-side bug —
// dispatch maps top-level throws to `internal-error`) is folded into a per-service `failed`
// row here instead, so one repo's menu failure never strands the others' rows; an unknown
// choice string is the same class of driving bug.
async function askSeam(
  onUpdateBlocker: OnUpdateBlocker,
  blocker: UpdateBlocker,
): Promise<{ choice: UpdateBlockerChoice } | { error: ResultError }> {
  try {
    const choice = await onUpdateBlocker(blocker);
    if (choice !== 'stash' && choice !== 'edited' && choice !== 'cancel-repo' && choice !== 'cancel-run' && choice !== 'fetch') {
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

// Re-verifies a repo before resuming it after a `stash`/`edited` choice: no mid-merge, no
// mid-rebase, and zero dirty paths. Real conflict content is never auto-resolved here — this
// only reads state.
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

// Pre-existing mid-merge/mid-rebase settlement. Without a seam this is a distinct `skipped`
// row (never the dirty/conflict codes, never aborted); with a seam the same four-choice menu
// applies after the report, and cancel choices never abort the pre-existing state (only
// merges this run started are ever aborted). Resumption means the mid-state cleared —
// ordinary dirt left behind falls through to the dirty gate, which re-reads the tree fresh.
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

// Ordinary (non-lockfile) dirty-worktree settlement. Without a seam this is a
// `skipped`/`dirty-worktree` row with zero writes; with a seam the run waits on the
// four-choice menu and resumes only after a passing re-verification (`stash` stashes via the
// git port, `edited` re-verifies a driving-side edit; still dirty re-presents).
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

// A rejected `fetch origin <b>:<b>` is almost always a local branch carrying commits origin
// lacks (git refuses to move a branch backwards). Core refreshes `origin/<b>` with a plain
// fetch and lists those commits: none → the failure is something else (network, auth) and
// stays the original `git-fetch-error`; some → the repo is stopped with an explicit message
// naming them. Without a seam that is a `failed` row; with one the developer chooses: `fetch`
// (carry on with the local branch as is), `edited` (fix it in the editor — e.g. push — then the
// strict fetch is retried), or one of the two cancels.
function unpushedMessage(service: string, branch: string, commits: readonly string[]): string {
  return `There are unpushed commits on branch ${branch} of service ${service}, which prevents a clean fetch: ${commits.join(' | ')}`;
}

async function resolveUnpushedCommits(
  service: string,
  git: GitPort,
  repoPath: string,
  branch: string,
  fetchError: ResultError,
  onUpdateBlocker: OnUpdateBlocker | undefined,
): Promise<BlockerSettlement> {
  const refreshed = await git.fetchRemote(repoPath, branch);
  if (!refreshed.ok) {
    return { resumed: false, row: failed(service, fetchError), cancelRun: false };
  }
  const listed = await git.listUnpushedCommits(repoPath, branch);
  if (!listed.ok || listed.data.length === 0) {
    return { resumed: false, row: failed(service, fetchError), cancelRun: false };
  }
  let commits = listed.data;
  if (onUpdateBlocker === undefined) {
    return {
      resumed: false,
      row: failed(service, { code: 'unpushed-commits', message: unpushedMessage(service, branch, commits) }),
      cancelRun: false,
    };
  }
  let retry = 0;
  let retryReason = '';
  for (;;) {
    const blocker: UpdateBlocker = {
      service,
      repoPath,
      kind: 'unpushed-commits',
      branch,
      commits,
      ...(retry > 0 ? { retry, retryReason } : {}),
    };
    const asked = await askSeam(onUpdateBlocker, blocker);
    if ('error' in asked) {
      return { resumed: false, row: failed(service, asked.error), cancelRun: false };
    }
    if (asked.choice === 'cancel-repo' || asked.choice === 'cancel-run') {
      return {
        resumed: false,
        row: {
          service,
          outcome: 'skipped',
          detail: { code: 'unpushed-commits', message: `Repo ${repoPath} update cancelled by developer — left untouched` },
        },
        cancelRun: asked.choice === 'cancel-run',
      };
    }
    if (asked.choice === 'fetch') {
      // The plain fetch already ran above; the local branch (a superset of origin's) is merged as is.
      return { resumed: true };
    }
    // `edited` (or an unavailable `stash`): retry the strict fetch the editor session may have unblocked.
    const retried = await git.fetch(repoPath, branch);
    if (retried.ok) {
      return { resumed: true };
    }
    retry += 1;
    retryReason = 'Local branch still has commits origin lacks';
    await git.fetchRemote(repoPath, branch);
    const again = await git.listUnpushedCommits(repoPath, branch);
    if (again.ok && again.data.length > 0) {
      commits = again.data;
    }
  }
}

// Mid-run conflict settlement (a merge — or pull — this run started now leaves the repo
// mid-merge). Without a seam this is an abort-and-report `failed`/`merge-conflict` row; with
// a seam there is no abort and no retry bound: every `edited` choice retries the update, and
// any attempt that does not settle the conflict re-presents the menu with an incremented
// `retry` counter and its reason. The only clean exits from an unresolvable conflict are the
// two cancel choices, which abort the own-started merge and land a `skipped` row. A resumed
// conflict rejoins the caller's pipeline (migrate → restart) via `{ done: false }`.
type ConflictSettlement = { done: true; outcome: RepoOutcome } | { done: false; conflict?: GroupUpdateRunDetail['conflict'] };

async function resolveMidRunConflict(
  service: string,
  git: GitPort,
  repoPath: string,
  conflict: ResultError,
  onUpdateBlocker: OnUpdateBlocker | undefined,
  via: 'pull' | 'merge',
  sharedBranch: string,
  autoResolveConflict?: AutoResolveConflict,
  shouldStop?: () => boolean,
): Promise<ConflictSettlement> {
  if (onUpdateBlocker === undefined) {
    return { done: true, outcome: await failConflicted(service, git, repoPath, conflict) };
  }
  let retry = 0;
  let retryReason = '';
  // What the auto-resolver did across the whole conflict: whether it settled anything, the
  // first issue note it raised (kept while the conflict stays unresolved), the issue of its
  // last pass, and whether the developer was ever asked.
  let touched = false;
  let note: string | undefined;
  let lastIssue: string | undefined;
  let menuShown = false;
  const conflictOutcome = (): GroupUpdateRunDetail['conflict'] => {
    if (touched) {
      return menuShown || lastIssue !== undefined ? 'partial' : 'auto-resolved';
    }
    return note !== undefined ? 'left-to-user' : undefined;
  };
  const tagged = (outcome: RepoOutcome): RepoOutcome => {
    // A row that did not finish its merge is never `auto-resolved`.
    const raw = conflictOutcome();
    const value = raw === 'auto-resolved' ? 'partial' : raw;
    return value === undefined ? outcome : { ...outcome, row: { ...outcome.row, run: { ...outcome.row.run, conflict: value } } };
  };
  // One auto-resolve pass; a throwing seam is an issue note, never a failed run. A stopped run
  // never starts one.
  const autoPass = async (): Promise<{ touched: boolean }> => {
    if (autoResolveConflict === undefined || shouldStop?.() === true) {
      return { touched: false };
    }
    try {
      const result = await autoResolveConflict({ service, repoPath });
      touched = touched || result.touched;
      lastIssue = result.issue;
      if (result.issue !== undefined) {
        note = result.issue;
      }
      return { touched: result.touched };
    } catch (error) {
      lastIssue = `Auto-resolution failed: ${error instanceof Error ? error.message : String(error)}`;
      note = lastIssue;
      return { touched: false };
    }
  };
  let skipPreMenuPass = false;
  for (;;) {
    if (!skipPreMenuPass) {
      const pass = await autoPass();
      if (pass.touched) {
        // The resolver may have settled everything: finalize without bothering the developer.
        const settled = await attemptEdited(git, repoPath, via, sharedBranch);
        if (settled.type === 'resumed') {
          return { done: false, conflict: conflictOutcome() };
        }
        if (settled.type === 'failed') {
          return { done: true, outcome: tagged(settled.outcome(service)) };
        }
        // Blocked (unmerged paths remain, or finalize refused): the menu takes over, uncounted.
      }
    }
    skipPreMenuPass = false;
    const blocker: UpdateBlocker = {
      service,
      repoPath,
      kind: 'merge-conflict',
      ...(retry > 0 ? { retry, retryReason } : {}),
      ...(note !== undefined ? { autoResolveNote: note } : {}),
    };
    menuShown = true;
    const asked = await askSeam(onUpdateBlocker, blocker);
    if ('error' in asked) {
      return { done: true, outcome: tagged(await failConflicted(service, git, repoPath, asked.error)) };
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
      return { done: true, outcome: tagged({ row, cancelRun: asked.choice === 'cancel-run' }) };
    }
    // `stash` is never run on a conflict (the TUI does not offer it): git refuses to stash
    // unmerged paths, and on a resolved-but-uncommitted merge it would shelve the
    // resolution and clear the merge — a seam answering it just re-presents the menu.
    let attempt: ConflictAttempt;
    if (asked.choice === 'stash') {
      attempt = { type: 'blocked', reason: 'Stash is not available during a merge conflict' };
    } else {
      // After the developer's edit the resolver runs again: with `package.json` now settled it
      // regenerates and stages the lockfile before the merge is finalized.
      await autoPass();
      skipPreMenuPass = true;
      attempt = await attemptEdited(git, repoPath, via, sharedBranch);
    }
    if (attempt.type === 'resumed') {
      return { done: false, conflict: conflictOutcome() };
    }
    if (attempt.type === 'failed') {
      return { done: true, outcome: tagged(attempt.outcome(service)) };
    }
    // Still blocked → re-present the menu, counting the failed attempt.
    retry += 1;
    retryReason = attempt.reason;
  }
}

// One resolution attempt's verdict: `resumed` rejoins the pipeline, `blocked` re-presents
// the menu with its reason, `failed` ends the repo on a non-conflict error (a git read or
// a non-conflict pull/merge failure — retrying the menu cannot fix those).
type ConflictAttempt =
  | { type: 'resumed' }
  | { type: 'blocked'; reason: string; unmerged?: boolean }
  | { type: 'failed'; outcome: (service: string) => RepoOutcome };

function failedAttempt(error: ResultError): ConflictAttempt {
  return { type: 'failed', outcome: (service) => failedOutcome(service, error) };
}

// `edited` — the developer resolved by hand driving-side. Still mid-merge: zero unmerged
// paths finalizes the merge commit; anything else re-presents (never aborts — the tree
// carries the developer's own in-the-moment resolution). No longer mid-merge (committed or
// aborted from the editor): a clean tree retries the update — a no-op when the merge was
// committed, a fresh conflict when it was aborted.
async function attemptEdited(git: GitPort, repoPath: string, via: 'pull' | 'merge', sharedBranch: string): Promise<ConflictAttempt> {
  const merging = await git.isMergeInProgress(repoPath);
  if (!merging.ok) {
    return failedAttempt(merging.error);
  }
  if (merging.data) {
    const unmerged = await git.hasUnmergedPaths(repoPath);
    if (!unmerged.ok) {
      return failedAttempt(unmerged.error);
    }
    if (unmerged.data) {
      return { type: 'blocked', reason: 'Unmerged paths remain — resolve and stage (git add) every conflicted file', unmerged: true };
    }
    const finalized = await git.finalizeMerge(repoPath);
    if (!finalized.ok) {
      return { type: 'blocked', reason: finalized.error.message };
    }
    return { type: 'resumed' };
  }
  const verify = await reverifyClean(git, repoPath);
  if (!verify.ok) {
    return failedAttempt(verify.error);
  }
  if (!verify.data) {
    return { type: 'blocked', reason: 'The merge is no longer in progress but the worktree has uncommitted changes' };
  }
  return retryUpdate(git, repoPath, via, sharedBranch);
}

// One re-pull/re-merge on a settled tree: a clean one resumes, a conflicting one leaves the
// repo mid-merge again and re-presents the menu, any other failure keeps its own code.
async function retryUpdate(git: GitPort, repoPath: string, via: 'pull' | 'merge', sharedBranch: string): Promise<ConflictAttempt> {
  if (via === 'pull') {
    const retried = await git.pull(repoPath);
    if (retried.ok) {
      return { type: 'resumed' };
    }
    const stillMerging = await git.isMergeInProgress(repoPath);
    if (stillMerging.ok && stillMerging.data) {
      return { type: 'blocked', reason: `Retried pull conflicted again: ${retried.error.message}` };
    }
    return failedAttempt(retried.error);
  }
  const retried = await git.mergeBranch(repoPath, sharedBranch);
  if (retried.ok) {
    return { type: 'resumed' };
  }
  if (retried.error.code === 'merge-conflict') {
    return { type: 'blocked', reason: `Retried merge conflicted again: ${retried.error.message}` };
  }
  return failedAttempt(retried.error);
}
