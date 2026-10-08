import { describe, expect, it, vi } from 'vitest';
import type { ContainerPort } from '../ports/container.js';
import type { GitPort } from '../ports/git.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RestartPort } from '../ports/restart.js';
import type { SharedTypesPort } from '../ports/shared-types.js';
import { err, ok } from '../result.js';
import type { DependencyConsumer } from './list-consumers.js';
import { commitMessage, propagateVersion, type PropagateOptions, type PropagateParams } from './propagate-version.js';

const DEP = '@ianord/shared-types';

function consumer(name: string): DependencyConsumer {
  return { service: name, repoPath: `/repo/${name}`, branch: `feat/${name}`, dependency: DEP, packageJsonPath: 'package.json' };
}

function manifestFor(service: string): Manifest {
  return { service, container: service, sharedBranch: 'development', restartCommands: ['make restart'], modules: {} };
}

interface Fakes {
  git: GitPort;
  shared: SharedTypesPort;
  restart: RestartPort;
  container: ContainerPort;
  manifest: ManifestPort;
  order: string[];
}

function fakes(overrides: { git?: Partial<GitPort>; shared?: Partial<SharedTypesPort>; restart?: Partial<RestartPort> } = {}): Fakes {
  const order: string[] = [];
  const written = new Set<string>();
  const git = {
    currentBranch: vi.fn(async (repoPath: string) => ok(`feat/${repoPath.split('/').pop()}`)),
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    // Unrelated noise always; the two files become dirty once the line was rewritten.
    listDirtyPaths: vi.fn(async (repoPath: string) =>
      ok(written.has(repoPath) ? ['unrelated.txt', 'package.json', 'package-lock.json'] : ['unrelated.txt']),
    ),
    stagePaths: vi.fn(async (_repo: string, paths: string[]) => {
      order.push(`stage:${paths.join(',')}`);
      return ok(undefined);
    }),
    commit: vi.fn(async (_repo: string, message: string) => {
      order.push(`commit:${message}`);
      return ok(undefined);
    }),
    ...overrides.git,
  } as unknown as GitPort;
  const shared: SharedTypesPort = {
    readVersion: vi.fn(async () => ok('0.1.0')),
    readOwnVersion: vi.fn(async () => ok('0.1.0')),
    writeVersionLine: vi.fn(async (path: string) => {
      written.add(path.replace('/package.json', ''));
      order.push(`write:${path}`);
      return ok(undefined);
    }),
    verifyPublished: vi.fn(async () => ok(true)),
    ...overrides.shared,
  };
  const restart: RestartPort = {
    run: vi.fn(async (repoPath: string, command: string) => {
      order.push(`run:${repoPath}:${command}`);
      return ok({ output: '' });
    }),
    ...overrides.restart,
  };
  const container = { restart: vi.fn(async () => ok(undefined)) } as unknown as ContainerPort;
  const manifest: ManifestPort = { load: vi.fn(async (repoPath: string) => ok(manifestFor(repoPath.split('/').pop() ?? ''))) };
  return { git, shared, restart, container, manifest, order };
}

const ALL: PropagateOptions = { install: true, cleanRestart: true, commit: true };

function params(f: Fakes, consumers: DependencyConsumer[], options: PropagateOptions = ALL, extra: Partial<PropagateParams> = {}): PropagateParams {
  return { ...f, version: '0.1.3674', consumers, options, fileExists: () => true, ...extra };
}

