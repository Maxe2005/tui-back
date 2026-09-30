// core/edt/switch: the core use-case for switching the active EDT (FR-6/FR-8, story 2.4;
// three-state partition and dirty-service resolutions, story 2.39).
//
// Classification (story 2.39): every registered repo is classified against the OUTGOING EDT
// (`classifySwitchRepos`, a pure helper):
//   - state 1 — a member of the outgoing EDT;
//   - state 2 — a member of some other EDT (the target included) but not of the outgoing one;
//   - state 3 — a member of no EDT at all.
// The DESTINATION stays target-driven (FR-8): a target member goes to its own registered
// branch (re-verified by `assertAllowedBranch(..., target.ulid)`, AD-8, then its
// target-tagged stash is popped back in); any other repo goes to its manifest `sharedBranch`,
// fetched first if absent locally — regardless of stale membership elsewhere.
//
// Whose uncommitted work is it? A dirty state-1 repo holds the outgoing EDT's work: it is
// stashed under `tui-back:<outgoing ulid>` before checkout, no question asked, and is popped
// back only by a later switch INTO the outgoing EDT (that switch's member path pops its own
// target-tagged stash). A dirty state-2/3 repo holds work that belongs to no outgoing member,
// so it is never moved silently: it needs an explicit per-repo `DirtyResolution` —
//   - `adopt` — the work joins the outgoing EDT: gate the branch (`assertAllowedBranch` with
//     the outgoing ulid) → stash under the outgoing tag → create the branch from the current
//     HEAD branch if it differs (never checked out) → register the repo as an outgoing member
//     (`addMemberUnderLock`, modify.ts's lock-held edts.yaml assembly) → checkout. The stash
//     then rides the ordinary state-1 return path onto the adopted branch.
//   - `discard` — the dirty paths are captured (untracked expanded to files), then
//     `git.discardAll` (reset --hard + clean -fd, never -x) runs, then checkout.
// This replaces the old fixed `tui-back:shared` round-trip, which popped a non-member's work
// straight back onto the shared branch (D1) and stashed a target-only member under the
// outgoing tag (D2).
//
// Pre-flight: before ANY git write, the dirtiness of every registered repo is re-read. A
// failed read just leaves that repo out (the main loop re-reads and reports it `failed`).
// When a dirty state-2/3 repo exists, resolutions come from the caller's explicit
// `dirtyResolutions` (CLI path, which skips the seam) or else from the
// `onDirtyReposBeforeSwitch` seam (TUI path), invoked once with every dirty repo — state-1 rows
// flagged `resolution: 'auto-stash'`. `cancel` → `switch-cancelled-by-user`; any dirty
// state-2/3 repo still without a resolution → `switch-dirty-services-unresolved`; an `adopt`
// with no outgoing EDT (first switch) → `switch-adopt-without-outgoing`. All three return
// with zero repos touched and state.json/edts.yaml untouched. With no seam and no
// resolutions (the CLI today), a dirty state-2/3 repo therefore fails safe.
//
// Per-repo isolation mirrors create.ts: one repo's failure is a `failed` row, never aborts
// the others or the state.json write. A repo that turned dirty after the pre-flight with no
// resolution is a `failed` row (`switch-dirty-unresolved`), left untouched. Once anything is
// stashed, every failure before the checkout lands restores that stash before reporting.
// state.json's activeEdt is updated once the target is resolved and no blocking lock
// applies, independent of individual repo outcomes.
//
// The `edt:<outgoingUlid>` lock-peek is a non-blocking, non-mutating read (LockPort.peek) —
// `--force` past a held lock never aborts or kills anything; it only marks the outgoing EDT
// `interrupted` and proceeds.
import { resolve } from 'node:path';
import { withActionLock } from '../locking.js';
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort, EdtStatus } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { err, ok, type Result, type ResultError } from '../result.js';
import { addMemberUnderLock } from './modify.js';
import { isSharedBranch } from './shared-branches.js';

export interface SwitchEdtRepoResult {
  service: string;
  outcome: 'switched' | 'adopted' | 'discarded' | 'failed';
  // `discardedPaths` (story 2.39): on a `discarded` row, exactly the paths the discard removed
  // (captured before `discardAll`, untracked directories expanded to files).
  // `adoptedBranch` (story 2.41): on an `adopted` row, the branch the work was adopted onto
  // in the outgoing EDT (the TUI's action log records it).
  detail?: { code: string; message: string; discardedPaths?: string[]; adoptedBranch?: string };
}

