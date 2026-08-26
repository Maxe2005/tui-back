// core/edt/create: the core use-case for creating a new EDT (Environment de Développement
// Temporisé). Story 2.2 extends Story 2.1's skeleton: an EDT now requires a topic and at
// least one manually selected member service (drawn from the managed-repo registry), and
// may optionally create a dev branch per member (default base `development`, naming mode
// grouped = one shared name / individual = one name per member, or disabled = reuse the
// existing branch). Returns a Result carrying { ulid, topic, results } on success.
//
// AD-7: one SQLite per EDT — the DB file lives at edtsBaseDir/<ulid>.db, a sibling of the
//       EDT directory (edtsBaseDir/<ulid>/), not nested inside it.
// AD-4: the .tui-back.yaml manifest is written with non-empty, ulid-based placeholder values
//       (service/container/migrationCommand are stubs — story 2.5 "modify an EDT" is where a
//       user fills in the real values) and validated through the caller-supplied
//       ManifestPort, the same zod schema every other manifest consumer enforces.
// AD-6: the EDT is recorded in a dedicated EDT registry (ports/edt-registry.ts, not
//       RegistryPort's { repos: string[] } shape) under the same per-resource advisory lock
//       (AD-9) register/reset already use for their own registry writes, so concurrent
//       `edt create` runs don't race the read-modify-write.
// AD-1: core/ never imports adapters/ — XDG paths and every port (manifest, registry, git,
//       EDT registry, lock) are provided by the caller (CLI/TUI composition root). Direct
//       node:fs / node:path and the `ulid`/`better-sqlite3` packages are plain runtime deps,
//       not adapters, so importing them here doesn't cross the boundary.
// AD-8: git writes go through the caller-supplied GitPort only; the driven git adapter owns
//       the shared-branch gate (assertAllowedBranch). createEdt itself never shells out to
//       git.
//
// Story 2.2 semantics (from the story spec):
//   - topic + zero-member + duplicate-topic + unregistered-member rejections all happen
//     before any file write.
//   - Branch creation is all-or-nothing per action but per-service isolated: one member's
//     failure never aborts the others and never fails EDT creation; per-service outcomes
//     flow into data.results as { service, outcome, detail? } with outcome in the closed
//     set created | existing-branch | failed.
//   - Branch creation never checks out the created branch (git branch <name> <base> creates
//     a ref; moving the working tree onto it is Story 2.4's protected-switch).
//
// Story 2.3 semantics (git branch-scope safety gate, FR-7/AD-8):
//   - The branch-creation-disabled path's existing current branch is not exempt from the
//     shared-branch gate: it is checked via git.assertAllowedBranch before being reused as
//     the member's own EDT branch, same as a newly created branch already is via
//     git.createBranch.
//   - A member whose outcome is `failed` — for any reason (shared-branch rejection, a
//     git/manifest read error, a branch-creation failure) — is excluded from the registered
//     `members` entirely; there is no "best effort" fallback branch recorded for a failed
//     member any more, closing the gap where a fallback could itself be a shared branch.
//     The member still gets a `failed` row in `results`, so the failure is never silently
//     dropped, and the batch stays per-member isolated (one failure never blocks another
//     member or the EDT's creation, even down to zero members — Story 2.5's invariant).
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { ulid as generateUlid } from 'ulid';
import { stringify } from 'yaml';
import { withActionLock } from '../locking.js';
import type { EdtMember, EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import { err, ok, type Result } from '../result.js';

export interface CreateBranchOptions {
  create: boolean;
  base: string;
  mode: 'grouped' | 'individual';
  // Branch name per member repoPath. Grouped mode: the same shared name for every member.
  // Individual mode: one name per member. Keys must be the member paths as passed in
  // `members` (the CLI canonicalizes both sides with node:path resolve()).
  names: Record<string, string>;
}

export interface CreateEdtMemberResult {
  service: string;
  outcome: 'created' | 'existing-branch' | 'failed';
  detail?: { code: string; message: string };
}

export interface CreateEdtData {
  ulid: string;
  topic: string;
  results: CreateEdtMemberResult[];
}

export interface CreateEdtParams {
  edtsBaseDir: string;
  manifest: ManifestPort;
  edtRegistry: EdtRegistryPort;
  lock: LockPort;
  edtRegistryResourceKey: string;
  registry: RegistryPort;
  git: GitPort;
  topic: string;
  members: string[];
  branchOptions: CreateBranchOptions;
}

export async function createEdt(params: CreateEdtParams): Promise<Result<CreateEdtData>> {
  const {
    edtsBaseDir,
    manifest,
    edtRegistry,
    lock,
    edtRegistryResourceKey,
    registry,
    git,
    branchOptions,
  } = params;

  const topic = params.topic.trim();
  if (topic === '') {
    return err('missing-argument', 'Usage: tui-back edt create --topic <topic> --member <path> [...options]');
  }

  const members = params.members.map((member) => resolve(member));
  if (members.length === 0) {
    return err('invalid-member', 'At least one member service is required to create an EDT');
  }

  // Membership: every selected member must be a registered managed repo (AD-6). The
  // registry stores canonicalized absolute paths, so members are resolved the same way
  // before the set check.
  const registered = await registry.list();
  if (!registered.ok) {
    return registered;
  }
  const registeredPaths = new Set(registered.data.map((path) => resolve(path)));
  const unknownMember = members.find((member) => !registeredPaths.has(member));
  if (unknownMember !== undefined) {
    return err('invalid-member', `Member is not a registered managed repo: ${unknownMember}`);
  }

  // Topic uniqueness: checked before any file write. The registry write itself stays under
  // the per-resource lock below (AD-9).
  const existing = await edtRegistry.list();
  if (!existing.ok) {
    return existing;
  }
  if (existing.data.some((entry) => entry.topic === topic)) {
    return err('edt-topic-exists', `An EDT with topic "${topic}" already exists`);
  }

  if (branchOptions.create) {
    const unnamed = members.find((member) => branchOptions.names[member] === undefined);
    if (unnamed !== undefined) {
      return err('invalid-argument', `No branch name provided for member ${unnamed}`);
    }
  }

  const ulid = generateUlid();
  const edtDir = join(edtsBaseDir, ulid);
  const dbPath = join(edtsBaseDir, `${ulid}.db`);

  if (existsSync(edtDir)) {
    return err('edt-creation-failed', `EDT directory already exists: ${edtDir}`);
  }

  try {
    mkdirSync(edtDir, { recursive: true });
  } catch (createError) {
    return err('edt-creation-failed', `Failed to create EDT directory ${edtDir}`, createError);
  }

  const rollback = (): void => {
    try {
      rmSync(edtDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`Failed to clean up EDT directory ${edtDir} after a failed creation:`, cleanupError);
    }
    try {
      rmSync(dbPath, { force: true });
    } catch (cleanupError) {
      console.error(`Failed to clean up EDT database ${dbPath} after a failed creation:`, cleanupError);
    }
  };

  // Write state.json (transient state — AD-7)
  const statePath = join(edtDir, 'state.json');
  const stateInit = JSON.stringify({ ulid, createdAt: new Date().toISOString(), status: 'active' }, null, 2);
  try {
    writeFileSync(statePath, stateInit, 'utf8');
  } catch (stateError) {
    rollback();
    return err('edt-creation-failed', `Failed to write state.json at ${statePath}`, stateError);
  }

  // Write .tui-back.yaml (AD-4) with non-empty, ulid-based placeholder values, then validate
  // it through the caller's ManifestPort — the same zod schema loadManifest enforces
  // everywhere else, so a manifest this use-case writes is guaranteed loadable by the rest
  // of the system.
  const manifestPath = join(edtDir, '.tui-back.yaml');
  const placeholderManifest = {
    service: `edt-${ulid}`,
    container: `edt-${ulid}`,
    migrationCommand: 'true',
    modules: {},
  };
  try {
    writeFileSync(manifestPath, stringify(placeholderManifest), 'utf8');
  } catch (manifestWriteError) {
    rollback();
    return err('edt-creation-failed', `Failed to write .tui-back.yaml at ${manifestPath}`, manifestWriteError);
  }

  const validated = await manifest.load(edtDir);
  if (!validated.ok) {
    rollback();
    return err(
      'edt-creation-failed',
      `Generated .tui-back.yaml at ${manifestPath} failed manifest validation`,
      validated.error,
    );
  }

  // Create the SQLite database (AD-7) as a sibling of the EDT directory, at
  // edtsBaseDir/<ulid>.db — better-sqlite3 gives a real, valid (empty) SQLite file rather
  // than a 0-byte placeholder. Real schema/migrations land in later stories.
  // Story 2.15: create the action_log table for per-EDT action history.
  try {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS action_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        action_type TEXT NOT NULL,
        outcome TEXT NOT NULL,
        detail TEXT NOT NULL
      )
    `);
    db.close();
  } catch (dbError) {
    rollback();
    return err('edt-creation-failed', `Failed to create SQLite database at ${dbPath}`, dbError);
  }

  // Per-member branch loop (Story 2.2). Iterates members in caller order for deterministic
  // results; per-service failure isolation: one member's branch outcome never affects the
  // others and never fails EDT creation.
  const results: CreateEdtMemberResult[] = [];
  const memberEntries: EdtMember[] = [];
  // Branches successfully created in this run, tracked for rollback: if the registry write
  // below fails, the EDT dir/db is cleaned up and these refs are deleted so a failed
  // creation leaves no trace in the member repos.
  const createdBranches: Array<{ repoPath: string; branchName: string }> = [];
  for (const member of members) {
    const resolved = await resolveMemberBranch(git, manifest, member, branchOptions);
    results.push({ service: resolved.service, outcome: resolved.outcome, ...(resolved.detail !== undefined ? { detail: resolved.detail } : {}) });
    // A failed member is never registered as a member — closes the gap where a "best
    // effort" fallback branch (e.g. the repo's current branch) could itself be shared
    // (story 2.3, AD-8). `branch` is only set for non-failed outcomes (see
    // ResolvedMemberBranch), so this doubles as the type-narrowing check.
    if (resolved.branch !== undefined) {
      memberEntries.push({ service: resolved.service, repoPath: member, branch: resolved.branch });
    }
    if (resolved.outcome === 'created') {
      createdBranches.push({ repoPath: member, branchName: branchOptions.names[member] });
    }
  }

  // Record the EDT in the EDT registry (AD-6/Task 2), under the same advisory-lock pattern
  // register/reset already use for their own registry writes (AD-9). The topic-uniqueness
  // check runs again inside the locked section: the pre-lock fast-fail above covers the
  // sequential case, but two racing `edt create --topic demo` runs would both pass it — the
  // lock serializes the read-modify-write, so the authoritative check must happen under it.
  const registeredEntry = await withActionLock(lock, edtRegistryResourceKey, async () => {
    const current = await edtRegistry.list();
    if (!current.ok) {
      return current;
    }
    if (current.data.some((entry) => entry.topic === topic)) {
      return err('edt-topic-exists', `An EDT with topic "${topic}" already exists`);
    }
    return edtRegistry.add({ ulid, topic, createdAt: new Date().toISOString(), status: 'active', members: memberEntries });
  });
  if (!registeredEntry.ok) {
    rollback();
    for (const { repoPath, branchName } of createdBranches) {
      const deleted = await git.deleteBranch(repoPath, branchName);
      if (!deleted.ok) {
        console.error(
          `Failed to delete branch ${branchName} in ${repoPath} after a failed EDT creation:`,
          deleted.error.message,
        );
      }
    }
    return registeredEntry;
  }

  return ok({ ulid, topic, results });
}

interface ResolvedMemberBranch {
  service: string;
  outcome: CreateEdtMemberResult['outcome'];
  detail?: CreateEdtMemberResult['detail'];
  // Set only when outcome !== 'failed': a failed member is never registered as an EDT
  // member (story 2.3), so there is nothing to compute a fallback value for.
  branch?: string;
}

async function resolveMemberBranch(
  git: GitPort,
  manifest: ManifestPort,
  member: string,
  options: CreateBranchOptions,
): Promise<ResolvedMemberBranch> {
  const loaded = await manifest.load(member);
  const service = loaded.ok ? loaded.data.service : member;

  // A member whose manifest cannot load has no identifiable service identity, and both
  // branch paths need the manifest (the git adapter resolves the shared-branch gate from
  // it). Report it as a per-service failure without aborting the batch; a failed member is
  // never registered (story 2.3), so no branch needs to be read here.
  if (!loaded.ok) {
    return { service, outcome: 'failed', detail: { code: loaded.error.code, message: loaded.error.message } };
  }

  if (!options.create) {
    const current = await git.currentBranch(member);
    if (!current.ok) {
      return { service, outcome: 'failed', detail: { code: current.error.code, message: current.error.message } };
    }

    // Story 2.3: the existing current branch is never checked by git.createBranch (there is
    // no create call on this path), so it must pass the shared-branch gate itself before
    // being reused as the member's own EDT branch (AD-8, FR-7).
    const allowed = await git.assertAllowedBranch(member, current.data);
    if (!allowed.ok) {
      return { service, outcome: 'failed', detail: { code: allowed.error.code, message: allowed.error.message } };
    }

    return { service, outcome: 'existing-branch', branch: current.data };
  }

  const created = await git.createBranch(member, options.names[member], options.base);
  if (created.ok) {
    return { service, outcome: 'created', branch: options.names[member] };
  }

  // The branch could not be created. A failed member is never registered as an EDT member
  // any more (story 2.3), so there is no fallback branch to compute — unlike pre-2.3, this
  // no longer reads the member's current branch as a "best effort" substitute.
  return { service, outcome: 'failed', detail: { code: created.error.code, message: created.error.message } };
}
