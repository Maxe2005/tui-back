import { describe, expect, it, vi } from 'vitest';
import type { GitPort } from '../ports/git.js';
import type { RestartPort } from '../ports/restart.js';
import type { SharedTypesPort } from '../ports/shared-types.js';
import { err, ok } from '../result.js';
import { runPublish } from './publish-version.js';

function fakes(overrides: { git?: Partial<GitPort>; restart?: Partial<RestartPort>; shared?: Partial<SharedTypesPort> } = {}) {
  const git = {
    currentBranch: vi.fn(async () => ok('feat/x')),
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    ...overrides.git,
  } as unknown as GitPort;
  const restart = {
    run: vi.fn(async () => ok({ output: 'published' })),
    ...overrides.restart,
  } as unknown as RestartPort;
  const shared = {
    readVersion: vi.fn(async () => ok('0.1.0')),
    readOwnVersion: vi.fn(async () => ok('0.1.3674')),
    writeVersionLine: vi.fn(async () => ok(undefined)),
    verifyPublished: vi.fn(async () => ok(true)),
    ...overrides.shared,
  } as unknown as SharedTypesPort;
  return { git, restart, shared };
}

const BASE = { sourceRepoPath: '/r/source', publishCommand: 'npm run v', packageName: '@ianord/shared-types' };

describe('runPublish', () => {
  it('runs the command exactly once, then reads and verifies the version', async () => {
    const f = fakes();
    const result = await runPublish({ ...f, ...BASE });
    expect(result).toMatchObject({ ok: true, data: { version: '0.1.3674' } });
    expect(f.restart.run).toHaveBeenCalledTimes(1);
    expect(f.restart.run).toHaveBeenCalledWith('/r/source', 'npm run v');
    expect(f.shared.readOwnVersion).toHaveBeenCalledWith('/r/source/package.json');
    expect(f.shared.verifyPublished).toHaveBeenCalledWith('@ianord/shared-types', '0.1.3674', undefined);
  });

  it('rejects an empty publish command without running anything', async () => {
    const f = fakes();
    for (const command of ['', '   ']) {
      const result = await runPublish({ ...f, ...BASE, publishCommand: command });
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-publish-command' } });
    }
    expect(f.restart.run).not.toHaveBeenCalled();
  });

  it('gates via the git branch check before running', async () => {
    const blocked = fakes({ git: { assertAllowedBranch: vi.fn(async () => err('shared-branch-rejected', 'protected')) } });
    expect(await runPublish({ ...blocked, ...BASE })).toMatchObject({ error: { code: 'shared-branch-rejected' } });
    expect(blocked.restart.run).not.toHaveBeenCalled();

    const noBranch = fakes({ git: { currentBranch: vi.fn(async () => err('git-rev-parse-error', 'nope')) } });
    expect(await runPublish({ ...noBranch, ...BASE })).toMatchObject({ error: { code: 'git-rev-parse-error' } });
    expect(noBranch.restart.run).not.toHaveBeenCalled();
  });

  it('maps a failing command to publish-failed with the output, naming no sub-step', async () => {
    const f = fakes({ restart: { run: vi.fn(async () => err('restart-failed', 'npm ERR boom')) } });
    const result = await runPublish({ ...f, ...BASE });
    expect(result).toMatchObject({ ok: false, error: { code: 'publish-failed' } });
    expect((result as { ok: false; error: { message: string } }).error.message).toContain('npm ERR boom');
    expect(f.shared.readOwnVersion).not.toHaveBeenCalled();
  });

  it('verifies on the configured registry', async () => {
    const f = fakes();
    await runPublish({ ...f, ...BASE, registry: 'https://npm.example' });
    expect(f.shared.verifyPublished).toHaveBeenCalledWith('@ianord/shared-types', '0.1.3674', 'https://npm.example');
  });

  it('does not mark published when the version is absent from the registry', async () => {
    const f = fakes({ shared: { verifyPublished: vi.fn(async () => ok(false)) } });
    expect(await runPublish({ ...f, ...BASE })).toMatchObject({ error: { code: 'version-not-published' } });
  });

  it('surfaces registry-unreachable distinctly', async () => {
    const f = fakes({ shared: { verifyPublished: vi.fn(async () => err('registry-unreachable', 'down')) } });
    expect(await runPublish({ ...f, ...BASE })).toMatchObject({ error: { code: 'registry-unreachable' } });
  });

  it('maps readOwnVersion failures instead of marking success', async () => {
    const f = fakes({ shared: { readOwnVersion: vi.fn(async () => err('package-json-unreadable', 'gone')) } });
    expect(await runPublish({ ...f, ...BASE })).toMatchObject({ error: { code: 'package-json-unreadable' } });
    expect(f.shared.verifyPublished).not.toHaveBeenCalled();
  });
});