// Story 2.39: a caller's explicit decision for one dirty state-2/3 repo (see the file header).
// `confirmedPaths` (story 2.41 review): the exact paths the user confirmed destroying (the TUI's
// discard confirmation, from the pre-flight `dirtyPaths` snapshot). When set, the discard step
// refuses — `failed` row `switch-discard-paths-changed`, repo untouched — if its fresh capture
// holds any path outside it (a file changed while the dialog was open). The CLI never sets it,
// so its discard behavior is unchanged.
export type DirtyResolution = { kind: 'adopt'; branch: string } | { kind: 'discard'; confirmedPaths?: string[] };

export type SwitchDirtyScope = 'outgoing-member' | 'member-of-other-edt' | 'non-member';

// Story 2.39: one row per dirty registered repo, computed before any git write. State-1 rows
// (`outgoing-member`) carry `resolution: 'auto-stash'` — read-only information, they need no
// decision. State-2/3 rows are the ones a resolution is required for; `owningEdtTopics` lists
// the other EDTs claiming the repo (empty for a non-member).
// Story 2.41: `sharedBranch` is the repo's manifest shared branch (null when the manifest could
// not be loaded) — the TUI's advisory protected-name check needs it. `dirtyPaths` (state-2/3
// rows only) is a read-only `listDirtyPaths(..., {expandUntracked: true})` snapshot the TUI's
// discard confirmation lists; a failed read leaves it unset.
export interface SwitchDirtyRepo {
  service: string;
  repoPath: string;
  scope: SwitchDirtyScope;
  currentBranch: string;
  currentBranchShared: boolean;
  sharedBranch: string | null;
  owningEdtTopics: string[];
  dirtyPaths?: string[];
  resolution?: 'auto-stash';
}

export type SwitchDirtyReposChoice =
  | { kind: 'cancel' }
  | { kind: 'proceed'; resolutions: Record<string, DirtyResolution> };

export type OnDirtyReposBeforeSwitch = (dirty: SwitchDirtyRepo[]) => Promise<SwitchDirtyReposChoice>;

// The `details` of a `switch-dirty-services-unresolved` error: one entry per blocking repo.
export interface SwitchUnresolvedDirtyRepo {
  service: string;
  repoPath: string;
  scope: 'member-of-other-edt' | 'non-member';
  currentBranch: string;
}

export interface SwitchActiveEdtData {
  ulid: string;
  topic: string;
  results: SwitchEdtRepoResult[];
  // True when the target EDT's registry entry carried status 'interrupted' coming into this
  // switch (i.e. it was last left via a --force switch past its own held lock) — read before
  // this call flips it back to 'active'.
  wasInterrupted: boolean;
}

export interface SwitchActiveEdtParams {
  edtRegistry: EdtRegistryPort;
  registry: RegistryPort;
  manifest: ManifestPort;
  git: GitPort;
  lock: LockPort;
  state: StatePort;
  // Review patch (story 2.4): same resource key create.ts's own registry writes lock under
  // (AD-9) — this use-case writes edts.yaml too.
  edtRegistryResourceKey: string;
  topic: string;
  force?: boolean;
  // Story 2.39: explicit per-repo resolutions keyed by repoPath (the CLI path, story 2.40).
  // When supplied, the seam below is never invoked.
  dirtyResolutions?: Record<string, DirtyResolution>;
  // Story 2.39: the TUI's resolution seam — see the file header.
  onDirtyReposBeforeSwitch?: OnDirtyReposBeforeSwitch;
}

export type SwitchRepoState = 1 | 2 | 3;

export interface ClassifiedSwitchRepo {
  repoPath: string;
  state: SwitchRepoState;
  // Set when the repo is a member of the TARGET (decides the destination branch).
  targetMember?: EdtMember;
  // Topics of every EDT other than the outgoing one that lists this repo as a member.
  owningTopics: string[];
}

