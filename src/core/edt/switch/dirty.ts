// core/edt/switch/dirty: the dirty-work half of the EDT switch. Pre-flight resolution of every
// dirty repo (resolveDirtyRepos), then per repo the plan (reads only), its execution (stash /
// discard / adopt) and the stash-restore failure path. No checkout happens here.
import { resolve } from 'node:path';
import type { EdtRegistryEntry } from '../../ports/edt-registry.js';
import type { GitPort } from '../../ports/git.js';
import type { ManifestPort } from '../../ports/manifest.js';
import { err, ok, type Result, type ResultError } from '../../result.js';
import { type CheckoutStep } from '../checkout-expected.js';
import { MANIFEST_FILE } from '../manifest-carry.js';
import { addMemberUnderLock } from '../modify.js';
import { isProtectedBranch } from '../shared-branches.js';
import {
  failed,
  type ClassifiedSwitchRepo,
  type DirtyResolution,
  type RepoSwitchContext,
  type SwitchActiveEdtParams,
  type SwitchDirtyRepo,
  type SwitchDirtyScope,
  type SwitchEdtRepoResult,
  type SwitchRepoState,
  type SwitchUnresolvedDirtyRepo,
} from './types.js';

export function stashMessage(ulid: string): string {
  return `tui-back:${ulid}`;
}

export function scopeOf(state: SwitchRepoState): SwitchDirtyScope {
  return state === 1 ? 'outgoing-member' : state === 2 ? 'member-of-other-edt' : 'non-member';
}

// ---- Pre-flight -----------------------------------------------------------------------------

export async function resolveDirtyRepos(input: {
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
    const dirty = await git.hasUncommittedChanges(repo.repoPath, { excludePaths: [MANIFEST_FILE] });
    if (!dirty.ok || !dirty.data) {
      continue;
    }
    dirtyRows.push(await describeDirtyRepo(git, manifest, repo, outgoing));
  }
  const needingResolution = dirtyRows.filter((row) => row.scope !== 'outgoing-member');

  let supplied: Record<string, DirtyResolution> | undefined = params.dirtyResolutions;
  if (needingResolution.length > 0 && supplied === undefined && params.dirtyPolicy === undefined && params.onDirtyReposBeforeSwitch !== undefined) {
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

  const policy = params.dirtyPolicy;
  if (policy !== undefined) {
    if (policy.kind === 'adopt' && outgoing === undefined && needingResolution.length > 0) {
      return err(
        'switch-adopt-without-outgoing',
        'Cannot adopt uncommitted changes: there is no active EDT to adopt them into. Use --discard-dirty or resolve them by hand. Nothing was touched.',
      );
    }
    for (const row of needingResolution) {
      if (resolutions.has(row.repoPath)) {
        continue;
      }
      if (policy.kind === 'discard') {
        resolutions.set(row.repoPath, { kind: 'discard' });
        continue;
      }
      if (row.currentBranchShared && (policy.branch === undefined || policy.branch.trim() === '')) {
        return err(
          'missing-argument',
          `${row.service} has uncommitted changes on the shared branch "${row.currentBranch}": adopting them needs a new branch name (--adopt-branch). Nothing was touched.`,
        );
      }
      resolutions.set(row.repoPath, {
        kind: 'adopt',
        branch: row.currentBranchShared ? (policy.branch as string) : row.currentBranch,
      });
    }
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
      `Switch to "${topic}" refused: uncommitted changes in ${unresolved.map((row) => row.service).join(', ')} are not in the outgoing EDT and have no resolution — commit or stash them by hand, then switch again (from the CLI, pass --discard-dirty or --adopt-dirty [--adopt-branch <name>]; the TUI offers the same choices in its dialog). Nothing was touched.`,
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
  const currentBranchShared = current.ok && loaded.ok ? isProtectedBranch(currentBranch, loaded.data) : false;
  const row: SwitchDirtyRepo = {
    service,
    repoPath: repo.repoPath,
    scope: scopeOf(repo.state),
    currentBranch,
    currentBranchShared,
    sharedBranch: loaded.ok ? loaded.data.sharedBranch : null,
    protectedBranches: loaded.ok ? (loaded.data.protectedBranches ?? []) : [],
    owningEdtTopics: repo.owningTopics,
  };
  const everyDirtyPath = await git.listDirtyPaths(repo.repoPath);
  if (everyDirtyPath.ok && everyDirtyPath.data.includes(MANIFEST_FILE)) {
    row.manifestCarried = true;
  }
  if (repo.state === 1) {
    row.resolution = 'auto-stash';
  } else {
    const paths = await git.listDirtyPaths(repo.repoPath, { expandUntracked: true, excludePaths: [MANIFEST_FILE] });
    if (paths.ok) {
      row.dirtyPaths = paths.data;
    }
  }
  return row;
}

// What to do with a repo's uncommitted work before its checkout — decided from reads only.
type DirtyPlan =
  | { kind: 'none' }
  | { kind: 'stash'; outgoingUlid: string }
  | { kind: 'adopt'; outgoing: EdtRegistryEntry; branch: string }
  | { kind: 'discard'; confirmedPaths?: string[] };

// The executed plan's effect, carried to the checkout step.
export interface Prepared {
  outcome: 'switched' | 'adopted' | 'discarded';
  // The outgoing-tagged stash this repo's work sits in, when one was created by this switch.
  stashTag?: string;
  adoptedInto?: EdtRegistryEntry;
  adoptedBranch?: string;
  discardedPaths?: string[];
}

type Step<T> = CheckoutStep<T, SwitchEdtRepoResult>;

export async function planDirtyWork(
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

export async function executeDirtyPlan(
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

// The adopt steps: (1) gate, (2) stash under the outgoing tag, (3) create the branch from the
// current HEAD branch if it differs (never checked out), (4) register the repo as an outgoing
// member under the edts.yaml lock. Any failure after the stash restores it.
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
export async function restoreAndFail(
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
