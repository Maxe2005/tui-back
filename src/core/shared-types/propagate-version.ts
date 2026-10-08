// core/shared-types/propagate-version: rewrites one dependency's declared version across the
// chosen consumer services. The version is verified on the registry before anything is written;
// then, per service and in this order: branch-scope gate, dirty check, rewrite of the dependency
// line only, optional `npm i`, optional clean restart, optional commit of package.json (+
// package-lock.json when present) and nothing else. One service failing never stops the others,
// and a failed service can be retried on its own, resuming at the step that failed. Nothing is
// ever pushed. Core receives every port; it never names the module that provides them.
import { existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import type { ContainerPort } from '../ports/container.js';
import type { GitPort } from '../ports/git.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RestartPort } from '../ports/restart.js';
import type { SharedTypesPort } from '../ports/shared-types.js';
import { err, ok, type Result } from '../result.js';
import { runRestartStep } from '../scripts/group-update.js';
import type { DependencyConsumer } from './list-consumers.js';

export type PropagateStep = 'gate' | 'dirty-check' | 'write' | 'install' | 'restart' | 'commit';
export type PropagateStepStatus = 'done' | 'skipped' | 'failed';

export interface PropagateOptions {
  install: boolean;
  cleanRestart: boolean;
  commit: boolean;
}

export interface PropagateStepResult {
  step: PropagateStep;
  status: PropagateStepStatus;
  detail?: string;
}

export interface PropagateServiceResult {
  service: string;
  repoPath: string;
  outcome: 'done' | 'skipped' | 'failed';
  steps: PropagateStepResult[];
  // `skipped`: why the service was left untouched.
  reason?: string;
  // `failed`: the step that failed (the retry resumes there) and its error.
  failedStep?: PropagateStep;
  error?: { code: string; message: string };
}

// A later step can resume a failed run without re-writing the line or tripping the dirty check
// on the tool's own edit.
export type ResumeFrom = 'install' | 'restart' | 'commit';

export interface PropagateParams {
  git: GitPort;
  manifest: ManifestPort;
  container: ContainerPort;
  restart: RestartPort;
  shared: SharedTypesPort;
  version: string;
  consumers: DependencyConsumer[];
  options: PropagateOptions;
  // Retry: per repoPath, the step to resume at (from a previous failed result).
  resume?: Readonly<Record<string, ResumeFrom>>;
  onProgress?: (event: { service: string; repoPath: string; step: PropagateStep }) => void;
  // Test seam: whether a repo-relative file exists.
  fileExists?: (repoPath: string, relativePath: string) => boolean;
}

export type PropagateReport =
  | { status: 'blocked'; error: { code: string; message: string } }
  | { status: 'completed'; results: PropagateServiceResult[] };

const RESUMABLE: readonly PropagateStep[] = ['install', 'restart', 'commit'];

export function isResumable(step: PropagateStep | undefined): step is ResumeFrom {
  return step !== undefined && RESUMABLE.includes(step);
}

export function commitMessage(dependency: string, version: string): string {
  return `chore(deps): bump ${dependency} to ${version} [tui-back]`;
}

function normalizeRel(path: string): string {
  return posix.normalize(path.replace(/\\/g, '/')).replace(/^\.\//, '');
}

// A declared version: major.minor.patch with an optional prerelease suffix.
export const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

export function isValidVersion(version: string): boolean {
  return VERSION_PATTERN.test(version.trim());
}

export async function verifyVersionPublished(
  shared: SharedTypesPort,
  consumers: readonly DependencyConsumer[],
  version: string,
): Promise<Result<void>> {
  if (!isValidVersion(version)) {
    return err('invalid-version', `"${version.trim()}" is not a valid version — expected major.minor.patch, e.g. 0.1.3674. Nothing was written.`);
  }
  for (const dependency of new Set(consumers.map((consumer) => consumer.dependency))) {
    const verified = await shared.verifyPublished(dependency, version);
    if (!verified.ok) {
      if (verified.error.code === 'registry-unreachable') {
        return err('registry-unreachable', `Registry unreachable: cannot verify ${dependency}@${version} (${verified.error.message}). Nothing was written.`);
      }
      return verified;
    }
    if (!verified.data) {
      return err('version-not-published', `${dependency}@${version} is not published on the registry. Nothing was written.`);
    }
  }
  return ok(undefined);
}

export async function propagateVersion(params: PropagateParams): Promise<PropagateReport> {
  const { shared, consumers } = params;
  const version = params.version.trim();
  if (consumers.length === 0) {
    return { status: 'blocked', error: { code: 'no-service-selected', message: 'No service selected — nothing to propagate.' } };
  }
  const verified = await verifyVersionPublished(shared, consumers, version);
  if (!verified.ok) {
    return { status: 'blocked', error: { code: verified.error.code, message: verified.error.message } };
  }
  const results: PropagateServiceResult[] = [];
  for (const consumer of consumers) {
    try {
      results.push(await propagateToService({ ...params, version }, consumer));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        service: consumer.service,
        repoPath: consumer.repoPath,
        outcome: 'failed',
        steps: [],
        error: { code: 'internal-error', message },
      });
    }
  }
  return { status: 'completed', results };
}