// Story 2.39: the pure three-state classifier (see the file header). Paths are compared
// resolve()'d on both sides; `targetMember.repoPath` is the resolved path.
export function classifySwitchRepos(
  registered: readonly string[],
  outgoing: EdtRegistryEntry | undefined,
  target: EdtRegistryEntry,
  allEdts: readonly EdtRegistryEntry[],
): ClassifiedSwitchRepo[] {
  const edts = allEdts.some((entry) => entry.ulid === target.ulid) ? allEdts : [...allEdts, target];
  const hasMember = (entry: EdtRegistryEntry, repoPath: string): boolean =>
    entry.members.some((candidate) => resolve(candidate.repoPath) === repoPath);

  return registered.map((rawPath) => {
    const repoPath = resolve(rawPath);
    const inOutgoing = outgoing !== undefined && hasMember(outgoing, repoPath);
    const owningTopics = edts
      .filter((entry) => entry.ulid !== outgoing?.ulid && hasMember(entry, repoPath))
      .map((entry) => entry.topic);
    const state: SwitchRepoState = inOutgoing ? 1 : owningTopics.length > 0 ? 2 : 3;
    const found = target.members.find((candidate) => resolve(candidate.repoPath) === repoPath);
    const classified: ClassifiedSwitchRepo = { repoPath, state, owningTopics };
    if (found !== undefined) {
      classified.targetMember = { ...found, repoPath };
    }
    return classified;
  });
}

export async function switchActiveEdt(params: SwitchActiveEdtParams): Promise<Result<SwitchActiveEdtData>> {
  const { edtRegistry, registry, manifest, git, lock, state, edtRegistryResourceKey, force = false } = params;

  const topic = params.topic.trim();
  if (topic === '') {
    return err('missing-argument', 'Usage: tui-back edt switch --to <topic> [--force]');
  }

  const listed = await edtRegistry.list();
  if (!listed.ok) {
    return listed;
  }

  const target = listed.data.find((candidate) => candidate.topic === topic);
  if (target === undefined) {
    return err('edt-not-found', `No EDT with topic "${topic}" is registered`);
  }

  const currentActive = await state.readActiveEdt();
  if (!currentActive.ok) {
    return currentActive;
  }

  const wasInterrupted = target.status === 'interrupted';

  // Already the active EDT: FR-1 idempotency — a no-op success, zero git calls, state.json
  // untouched.
  if (currentActive.data === target.ulid) {
    return ok({ ulid: target.ulid, topic: target.topic, results: [], wasInterrupted });
  }

  const outgoing =
    currentActive.data !== null ? listed.data.find((candidate) => candidate.ulid === currentActive.data) : undefined;

  // Blocked-by-default gate: a non-blocking peek at the outgoing EDT's action lock, before
  // any repo is touched. --force never aborts the held action (no abort primitive exists
  // yet) — it only records the outgoing EDT as interrupted and proceeds regardless.
  let outgoingFinalStatus: EdtStatus | undefined;
  if (outgoing !== undefined) {
    const peeked = await lock.peek(`edt:${outgoing.ulid}`);
    if (!peeked.ok) {
      return peeked;
    }
    if (peeked.data.locked) {
      if (!force) {
        return err(
          'switch-blocked-action-in-progress',
          `Cannot switch away from "${outgoing.topic}": an action is currently in progress on it. Pass --force to interrupt it and switch anyway.`,
        );
      }
      outgoingFinalStatus = 'interrupted';
    } else {
      outgoingFinalStatus = 'inactive';
    }
  }

  const registered = await registry.list();
  if (!registered.ok) {
    return registered;
  }

  const registeredPaths = new Set(registered.data.map((rawPath) => resolve(rawPath)));
  const classified = classifySwitchRepos(registered.data, outgoing, target, listed.data);

  // Pre-flight: before any git write (see the file header).
  const preflight = await resolveDirtyRepos({ params, git, manifest, classified, outgoing, topic });
  if (!preflight.ok) {
    return preflight;
  }

  const context: RepoSwitchContext = {
    git,
    manifest,
    edtRegistry,
    lock,
    edtRegistryResourceKey,
    outgoing,
    target,
  };
  const results: SwitchEdtRepoResult[] = [];
  for (const repo of classified) {
    const resolution = preflight.data.get(repo.repoPath);
    results.push(
      repo.targetMember !== undefined
        ? await switchMemberRepo(context, repo, repo.targetMember, resolution)
        : await switchNonMemberRepo(context, repo, resolution),
    );
  }

  // Review patch (story 2.4): a target member whose repoPath has since dropped out of the
  // managed-repo registry used to be silently skipped — never checked out, no failure
  // reported, quietly breaking "every target member sits on its own registered branch" with
  // zero signal. Surfaced as `failed`, same per-repo isolation philosophy as every other row.
  for (const member of target.members) {
    if (!registeredPaths.has(resolve(member.repoPath))) {
      results.push(
        failed(member.service, {
          code: 'repo-not-registered',
          message: `Target member ${member.repoPath} is no longer in the managed-repo registry`,
        }),
      );
    }
  }

  // state.json and edts.yaml are updated once the target is resolved and no blocking lock
  // applies, independent of individual repo outcomes above (same philosophy as createEdt
  // still registering an EDT despite member failures) — but the two registry writes below
  // race with a concurrent `edt create`/`edt switch` on the same edts.yaml (AD-9) without this
  // lock, and a `setStatus` failure used to be swallowed to console.error while the overall
  // Result still reported ok:true. Both are review patches: the lock serializes the
  // read-modify-write the same way create.ts's own registry write does, and a setStatus
  // failure is now a `failed` row in `results` instead of a silent log line.
  const written = await withActionLock(lock, edtRegistryResourceKey, async () => {
    const wroteState = await state.writeActiveEdt(target.ulid);
    if (!wroteState.ok) {
      // Keep the per-repo results the caller already earned instead of discarding them —
      // they report what actually happened to each working tree even though the pointer
      // write itself failed.
      return err(wroteState.error.code, wroteState.error.message, { results });
    }

    const activated = await edtRegistry.setStatus(target.ulid, 'active');
    if (!activated.ok) {
      results.push(failed('edt-registry:activate-target', activated.error));
    }

    if (outgoing !== undefined && outgoingFinalStatus !== undefined) {
      const deactivated = await edtRegistry.setStatus(outgoing.ulid, outgoingFinalStatus);
      if (!deactivated.ok) {
        results.push(failed('edt-registry:deactivate-outgoing', deactivated.error));
      }
    }

    return ok(undefined);
  });
  if (!written.ok) {
    return written;
  }

  return ok({ ulid: target.ulid, topic: target.topic, results, wasInterrupted });
}

