// core/edt/modify: the core use-case for modifying an EDT after creation (Story 2.5).
// A developer can add/remove member services, change a member's working branch, and rename
// the EDT's topic after creation, so the EDT can evolve as the work's scope changes.
//
// AD-7: one SQLite per EDT, AD-9: per-resource advisory lock, AD-8: git branch-scope safety
// gate. The whole `edts.yaml` read-modify-write runs inside
// `withActionLock(lock, edtRegistryResourceKey, ...)` (same pattern as `create.ts` and
// `switch.ts`). Member changes re-use creation's gated branch recording and Story 2.4's
// protected-switch (stash-if-dirty → checkout → restore).
//
// Story 2.2/2.3/2.4 semantics are re-used inline (shared-branch gate, protected-switch,
// branch-scope safety). Every core use-case returns the `{ok,data}`/`{ok,error}` envelope
// (AD-3). NodeNext `.js` imports; imports-first.
//
// `modifyEdt` itself is a straight-line sequence of 4 pre-lock steps (add members / remove
// members / set branches / rename branches — each its own private helper below) followed by
// the lock-held assembly-and-write. Each step function returns its own slice of the final
// `results` list plus whatever the later steps or the lock-held assembly need from it; only
// step 1 (a registry.list() call) can fail the whole use-case outright, so it alone returns a
// `Result` the caller propagates.
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
  // Story 2.26: mirrors setBranches's shape — each entry renames the *member's own currently
  // registered branch* to newName (oldName is never taken from the caller; it's always
  // resolved from this EDT's own membership below) and adopts newName as that member's branch
  // going forward. Populated by the branch-picker's "Rename current" mode (Modify's per-member
  // step, Service-actions) and its Pick-existing-row rename action when the picked row already
  // is this member's own branch — never usable for a not-yet-member repoPath (there is no
  // "current registered branch" to resolve), which is exactly why Rename current is never
  // offered at Add-to-EDT (Boundaries).
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
// Story 2.24: pendingAdds — addMembers entries with a matching setBranches entry defer branch
// resolution entirely to step 3 (no currentBranch / assertAllowedBranch here). Unmatched
// entries fail fast with branch-required.
interface MemberAdditions {
  results: ModifyEdtResult[];
  // Story 2.24 code review: a resolved path step 1 already rejected (invalid-member /
  // duplicate-member) must not also be processed by step 3 — a raw caller can combine
  // --add-member for an invalid/duplicate path with --set-branch for that same path, and
  // without this, step 3 would still run assertAllowedBranch/checkout against it, producing a
  // second, possibly conflicting result row and a real git checkout on a path already
  // declared invalid.
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

    // Story 2.24: if a matching setBranches entry exists, defer entirely to step 3 — no
    // currentBranch / assertAllowedBranch here. Otherwise fail with branch-required.
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
// Story 2.24: for pendingAdds (addMembers with matching setBranches), a successful checkout
// also promotes into addedMembers (not just branchChanges) so the lock-time assembly picks it
// up as a genuinely new member.
interface BranchAssignments {
  results: ModifyEdtResult[];
  // Review patch (story 2.9): adds/branch-changes were computed pre-lock but must be fed back
  // into the registry entry written under the lock — the write only ever applies the
  // deterministic topic rename + removals on its own. These two arrays carry the *successful*
  // outcomes' data forward so the lock section can actually persist them.
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

    // Story 2.24 code review: this resolved path already has a failure result from step 1
    // (invalid-member/duplicate-member) — never process it a second time here.
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

    // Protected-switch: stash-if-dirty → checkout → restore (Story 2.4)
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

