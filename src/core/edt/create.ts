// core/edt/create: creates an EDT — validates topic and members, writes the EDT dir, manifest
// and SQLite db, resolves one branch per member (branchOptions, or authoritative memberPlans),
// then registers the EDT under the registry lock. Every rejection happens before any write;
// a member's failure never aborts the others and a failed member is never registered.
// Branches are created or attached, never checked out or fetched.
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
  // Per-member base override, set by the TUI when members' manifest sharedBranch values
  // diverge. `bases[member]` wins over `base` for that member.
  bases?: Record<string, string>;
  mode: 'grouped' | 'individual';
  // Branch name per member repoPath. Grouped mode: the same shared name for every member.
  // Individual mode: one name per member. Keys must be the member paths as passed in
  // `members` (the CLI canonicalizes both sides with node:path resolve()).
  names: Record<string, string>;
}

// One member's authoritative branch plan: `create` (own base + name, the base may be a
// remote-tracking ref) or `existing` (attach a local or remote-only branch, optionally renamed).
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
  // Required unless `memberPlans` is provided.
  branchOptions?: CreateBranchOptions;
  // Per-member plans keyed by member repoPath; when present `branchOptions` is ignored.
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
  // than a 0-byte placeholder. The action_log table holds per-EDT action history.
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

  // Per-member branch loop, in caller order for deterministic results. One member's outcome
  // never affects the others and never fails EDT creation.
  const results: CreateEdtMemberResult[] = [];
  const memberEntries: EdtMember[] = [];
  // Branch writes made in this run, tracked for rollback: if the registry write below fails,
  // the EDT dir/db is cleaned up and each write is undone (created/tracking branches deleted,
  // renamed branches renamed back) so a failed creation leaves no trace in the member repos.
  const branchWrites: BranchWrite[] = [];
  for (const member of members) {
    const resolved = await resolveMemberBranch(git, manifest, member, strategy, ulid);
    results.push({ service: resolved.service, outcome: resolved.outcome, ...(resolved.detail !== undefined ? { detail: resolved.detail } : {}) });
    // A failed member is never registered: a "best effort" fallback branch (e.g. the repo's
    // current branch) could itself be shared (AD-8). `branch` is only set for non-failed
    // outcomes (see ResolvedMemberBranch), so this doubles as the type-narrowing check.
    if (resolved.branch !== undefined) {
      memberEntries.push({ service: resolved.service, repoPath: member, branch: resolved.branch });
    }
    if (resolved.write !== undefined) {
      branchWrites.push(resolved.write);
    }
  }

  // Record the EDT in the EDT registry (AD-6), under the same advisory-lock pattern
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
        // `true` keeps this rollback's unconditional `-D` behavior.
        const deleted = await git.deleteBranch(write.repoPath, write.branchName, true);
        if (!deleted.ok) {
          console.error(
            `Failed to delete branch ${write.branchName} in ${write.repoPath} after a failed EDT creation:`,
            deleted.error.message,
          );
        }
      } else {
        // A rename only succeeded if neither name was protected, so renaming back cannot hit
        // renameBranch's old-name gate.
        const restored = await git.renameBranch(write.repoPath, write.renamedTo, write.originalName, ulid);
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

// How members' branches are resolved — the uniform `branchOptions`, or the authoritative
// per-member plans (keys already resolve()d and validated).
type BranchStrategy =
  | { kind: 'options'; options: CreateBranchOptions }
  | { kind: 'plans'; plans: Map<string, MemberBranchPlan> };

// A git write made for one member, recorded so a registry-write failure can undo it —
// `created` covers both createBranch and createTrackingBranch (force-deleted on rollback),
// `renamed` a renameBranch (renamed back on rollback).
type BranchWrite =
  | { kind: 'created'; repoPath: string; branchName: string }
  | { kind: 'renamed'; repoPath: string; originalName: string; renamedTo: string };

// Validates `memberPlans` against the resolve()d members before any write: a member without a
// plan, a plan for a non-member, a duplicate key after resolve(), or an empty
// base/name/branch/renameTo is invalid-argument.
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
  // member, so there is nothing to compute a fallback value for.
  branch?: string;
  // The git write this member's resolution made, for registry-write rollback.
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
  // never registered, so no branch needs to be read here.
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

    // The existing current branch is never checked by git.createBranch (there is no create
    // call on this path), so it must pass the shared-branch gate itself before being reused
    // as the member's own EDT branch (AD-8, FR-7).
    const allowed = await git.assertAllowedBranch(member, current.data);
    if (!allowed.ok) {
      return { service, outcome: 'failed', detail: { code: allowed.error.code, message: allowed.error.message } };
    }

    return { service, outcome: 'existing-branch', branch: current.data };
  }

  // `||`, not `??`: an explicit empty-string `bases[member]` must fall back to `options.base`
  // instead of reaching git as an empty base ref.
  const created = await git.createBranch(member, options.names[member], options.bases?.[member] || options.base);
  if (created.ok) {
    return {
      service,
      outcome: 'created',
      branch: options.names[member],
      write: { kind: 'created', repoPath: member, branchName: options.names[member] },
    };
  }

  // The branch could not be created. A failed member is never registered, so there is no
  // fallback branch to compute.
  return { service, outcome: 'failed', detail: { code: created.error.code, message: created.error.message } };
}

// Executes one member's authoritative plan. Never checks out, never fetches; every git write
// is gated by the adapter (AD-8, FR-7). `existing` order: a local branch wins, else a listed
// remote-tracking ref becomes a local tracking branch, else the member fails branch-missing.
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
      // renameBranch gates both the old and the new name against the shared set.
      const renamed = await git.renameBranch(member, plan.branch, plan.renameTo, edtUlid);
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
    // Reused as-is: no git write gates it, so the gate above is its only check.
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

// The create wizard's per-service branch lists — local branches plus remote-tracking refs
// (`origin/x`). Pure reads: nothing is fetched, so the remote list is whatever the last fetch
// left behind. Either read failing fails the whole call — a half-known list would make the
// wizard's "local preferred over origin/<x>" resolution silently wrong.
export type CreateCandidateBranches = { local: string[]; remote: string[] };

export async function listCreateCandidateBranches(git: GitPort, repoPath: string): Promise<Result<CreateCandidateBranches>> {
  // Both reads are independent: run them side by side.
  const [local, remote] = await Promise.all([git.listBranches(repoPath), git.listRemoteBranches(repoPath)]);
  if (!local.ok) {
    return local;
  }
  if (!remote.ok) {
    return remote;
  }
  return ok({ local: local.data, remote: remote.data });
}