// Story 2.38: exported for activate.ts, which reports its per-repo rows the same way.
export function failed(service: string, error: ResultError): SwitchEdtRepoResult {
  return { service, outcome: 'failed', detail: { code: error.code, message: error.message } };
}

function stashMessage(ulid: string): string {
  return `tui-back:${ulid}`;
}

function scopeOf(state: SwitchRepoState): SwitchDirtyScope {
  return state === 1 ? 'outgoing-member' : state === 2 ? 'member-of-other-edt' : 'non-member';
}

// ---- Pre-flight -----------------------------------------------------------------------------

async function resolveDirtyRepos(input: {
  params: SwitchActiveEdtParams;
  git: GitPort;
  manifest: ManifestPort;
  classified: readonly ClassifiedSwitchRepo[];
  outgoing: EdtRegistryEntry | undefined;
  topic: string;
}): Promise<Result<Map<string, DirtyResolution>>> {
  const { params, git, manifest, classified, outgoing, topic } = input;

  const dirtyRows: SwitchDirtyRepo[] = [];
  for (const repo of classified) {
    const dirty = await git.hasUncommittedChanges(repo.repoPath);
    if (!dirty.ok || !dirty.data) {
      continue;
    }
    dirtyRows.push(await describeDirtyRepo(git, manifest, repo, outgoing));
  }
  const needingResolution = dirtyRows.filter((row) => row.scope !== 'outgoing-member');

  let supplied: Record<string, DirtyResolution> | undefined = params.dirtyResolutions;
  if (needingResolution.length > 0 && supplied === undefined && params.onDirtyReposBeforeSwitch !== undefined) {
    const choice = await params.onDirtyReposBeforeSwitch(dirtyRows);
    if (choice.kind === 'cancel') {
      return err(
        'switch-cancelled-by-user',
        `Switch to "${topic}" cancelled: uncommitted changes were present in one or more services.`,
      );
    }
    supplied = choice.resolutions;
  }

  const resolutions = new Map<string, DirtyResolution>();
  for (const [rawPath, resolution] of Object.entries(supplied ?? {})) {
    resolutions.set(resolve(rawPath), resolution);
  }

  const unresolved: SwitchUnresolvedDirtyRepo[] = needingResolution
    .filter((row) => !resolutions.has(row.repoPath))
    .map((row) => ({
      service: row.service,
      repoPath: row.repoPath,
      scope: row.scope as SwitchUnresolvedDirtyRepo['scope'],
      currentBranch: row.currentBranch,
    }));
  if (unresolved.length > 0) {
    return err(
      'switch-dirty-services-unresolved',
      `Switch to "${topic}" refused: uncommitted changes in ${unresolved.map((row) => row.service).join(', ')} are not in the outgoing EDT and have no resolution — commit or stash them by hand, then switch again (they can also be adopted or discarded from the TUI once available). Nothing was touched.`,
      unresolved,
    );
  }

  // Only the rows that actually need a resolution are validated: a stale adopt entry for a
  // clean or state-1 repo is a no-op in the main loop, so it must not abort the switch.
  for (const row of needingResolution) {
    const resolution = resolutions.get(row.repoPath);
    if (resolution?.kind !== 'adopt') {
      continue;
    }
    if (outgoing === undefined) {
      return err(
        'switch-adopt-without-outgoing',
        `Cannot adopt uncommitted changes in ${row.repoPath}: there is no active EDT to adopt them into. Discard them or cancel. Nothing was touched.`,
      );
    }
    if (resolution.branch.trim() === '') {
      return err('invalid-argument', `An adopt resolution for ${row.repoPath} needs a branch name. Nothing was touched.`);
    }
  }

  return ok(resolutions);
}