async function propagateToService(params: PropagateParams, consumer: DependencyConsumer): Promise<PropagateServiceResult> {
  const { git, manifest, container, restart, shared, version, options, onProgress } = params;
  const fileExists = params.fileExists ?? ((repoPath: string, rel: string) => existsSync(join(repoPath, rel)));
  const { service, repoPath, dependency, packageJsonPath } = consumer;
  const resumeFrom = params.resume?.[repoPath];
  const steps: PropagateStepResult[] = [];
  const emit = (step: PropagateStep) => onProgress?.({ service, repoPath, step });
  const fail = (step: PropagateStep, error: { code: string; message: string }): PropagateServiceResult => {
    steps.push({ step, status: 'failed', detail: error.message });
    return { service, repoPath, outcome: 'failed', steps, failedStep: step, error: { code: error.code, message: error.message } };
  };
  const skipService = (step: PropagateStep, reason: string): PropagateServiceResult => {
    steps.push({ step, status: 'skipped', detail: reason });
    return { service, repoPath, outcome: 'skipped', steps, reason };
  };

  // Branch-scope gate (AD-8): the branch the repo is actually on, judged before any write.
  emit('gate');
  const branch = await git.currentBranch(repoPath);
  if (!branch.ok) {
    return fail('gate', branch.error);
  }
  const allowed = await git.assertAllowedBranch(repoPath, branch.data);
  if (!allowed.ok) {
    return fail('gate', allowed.error);
  }
  steps.push({ step: 'gate', status: 'done' });

  const lockRel = normalizeRel(join(dirname(packageJsonPath), 'package-lock.json'));
  const packageRel = normalizeRel(packageJsonPath);
  const lockPresent = fileExists(repoPath, lockRel);
  const mustStart = resumeFrom === undefined;

  if (mustStart) {
    emit('dirty-check');
    const dirty = await git.listDirtyPaths(repoPath);
    if (!dirty.ok) {
      return fail('dirty-check', dirty.error);
    }
    const dirtySet = new Set(dirty.data.map(normalizeRel));
    if (dirtySet.has(packageRel)) {
      return skipService('dirty-check', `${packageRel} has uncommitted changes — commit or discard them first`);
    }
    if (options.commit && lockPresent && dirtySet.has(lockRel)) {
      return skipService('dirty-check', `${lockRel} has uncommitted changes and would be swept into the commit`);
    }
    steps.push({ step: 'dirty-check', status: 'done' });

    emit('write');
    const written = await shared.writeVersionLine(join(repoPath, packageJsonPath), dependency, version);
    if (!written.ok) {
      return fail('write', written.error);
    }
    steps.push({ step: 'write', status: 'done' });
  }

  const startsAt = (step: ResumeFrom) => mustStart || RESUMABLE.indexOf(step) >= RESUMABLE.indexOf(resumeFrom);

  if (options.install) {
    if (startsAt('install')) {
      emit('install');
      const installed = await restart.run(repoPath, 'npm i');
      if (!installed.ok) {
        return fail('install', installed.error);
      }
      steps.push({ step: 'install', status: 'done' });
    }
  } else {
    steps.push({ step: 'install', status: 'skipped', detail: 'not selected' });
  }

  if (options.cleanRestart) {
    if (startsAt('restart')) {
      emit('restart');
      const loaded = await manifest.load(repoPath);
      if (!loaded.ok) {
        return fail('restart', loaded.error);
      }
      const restarted = await runRestartStep({
        container,
        restart,
        containerName: loaded.data.container,
        restartCommands: loaded.data.restartCommands,
        repoPath,
        cleanRestart: true,
        service,
      });
      if (!restarted.ok && restarted.error.code === 'no-container') {
        steps.push({ step: 'restart', status: 'skipped', detail: restarted.error.message });
      } else if (!restarted.ok) {
        return fail('restart', restarted.error);
      } else {
        steps.push({ step: 'restart', status: 'done' });
      }
    }
  } else {
    steps.push({ step: 'restart', status: 'skipped', detail: 'not selected' });
  }

  if (options.commit) {
    emit('commit');
    const files = lockPresent ? [packageRel, lockRel] : [packageRel];
    const dirty = await git.listDirtyPaths(repoPath);
    if (!dirty.ok) {
      return fail('commit', dirty.error);
    }
    const dirtySet = new Set(dirty.data.map(normalizeRel));
    const changed = files.filter((file) => dirtySet.has(file));
    if (changed.length === 0) {
      steps.push({ step: 'commit', status: 'skipped', detail: 'nothing to commit — already at this version' });
    } else {
      const staged = await git.stagePaths(repoPath, changed);
      if (!staged.ok) {
        return fail('commit', staged.error);
      }
      const committed = await git.commit(repoPath, commitMessage(dependency, version), changed);
      if (!committed.ok) {
        return fail('commit', committed.error);
      }
      steps.push({ step: 'commit', status: 'done' });
    }
  } else {
    steps.push({ step: 'commit', status: 'skipped', detail: 'not selected' });
  }

  return { service, repoPath, outcome: 'done', steps };
}
