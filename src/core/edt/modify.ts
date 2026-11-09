// core/edt/modify: modifies an EDT after creation — add/remove members, change or rename a
// member's branch, rename the topic. Git writes (gate, protected switch, rename) run pre-lock,
// one helper per step; only the final edts.yaml assembly and write is held under the registry
// lock (AD-9). Only step 1's registry read can fail the whole use-case.
import { resolve } from 'node:path';
import { withActionLock } from '../locking.js';
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import { err, ok, type Result } from '../result.js';

export interface ModifyEdtResult {
  service: string;
  outcome: 'added' | 'removed' | 'branch-changed' | 'failed';
  detail?: { code: string; message: string };
  newBranch?: string;
}

export interface ModifyEdtData {
  ulid: string;
  topic: string;
  results: ModifyEdtResult[];
}

export interface ModifyEdtParams {
  edtRegistry: EdtRegistryPort;
  registry: RegistryPort;
  manifest: ManifestPort;
  git: GitPort;
  lock: LockPort;
  edtRegistryResourceKey: string;
  topic: string;
  addMembers: string[];
  removeMembers: string[];
  setBranches: Array<{ repoPath: string; branch: string }>;
  renameTo?: string;
  // Each entry renames the member's own currently registered branch to newName and adopts
  // newName as its branch. oldName is never taken from the caller — it is resolved from this
  // EDT's membership — so a not-yet-member repoPath cannot be renamed this way (the TUI never
  // offers "Rename current" when adding a member).
  renameBranches?: Array<{ repoPath: string; newName: string }>;
}

export async function modifyEdt(params: ModifyEdtParams): Promise<Result<ModifyEdtData>> {
  const {
    edtRegistry,
    registry,
    manifest,
    git,
    lock,
    edtRegistryResourceKey,
    topic,
    addMembers,
    removeMembers,
    setBranches,
    renameTo,
    renameBranches = [],
  } = params;

  const trimmedTopic = topic.trim();
  if (trimmedTopic === '') {
    return err('missing-argument', 'Usage: tui-back edt modify --topic <topic> [--add-member <path> --set-branch <path>=<branch>]... [--remove-member <path>]... [--set-branch <path>=<branch>]... [--rename-to <topic>] (each --add-member requires a matching --set-branch for that same path — no current-branch default)');
  }

  // Fast-fail: check target EDT exists (before no-operations check, so unknown topic
  // takes priority over “no operation provided”)
  const edtListed = await edtRegistry.list();
  if (!edtListed.ok) {
    return edtListed;
  }
  const target = edtListed.data.find((candidate) => candidate.topic === trimmedTopic);
  if (target === undefined) {
    return err('edt-not-found', `No EDT with topic "${trimmedTopic}" is registered`);
  }

  // At least one operation required
  const hasOp =
    addMembers.length > 0 ||
    removeMembers.length > 0 ||
    setBranches.length > 0 ||
    renameBranches.length > 0 ||
    renameTo !== undefined;
  if (!hasOp) {
    return err('invalid-argument', 'At least one operation required: --add-member, --remove-member, --set-branch, or --rename-to');
  }
  // If rename, check uniqueness (fast-fail, re-validated under lock)
  if (renameTo !== undefined) {
    if (renameTo.trim() === '') {
      return err('invalid-argument', 'Rename topic must not be empty');
    }
    if (edtListed.data.some((entry) => entry.topic === renameTo && entry.ulid !== target.ulid)) {
      return err('edt-topic-exists', `An EDT with topic "${renameTo}" already exists (uniqueness re-validated under per-resource advisory lock)`);
    }
  }

  // Pre-lock: collect per-op results for git-touching ops. We do git writes outside the lock
  // (same precedent as create/switch), then under the lock we only assemble the final entry
  // and write edts.yaml.
  //
  // ---- 1. Add members (pre-lock: registered/duplicate checks only for pending, branch-required for unmatched) ----
  const addStep = await resolveMemberAdditions({ addMembers, setBranches, registry, target });
  if (!addStep.ok) {
    return addStep;
  }
  const { results: addResults, pendingAdds, rejectedAddPaths } = addStep.data;

  // ---- 2. Remove members (pre-logic, validated under lock) ----
  const removeResults = resolveMemberRemovals(removeMembers);

  // ---- 3. Set branches (pre-lock: gate + protected-switch git) ----
  const branchStep = await resolveBranchAssignments({ setBranches, rejectedAddPaths, pendingAdds, target, git, manifest });

  // ---- 4. Rename branches (pre-lock: resolve oldName from this EDT's own membership, gate,
  // git.renameBranch) ----
  const renameStep = await resolveBranchRenames({ renameBranches, target, git, manifest });

  const results: ModifyEdtResult[] = [...addResults, ...removeResults, ...branchStep.results, ...renameStep.results];
  const addedMembers = branchStep.addedMembers;
  const branchChanges = [...branchStep.branchChanges, ...renameStep.branchChanges];

  // ---- Under per-resource advisory lock (AD-9): assemble final entry and write edts.yaml ----
  const written = await persistModifiedEntry({
    edtRegistry,
    edtRegistryResourceKey,
    lock,
    target,
    preLockEntries: edtListed.data,
    renameTo,
    removeMembers,
    addedMembers,
    branchChanges,
  });
  if (!written.ok) {
    return written;
  }

  return ok({ ulid: target.ulid, topic: renameTo !== undefined ? renameTo : trimmedTopic, results });
}

