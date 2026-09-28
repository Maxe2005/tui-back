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
//
// Story 2.35 semantics (per-service branch plans, remote branches):
//   - `memberPlans` (optional) carries one MemberBranchPlan per member — `create` (own base +
//     name, the base may be a remote-tracking ref such as `origin/release`) or `existing`
//     (attach a local or remote-only branch, optionally renaming it). When present it is
//     authoritative: `branchOptions` is ignored and never converted into plans. Keys are
//     resolve()d like `members`; a member without a plan, a plan for a non-member, a
//     duplicate key after resolve(), or an empty base/name/branch/renameTo is rejected with
//     invalid-argument before any write. `branchOptions` becomes optional; providing neither
//     is invalid-argument. Without `memberPlans`, the Story 2.2/2.27 `branchOptions` path runs
//     exactly as before.
//   - `existing` resolution order: a local branch wins (gated via assertAllowedBranch, or
//     renamed via renameBranch — which gates both names); else a remote-tracking ref listed
//     by listRemoteBranches becomes a local tracking branch (default local name = the ref
//     minus its remote segment, `origin/feat/q` -> `feat/q`, or `renameTo`); else the member
//     fails with branch-missing. Nothing is ever checked out or fetched.
//   - Outcomes widen to created | existing-branch | renamed | failed; per-member isolation is
//     unchanged. Registry-write rollback is typed: created and tracking branches are
//     force-deleted, renamed branches are renamed back; every rollback failure is
//     console.error-logged, never thrown.
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
  // Story 2.27: per-member base-branch override — the TUI forces one of these when selected
  // members' manifest-declared sharedBranch values diverge (never inferred/guessed, always
  // an explicit developer choice). `bases[member]` wins over `base` for that member when
  // present; optional and purely additive, so every pre-2.27 caller (CLI, existing tests)
  // that never sets it keeps applying `base` uniformly, unchanged.
  bases?: Record<string, string>;
  mode: 'grouped' | 'individual';
  // Branch name per member repoPath. Grouped mode: the same shared name for every member.
  // Individual mode: one name per member. Keys must be the member paths as passed in
  // `members` (the CLI canonicalizes both sides with node:path resolve()).
  names: Record<string, string>;
}

// Story 2.35: one member's authoritative branch plan (see the header comment).
export type MemberBranchPlan =
  | { kind: 'create'; base: string; name: string }
  | { kind: 'existing'; branch: string; renameTo?: string };

export interface CreateEdtMemberResult {
  service: string;
  outcome: 'created' | 'existing-branch' | 'renamed' | 'failed';
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
  // Optional since Story 2.35: required unless `memberPlans` is provided.
  branchOptions?: CreateBranchOptions;
  // Story 2.35: per-member plans keyed by member repoPath; authoritative when present.
  memberPlans?: Record<string, MemberBranchPlan>;
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

