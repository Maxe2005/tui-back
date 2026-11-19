import { describe, expect, it, vi } from 'vitest';
import { ok } from '../../../core/result.js';
import type { EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import { DEFAULT_SETTINGS } from '../../../core/ports/settings.js';
import { runCli } from './dispatch.js';
import { fakeState, fakeEdtRegistry, buildTestSubcommands } from './dispatch.test-support.js';

describe('subcommand registry guards — edt', () => {
  it('edt rejects an unknown action and excess arguments with invalid-argument', async () => {
    const subcommands = buildTestSubcommands();
    const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
    if (!edt) throw new Error('expected edt subcommand');

    const unknown = await edt.run(['bogus']);
    expect(unknown).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const noAction = await edt.run([]);
    expect(noAction).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const excess = await edt.run(['create', 'extra']);
    expect(excess).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });

  it('edt delete dispatches to the delete use-case, parsing the positional topic and --branches flags', async () => {
    const subcommands = buildTestSubcommands();
    const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
    if (!edt) throw new Error('expected edt subcommand');

    const missingTopic = await edt.run(['delete']);
    expect(missingTopic).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const malformedBranches = await edt.run(['delete', 'demo', '--branches', 'no-equals-sign']);
    expect(malformedBranches).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const badDisposition = await edt.run(['delete', 'demo', '--branches', '/repo/a=maybe']);
    expect(badDisposition).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const unknownFlag = await edt.run(['delete', 'demo', '--bogus']);
    expect(unknownFlag).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    // A well-formed call reaches the use-case itself, which reports edt-not-found for a
    // topic the fake registry doesn't know about — proving dispatch/parsing succeeded.
    const notFound = await edt.run(['delete', 'no-such-topic', '--branches', '/repo/a=delete']);
    expect(notFound).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
  });

  // --branches mistakes reject with invalid-argument instead of resolving to a surprising
  // default.
  describe('edt delete --branches validation', () => {
    function fakeEdtRegistryWithTarget(): EdtRegistryPort {
      const target = {
        ulid: 'ulid-1',
        topic: 'demo',
        createdAt: '2026-08-18T00:00:00.000Z',
        status: 'inactive' as const,
        members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
      };
      return {
        add: async () => ok(undefined),
        list: async () => ok([target]),
        setStatus: async () => ok(undefined),
        update: async () => ok(undefined),
        remove: async () => ok(undefined),
      };
    }

    it('rejects an empty repoPath before "=" instead of resolving it to process.cwd()', async () => {
      const subcommands = buildTestSubcommands();
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');

      const result = await edt.run(['delete', 'demo', '--branches', '=delete']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects a --branches repoPath that is not one of the target EDT\'s own members', async () => {
      const subcommands = buildTestSubcommands({ edtRegistry: fakeEdtRegistryWithTarget() });
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');

      const result = await edt.run(['delete', 'demo', '--branches', '/repo/not-a-member=delete']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('accepts a --branches repoPath that does match a target member', async () => {
      const subcommands = buildTestSubcommands({ edtRegistry: fakeEdtRegistryWithTarget() });
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');

      const result = await edt.run(['delete', 'demo', '--branches', '/repo/a=delete']);

      // Reaches the use-case (never rejected at the CLI-validation layer above).
      expect(result).toMatchObject({ ok: true });
    });

    it('rejects a --branches repeated for the same resolved repoPath instead of letting the later value win', async () => {
      const subcommands = buildTestSubcommands({ edtRegistry: fakeEdtRegistryWithTarget() });
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');

      const result = await edt.run(['delete', 'demo', '--branches', '/repo/a=leave', '--branches', '/repo/a=delete']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects a --branches repeated for the same repoPath even under a differently-shaped (trailing-slash) spelling', async () => {
      const subcommands = buildTestSubcommands({ edtRegistry: fakeEdtRegistryWithTarget() });
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');

      const result = await edt.run(['delete', 'demo', '--branches', '/repo/a=leave', '--branches', '/repo/a/=delete']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });
  });

  describe('edt switch --restart (FR-37)', () => {
    const target = {
      ulid: 'ulid-1',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'inactive' as const,
      members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
    };

    function restartSetup(opts: { healthy?: boolean; mode?: 'none' | 'simple' | 'clean'; withHealthUrl?: boolean; healthCheckDisabled?: string[] } = {}) {
      const writeActiveEdt = vi.fn(async () => ok(undefined));
      const containerRestart = vi.fn(async () => ok(undefined));
      const probe = vi.fn(async () => ok({ healthy: opts.healthy ?? true, status: opts.healthy === false ? 503 : 200, ...(opts.healthy === false ? { reason: 'HTTP 503' } : {}) }));
      const subcommands = buildTestSubcommands({
        registry: {
          list: async () => ok(['/repo/a', '/repo/b']),
          add: async () => ok(undefined),
          exists: async () => ok(true),
          scan: async () => ok({ candidates: [], skipped: [] }),
          reset: async () => ok({ path: '/p', backupPath: null }),
          remove: async () => ok(undefined),
        },
        manifest: {
          load: async (repoPath: string) =>
            ok({
              service: repoPath === '/repo/a' ? 'svc-a' : 'svc-b',
              container: repoPath === '/repo/a' ? 'ctr-a' : undefined,
              ...(opts.withHealthUrl === false ? {} : { healthUrl: 'http://localhost:1/health' }),
              sharedBranch: 'development',
              modules: {},
            }),
        },
        edtRegistry: { ...fakeEdtRegistry(), list: async () => ok([target]) },
        state: { ...fakeState(), writeActiveEdt },
        container: { restart: containerRestart },
        settings: {
          load: async () =>
            ok({
              settings: { ...DEFAULT_SETTINGS, switch: { restartMode: opts.mode ?? 'none' }, services: { healthCheckDisabled: opts.healthCheckDisabled ?? [] } },
              warning: null,
            }),
          save: async () => ok(undefined),
        },
        docker: {
          streamLogs: () => () => {},
          fetchLogsBefore: async () => ok([]),
          getContainerHealth: async () => ok('up' as const),
          restartContainer: async () => ok(undefined),
        },
        healthProbe: { probe },
      });
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');
      return { edt, writeActiveEdt, containerRestart, probe, subcommands };
    }

    it('rejects an unknown --restart value before anything is touched', async () => {
      const { edt, writeActiveEdt } = restartSetup();
      const result = await edt.run(['switch', '--to', 'demo', '--restart', 'bogus']);
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(writeActiveEdt).not.toHaveBeenCalled();
      expect(await edt.run(['switch', '--to', 'demo', '--restart'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('without the flag and with the default none, the output is exactly the switch result — no restart key', async () => {
      const { edt, containerRestart } = restartSetup();
      const result = await edt.run(['switch', '--to', 'demo']);
      expect(result.ok).toBe(true);
      expect(result.ok && 'restart' in (result.data as object)).toBe(false);
      expect(containerRestart).not.toHaveBeenCalled();
    });

    it('--restart simple restarts changed services, verifies them and emits rows in the envelope', async () => {
      const { edt, containerRestart, probe } = restartSetup();
      const result = await edt.run(['switch', '--to', 'demo', '--restart', 'simple']);
      expect(result.ok).toBe(true);
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
      expect(probe).toHaveBeenCalledWith('http://localhost:1/health', expect.any(Number));
      expect(result.ok && (result.data as { restart: unknown[] }).restart).toEqual(
        expect.arrayContaining([{ service: 'svc-a', mode: 'simple', state: 'functional' }]),
      );
    });

    it('--restart never probes a service whose health check is disabled in settings', async () => {
      const { edt, containerRestart, probe } = restartSetup({ healthy: false, healthCheckDisabled: ['svc-a'] });
      const result = await edt.run(['switch', '--to', 'demo', '--restart', 'simple']);
      expect(result.ok).toBe(true);
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
      expect(probe).not.toHaveBeenCalled();
      expect(result.ok && (result.data as { restart: unknown[] }).restart).toEqual(
        expect.arrayContaining([{ service: 'svc-a', mode: 'simple', state: 'up-unverified' }]),
      );
    });

    it('the flag overrides the setting, and an absent flag uses it', async () => {
      const viaSetting = restartSetup({ mode: 'clean', withHealthUrl: false });
      const fromSetting = await viaSetting.edt.run(['switch', '--to', 'demo']);
      expect(fromSetting.ok && (fromSetting.data as { restart: Array<{ mode: string; state: string; detail?: string }> }).restart[0]).toMatchObject({
        service: 'svc-a',
        mode: 'clean',
        state: 'up-unverified',
        detail: expect.stringContaining('no clean-restart recipe'),
      });
      const overridden = restartSetup({ mode: 'clean' });
      const none = await overridden.edt.run(['switch', '--to', 'demo', '--restart', 'none']);
      expect(none.ok && 'restart' in (none.data as object)).toBe(false);
    });

    it('exits non-zero with the rows in the envelope when a targeted service ends unhealthy', async () => {
      const { subcommands } = restartSetup({ healthy: false });
      // The unhealthy verdict only lands once the 30 s verification budget is spent.
      let rendered: Awaited<ReturnType<typeof runCli>>;
      vi.useFakeTimers();
      try {
        const pending = runCli(['edt', 'switch', '--to', 'demo', '--restart', 'simple'], subcommands, false);
        await vi.advanceTimersByTimeAsync(31_000);
        rendered = await pending;
      } finally {
        vi.useRealTimers();
      }
      expect(rendered.exitCode).toBe(1);
      const line = JSON.parse(rendered.output) as { ok: boolean; error: { code: string; details: { restart: Array<{ service: string; state: string }> } } };
      expect(line.error.code).toBe('switch-restart-needs-attention');
      expect(line.error.details.restart).toEqual(expect.arrayContaining([expect.objectContaining({ service: 'svc-a', state: 'unhealthy' })]));
    });

    it('rejects a restart request up front when the Docker port is not wired', async () => {
      const subcommands = buildTestSubcommands({ edtRegistry: { ...fakeEdtRegistry(), list: async () => ok([target]) } });
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');
      expect(await edt.run(['switch', '--to', 'demo', '--restart', 'simple'])).toMatchObject({ ok: false, error: { code: 'restart-unavailable' } });
    });
  });

});