// ---- Step 1: add members ----------------------------------------------------------------
// pendingAdds: addMembers entries with a matching setBranches entry defer branch resolution
// entirely to step 3 (no currentBranch / assertAllowedBranch here). Unmatched entries fail
// fast with branch-required.
interface MemberAdditions {
  results: ModifyEdtResult[];
  // Paths step 1 already rejected (invalid-member / duplicate-member) that step 3 must skip: a
  // raw caller can combine --add-member and --set-branch for the same path, and step 3 would
  // otherwise gate and check out a path already declared invalid.
  rejectedAddPaths: Set<string>;
  pendingAdds: Set<string>;
}

async function resolveMemberAdditions(params: {
  addMembers: string[];
  setBranches: Array<{ repoPath: string; branch: string }>;
  registry: RegistryPort;
  target: EdtRegistryEntry;
}): Promise<Result<MemberAdditions>> {
  const { addMembers, setBranches, registry, target } = params;
  const results: ModifyEdtResult[] = [];
  const rejectedAddPaths = new Set<string>();
  const pendingAdds = new Set<string>();

  if (addMembers.length === 0) {
    return ok({ results, rejectedAddPaths, pendingAdds });
  }

  const setBranchesByPath = new Map(setBranches.map(({ repoPath, branch }) => [resolve(repoPath), branch]));
  const registered = await registry.list();
  if (!registered.ok) {
    return registered;
  }
  const registeredPaths = new Set(registered.data.map((rawPath) => resolve(rawPath)));

  for (const memberPath of addMembers) {
    const resolved = resolve(memberPath);
    if (!registeredPaths.has(resolved)) {
      results.push({
        service: resolved,
        outcome: 'failed',
        detail: { code: 'invalid-member', message: `Member is not a registered managed repo: ${resolved}` },
      });
      rejectedAddPaths.add(resolved);
      continue;
    }

    // Duplicate check: skip if member already in target EDT
    const alreadyAdded = target.members.some((m) => resolve(m.repoPath) === resolved);
    if (alreadyAdded) {
      results.push({
        service: resolved,
        outcome: 'failed',
        detail: { code: 'duplicate-member', message: `Member ${resolved} is already in the EDT's member list` },
      });
      rejectedAddPaths.add(resolved);
      continue;
    }

    // A matching setBranches entry defers entirely to step 3 — no currentBranch /
    // assertAllowedBranch here. Otherwise fail with branch-required.
    if (setBranchesByPath.has(resolved)) {
      pendingAdds.add(resolved);
      continue;
    }

    results.push({
      service: resolved,
      outcome: 'failed',
      detail: { code: 'branch-required', message: `no branch specified for new member ${resolved}; call with a matching setBranches entry` },
    });
  }

  return ok({ results, rejectedAddPaths, pendingAdds });
}

// ---- Step 2: remove members -------------------------------------------------------------
// No git writes; just note the removals. Under the lock we'll validate members exist and
// actually remove them from the registry entry.
function resolveMemberRemovals(removeMembers: string[]): ModifyEdtResult[] {
  return removeMembers.map((memberPath) => ({ service: memberPath, outcome: 'removed' as const }));
}