async function describeDirtyRepo(
  git: GitPort,
  manifest: ManifestPort,
  repo: ClassifiedSwitchRepo,
  outgoing: EdtRegistryEntry | undefined,
): Promise<SwitchDirtyRepo> {
  const loaded = await manifest.load(repo.repoPath);
  const outgoingMember = outgoing?.members.find((candidate) => resolve(candidate.repoPath) === repo.repoPath);
  const service =
    repo.targetMember?.service ?? outgoingMember?.service ?? (loaded.ok ? loaded.data.service : repo.repoPath);
  const current = await git.currentBranch(repo.repoPath);
  // GitPort.currentBranch fails on a detached or unborn HEAD (the adapter never returns the
  // literal `HEAD` as a branch) or on any git error; the row then shows `HEAD`, flagged
  // not-shared. An adopt of such a repo fails at its own currentBranch read — after the
  // read-only gate, before the stash — so it is a `failed` row with the repo untouched.
  const currentBranch = current.ok ? current.data : 'HEAD';
  const currentBranchShared = current.ok && loaded.ok ? isSharedBranch(currentBranch, loaded.data.sharedBranch) : false;
  const row: SwitchDirtyRepo = {
    service,
    repoPath: repo.repoPath,
    scope: scopeOf(repo.state),
    currentBranch,
    currentBranchShared,
    sharedBranch: loaded.ok ? loaded.data.sharedBranch : null,
    owningEdtTopics: repo.owningTopics,
  };
  if (repo.state === 1) {
    row.resolution = 'auto-stash';
  } else {
    const paths = await git.listDirtyPaths(repo.repoPath, { expandUntracked: true });
    if (paths.ok) {
      row.dirtyPaths = paths.data;
    }
  }
  return row;
}

// ---- Destination rule (shared with activate.ts, story 2.38) --------------------------------

// Where a repo goes when an EDT becomes active (FR-8): a member of that EDT goes to its own
// registered branch, any other repo to its manifest `sharedBranch`.
export type TargetBranchSpec = { kind: 'member'; branch: string; edtUlid: string } | { kind: 'shared'; branch: string };

// Makes the destination checkout-ready, from reads only — except the FR-8 fetch of a missing
// shared branch. A member branch is re-verified by the branch-scope gate
// (`assertAllowedBranch(..., edtUlid)`, AD-8, never assumed) and is never fetched or
// auto-created: missing (or unreadable) is `member-branch-missing`. A shared branch absent
// locally is fetched first.
export async function resolveTargetBranch(git: GitPort, repoPath: string, spec: TargetBranchSpec): Promise<Result<void>> {
  if (spec.kind === 'member') {
    const allowed = await git.assertAllowedBranch(repoPath, spec.branch, spec.edtUlid);
    if (!allowed.ok) {
      return allowed;
    }
  }
  const existsLocally = await git.branchExistsLocally(repoPath, spec.branch);
  if (!existsLocally.ok) {
    return existsLocally;
  }
  if (existsLocally.data) {
    return ok(undefined);
  }
  if (spec.kind === 'member') {
    return err('member-branch-missing', `Member branch "${spec.branch}" does not exist locally in ${repoPath} — left untouched`);
  }
  return git.fetch(repoPath, spec.branch);
}

// ---- Per-repo switch -------------------------------------------------------------------------

interface RepoSwitchContext {
  git: GitPort;
  manifest: ManifestPort;
  edtRegistry: EdtRegistryPort;
  lock: LockPort;
  edtRegistryResourceKey: string;
  outgoing: EdtRegistryEntry | undefined;
  target: EdtRegistryEntry;
}

