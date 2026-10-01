// core/edt/activate: makes the very first EDT active. Once one is active, `switchActiveEdt` is
// the only path (it owns the outgoing EDT's stash); this refuses with `activate-has-outgoing`.
// Pre-flight before any checkout: paths a checkout would overwrite (dirty AND differing from the
// target) block the run unless confirmed in `overwrite`. Confirmed paths are discarded path by
// path, never with discardAll; per-repo failures never block the others.
import { resolve } from 'node:path';
import { withActionLock } from '../locking.js';
import type { EdtMember, EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { err, ok, type Result } from '../result.js';
import { failed, resolveTargetBranch, type SwitchEdtRepoResult, type TargetBranchSpec } from './switch.js';

export interface ActivateEdtParams {
  edtRegistry: EdtRegistryPort;
  registry: RegistryPort;
  manifest: ManifestPort;
  git: GitPort;
  lock: LockPort;
  state: StatePort;
  edtRegistryResourceKey: string;
  topic: string;
  // Paths the developer confirmed overwriting, per repoPath (the TUI's second confirmation).
  overwrite?: Record<string, string[]>;
}

// One repo whose checkout would overwrite uncommitted work: `paths` are all its at-risk paths.
export interface ActivationBlockedRepo {
  service: string;
  repoPath: string;
  paths: string[];
}

export type ActivateEdtData =
  | { status: 'blocked'; blocked: ActivationBlockedRepo[] }
  | { status: 'activated'; ulid: string; topic: string; results: SwitchEdtRepoResult[] };

// A repo the pre-flight cleared for checkout.
interface ReadyRepo {
  service: string;
  repoPath: string;
  branch: string;
  alreadyThere: boolean;
  atRisk: string[];
}

type Preflighted = { kind: 'ready'; repo: ReadyRepo } | { kind: 'failed'; row: SwitchEdtRepoResult };

export async function activateEdt(params: ActivateEdtParams): Promise<Result<ActivateEdtData>> {
  const { edtRegistry, registry, manifest, git, lock, state, edtRegistryResourceKey } = params;

  const topic = params.topic.trim();
  if (topic === '') {
    return err('missing-argument', 'activateEdt needs the topic of the EDT to activate');
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
  if (currentActive.data !== null) {
    return err(
      'activate-has-outgoing',
      `Cannot activate "${topic}" directly: an EDT is already active — switch to it instead (the protected switch preserves the outgoing EDT's work). Nothing was touched.`,
    );
  }

  const registered = await registry.list();
  if (!registered.ok) {
    return registered;
  }
  const registeredPaths = new Set(registered.data.map((rawPath) => resolve(rawPath)));

  const confirmed = new Map<string, Set<string>>();
  for (const [rawPath, paths] of Object.entries(params.overwrite ?? {})) {
    confirmed.set(resolve(rawPath), new Set(paths));
  }

  // Pre-flight: every repo, before any checkout.
  const preflighted: Preflighted[] = [];
  for (const repoPath of registeredPaths) {
    const found = target.members.find((candidate) => resolve(candidate.repoPath) === repoPath);
    preflighted.push(await preflightRepo(git, manifest, repoPath, found, target.ulid));
  }

  const atRiskRepos = preflighted.flatMap((entry) =>
    entry.kind === 'ready' && entry.repo.atRisk.length > 0 ? [entry.repo] : [],
  );
  const unconfirmed = atRiskRepos.some((repo) => {
    const accepted = confirmed.get(repo.repoPath);
    return repo.atRisk.some((path) => accepted === undefined || !accepted.has(path));
  });
  if (unconfirmed) {
    return ok({
      status: 'blocked',
      blocked: atRiskRepos.map((repo) => ({ service: repo.service, repoPath: repo.repoPath, paths: repo.atRisk })),
    });
  }

  // Activation: every at-risk path is confirmed by now.
  const results: SwitchEdtRepoResult[] = [];
  for (const entry of preflighted) {
    results.push(entry.kind === 'failed' ? entry.row : await activateRepo(git, entry.repo));
  }

    // A member no longer in the managed-repo registry is surfaced as `failed`, never silently
    // skipped.
  for (const found of target.members) {
    if (!registeredPaths.has(resolve(found.repoPath))) {
      results.push(
        failed(found.service, {
          code: 'repo-not-registered',
          message: `Member ${found.repoPath} is no longer in the managed-repo registry`,
        }),
      );
    }
  }

  const written = await withActionLock(lock, edtRegistryResourceKey, async () => {
    // Re-read under the lock: another activation or switch may have set an active EDT while
    // this one ran its per-repo checkouts — never overwrite the pointer it won.
    const activeNow = await state.readActiveEdt();
    if (!activeNow.ok) {
      return err(activeNow.error.code, activeNow.error.message, { results });
    }
    if (activeNow.data !== null) {
      return err(
        'activate-has-outgoing',
        `Cannot activate "${topic}": another EDT became active meanwhile — its pointer was kept. Switch to "${topic}" instead.`,
        { results },
      );
    }
    const wroteState = await state.writeActiveEdt(target.ulid);
    if (!wroteState.ok) {
      return err(wroteState.error.code, wroteState.error.message, { results });
    }
    const activated = await edtRegistry.setStatus(target.ulid, 'active');
    if (!activated.ok) {
      results.push(failed('edt-registry:activate-target', activated.error));
    }
    return ok(undefined);
  });
  if (!written.ok) {
    return written;
  }

  return ok({ status: 'activated', ulid: target.ulid, topic: target.topic, results });
}

async function preflightRepo(
  git: GitPort,
  manifest: ManifestPort,
  repoPath: string,
  found: EdtMember | undefined,
  ulid: string,
): Promise<Preflighted> {
  let service: string;
  let spec: TargetBranchSpec;
  if (found !== undefined) {
    service = found.service;
    spec = { kind: 'member', branch: found.branch, edtUlid: ulid };
  } else {
    const loaded = await manifest.load(repoPath);
    if (!loaded.ok) {
      return { kind: 'failed', row: failed(repoPath, loaded.error) };
    }
    service = loaded.data.service;
    spec = { kind: 'shared', branch: loaded.data.sharedBranch };
  }

  const destination = await resolveTargetBranch(git, repoPath, spec);
  if (!destination.ok) {
    return { kind: 'failed', row: failed(service, destination.error) };
  }

  const current = await git.currentBranch(repoPath);
  if (current.ok && current.data === spec.branch) {
    return { kind: 'ready', repo: { service, repoPath, branch: spec.branch, alreadyThere: true, atRisk: [] } };
  }

  const dirty = await git.listDirtyPaths(repoPath, { expandUntracked: true });
  if (!dirty.ok) {
    return { kind: 'failed', row: failed(service, dirty.error) };
  }
  let atRisk: string[] = [];
  if (dirty.data.length > 0) {
    const diff = await git.diffNameOnly(repoPath, current.ok ? current.data : 'HEAD', spec.branch);
    if (!diff.ok) {
      return { kind: 'failed', row: failed(service, diff.error) };
    }
    const differing = new Set(diff.data);
    atRisk = [...new Set(dirty.data.filter((path) => differing.has(path)))];
  }
  return { kind: 'ready', repo: { service, repoPath, branch: spec.branch, alreadyThere: false, atRisk } };
}

async function activateRepo(git: GitPort, repo: ReadyRepo): Promise<SwitchEdtRepoResult> {
  const { service, repoPath, branch, atRisk } = repo;
  if (repo.alreadyThere) {
    return { service, outcome: 'switched' };
  }

  if (atRisk.length > 0) {
    const discarded = await git.discardPathsToHead(repoPath, atRisk);
    if (!discarded.ok) {
      return {
        service,
        outcome: 'failed',
        detail: {
          code: discarded.error.code,
          message: `${discarded.error.message}. The confirmed paths may have been partially discarded; not checked out.`,
          discardedPaths: atRisk,
        },
      };
    }
  }

  const checkedOut = await git.checkout(repoPath, branch);
  if (!checkedOut.ok) {
    if (atRisk.length > 0) {
      return {
        service,
        outcome: 'failed',
        detail: {
          code: checkedOut.error.code,
          message: `${checkedOut.error.message}. The confirmed paths had already been discarded.`,
          discardedPaths: atRisk,
        },
      };
    }
    return failed(service, checkedOut.error);
  }

  if (atRisk.length > 0) {
    return {
      service,
      outcome: 'discarded',
      detail: { code: 'discarded', message: `Discarded ${atRisk.length} uncommitted path(s)`, discardedPaths: atRisk },
    };
  }
  return { service, outcome: 'switched' };
}