// ---- Step 3: set branches ----------------------------------------------------------------
// For pendingAdds (addMembers with matching setBranches), a successful checkout also promotes
// into addedMembers (not just branchChanges) so the lock-time assembly picks it up as a
// genuinely new member.
interface BranchAssignments {
  results: ModifyEdtResult[];
  // Adds and branch changes are computed pre-lock but must be fed back into the entry written
  // under the lock — that write only applies the topic rename and removals on its own. These
  // two arrays carry the successful outcomes' data forward so the lock section persists them.
  addedMembers: EdtMember[];
  branchChanges: Array<{ repoPath: string; branch: string }>;
}

async function resolveBranchAssignments(params: {
  setBranches: Array<{ repoPath: string; branch: string }>;
  rejectedAddPaths: Set<string>;
  pendingAdds: Set<string>;
  target: EdtRegistryEntry;
  git: GitPort;
  manifest: ManifestPort;
}): Promise<BranchAssignments> {
  const { setBranches, rejectedAddPaths, pendingAdds, target, git, manifest } = params;
  const results: ModifyEdtResult[] = [];
  const addedMembers: EdtMember[] = [];
  const branchChanges: Array<{ repoPath: string; branch: string }> = [];

  for (const { repoPath, branch } of setBranches) {
    const resolved = resolve(repoPath);

    // This resolved path already has a failure result from step 1 (invalid-member /
    // duplicate-member) — never process it a second time here.
    if (rejectedAddPaths.has(resolved)) {
      continue;
    }

    // Gate: shared-branch + cross-EDT ownership (AD-8)
    const allowed = await git.assertAllowedBranch(resolved, branch, target.ulid);
    if (!allowed.ok) {
      results.push({
        service: resolved,
        outcome: 'failed',
        detail: { code: allowed.error.code, message: allowed.error.message },
      });
      continue;
    }

    // Protected-switch: stash-if-dirty → checkout → restore
    const dirty = await git.hasUncommittedChanges(resolved);
    if (!dirty.ok) {
      results.push({
        service: resolved,
        outcome: 'failed',
        detail: { code: dirty.error.code, message: dirty.error.message },
      });
      continue;
    }
    if (dirty.data) {
      const stashed = await git.stashSave(resolved, `tui-back:${target.ulid}`);
      if (!stashed.ok) {
        results.push({
          service: resolved,
          outcome: 'failed',
          detail: { code: stashed.error.code, message: stashed.error.message },
        });
        continue;
      }
    }

    const checkedOut = await git.checkout(resolved, branch);
    if (!checkedOut.ok) {
      // Attempt to restore the stash that was saved earlier, so the repo isn't left
      // with a permanent stash that won't be popped.
      await git.restoreStash(resolved, `tui-back:${target.ulid}`);
      results.push({
        service: resolved,
        outcome: 'failed',
        detail: { code: checkedOut.error.code, message: checkedOut.error.message },
      });
      continue;
    }

    // Restore the EDT's own stash (message-tagged)
    const restored = await git.restoreStash(resolved, `tui-back:${target.ulid}`);
    if (!restored.ok) {
      results.push({
        service: resolved,
        outcome: 'failed',
        detail: { code: restored.error.code, message: restored.error.message },
      });
      continue;
    }

    // Determine service from manifest. On a manifest-load failure a pendingAdds repo (a new
    // member) falls back to the full resolved path, while an existing member's branch change
    // falls back to the basename.
    const isPendingAdd = pendingAdds.has(resolved);
    const { service } = await (async () => {
      const loaded = await manifest.load(resolved);
      if (loaded.ok) {
        return { service: loaded.data.service };
      }
      return { service: isPendingAdd ? resolved : resolved.split('/').pop() || resolved };
    })();
    // A setBranches entry for a pending add is recorded as 'added' and promoted into
    // addedMembers; otherwise it's a branch change for an existing member.
    if (isPendingAdd) {
      results.push({
        service,
        outcome: 'added',
        newBranch: branch,
      });
      addedMembers.push({ service, repoPath: resolved, branch });
    } else {
      results.push({
        service,
        outcome: 'branch-changed',
        newBranch: branch,
      });
      branchChanges.push({ repoPath: resolved, branch });
    }
  }

  return { results, addedMembers, branchChanges };
}

