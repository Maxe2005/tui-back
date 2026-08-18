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
import type { EdtMember, EdtRegistryPort } from '../ports/edt-registry.js';
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
  topic: string;
  force?: boolean;
}

export async function switchActiveEdt(params: SwitchActiveEdtParams): Promise<Result<SwitchActiveEdtData>> {
  const { edtRegistry, registry, manifest, git, lock, state, force = false } = params;

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
  let outgoingFinalStatus: string | undefined;
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

  // state.json is updated once the target is resolved and no blocking lock applies,
  // independent of individual repo outcomes above (same philosophy as createEdt still
  // registering an EDT despite member failures).
  const wroteState = await state.writeActiveEdt(target.ulid);
  if (!wroteState.ok) {
    return wroteState;
  }

  const activated = await edtRegistry.setStatus(target.ulid, 'active');
  if (!activated.ok) {
    console.error(`Failed to mark EDT ${target.ulid} active after switching to it:`, activated.error.message);
  }

  if (outgoing !== undefined && outgoingFinalStatus !== undefined) {
    const deactivated = await edtRegistry.setStatus(outgoing.ulid, outgoingFinalStatus);
    if (!deactivated.ok) {
      console.error(
        `Failed to mark EDT ${outgoing.ulid} ${outgoingFinalStatus} after switching away from it:`,
        deactivated.error.message,
      );
    }
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
