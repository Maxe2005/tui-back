// core/scripts/group-update: unit tests against fake ports — the clean-restart recipe and runRestartStep.
import { describe, expect, it, type Mock, vi } from 'vitest';
import { err, ok } from '../../result.js';
import type { ContainerPort } from '../../ports/runtime/container.js';
import type { ManifestPort } from '../../ports/vcs/manifest.js';
import type { RestartPort } from '../../ports/runtime/restart.js';
import { groupUpdate, runRestartStep } from './group-update.js';
import { calls, fakeContainer, fakeRegistry, fakeRestart, manifestFor } from '../../shared/core-ports.test-support.js';
import { fakeGit, makeParams } from './group-update.test-support.js';

describe('groupUpdate — clean-restart recipe', () => {
  const RECIPE = ['npm ci', 'docker compose up -d --build'];

  function fakeManifestWithRecipe(restartCommands: string[]): ManifestPort {
    return {
      load: vi.fn(async (repoPath: string) =>
        ok({ ...manifestFor(repoPath.split('/').pop() ?? repoPath), restartCommands }),
      ),
    };
  }

  it('cleanRestart with a declared recipe runs each command in order in the repo cwd, never the plain restart', async () => {
    const git = fakeGit();
    const restart = fakeRestart();
    const container = fakeContainer();

    const result = await groupUpdate(
      makeParams({ manifest: fakeManifestWithRecipe(RECIPE), git, restart, container, cleanRestart: true }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(restart.run)).toEqual([
      ['/repo/a', 'npm ci'],
      ['/repo/a', 'docker compose up -d --build'],
      ['/repo/b', 'npm ci'],
      ['/repo/b', 'docker compose up -d --build'],
    ]);
    // Never both ports for the same service in the same action.
    expect(calls(container.restart)).toHaveLength(0);
    // Strict per-service order: each repo merges before its own recipe runs (the run is
    // per-service sequential — svc-a's recipe lands before svc-b's merge).
    const mergeMock = (git.mergeBranch as unknown as Mock).mock;
    const recipeMock = (restart.run as unknown as Mock).mock;
    for (const repoPath of ['/repo/a', '/repo/b']) {
      const mergeIndex = mergeMock.calls.findIndex((args: unknown[]) => args[0] === repoPath);
      const recipeIndex = recipeMock.calls.findIndex((args: unknown[]) => args[0] === repoPath);
      expect(mergeIndex).toBeGreaterThanOrEqual(0);
      expect(recipeIndex).toBeGreaterThanOrEqual(0);
      expect(mergeMock.invocationCallOrder[mergeIndex]).toBeLessThan(recipeMock.invocationCallOrder[recipeIndex]);
    }
  });

  it('a failing recipe command stops the recipe and fails only that service with service, command, and output — others continue', async () => {
    const restart = fakeRestart({
      run: vi.fn(async (repoPath: string, command: string) =>
        repoPath === '/repo/a' && command === 'npm ci'
          ? err('restart-failed', 'compose up blew up')
          : ok({ output: '' }),
      ),
    });
    const container = fakeContainer();

    const result = await groupUpdate(
      makeParams({ manifest: fakeManifestWithRecipe(RECIPE), restart, container, cleanRestart: true }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'restart-failed' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    if (result.ok) {
      const message = result.data.results[0].detail?.message ?? '';
      expect(message).toContain('/repo/a');
      expect(message).toContain('npm ci');
      expect(message).toContain('compose up blew up');
    }
    // The first failure stopped svc-a's recipe: its second command never ran.
    expect(calls(restart.run).filter(([path]) => path === '/repo/a')).toEqual([['/repo/a', 'npm ci']]);
    // svc-b ran its full recipe and never fell back to the plain restart.
    expect(calls(restart.run).filter(([path]) => path === '/repo/b')).toEqual([
      ['/repo/b', 'npm ci'],
      ['/repo/b', 'docker compose up -d --build'],
    ]);
    expect(calls(container.restart)).toHaveLength(0);
  });

  it('a repeatedly failing recipe surfaces identically on every retry with no retry limit', async () => {
    const restart = fakeRestart({
      run: vi.fn(async () => err('restart-failed', 'compose up blew up')),
    });
    const container = fakeContainer();
    const params = { manifest: fakeManifestWithRecipe(RECIPE), restart, container, cleanRestart: true };

    const first = await groupUpdate(makeParams(params));
    const second = await groupUpdate(makeParams(params));

    for (const result of [first, second]) {
      expect(result).toMatchObject({
        ok: true,
        data: {
          results: [
            { service: 'svc-a', outcome: 'failed', detail: { code: 'restart-failed' } },
            { service: 'svc-b', outcome: 'failed', detail: { code: 'restart-failed' } },
          ],
        },
      });
    }
    // No suppression on retry: the first recipe command ran once per service per run.
    expect(calls(restart.run)).toHaveLength(4);
  });

  it('cleanRestart with no declared recipe falls back to the plain container restart without error', async () => {
    const restart = fakeRestart();
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ restart, container, cleanRestart: true }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(restart.run)).toHaveLength(0);
    expect(calls(container.restart)).toEqual([['ctr-a'], ['ctr-b']]);
  });

  it('cleanRestart off leaves a declared recipe untouched and runs the plain container restart', async () => {
    const restart = fakeRestart();
    const container = fakeContainer();

    const result = await groupUpdate(
      makeParams({ manifest: fakeManifestWithRecipe(RECIPE), restart, container, cleanRestart: false }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(restart.run)).toHaveLength(0);
    expect(calls(container.restart)).toEqual([['ctr-a'], ['ctr-b']]);
  });

  it('cleanRestart with an empty recipe array falls back to the plain container restart', async () => {
    const restart = fakeRestart();
    const container = fakeContainer();

    const result = await groupUpdate(
      makeParams({ manifest: fakeManifestWithRecipe([]), restart, container, cleanRestart: true }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(restart.run)).toHaveLength(0);
    expect(calls(container.restart)).toHaveLength(2);
  });

  it('normalizes a non-restart-failed adapter code to the restart-failed row detail', async () => {
    const restart = fakeRestart({
      run: vi.fn(async () => err('sh-spawn-error', 'ENOENT')),
    });

    const result = await groupUpdate(
      makeParams({ manifest: fakeManifestWithRecipe(RECIPE), restart, cleanRestart: true }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'restart-failed' } },
          { service: 'svc-b', outcome: 'failed', detail: { code: 'restart-failed' } },
        ],
      },
    });
    if (result.ok) {
      expect(result.data.results[0].detail?.message).toContain('ENOENT');
    }
  });

  it('a failing recipe keeps the merged code (recipe runs after pull/merge) but reports failed', async () => {
    const git = fakeGit();
    const restart = fakeRestart({
      run: vi.fn(async () => err('restart-failed', 'compose up blew up')),
    });

    const result = await groupUpdate(
      makeParams({ manifest: fakeManifestWithRecipe(RECIPE), git, restart, cleanRestart: true }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'restart-failed' } },
          { service: 'svc-b', outcome: 'failed', detail: { code: 'restart-failed' } },
        ],
      },
    });
    // Both services merged before their recipe ran — the failure short-circuits only the restart.
    expect(calls(git.mergeBranch)).toContainEqual(['/repo/a', 'development']);
    expect(calls(git.mergeBranch)).toContainEqual(['/repo/b', 'development']);
  });

  it('all-scope with cleanRestart and a declared recipe runs the recipe per repo, never the plain restart', async () => {
    const restart = fakeRestart();
    const container = fakeContainer();

    const result = await groupUpdate(
      makeParams({
        manifest: fakeManifestWithRecipe(RECIPE),
        restart,
        container,
        cleanRestart: true,
        scope: 'all',
        registry: fakeRegistry(['/repo/a', '/repo/b']),
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'a', outcome: 'updated' },
          { service: 'b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(restart.run)).toEqual([
      ['/repo/a', 'npm ci'],
      ['/repo/a', 'docker compose up -d --build'],
      ['/repo/b', 'npm ci'],
      ['/repo/b', 'docker compose up -d --build'],
    ]);
    expect(calls(container.restart)).toHaveLength(0);
  });
});