// ---- Step 4: rename branches --------------------------------------------------------------
// Mirrors step 3, but the git write is a rename (`git branch -m`), never a checkout — the
// member is by construction already on oldName, so no stash/checkout is needed. `oldName` is
// resolved from `target.members`, never taken from the caller, so a caller cannot pass an
// arbitrary or stale branch name as "the thing to rename".
interface BranchRenames {
  results: ModifyEdtResult[];
  // Same branchChanges shape step 3 populates — lock-time assembly applies both against the
  // final member set uniformly, through one persistence path.
  branchChanges: Array<{ repoPath: string; branch: string }>;
}

async function resolveBranchRenames(params: {
  renameBranches: Array<{ repoPath: string; newName: string }>;
  target: EdtRegistryEntry;
  git: GitPort;
  manifest: ManifestPort;
}): Promise<BranchRenames> {
  const { renameBranches, target, git, manifest } = params;
  const results: ModifyEdtResult[] = [];
  const branchChanges: Array<{ repoPath: string; branch: string }> = [];

  for (const { repoPath, newName } of renameBranches) {
    const resolved = resolve(repoPath);

    const member = target.members.find((m) => resolve(m.repoPath) === resolved);
    if (member === undefined) {
      results.push({
        service: resolved,
        outcome: 'failed',
        detail: { code: 'invalid-member', message: `Cannot rename: ${resolved} is not a member of this EDT` },
      });
      continue;
    }
    const oldName = member.branch;

    const allowed = await git.assertAllowedBranch(resolved, newName, target.ulid);
    if (!allowed.ok) {
      results.push({
        service: resolved,
        outcome: 'failed',
        detail: { code: allowed.error.code, message: allowed.error.message },
      });
      continue;
    }

    const renamed = await git.renameBranch(resolved, oldName, newName, target.ulid);
    if (!renamed.ok) {
      results.push({
        service: resolved,
        outcome: 'failed',
        detail: { code: renamed.error.code, message: renamed.error.message },
      });
      continue;
    }

    const loaded = await manifest.load(resolved);
    const service = loaded.ok ? loaded.data.service : resolved.split('/').pop() || resolved;
    results.push({ service, outcome: 'branch-changed', newBranch: newName });
    branchChanges.push({ repoPath: resolved, branch: newName });
  }

  return { results, branchChanges };
}

// ---- Lock-held assembly and write --------------------------------------------------------
// The switch's `adopt` resolution registers a dirty non-member repo as a new member of the
// OUTGOING EDT — a membership write only: switch.ts already did the git side, and it must
// never check out or pop, so it can't call the full modifyEdt. It goes through the same
// lock-held re-read/assemble/write as every modifyEdt add (one persistence path) and
// re-checks membership under the lock (a racing add is a no-op, never a duplicate).
export interface AddMemberUnderLockParams {
  edtRegistry: EdtRegistryPort;
  lock: LockPort;
  edtRegistryResourceKey: string;
  edt: EdtRegistryEntry;
  member: EdtMember;
}

export async function addMemberUnderLock(params: AddMemberUnderLockParams): Promise<Result<void>> {
  const { edtRegistry, lock, edtRegistryResourceKey, edt, member } = params;
  return persistModifiedEntry({
    edtRegistry,
    edtRegistryResourceKey,
    lock,
    target: edt,
    preLockEntries: [],
    renameTo: undefined,
    removeMembers: [],
    addedMembers: [{ ...member, repoPath: resolve(member.repoPath) }],
    branchChanges: [],
  });
}

