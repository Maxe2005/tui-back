// core/edt/switch: switches the active EDT (FR-6/FR-8). Every registered repo is classified
// against the OUTGOING EDT, its uncommitted work is stashed, adopted or discarded per its
// state, then it is checked out to its target-driven destination. Per-repo failures never
// abort the others; state.json and edts.yaml are updated once the target is resolved and no
// blocking lock applies. See switchActiveEdt for the full rules.
// a `dirtyPolicy` (the CLI's --discard-dirty / --adopt-dirty / --adopt-branch flags)
// is expanded per dirty state-2/3 repo into resolutions, so the seam is skipped when one is given.
// Dirty-work handling lives in switch/dirty.ts, per-repo switching in switch/member.ts and the
// shared types in switch/types.ts; the public API is re-exported from here.
import { resolve } from 'node:path';
import { withActionLock } from '../../locking.js';
import { edtUpdateLockKey } from '../../scripts/group-update/group-update.js';
import type { EdtRegistryEntry, EdtStatus } from '../../ports/storage/edt-registry.js';
import type { Manifest } from '../../ports/vcs/manifest.js';
import { err, ok, type Result } from '../../result.js';
import { withCarriedManifest } from '../shared-edt/manifest-carry.js';
import { isSystemEdt } from '../shared-edt/shared-edt.js';
import { resolveDirtyRepos } from './dirty.js';
import { switchMemberRepo, switchNonMemberRepo } from './member.js';
import {
  failed,
  type ClassifiedSwitchRepo,
  type RepoSwitchContext,
  type SwitchActiveEdtData,
  type SwitchActiveEdtParams,
  type SwitchEdtRepoResult,
  type SwitchRepoState,
} from './types.js';

export { failed };
export type {
  ClassifiedSwitchRepo,
  DirtyPolicy,
  DirtyResolution,
  OnDirtyReposBeforeSwitch,
  SwitchActiveEdtData,
  SwitchActiveEdtParams,
  SwitchDirtyRepo,
  SwitchDirtyReposChoice,
  SwitchDirtyScope,
  SwitchEdtRepoResult,
  SwitchRepoState,
  SwitchUnresolvedDirtyRepo,
} from './types.js';

// The pure three-state classifier (see switchActiveEdt). Paths are compared resolve()'d on
// both sides; `targetMember.repoPath` is the resolved path.
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
      // The system EDT lists every repo, so it only counts as an owner when it IS the target
      // (otherwise a non-member would read as "member of another EDT" because of it).
      .filter((entry) => entry.ulid !== outgoing?.ulid && (!isSystemEdt(entry) || entry.ulid === target.ulid) && hasMember(entry, repoPath))
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

// Classification against the OUTGOING EDT: state 1 = a member of it; state 2 = a member of
// another EDT (the target included) but not of the outgoing one; state 3 = a member of no EDT.
// The destination stays target-driven (FR-8): a target member goes to its own registered
// branch (re-gated with the target ulid, then its target-tagged stash is popped back in); any
// other repo goes to its manifest `sharedBranch`, fetched first if absent locally.
//
// A dirty state-1 repo holds the outgoing EDT's work: it is stashed under
// `tui-back:<outgoing ulid>` and popped back only by a later switch INTO the outgoing EDT. A
// dirty state-2/3 repo is never moved silently — it needs an explicit `DirtyResolution`:
//   - `adopt`: gate the branch with the outgoing ulid → stash under the outgoing tag → create
//     the branch from HEAD if it differs (never checked out) → register the repo as an
//     outgoing member (`addMemberUnderLock`) → checkout. The stash then rides the state-1
//     return path onto the adopted branch.
//   - `discard`: capture the dirty paths (untracked expanded), `git.discardAll` (reset --hard
//     + clean -fd, never -x), then checkout.
//
// Pre-flight, before ANY git write: resolutions come from `dirtyResolutions` (CLI) or else the
// `onDirtyReposBeforeSwitch` seam (TUI), invoked once with every dirty repo. `cancel`, a dirty
// state-2/3 repo without a resolution, or an `adopt` with no outgoing EDT each return with zero
// repos touched — so with no seam and no resolutions, a dirty state-2/3 repo fails safe. Once
// anything is stashed, every failure before the checkout restores that stash.
//
// The outgoing lock peek is non-blocking and non-mutating: `--force` past a held lock never
// aborts anything; it only marks the outgoing EDT `interrupted`. When the peek found it free,
// that lock is then held from the first repo until state.json and edts.yaml name the target, so
// an update or realign is rejected for the whole switch.
export async function switchActiveEdt(params: SwitchActiveEdtParams): Promise<Result<SwitchActiveEdtData>> {
  const { edtRegistry, registry, manifest, manifestCarry, git, lock, state, edtRegistryResourceKey, force = false } = params;

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
        return blockedBy(outgoing);
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
    manifestCarry,
    edtRegistry,
    lock,
    edtRegistryResourceKey,
    outgoing,
    target,
  };
  const results: SwitchEdtRepoResult[] = [];
  const runSwitch = async (): Promise<Result<void>> => {
    for (const repo of classified) {
      const resolution = preflight.data.get(repo.repoPath);
      const { targetMember } = repo;
      // A non-member's destination comes from its manifest as it sits on disk now, so it is read
      // before the carry clears a dirty one.
      const nonMemberManifest = targetMember === undefined ? await manifest.load(repo.repoPath) : undefined;
      const serviceName = targetMember?.service ?? (nonMemberManifest?.ok ? nonMemberManifest.data.service : repo.repoPath);
      results.push(
        await withCarriedManifest({ git, carry: manifestCarry }, repo.repoPath, serviceName, () =>
          targetMember !== undefined
            ? switchMemberRepo(context, repo, targetMember, resolution)
            : switchNonMemberRepo(context, repo, resolution, nonMemberManifest as Result<Manifest>),
        ),
      );
    }
    // A target member whose repoPath has dropped out of the managed-repo registry is surfaced as
    // `failed` rather than skipped — otherwise "every target member sits on its own registered
    // branch" would break with zero signal.
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
    // still registering an EDT despite member failures). The registry writes run under the
    // edts.yaml lock so they cannot race a concurrent `edt create`/`edt switch` (AD-9), and a
    // setStatus failure becomes a `failed` row in `results`, never a silent log line.
    return withActionLock(lock, edtRegistryResourceKey, async () => {
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
  };
  // The outgoing EDT's action lock is held from the first repo through the state.json and
  // edts.yaml writes when the peek found it free. Under --force past a held lock it is not
  // taken: the holder keeps it. Taken between the peek and here, it blocks like the peek.
  if (outgoing === undefined || outgoingFinalStatus !== 'inactive') {
    const switched = await runSwitch();
    if (!switched.ok) {
      return switched;
    }
  } else {
    let entered = false;
    const switched = await withActionLock(lock, edtUpdateLockKey(outgoing.ulid), () => {
      entered = true;
      return runSwitch();
    });
    if (!switched.ok) {
      return !entered && switched.error.code === 'action-in-progress' ? blockedBy(outgoing) : switched;
    }
  }

  return ok({ ulid: target.ulid, topic: target.topic, results, wasInterrupted });
}

function blockedBy(outgoing: EdtRegistryEntry): Result<never> {
  return err(
    'switch-blocked-action-in-progress',
    `Cannot switch away from "${outgoing.topic}": an action is currently in progress on it. Pass --force to interrupt it and switch anyway.`,
  );
}

// ---- Destination rule (shared with activate.ts and realign) ---------------------------------

export { resolveTargetBranch, type TargetBranchSpec } from '../branches/checkout-expected.js';