// What to do with a repo's uncommitted work before its checkout — decided from reads only.
type DirtyPlan =
  | { kind: 'none' }
  | { kind: 'stash'; outgoingUlid: string }
  | { kind: 'adopt'; outgoing: EdtRegistryEntry; branch: string }
  | { kind: 'discard'; confirmedPaths?: string[] };

// The executed plan's effect, carried to the checkout step.
interface Prepared {
  outcome: 'switched' | 'adopted' | 'discarded';
  // The outgoing-tagged stash this repo's work sits in, when one was created by this switch.
  stashTag?: string;
  adoptedInto?: EdtRegistryEntry;
  adoptedBranch?: string;
  discardedPaths?: string[];
}

type Step<T> = { ok: true; value: T } | { ok: false; row: SwitchEdtRepoResult };

async function planDirtyWork(
  context: RepoSwitchContext,
  service: string,
  repo: ClassifiedSwitchRepo,
  resolution: DirtyResolution | undefined,
): Promise<Step<DirtyPlan>> {
  const dirty = await context.git.hasUncommittedChanges(repo.repoPath);
  if (!dirty.ok) {
    return { ok: false, row: failed(service, dirty.error) };
  }
  if (!dirty.data) {
    // Clean now — whatever resolution was given, there is nothing to preserve or discard.
    return { ok: true, value: { kind: 'none' } };
  }
  if (repo.state === 1 && context.outgoing !== undefined) {
    return { ok: true, value: { kind: 'stash', outgoingUlid: context.outgoing.ulid } };
  }
  if (resolution === undefined) {
    return {
      ok: false,
      row: failed(service, {
        code: 'switch-dirty-unresolved',
        message: `${repo.repoPath} has uncommitted changes and no resolution (not covered by the pre-flight) — left untouched`,
      }),
    };
  }
  if (resolution.kind === 'discard') {
    return {
      ok: true,
      value: resolution.confirmedPaths !== undefined ? { kind: 'discard', confirmedPaths: resolution.confirmedPaths } : { kind: 'discard' },
    };
  }
  if (context.outgoing === undefined) {
    return {
      ok: false,
      row: failed(service, {
        code: 'switch-adopt-without-outgoing',
        message: `Cannot adopt uncommitted changes in ${repo.repoPath}: there is no active EDT to adopt them into — left untouched`,
      }),
    };
  }
  const branch = resolution.branch.trim();
  if (branch === '') {
    return {
      ok: false,
      row: failed(service, {
        code: 'invalid-argument',
        message: `An adopt resolution for ${repo.repoPath} needs a branch name — left untouched`,
      }),
    };
  }
  return { ok: true, value: { kind: 'adopt', outgoing: context.outgoing, branch } };
}

async function executeDirtyPlan(
  context: RepoSwitchContext,
  service: string,
  repoPath: string,
  plan: DirtyPlan,
): Promise<Step<Prepared>> {
  const { git } = context;
  switch (plan.kind) {
    case 'none':
      return { ok: true, value: { outcome: 'switched' } };
    case 'stash': {
      const tag = stashMessage(plan.outgoingUlid);
      const stashed = await git.stashSave(repoPath, tag);
      if (!stashed.ok) {
        return { ok: false, row: failed(service, stashed.error) };
      }
      return { ok: true, value: { outcome: 'switched', stashTag: tag } };
    }
    case 'discard': {
      const captured = await git.listDirtyPaths(repoPath, { expandUntracked: true });
      if (!captured.ok) {
        return { ok: false, row: failed(service, captured.error) };
      }
      if (captured.data.length === 0) {
        return { ok: true, value: { outcome: 'switched' } };
      }
      if (plan.confirmedPaths !== undefined) {
        const confirmed = new Set(plan.confirmedPaths);
        const unconfirmed = captured.data.filter((path) => !confirmed.has(path));
        if (unconfirmed.length > 0) {
          const shown = unconfirmed.slice(0, UNCONFIRMED_PATHS_SHOWN).join(', ');
          const more = unconfirmed.length > UNCONFIRMED_PATHS_SHOWN ? ` (+${unconfirmed.length - UNCONFIRMED_PATHS_SHOWN} more)` : '';
          return {
            ok: false,
            row: failed(service, {
              code: 'switch-discard-paths-changed',
              message: `Uncommitted changes in ${repoPath} changed since the discard was confirmed (not confirmed: ${shown}${more}) — nothing discarded, left untouched`,
            }),
          };
        }
      }
      const discarded = await git.discardAll(repoPath);
      if (!discarded.ok) {
        // The reset may already have run before the clean failed: report what was targeted.
        return {
          ok: false,
          row: {
            service,
            outcome: 'failed',
            detail: {
              code: discarded.error.code,
              message: `${discarded.error.message}. The uncommitted changes may have been partially discarded.`,
              discardedPaths: captured.data,
            },
          },
        };
      }
      return { ok: true, value: { outcome: 'discarded', discardedPaths: captured.data } };
    }
    case 'adopt':
      return adoptDirtyWork(context, service, repoPath, plan.outgoing, plan.branch);
  }
}