async function persistModifiedEntry(params: {
  edtRegistry: EdtRegistryPort;
  edtRegistryResourceKey: string;
  lock: LockPort;
  target: EdtRegistryEntry;
  // The pre-lock snapshot (`edtListed.data` in modifyEdt). The rename-uniqueness re-check
  // below reads this snapshot, not the list re-read under the lock.
  preLockEntries: readonly EdtRegistryEntry[];
  renameTo: string | undefined;
  removeMembers: string[];
  addedMembers: EdtMember[];
  branchChanges: Array<{ repoPath: string; branch: string }>;
}): Promise<Result<void>> {
  const { edtRegistry, edtRegistryResourceKey, lock, target, preLockEntries, renameTo, removeMembers, addedMembers, branchChanges } = params;

  return withActionLock(lock, edtRegistryResourceKey, async () => {
    // Re-read the authoritative list
    const reListed = await edtRegistry.list();
    if (!reListed.ok) {
      return reListed;
    }

    // Re-check rename uniqueness. Known gap: this reads the pre-lock snapshot rather than
    // `reListed`, so a concurrent rename to the same topic is not caught here.
    if (renameTo !== undefined) {
      if (preLockEntries.some((entry) => entry.topic === renameTo && entry.ulid !== target.ulid)) {
        return err('edt-topic-exists', `An EDT with topic "${renameTo}" already exists`);
      }
    }

    // Build the updated entry by copying the target entry and applying changes
    const updated = [...reListed.data];
    const targetIdx = updated.findIndex((e) => e.ulid === target.ulid);
    if (targetIdx === -1) {
      return err('edt-not-found', `No EDT registered with ulid ${target.ulid}`);
    }

    const targetEntry = { ...updated[targetIdx] };

    // Apply rename (topic change only — AD-7: ULID filename unchanged)
    if (renameTo !== undefined) {
      targetEntry.topic = renameTo;
    }

    // Apply removes: filter out members whose repoPath appears in removeMembers
    let members = targetEntry.members;
    if (removeMembers.length > 0) {
      const removePaths = new Set(removeMembers.map((p) => resolve(p)));
      members = members.filter((m) => !removePaths.has(resolve(m.repoPath)));
    }

    // Apply the successful adds computed pre-lock. Re-checks membership under the lock too
    // (not just the pre-lock fast-fail) so a racing concurrent modify that added the same
    // member first doesn't produce a duplicate entry.
    if (addedMembers.length > 0) {
      const existingPaths = new Set(members.map((m) => resolve(m.repoPath)));
      for (const added of addedMembers) {
        if (!existingPaths.has(resolve(added.repoPath))) {
          members = [...members, added];
          existingPaths.add(resolve(added.repoPath));
        }
      }
    }

    // Apply the successful branch changes computed pre-lock, over the final member set
    // (including any just-added above) so a branch override on a member added in the same
    // call wins over its auto-resolved current branch.
    if (branchChanges.length > 0) {
      const branchByPath = new Map(branchChanges.map((c) => [resolve(c.repoPath), c.branch]));
      members = members.map((m) => {
        const newBranch = branchByPath.get(resolve(m.repoPath));
        return newBranch !== undefined ? { ...m, branch: newBranch } : m;
      });
    }

    targetEntry.members = members;

    // Write the updated entry
    const writeResult = await edtRegistry.update(targetEntry.ulid, {
      topic: targetEntry.topic,
      members: targetEntry.members,
    });
    if (!writeResult.ok) {
      return writeResult;
    }

    return ok(undefined);
  });
}

// The branch-picker's Create-new pre-step: a thin wrapper around git.createBranch, kept
// outside modifyEdt's params because branch creation has no membership semantics of its own.
// git.createBranch gates internally (assertAllowedBranch, no edtId).
export interface CreateMemberBranchParams {
  git: GitPort;
  repoPath: string;
  branchName: string;
  baseBranch: string;
}

export async function createMemberBranch(params: CreateMemberBranchParams): Promise<Result<void>> {
  const { git, repoPath, branchName, baseBranch } = params;
  return git.createBranch(repoPath, branchName, baseBranch);
}

// The branch-picker's rename of a picked branch for a not-yet-member repoPath: modifyEdt's
// `renameBranches` resolves `oldName` from existing membership, which cannot include it. The
// renamed branch is then adopted through the caller's usual addMembers+setBranches call.
export interface RenameMemberBranchParams {
  git: GitPort;
  repoPath: string;
  oldName: string;
  newName: string;
  // the target EDT's ulid — its own branches are exempt from the cross-EDT gate.
  edtId?: string;
}

export async function renameMemberBranch(params: RenameMemberBranchParams): Promise<Result<void>> {
  const { git, repoPath, oldName, newName, edtId } = params;
  return git.renameBranch(repoPath, oldName, newName, edtId);
}

// The branch-picker's candidate source. Exposed from core so the TUI store never calls
// deps.git directly.
export async function listMemberBranches(git: GitPort, repoPath: string): Promise<Result<string[]>> {
  return git.listBranches(repoPath);
}
