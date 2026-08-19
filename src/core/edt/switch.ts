// core/edt/switch: the core use-case for switching the active EDT (FR-6/FR-8, story 2.4).
// For every managed repo (registry.list()): a target member is stashed-if-dirty, re-verified
// against the branch-scope gate (AD-8, never assumed), and checked out to its own registered
// branch, with its matching message-tagged stash (if any) popped back in; every other
// managed repo is stashed-if-dirty and checked out to its manifest sharedBranch, fetched
// first if not present locally — regardless of that repo's stale membership in some other,
// now-inactive EDT (FR-8's "regardless of" clause: partitioning by "is this repo a target
// member" rather than "was this repo touched by the outgoing EDT" gets this for free).
//
// Per-repo isolation mirrors create.ts: one repo's stash/fetch/checkout failure is `failed`
// in data.results, never aborts the others or the state.json write. state.json's activeEdt
// is updated once the target is resolved and no blocking lock applies, independent of
// individual repo outcomes — the same philosophy create.ts uses for registering an EDT
// despite member failures.
//
// Stash tagging (design note): the message tag `tui-back:<ulid>` uses the OUTGOING EDT's
// ulid (or the target's own ulid on a first-ever switch, when there is no outgoing) for
// every stash created *by this switch* — the dirty state being left behind belongs to
// whatever context was active before. Immediately after checking a target member into its
// own branch, this switch looks for a *target*-tagged stash (from a past switch away from
// the target, when the target was itself the outgoing EDT and got tagged with its own ulid)
// and pops it — the exact two-call symmetry that makes "switching back into an EDT that owns
// a matching stash pops it" true across separate switch invocations, without needing to
// consult every other EDT's membership to guess an owner.
//
// The `edt:<outgoingUlid>` lock-peek is a non-blocking, non-mutating read (LockPort.peek) —
// this story reserves the resource-key convention; no action acquires it yet (Epic 3+ group
// updates are expected to). `--force` past a held lock never aborts or kills anything (no
// abort primitive exists yet) — it only marks the outgoing EDT `interrupted` and proceeds.
import { resolve } from 'node:path';
import { withActionLock } from '../locking.js';
import type { EdtMember, EdtRegistryPort, EdtStatus } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { err, ok, type Result, type ResultError } from '../result.js';

export interface SwitchEdtRepoResult {
  service: string;
  outcome: 'switched' | 'failed';
  detail?: { code: string; message: string };
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
  // (AD-9) — this use-case writes edts.yaml too and was missing the guard entirely.
  edtRegistryResourceKey: string;
  topic: string;
  force?: boolean;
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

  const stashTagUlid = outgoing !== undefined ? outgoing.ulid : target.ulid;

  const registered = await registry.list();
  if (!registered.ok) {
    return registered;
  }

  const targetMembersByPath = new Map(target.members.map((member) => [resolve(member.repoPath), member]));
  const registeredPaths = new Set(registered.data.map((rawPath) => resolve(rawPath)));

  const results: SwitchEdtRepoResult[] = [];
  for (const rawPath of registered.data) {
    const repoPath = resolve(rawPath);
    const member = targetMembersByPath.get(repoPath);
    results.push(
      member !== undefined
        ? await switchMemberRepo(git, target.ulid, stashTagUlid, { ...member, repoPath })
        : await switchNonMemberRepo(git, manifest, repoPath, stashTagUlid),
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

function failed(service: string, error: ResultError): SwitchEdtRepoResult {
  return { service, outcome: 'failed', detail: { code: error.code, message: error.message } };
}

function stashMessage(ulid: string): string {
  return `tui-back:${ulid}`;
}

async function switchMemberRepo(
  git: GitPort,
  targetUlid: string,
  stashTagUlid: string,
  member: EdtMember,
): Promise<SwitchEdtRepoResult> {
  const { service, repoPath, branch } = member;

  // Re-verify before touching anything — never assume (AD-8): closes the cross-EDT half,
  // catching a branch that was this EDT's own at registration time but has since become
  // shared/protected or been claimed as a different EDT's own branch for this repo.
  const allowed = await git.assertAllowedBranch(repoPath, branch, targetUlid);
  if (!allowed.ok) {
    return failed(service, allowed.error);
  }

  const dirty = await git.hasUncommittedChanges(repoPath);
  if (!dirty.ok) {
    return failed(service, dirty.error);
  }
  if (dirty.data) {
    const stashed = await git.stashSave(repoPath, stashMessage(stashTagUlid));
    if (!stashed.ok) {
      return failed(service, stashed.error);
    }
  }

  // A missing member branch (never auto-created here) surfaces as a checkout failure —
  // reported, never thrown; any work just stashed above stays safely stashed.
  const checkedOut = await git.checkout(repoPath, branch);
  if (!checkedOut.ok) {
    return failed(service, checkedOut.error);
  }

  // Pop this member's own matching stash, if this EDT left one behind on a past switch away
  // from it (message-tagged with its own ulid, not stack position).
  const popped = await git.restoreStash(repoPath, stashMessage(targetUlid));
  if (!popped.ok) {
    return failed(service, popped.error);
  }

  return { service, outcome: 'switched' };
}

async function switchNonMemberRepo(
  git: GitPort,
  manifest: ManifestPort,
  repoPath: string,
  stashTagUlid: string,
): Promise<SwitchEdtRepoResult> {
  const loaded = await manifest.load(repoPath);
  const service = loaded.ok ? loaded.data.service : repoPath;
  if (!loaded.ok) {
    return failed(service, loaded.error);
  }

  const sharedBranch = loaded.data.sharedBranch;

  const dirty = await git.hasUncommittedChanges(repoPath);
  if (!dirty.ok) {
    return failed(service, dirty.error);
  }
  if (dirty.data) {
    const stashed = await git.stashSave(repoPath, stashMessage(stashTagUlid));
    if (!stashed.ok) {
      return failed(service, stashed.error);
    }
  }

  const existsLocally = await git.branchExistsLocally(repoPath, sharedBranch);
  if (!existsLocally.ok) {
    return failed(service, existsLocally.error);
  }
  if (!existsLocally.data) {
    const fetched = await git.fetch(repoPath, sharedBranch);
    if (!fetched.ok) {
      return failed(service, fetched.error);
    }
  }

  const checkedOut = await git.checkout(repoPath, sharedBranch);
  if (!checkedOut.ok) {
    return failed(service, checkedOut.error);
  }

  return { service, outcome: 'switched' };
}