describe('runRestartStep onStep', () => {
  const container = { restart: vi.fn(async () => ok(undefined)) } as unknown as ContainerPort;
  const base = { container, containerName: 'api', repoPath: '/r/a', service: 'api' };

  it('reports each recipe command before it runs, with its 1-based position', async () => {
    const seen: string[] = [];
    const restart = {
      run: vi.fn(async (_p: string, command: string) => {
        seen.push(`run ${command}`);
        return ok({ output: '' });
      }),
    } as unknown as RestartPort;
    const result = await runRestartStep({
      ...base,
      restart,
      restartCommands: ['a', 'b'],
      cleanRestart: true,
      onStep: (step, total) => seen.push(`step ${step}/${total}`),
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['step 1/2', 'run a', 'step 2/2', 'run b']);
  });

  it('stops reporting at the first failing command and never reports for a plain container restart', async () => {
    const steps: number[] = [];
    const failing = { run: vi.fn(async () => err('restart-failed', 'x')) } as unknown as RestartPort;
    const failed = await runRestartStep({ ...base, restart: failing, restartCommands: ['a', 'b'], cleanRestart: true, onStep: (step) => steps.push(step) });
    expect(failed.ok).toBe(false);
    expect(steps).toEqual([1]);
    const plain = await runRestartStep({ ...base, restart: failing, restartCommands: ['a'], cleanRestart: false, onStep: (step) => steps.push(step) });
    expect(plain.ok).toBe(true);
    expect(steps).toEqual([1]);
  });
});