// How many unconfirmed paths a `switch-discard-paths-changed` message names.
const UNCONFIRMED_PATHS_SHOWN = 10;

// The adopt steps, in the AC's order: (1) gate, (2) stash under the outgoing tag, (3) create
// the branch from the current HEAD branch if it differs (never checked out), (4) register the
// repo as an outgoing member under the edts.yaml lock. Any failure after the stash restores it.
async function adoptDirtyWork(
  context: RepoSwitchContext,
  service: string,
  repoPath: string,
  outgoing: EdtRegistryEntry,
  branch: string,
): Promise<Step<Prepared>> {
  const { git } = context;

  const allowed = await git.assertAllowedBranch(repoPath, branch, outgoing.ulid);
  if (!allowed.ok) {
    return { ok: false, row: failed(service, allowed.error) };
  }
  const current = await git.currentBranch(repoPath);
  if (!current.ok) {
    return { ok: false, row: failed(service, current.error) };
  }

  const tag = stashMessage(outgoing.ulid);
  const stashed = await git.stashSave(repoPath, tag);
  if (!stashed.ok) {
    return { ok: false, row: failed(service, stashed.error) };
  }

  let created = false;
  if (branch !== current.data) {
    const branchCreated = await git.createBranch(repoPath, branch, current.data);
    if (!branchCreated.ok) {
      return { ok: false, row: await restoreAndFail(git, service, repoPath, tag, branchCreated.error, '') };
    }
    created = true;
  }

  const registered = await addMemberUnderLock({
    edtRegistry: context.edtRegistry,
    lock: context.lock,
    edtRegistryResourceKey: context.edtRegistryResourceKey,
    edt: outgoing,
    member: { service, repoPath, branch },
  });
  if (!registered.ok) {
    const note = created ? ` Branch "${branch}" was created and is kept.` : '';
    return { ok: false, row: await restoreAndFail(git, service, repoPath, tag, registered.error, note) };
  }

  return { ok: true, value: { outcome: 'adopted', stashTag: tag, adoptedInto: outgoing, adoptedBranch: branch } };
}

// Restores the stash this switch just created (onto the branch the repo still sits on) and
// builds the `failed` row, saying so — or saying where the work still is when the restore
// itself fails.
async function restoreAndFail(
  git: GitPort,
  service: string,
  repoPath: string,
  tag: string,
  error: ResultError,
  note: string,
): Promise<SwitchEdtRepoResult> {
  const restored = await git.restoreStash(repoPath, tag);
  const where = restored.ok
    ? ' Uncommitted work restored in place.'
    : ` Restoring the stash also failed (${restored.error.message}) — the work is still stashed under "${tag}".`;
  return failed(service, { code: error.code, message: `${error.message}.${where}${note}` });
}

// Checkout failed after the dirty plan ran: undo what can be undone and say what was kept.
async function failAfterPrepare(
  git: GitPort,
  service: string,
  repoPath: string,
  prepared: Prepared,
  error: ResultError,
): Promise<SwitchEdtRepoResult> {
  if (prepared.outcome === 'discarded') {
    return {
      service,
      outcome: 'failed',
      detail: {
        code: error.code,
        message: `${error.message}. The uncommitted changes had already been discarded.`,
        discardedPaths: prepared.discardedPaths,
      },
    };
  }
  if (prepared.stashTag === undefined) {
    return failed(service, error);
  }
  const note =
    prepared.adoptedInto !== undefined
      ? ` Membership in "${prepared.adoptedInto.topic}" on branch "${prepared.adoptedBranch}" is kept (the branch exists and is registered).`
      : '';
  return restoreAndFail(git, service, repoPath, prepared.stashTag, error, note);
}