    // Determine service from manifest. Story 2.24 code review: a pendingAdds repo (a
    // brand-new member) falls back to the full resolved path on a manifest-load failure —
    // matching the old step-1 behavior for new members — while an existing member's branch
    // change keeps the pre-existing basename fallback (resolved.split('/').pop()).
    const isPendingAdd = pendingAdds.has(resolved);
    const { service } = await (async () => {
      const loaded = await manifest.load(resolved);
      if (loaded.ok) {
        return { service: loaded.data.service };
      }
      return { service: isPendingAdd ? resolved : resolved.split('/').pop() || resolved };
    })();
    // Story 2.24: if this setBranches entry corresponds to a pending add, record as 'added'
    // and promote into addedMembers; otherwise it's a branch change for an existing member.
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
// Story 2.26: mirrors step 3's shape exactly, but the git write is a rename (`git branch -m`),
// never a checkout — the member is, by construction, already on oldName (its own currently
// registered branch), so renaming it in place needs no stash/checkout dance. `oldName` is
// never taken from the caller: resolving it from `target.members` (the pre-lock snapshot, same
// as every other step here) is what makes this safe against a caller passing an
// arbitrary/stale branch name as "the thing to rename".
interface BranchRenames {
  results: ModifyEdtResult[];
  // Same branchChanges shape step 3 populates — lock-time assembly applies both against the
  // final member set uniformly, no second persistence path (Boundaries).
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
// Story 2.39: the switch use-case's `adopt` resolution registers a dirty non-member repo as a
// new member of the OUTGOING EDT — a membership write only (its git side — gate, stash,
// createBranch — is already done by switch.ts, and it must never check out or pop, which is
// why it can't call the full modifyEdt). It goes through this exact same lock-held
// re-read/assemble/write as every modifyEdt add, so there is one single persistence path for
// adding a member. Re-checks membership under the lock (a racing add is a no-op, never a
// duplicate).
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
  // The pre-lock snapshot (`edtListed.data` in modifyEdt) — the rename-uniqueness re-check
  // below intentionally re-uses this same snapshot rather than the freshly re-read list a few
  // lines down, exactly as the pre-extraction code did; preserved verbatim rather than
  // "fixed" as part of this readability-only refactor.
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

    // Re-check rename uniqueness under lock (race-safe)
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

    // Review patch (story 2.9): apply the successful adds computed pre-lock. Re-checks
    // membership under the lock too (not just the pre-lock fast-fail) so a racing concurrent
    // modify that added the same member first doesn't produce a duplicate entry.
    if (addedMembers.length > 0) {
      const existingPaths = new Set(members.map((m) => resolve(m.repoPath)));
      for (const added of addedMembers) {
        if (!existingPaths.has(resolve(added.repoPath))) {
          members = [...members, added];
          existingPaths.add(resolve(added.repoPath));
        }
      }
    }

    // Review patch (story 2.9): apply the successful branch changes computed pre-lock, over
    // the final member set (including any just-added above) so a branch override on a
    // member added in the same call wins over its auto-resolved current branch.
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

// Story 2.26 -----------------------------------------------------------------------------
// The branch-picker's Create-new pre-step, at all 3 non-creation entry points (Modify's
// per-member step, Service-actions, Add-to-EDT): a thin wrapper around git.createBranch,
// deliberately kept outside modifyEdt's own params (Design Notes) — branch *creation* has no
// membership semantics of its own, unlike setBranches/renameBranches, which both describe how
// membership/registration should change. Gated exactly the same way git.createBranch already
// gates internally (assertAllowedBranch, no edtId) — nothing extra to do here.
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

// The branch-picker's Pick-existing row-rename pre-step for a not-yet-member repoPath
// (Add-to-EDT): modifyEdt's own `renameBranches` param can only ever resolve `oldName` from
// this EDT's *existing* membership (see the pre-lock step above), which structurally cannot
// include a repoPath that isn't a member yet — there is nothing there to resolve. This thin
// wrapper around git.renameBranch (mirrors createMemberBranch immediately above) lets the
// picker rename an arbitrary picked branch and adopt the renamed result as the new member's
// branch via the entry point's own existing addMembers+setBranches call, one submit, exactly
// like Create-new's pre-step feeds a freshly created branch into that same call.
export interface RenameMemberBranchParams {
  git: GitPort;
  repoPath: string;
  oldName: string;
  newName: string;
  // Story 2.43: the target EDT's ulid — its own branches are exempt from the cross-EDT gate.
  edtId?: string;
}

export async function renameMemberBranch(params: RenameMemberBranchParams): Promise<Result<void>> {
  const { git, repoPath, oldName, newName, edtId } = params;
  return git.renameBranch(repoPath, oldName, newName, edtId);
}

// The branch-picker's candidate source (both the base-branch and Pick-existing lists) — a
// thin wrapper around git.listBranches, kept here (not called as `deps.git.listBranches`
// straight from the TUI store) so the store's own new action preserves the one consistent
// rule this codebase already follows: deps.git is never called directly from the TUI layer,
// only through a core export (Design Notes).
export async function listMemberBranches(git: GitPort, repoPath: string): Promise<Result<string[]>> {
  return git.listBranches(repoPath);
}