describe('propagateVersion', () => {
  it('rewrites each consumer, then npm i, restart and commit in order', async () => {
    const f = fakes();

    const report = await propagateVersion(params(f, [consumer('a'), consumer('b')]));

    expect(report).toMatchObject({ status: 'completed', results: [{ service: 'a', outcome: 'done' }, { service: 'b', outcome: 'done' }] });
    expect(f.order.slice(0, 5)).toEqual([
      'write:/repo/a/package.json',
      'run:/repo/a:npm i',
      'run:/repo/a:make restart',
      'stage:package.json,package-lock.json',
      `commit:${commitMessage(DEP, '0.1.3674')}`,
    ]);
    expect(commitMessage(DEP, '0.1.3674')).toBe('chore(deps): bump @ianord/shared-types to 0.1.3674 [tui-back]');
  });

  it('blocks with an explicit message and writes nothing when the version is unpublished', async () => {
    const f = fakes({ shared: { verifyPublished: vi.fn(async () => ok(false)) } });

    const report = await propagateVersion(params(f, [consumer('a')]));

    expect(report).toMatchObject({ status: 'blocked', error: { code: 'version-not-published' } });
    expect(f.shared.writeVersionLine).not.toHaveBeenCalled();
  });

  it('blocks with a distinct registry-unreachable error when the registry is down', async () => {
    const f = fakes({ shared: { verifyPublished: vi.fn(async () => err('registry-unreachable', 'timeout')) } });

    const report = await propagateVersion(params(f, [consumer('a')]));

    expect(report).toMatchObject({ status: 'blocked', error: { code: 'registry-unreachable' } });
    expect(f.shared.writeVersionLine).not.toHaveBeenCalled();
  });

  it('skips a service whose package.json is already dirty and proceeds with the others', async () => {
    const f = fakes({
      git: { listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['package.json'] : [])) },
    });

    const report = await propagateVersion(params(f, [consumer('a'), consumer('b')], { install: false, cleanRestart: false, commit: false }));

    expect(report).toMatchObject({ status: 'completed', results: [{ service: 'a', outcome: 'skipped' }, { service: 'b', outcome: 'done' }] });
    expect(f.shared.writeVersionLine).toHaveBeenCalledTimes(1);
  });

  it('proceeds when only unrelated files are dirty and never stages them', async () => {
    const f = fakes();

    const report = await propagateVersion(params(f, [consumer('a')]));

    expect(report).toMatchObject({ status: 'completed', results: [{ outcome: 'done' }] });
    expect(f.git.stagePaths).toHaveBeenCalledWith('/repo/a', ['package.json', 'package-lock.json']);
  });

  it('skips the commit step when the rewrite changed nothing', async () => {
    const f = fakes({ git: { listDirtyPaths: vi.fn(async () => ok(['unrelated.txt'])) } });

    const report = await propagateVersion(params(f, [consumer('a')]));

    expect(f.git.commit).not.toHaveBeenCalled();
    expect(report).toMatchObject({ results: [{ outcome: 'done', steps: expect.arrayContaining([{ step: 'commit', status: 'skipped', detail: expect.any(String) }]) }] });
  });

  it('stages package.json only when there is no package-lock.json', async () => {
    const f = fakes();

    await propagateVersion(params(f, [consumer('a')], { install: false, cleanRestart: false, commit: true }, { fileExists: () => false }));

    expect(f.git.stagePaths).toHaveBeenCalledWith('/repo/a', ['package.json']);
    expect(f.git.commit).toHaveBeenCalledWith('/repo/a', commitMessage(DEP, '0.1.3674'), ['package.json']);
  });

  it('refuses a consumer on a protected branch, reported failed at the gate, others unaffected', async () => {
    const f = fakes({
      git: {
        assertAllowedBranch: vi.fn(async (repoPath: string) =>
          repoPath === '/repo/a' ? err('shared-branch-rejected', 'protected') : ok(undefined),
        ),
      },
    });

    const report = await propagateVersion(params(f, [consumer('a'), consumer('b')], { install: false, cleanRestart: false, commit: false }));

    expect(report).toMatchObject({
      status: 'completed',
      results: [
        { service: 'a', outcome: 'failed', failedStep: 'gate', error: { code: 'shared-branch-rejected' } },
        { service: 'b', outcome: 'done' },
      ],
    });
    expect(f.shared.writeVersionLine).toHaveBeenCalledTimes(1);
  });

  it('names the failing step when npm i fails and leaves the other services unaffected', async () => {
    const f = fakes({
      restart: {
        run: vi.fn(async (repoPath: string) => (repoPath === '/repo/b' ? err('restart-failed', 'npm ERR') : ok({ output: '' }))),
      },
    });

    const report = await propagateVersion(params(f, [consumer('a'), consumer('b'), consumer('c')], { install: true, cleanRestart: false, commit: false }));

    expect(report).toMatchObject({
      results: [{ outcome: 'done' }, { service: 'b', outcome: 'failed', failedStep: 'install', error: { code: 'restart-failed' } }, { outcome: 'done' }],
    });
  });

  it('retries one failed service resuming at the failed step without re-writing', async () => {
    const f = fakes();

    const report = await propagateVersion(
      params(f, [consumer('b')], { install: true, cleanRestart: false, commit: false }, { resume: { '/repo/b': 'install' } }),
    );

    expect(report).toMatchObject({ results: [{ service: 'b', outcome: 'done' }] });
    expect(f.shared.writeVersionLine).not.toHaveBeenCalled();
    expect(f.restart.run).toHaveBeenCalledWith('/repo/b', 'npm i');
  });

  it('runs only the selected options', async () => {
    const f = fakes();

    await propagateVersion(params(f, [consumer('a')], { install: false, cleanRestart: false, commit: false }));

    expect(f.restart.run).not.toHaveBeenCalled();
    expect(f.git.commit).not.toHaveBeenCalled();
    expect(f.git.stagePaths).not.toHaveBeenCalled();
  });

  it('rejects an invalid version before any registry call or write', async () => {
    for (const version of ['', '0.1.', 'abc', '1.2', '0.1.x']) {
      const f = fakes();

      const report = await propagateVersion({ ...params(f, [consumer('a')]), version });

      expect(report).toMatchObject({ status: 'blocked', error: { code: 'invalid-version' } });
      expect(f.shared.verifyPublished).not.toHaveBeenCalled();
      expect(f.shared.writeVersionLine).not.toHaveBeenCalled();
    }
  });

  it('accepts a prerelease version and trims it', async () => {
    const f = fakes();

    const report = await propagateVersion({ ...params(f, [consumer('a')]), version: ' 0.1.3-beta.2 ' });

    expect(report.status).toBe('completed');
    expect(f.shared.verifyPublished).toHaveBeenCalledWith(DEP, '0.1.3-beta.2');
  });

  it('blocks with no-service-selected when there is no consumer', async () => {
    const f = fakes();

    expect(await propagateVersion(params(f, []))).toMatchObject({ status: 'blocked', error: { code: 'no-service-selected' } });
    expect(f.shared.verifyPublished).not.toHaveBeenCalled();
  });

  it('skips a service whose package-lock.json is dirty when commit is on, without writing', async () => {
    const f = fakes({ git: { listDirtyPaths: vi.fn(async () => ok(['package-lock.json'])) } });

    const report = await propagateVersion(params(f, [consumer('a')]));

    expect(report).toMatchObject({ results: [{ outcome: 'skipped' }] });
    expect(f.shared.writeVersionLine).not.toHaveBeenCalled();
  });

  it('proceeds despite a dirty package-lock.json when commit is off', async () => {
    const f = fakes({ git: { listDirtyPaths: vi.fn(async () => ok(['package-lock.json'])) } });

    const report = await propagateVersion(params(f, [consumer('a')], { install: false, cleanRestart: false, commit: false }));

    expect(report).toMatchObject({ results: [{ outcome: 'done' }] });
    expect(f.shared.writeVersionLine).toHaveBeenCalled();
  });

  it('resuming at commit with every option on runs neither npm i nor restart but still commits', async () => {
    const f = fakes();
    (f.git.listDirtyPaths as ReturnType<typeof vi.fn>).mockResolvedValue(ok(['package.json', 'package-lock.json']));

    const report = await propagateVersion(params(f, [consumer('a')], ALL, { resume: { '/repo/a': 'commit' } }));

    expect(report).toMatchObject({ results: [{ outcome: 'done' }] });
    expect(f.restart.run).not.toHaveBeenCalled();
    expect(f.shared.writeVersionLine).not.toHaveBeenCalled();
    expect(f.git.stagePaths).toHaveBeenCalled();
    expect(f.git.commit).toHaveBeenCalled();
  });

  it('resuming at restart does not run npm i again', async () => {
    const f = fakes();

    await propagateVersion(params(f, [consumer('a')], ALL, { resume: { '/repo/a': 'restart' } }));

    expect(f.restart.run).not.toHaveBeenCalledWith('/repo/a', 'npm i');
    expect(f.restart.run).toHaveBeenCalledWith('/repo/a', 'make restart');
  });

  it('records the restart step as skipped for a service with no container and no recipe', async () => {
    const f = fakes();
    (f.manifest.load as ReturnType<typeof vi.fn>).mockResolvedValue(ok({ service: 'a', sharedBranch: 'development', modules: {} }));

    const report = await propagateVersion(params(f, [consumer('a')], { install: false, cleanRestart: true, commit: false }));

    expect(report).toMatchObject({
      results: [{ outcome: 'done', steps: expect.arrayContaining([expect.objectContaining({ step: 'restart', status: 'skipped' })]) }],
    });
  });

  it('never pushes: the git port exposes no push', () => {
    expect(Object.keys(fakes().git)).not.toContain('push');
  });
});