// The checkout landed but a later step (the target-stash pop) failed: nothing is undone —
// the row keeps what the dirty plan already did so it is never silently lost from the report.
function failAfterCheckout(service: string, prepared: Prepared, error: ResultError): SwitchEdtRepoResult {
  if (prepared.outcome === 'discarded') {
    return {
      service,
      outcome: 'failed',
      detail: {
        code: error.code,
        message: `${error.message}. The uncommitted changes had already been discarded.`,
        discardedPaths: prepared.discardedPaths,
      },
    };
  }
  if (prepared.adoptedInto !== undefined) {
    return failed(service, {
      code: error.code,
      message: `${error.message}. The adoption into "${prepared.adoptedInto.topic}" on "${prepared.adoptedBranch}" succeeded; the adopted work sits in its stash "${prepared.stashTag}".`,
    });
  }
  return failed(service, error);
}

function succeeded(service: string, prepared: Prepared): SwitchEdtRepoResult {
  if (prepared.outcome === 'discarded') {
    const paths = prepared.discardedPaths ?? [];
    return {
      service,
      outcome: 'discarded',
      detail: {
        code: 'discarded',
        message: `Discarded ${paths.length} uncommitted path(s)`,
        discardedPaths: paths,
      },
    };
  }
  if (prepared.outcome === 'adopted' && prepared.adoptedBranch !== undefined) {
    const into = prepared.adoptedInto !== undefined ? ` into "${prepared.adoptedInto.topic}"` : '';
    return {
      service,
      outcome: 'adopted',
      detail: {
        code: 'adopted',
        message: `Uncommitted work adopted${into} on branch "${prepared.adoptedBranch}"`,
        adoptedBranch: prepared.adoptedBranch,
      },
    };
  }
  return { service, outcome: prepared.outcome };
}

// A target member: re-verified against the branch-scope gate (AD-8, never assumed), its dirty
// work handled per its state, checked into its own registered branch, then its target-tagged
// stash (left by a past switch away from the target) popped back in.
async function switchMemberRepo(
  context: RepoSwitchContext,
  repo: ClassifiedSwitchRepo,
  member: EdtMember,
  resolution: DirtyResolution | undefined,
): Promise<SwitchEdtRepoResult> {
  const { git, target } = context;
  const { service, repoPath, branch } = member;

  // Resolve (and gate) the destination before touching the working tree, so a missing member
  // branch never follows an irreversible discard (or a needless stash).
  const destination = await resolveTargetBranch(git, repoPath, { kind: 'member', branch, edtUlid: target.ulid });
  if (!destination.ok) {
    return failed(service, destination.error);
  }

  const plan = await planDirtyWork(context, service, repo, resolution);
  if (!plan.ok) {
    return plan.row;
  }

  const prepared = await executeDirtyPlan(context, service, repoPath, plan.value);
  if (!prepared.ok) {
    return prepared.row;
  }

  const checkedOut = await git.checkout(repoPath, branch);
  if (!checkedOut.ok) {
    return failAfterPrepare(git, service, repoPath, prepared.value, checkedOut.error);
  }

  const popped = await git.restoreStash(repoPath, stashMessage(target.ulid));
  if (!popped.ok) {
    return failAfterCheckout(service, prepared.value, popped.error);
  }

  return succeeded(service, prepared.value);
}

// Any repo that is not a target member: its dirty work handled per its state, then checked
// out to its manifest sharedBranch (fetched first if absent locally). Nothing is popped —
// its outgoing-tagged stash (if any) waits for a return into the outgoing EDT.
async function switchNonMemberRepo(
  context: RepoSwitchContext,
  repo: ClassifiedSwitchRepo,
  resolution: DirtyResolution | undefined,
): Promise<SwitchEdtRepoResult> {
  const { git, manifest } = context;
  const { repoPath } = repo;

  const loaded = await manifest.load(repoPath);
  const service = loaded.ok ? loaded.data.service : repoPath;
  if (!loaded.ok) {
    return failed(service, loaded.error);
  }
  const sharedBranch = loaded.data.sharedBranch;

  const plan = await planDirtyWork(context, service, repo, resolution);
  if (!plan.ok) {
    return plan.row;
  }

  // Resolve the destination before touching the working tree, so a failed fetch never
  // follows an irreversible discard.
  const destination = await resolveTargetBranch(git, repoPath, { kind: 'shared', branch: sharedBranch });
  if (!destination.ok) {
    return failed(service, destination.error);
  }

  const prepared = await executeDirtyPlan(context, service, repoPath, plan.value);
  if (!prepared.ok) {
    return prepared.row;
  }

  const checkedOut = await git.checkout(repoPath, sharedBranch);
  if (!checkedOut.ok) {
    return failAfterPrepare(git, service, repoPath, prepared.value, checkedOut.error);
  }

  return succeeded(service, prepared.value);
}
