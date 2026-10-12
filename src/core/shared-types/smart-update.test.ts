import { describe, expect, it, vi } from 'vitest';
import type { ContainerPort } from '../ports/container.js';
import type { GitPort } from '../ports/git.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RestartPort } from '../ports/restart.js';
import type { SharedTypesPort } from '../ports/shared-types.js';
import { err, ok } from '../result.js';
import type { GroupUpdateRepoResult } from '../scripts/group-update.js';
import type { DependencyConsumer, SourceEntry } from './list-consumers.js';
import { runSharedTypesPhase, shouldRunSharedTypesPhase, type SharedTypesPhaseParams } from './smart-update.js';

const SOURCE: SourceEntry = { service: 'types', repoPath: '/r/types', branch: 'feat/t', publishCommand: 'npm run v', packageName: '@ianord/shared-types' };
const consumer = (name: string): DependencyConsumer => ({
  service: name,
  repoPath: `/r/${name}`,
  branch: `feat/${name}`,
  dependency: '@ianord/shared-types',
  packageJsonPath: 'package.json',
});
const ADVANCED: GroupUpdateRepoResult = { service: 'types', outcome: 'updated', run: { merge: { kind: 'advanced' } } };
const UP_TO_DATE: GroupUpdateRepoResult = { service: 'types', outcome: 'updated', run: { merge: { kind: 'up-to-date' } } };

function setup(overrides: { publishFails?: boolean; writeFails?: string } = {}) {
  const calls = new Map<string, number>();
  const git = {
    currentBranch: vi.fn(async () => ok('feat/x')),
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    // Clean before the write, `package.json` dirty at the commit step.
    listDirtyPaths: vi.fn(async (repoPath: string) => {
      calls.set(repoPath, (calls.get(repoPath) ?? 0) + 1);
      return ok((calls.get(repoPath) ?? 0) > 1 ? ['package.json'] : []);
    }),
    stagePaths: vi.fn(async () => ok(undefined)),
    commit: vi.fn(async () => ok(undefined)),
  } as unknown as GitPort;
  const restart = {
    run: vi.fn(async () => (overrides.publishFails ? err('restart-failed', 'npm ERR') : ok({ output: 'published' }))),
  } as unknown as RestartPort;
  const shared = {
    readOwnVersion: vi.fn(async () => ok('0.1.9')),
    writeVersionLine: vi.fn(async (path: string) => (overrides.writeFails !== undefined && path.includes(overrides.writeFails) ? err('write-failed', 'disk') : ok(undefined))),
    verifyPublished: vi.fn(async () => ok(true)),
  } as unknown as SharedTypesPort;
  const manifest = { load: vi.fn() } as unknown as ManifestPort;
  const container = {} as unknown as ContainerPort;
  const base: SharedTypesPhaseParams = {
    git,
    restart,
    shared,
    manifest,
    container,
    mode: 'always',
    source: SOURCE,
    sourceRow: ADVANCED,
    consumers: [consumer('a'), consumer('b')],
    fileExists: () => false,
  };
  return { base, git, restart, shared };
}

describe('shouldRunSharedTypesPhase', () => {
  it('follows the mode and the source row', () => {
    expect(shouldRunSharedTypesPhase('off', ADVANCED)).toBe(false);
    expect(shouldRunSharedTypesPhase('always', UP_TO_DATE)).toBe(true);
    expect(shouldRunSharedTypesPhase('if-changed', UP_TO_DATE)).toBe(false);
    expect(shouldRunSharedTypesPhase('if-changed', ADVANCED)).toBe(true);
    expect(shouldRunSharedTypesPhase('always', { service: 'types', outcome: 'failed' })).toBe(false);
    expect(shouldRunSharedTypesPhase('always', { service: 'types', outcome: 'skipped' })).toBe(false);
    expect(shouldRunSharedTypesPhase('always', undefined)).toBe(false);
  });
});

describe('runSharedTypesPhase', () => {
  it('publishes then propagates with commit on, install and clean restart off', async () => {
    const f = setup();
    const stages: string[] = [];
    const result = await runSharedTypesPhase({ ...f.base, onStage: (stage) => stages.push(stage) });
    expect(result).toMatchObject({ ok: true, data: { status: 'done', version: '0.1.9' } });
    expect(stages).toEqual(['publishing', 'propagating']);
    expect(f.restart.run).toHaveBeenCalledTimes(1);
    expect(f.restart.run).toHaveBeenCalledWith('/r/types', 'npm run v');
    expect(f.git.commit).toHaveBeenCalledTimes(2);
  });

  it('skips when the merge changed nothing under if-changed', async () => {
    const f = setup();
    const result = await runSharedTypesPhase({ ...f.base, mode: 'if-changed', sourceRow: UP_TO_DATE });
    expect(result).toMatchObject({ ok: true, data: { status: 'skipped' } });
    expect(f.restart.run).not.toHaveBeenCalled();
  });

  it('never publishes after a failed or skipped source row', async () => {
    const f = setup();
    const result = await runSharedTypesPhase({ ...f.base, sourceRow: { service: 'types', outcome: 'failed' } });
    expect(result).toMatchObject({ ok: true, data: { status: 'skipped' } });
    expect(f.restart.run).not.toHaveBeenCalled();
  });

  it('turns a publish failure into a phase failure and propagates nothing', async () => {
    const f = setup({ publishFails: true });
    const result = await runSharedTypesPhase(f.base);
    expect(result).toMatchObject({ ok: false, error: { code: 'shared-types-phase-failed', details: { stage: 'publishing' } } });
    expect(f.shared.writeVersionLine).not.toHaveBeenCalled();
  });

  it('turns a partial propagation into a phase failure listing the failed services', async () => {
    const f = setup({ writeFails: '/r/b/' });
    const result = await runSharedTypesPhase(f.base);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'shared-types-phase-failed', details: { stage: 'propagating', publishedVersion: '0.1.9', failedServices: ['b'] } },
    });
    expect((result as { error: { message: string } }).error.message).toContain('b');
  });

  it('a retry with an already published version does not publish again', async () => {
    const f = setup();
    const result = await runSharedTypesPhase({ ...f.base, publishedVersion: '0.1.9' });
    expect(result).toMatchObject({ ok: true, data: { status: 'done', version: '0.1.9' } });
    expect(f.restart.run).not.toHaveBeenCalled();
  });

  it('a blocked propagation (registry unreachable) is a phase failure', async () => {
    const f = setup();
    (f.shared.verifyPublished as ReturnType<typeof vi.fn>).mockResolvedValue(err('registry-unreachable', 'down'));
    const result = await runSharedTypesPhase({ ...f.base, publishedVersion: '0.1.9' });
    expect(result).toMatchObject({ ok: false, error: { code: 'shared-types-phase-failed' } });
  });

  it('a source with no consumers still succeeds after publishing', async () => {
    const f = setup();
    const result = await runSharedTypesPhase({ ...f.base, consumers: [] });
    expect(result).toMatchObject({ ok: true, data: { status: 'done', results: [] } });
  });
});
