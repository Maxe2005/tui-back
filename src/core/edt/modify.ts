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
import { resolve } from 'node:path';
import { withActionLock } from '../locking.js';
import type { EdtMember, EdtRegistryPort } from '../ports/edt-registry.js';
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
  } = params;

  const trimmedTopic = topic.trim();
  if (trimmedTopic === '') {
    return err('missing-argument', 'Usage: tui-back edt modify --topic <topic> [--add-member <path>]... [--remove-member <path>]... [--set-branch <path>=<branch>]... [--rename-to <topic>]');
  }

  // At least one operation required
  const hasOp = addMembers.length > 0 || removeMembers.length > 0 || setBranches.length > 0 || (renameTo !== undefined);
  if (!hasOp) {
    return err('invalid-argument', 'At least one operation required: --add-member, --remove-member, --set-branch, or --rename-to');
  }

  // Fast-fail: check target EDT exists
  const edtListed = await edtRegistry.list();
  if (!edtListed.ok) {
    return edtListed;
  }
  const target = edtListed.data.find((candidate) => candidate.topic === trimmedTopic);
  if (target === undefined) {
    return err('edt-not-found', `No EDT with topic "${trimmedTopic}" is registered`);
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

  // Pre-lock: collect per-op results for git-touching ops.
  // We do git writes outside the lock (same precedent as create/switch), then under the
  // lock we only assemble the final entry and write edts.yaml.
  const results: ModifyEdtResult[] = [];
  // Review patch (story 2.9): adds/branch-changes were computed into `results` above but
  // never fed back into the registry entry written under the lock below — the write only
  // ever applied the deterministic topic rename + removals. These two arrays carry the
  // *successful* outcomes' data forward so the lock section can actually persist them.
  const addedMembers: EdtMember[] = [];
  const branchChanges: Array<{ repoPath: string; branch: string }> = [];

  // ---- 1. Add members (pre-lock: read current branch + gate AD-8) ----
  if (addMembers.length > 0) {
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
        continue;
      }

      // Read current branch + gate AD-8 (shared-branch + cross-EDT ownership)
      const current = await git.currentBranch(resolved);
      if (!current.ok) {
        results.push({
          service: resolved,
          outcome: 'failed',
          detail: { code: current.error.code, message: current.error.message },
        });
        continue;
      }

      const allowed = await git.assertAllowedBranch(resolved, current.data, target.ulid);
      if (!allowed.ok) {
        results.push({
          service: resolved,
          outcome: 'failed',
          detail: { code: allowed.error.code, message: allowed.error.message },
        });
        continue;
      }

      // Resolve the real service identity for the persisted registry entry (same source
      // create.ts uses) rather than falling back to the raw path — a manifest-load failure
      // here is not fatal to the add (the branch is already gated), it only degrades the
      // recorded service label.
      const loadedManifest = await manifest.load(resolved);
      const service = loadedManifest.ok ? loadedManifest.data.service : resolved;

      // Record member with current (gated) branch — success
      results.push({
        service,
        outcome: 'added',
        newBranch: current.data,
      });
      addedMembers.push({ service, repoPath: resolved, branch: current.data });
    }
  }

  // ---- 2. Remove members (pre-logic, validated under lock) ----
  // No git writes; just note the removals. Under the lock we'll validate members exist
  // and actually remove them from the registry entry.
  if (removeMembers.length > 0) {
    // We'll mark each as removed in results; the actual registry edit happens under lock.
    for (const memberPath of removeMembers) {
      results.push({
        service: memberPath,
        outcome: 'removed',
      });
    }
  }

  // ---- 3. Set branches (pre-lock: gate + protected-switch git) ----
  if (setBranches.length > 0) {
    for (const { repoPath, branch } of setBranches) {
      const resolved = resolve(repoPath);

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

      // Determine service from manifest
      const { service } = await (async () => {
        const loaded = await manifest.load(resolved);
        return loaded.ok ? { service: loaded.data.service } : { service: resolved.split('/').pop() || resolved };
      })();
      results.push({
        service,
        outcome: 'branch-changed',
        newBranch: branch,
      });
      branchChanges.push({ repoPath: resolved, branch });
    }
  }

  // ---- Under per-resource advisory lock (AD-9): assemble final entry and write edts.yaml ----
  const written = await withActionLock(lock, edtRegistryResourceKey, async () => {
    // Re-read the authoritative list
    const reListed = await edtRegistry.list();
    if (!reListed.ok) {
      return reListed;
    }

    // Re-check rename uniqueness under lock (race-safe)
    if (renameTo !== undefined) {
      if (edtListed.data.some((entry) => entry.topic === renameTo && entry.ulid !== target.ulid)) {
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
  if (!written.ok) {
    return written;
  }

  return ok({ ulid: target.ulid, topic: renameTo !== undefined ? renameTo : trimmedTopic, results });
}