  let strategy: BranchStrategy;
  if (params.memberPlans !== undefined) {
    const plans = validateMemberPlans(members, params.memberPlans);
    if (!plans.ok) {
      return plans;
    }
    strategy = { kind: 'plans', plans: plans.data };
  } else if (branchOptions !== undefined) {
    if (branchOptions.create) {
      const unnamed = members.find((member) => branchOptions.names[member] === undefined);
      if (unnamed !== undefined) {
        return err('invalid-argument', `No branch name provided for member ${unnamed}`);
      }
    }
    strategy = { kind: 'options', options: branchOptions };
  } else {
    return err('invalid-argument', 'Either branchOptions or memberPlans is required to create an EDT');
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
  // Branch writes made in this run, tracked for rollback: if the registry write below fails,
  // the EDT dir/db is cleaned up and each write is undone (created/tracking branches deleted,
  // renamed branches renamed back — Story 2.35) so a failed creation leaves no trace in the
  // member repos.
  const branchWrites: BranchWrite[] = [];
  for (const member of members) {
    const resolved = await resolveMemberBranch(git, manifest, member, strategy, ulid);
    results.push({ service: resolved.service, outcome: resolved.outcome, ...(resolved.detail !== undefined ? { detail: resolved.detail } : {}) });
    // A failed member is never registered as a member — closes the gap where a "best
    // effort" fallback branch (e.g. the repo's current branch) could itself be shared
    // (story 2.3, AD-8). `branch` is only set for non-failed outcomes (see
    // ResolvedMemberBranch), so this doubles as the type-narrowing check.
    if (resolved.branch !== undefined) {
      memberEntries.push({ service: resolved.service, repoPath: member, branch: resolved.branch });
    }
    if (resolved.write !== undefined) {
      branchWrites.push(resolved.write);
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
    for (const write of branchWrites) {
      if (write.kind === 'created') {
        // Story 2.29: deleteBranch now requires an explicit force flag — `true` preserves this
        // rollback path's pre-existing `-D` (unconditional) behavior exactly.
        const deleted = await git.deleteBranch(write.repoPath, write.branchName, true);
        if (!deleted.ok) {
          console.error(
            `Failed to delete branch ${write.branchName} in ${write.repoPath} after a failed EDT creation:`,
            deleted.error.message,
          );
        }
      } else {
        // Story 2.35: a rename only succeeded if neither name was protected, so renaming back
        // cannot hit renameBranch's old-name gate.
        const restored = await git.renameBranch(write.repoPath, write.renamedTo, write.originalName);
        if (!restored.ok) {
          console.error(
            `Failed to rename branch ${write.renamedTo} back to ${write.originalName} in ${write.repoPath} after a failed EDT creation:`,
            restored.error.message,
          );
        }
      }
    }
    return registeredEntry;
  }

  return ok({ ulid, topic, results });
}

// Story 2.35: how members' branches are resolved — the legacy uniform `branchOptions`, or the
// authoritative per-member plans (keys already resolve()d and validated).
type BranchStrategy =
  | { kind: 'options'; options: CreateBranchOptions }
  | { kind: 'plans'; plans: Map<string, MemberBranchPlan> };

// Story 2.35: a git write made for one member, recorded so a registry-write failure can undo
// it — `created` covers both createBranch and createTrackingBranch (force-deleted on
// rollback), `renamed` a renameBranch (renamed back on rollback).
type BranchWrite =
  | { kind: 'created'; repoPath: string; branchName: string }
  | { kind: 'renamed'; repoPath: string; originalName: string; renamedTo: string };

// Story 2.35: validates `memberPlans` against the resolve()d members before any write —
// returns the plans keyed by resolved path, or invalid-argument.
function validateMemberPlans(
  members: string[],
  memberPlans: Record<string, MemberBranchPlan>,
): Result<Map<string, MemberBranchPlan>> {
  // Runtime guard: an untyped caller may pass null / a non-object (Object.entries would throw).
  const candidate: unknown = memberPlans;
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return err('invalid-argument', 'memberPlans must be an object keyed by member path');
  }
  const memberSet = new Set(members);
  const plans = new Map<string, MemberBranchPlan>();
  for (const [key, plan] of Object.entries(memberPlans)) {
    const path = resolve(key);
    if (!memberSet.has(path)) {
      return err('invalid-argument', `Branch plan provided for a non-member: ${key}`);
    }
    if (plans.has(path)) {
      return err('invalid-argument', `Duplicate branch plan for member ${path}`);
    }
    const invalid = invalidPlanReason(plan);
    if (invalid !== undefined) {
      return err('invalid-argument', `Invalid branch plan for member ${path}: ${invalid}`);
    }
    plans.set(path, plan);
  }
  const unplanned = members.find((member) => !plans.has(member));
  if (unplanned !== undefined) {
    return err('invalid-argument', `No branch plan provided for member ${unplanned}`);
  }
  return ok(plans);
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

function invalidPlanReason(plan: MemberBranchPlan): string | undefined {
  // Runtime guard: callers may bypass the type (untyped JS, JSON input).
  const candidate = plan as { kind?: unknown } | null | undefined;
  if (candidate === null || typeof candidate !== 'object') {
    return 'plan must be an object';
  }
  if (plan.kind === 'create') {
    if (isBlank(plan.base)) {
      return 'empty base';
    }
    if (isBlank(plan.name)) {
      return 'empty name';
    }
    return undefined;
  }
  if (plan.kind === 'existing') {
    if (isBlank(plan.branch)) {
      return 'empty branch';
    }
    if (plan.renameTo !== undefined && isBlank(plan.renameTo)) {
      return 'empty renameTo';
    }
    return undefined;
  }
  return `unknown plan kind ${String(candidate.kind)}`;
}

interface ResolvedMemberBranch {
  service: string;
  outcome: CreateEdtMemberResult['outcome'];
  detail?: CreateEdtMemberResult['detail'];
  // Set only when outcome !== 'failed': a failed member is never registered as an EDT
  // member (story 2.3), so there is nothing to compute a fallback value for.
  branch?: string;
  // Story 2.35: the git write this member's resolution made, for registry-write rollback.
  write?: BranchWrite;
}

function failed(service: string, error: { code: string; message: string }): ResolvedMemberBranch {
  return { service, outcome: 'failed', detail: { code: error.code, message: error.message } };
}

async function resolveMemberBranch(
  git: GitPort,
  manifest: ManifestPort,
  member: string,
  strategy: BranchStrategy,
  edtUlid: string,
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

  if (strategy.kind === 'plans') {
    // validateMemberPlans guarantees every member has a plan.
    return resolvePlannedMemberBranch(git, member, service, strategy.plans.get(member) as MemberBranchPlan, edtUlid);
  }
  const { options } = strategy;

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

  // Code review (story 2.27): `??` alone would pass an explicit empty-string `bases[member]`
  // straight to git as an empty base ref instead of falling back to `options.base` — `||`
  // treats an empty override the same as an absent one.
  const created = await git.createBranch(member, options.names[member], options.bases?.[member] || options.base);
  if (created.ok) {
    return {
      service,
      outcome: 'created',
      branch: options.names[member],
      write: { kind: 'created', repoPath: member, branchName: options.names[member] },
    };
  }

  // The branch could not be created. A failed member is never registered as an EDT member
  // any more (story 2.3), so there is no fallback branch to compute — unlike pre-2.3, this
  // no longer reads the member's current branch as a "best effort" substitute.
  return { service, outcome: 'failed', detail: { code: created.error.code, message: created.error.message } };
}

// Story 2.35: executes one member's authoritative plan. Never checks out, never fetches;
// every git write is gated by the adapter (AD-8, FR-7).
async function resolvePlannedMemberBranch(
  git: GitPort,
  member: string,
  service: string,
  plan: MemberBranchPlan,
  edtUlid: string,
): Promise<ResolvedMemberBranch> {
  if (plan.kind === 'create') {
    const created = await git.createBranch(member, plan.name, plan.base);
    if (!created.ok) {
      return failed(service, created.error);
    }
    return {
      service,
      outcome: 'created',
      branch: plan.name,
      write: { kind: 'created', repoPath: member, branchName: plan.name },
    };
  }

  // `existing`: a local branch wins over a remote-tracking ref of the same spelling.
  const local = await git.branchExistsLocally(member, plan.branch);
  if (!local.ok) {
    return failed(service, local.error);
  }

  if (local.data) {
    // An existing local branch is gated with the new EDT's ulid as edtId, so AD-8's
    // cross-EDT half runs too: the EDT is not registered yet, so any registered owner of this
    // branch is "another EDT" — attaching it, or renaming it away, is rejected
    // (branch-owned-by-other-edt). renameBranch itself only runs the shared-branch gate.
    const allowed = await git.assertAllowedBranch(member, plan.branch, edtUlid);
    if (!allowed.ok) {
      return failed(service, allowed.error);
    }
    if (plan.renameTo !== undefined && plan.renameTo !== plan.branch) {
      // renameBranch gates both the old and the new name against the shared set (Story 2.35).
      const renamed = await git.renameBranch(member, plan.branch, plan.renameTo);
      if (!renamed.ok) {
        return failed(service, renamed.error);
      }
      return {
        service,
        outcome: 'renamed',
        branch: plan.renameTo,
        write: { kind: 'renamed', repoPath: member, originalName: plan.branch, renamedTo: plan.renameTo },
      };
    }
    // Reused as-is: no git write gates it, so the gate above is its only check (Story 2.3
    // precedent for the branch-creation-disabled path).
    return { service, outcome: 'existing-branch', branch: plan.branch };
  }

  const remotes = await git.listRemoteBranches(member);
  if (!remotes.ok) {
    return failed(service, remotes.error);
  }
  if (!remotes.data.includes(plan.branch)) {
    return failed(service, {
      code: 'branch-missing',
      message: `Branch "${plan.branch}" exists neither locally nor as a remote-tracking ref in ${member}`,
    });
  }

  // Default local name: the remote ref minus its remote segment (`origin/feat/q` -> `feat/q`).
  const localName = plan.renameTo ?? plan.branch.slice(plan.branch.indexOf('/') + 1);
  if (localName === '' || !plan.branch.includes('/')) {
    return failed(service, {
      code: 'invalid-argument',
      message: `Cannot derive a local branch name from remote ref "${plan.branch}" in ${member}`,
    });
  }
  const tracked = await git.createTrackingBranch(member, localName, plan.branch);
  if (!tracked.ok) {
    return failed(service, tracked.error);
  }
  return {
    service,
    outcome: 'created',
    branch: localName,
    write: { kind: 'created', repoPath: member, branchName: localName },
  };
}

// Story 2.37: the create wizard's Step 3 per-service branch lists — local branches plus
// remote-tracking refs (`origin/x`), read through the caller's GitPort (the TUI never touches
// deps.git directly, mirroring modify.ts's listMemberBranches thin-wrapper precedent). Pure
// reads: nothing is ever fetched, so the remote list is whatever the last fetch left behind.
// Either read failing fails the whole call — a half-known list would make the wizard's
// "local preferred over origin/<x>" resolution silently wrong.
export async function listCreateCandidateBranches(
  git: GitPort,
  repoPath: string,
): Promise<Result<{ local: string[]; remote: string[] }>> {
  const local = await git.listBranches(repoPath);
  if (!local.ok) {
    return local;
  }
  const remote = await git.listRemoteBranches(repoPath);
  if (!remote.ok) {
    return remote;
  }
  return ok({ local: local.data, remote: remote.data });
}
