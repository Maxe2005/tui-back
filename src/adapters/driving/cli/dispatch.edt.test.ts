import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../core/result.js';
import type { GitPort } from '../../../core/ports/git.js';
import type { EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import { DEFAULT_SETTINGS } from '../../../core/ports/settings.js';
import { runCli } from './dispatch.js';
import { fakeState, fakeEdtRegistry, fakeGitPort, buildTestSubcommands } from './dispatch.test-support.js';

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

  describe('edt list and the system shared-branches EDT', () => {
    const system = {
      ulid: '01SHAREDBRANCHES0000000000',
      topic: 'Shared branches',
      kind: 'system-shared' as const,
      createdAt: '1970-01-01T00:00:00.000Z',
      status: 'inactive' as const,
      members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'development' }],
    };
    const user = {
      ulid: '01USER',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'inactive' as const,
      members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
    };
    const registryOf = (entries: Array<typeof system | typeof user>): EdtRegistryPort => ({
      add: async () => ok(undefined),
      list: async () => ok(entries),
      setStatus: async () => ok(undefined),
      update: async () => ok(undefined),
      remove: async () => ok(undefined),
    });
    const edtOf = (entries: Array<typeof system | typeof user>) => {
      const edt = buildTestSubcommands({ edtRegistry: registryOf(entries) }).find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');
      return edt;
    };

    it('lists every EDT with kind "user" or "system-shared"', async () => {
      const result = await edtOf([user, system]).run(['list']);

      expect(result).toMatchObject({
        ok: true,
        data: { edts: [{ topic: 'demo', kind: 'user' }, { topic: 'Shared branches', kind: 'system-shared' }] },
      });
    });

    it('reports status active for the entry the active-EDT pointer names, even the system one', async () => {
      const state = { ...fakeState(), readActiveEdt: async () => ok(system.ulid as string | null) };
      const edt = buildTestSubcommands({ edtRegistry: registryOf([user, system]), state }).find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');

      const result = await edt.run(['list']);

      expect(result).toMatchObject({ ok: true, data: { edts: [{ topic: 'demo', status: 'inactive' }, { topic: 'Shared branches', status: 'active' }] } });
    });

    it('has no system entry when the registry does not synthesize it (setting off)', async () => {
      const result = await edtOf([user]).run(['list']);
      expect(result).toMatchObject({ ok: true, data: { edts: [{ kind: 'user' }] } });
    });

    it('rejects extra arguments', async () => {
      expect(await edtOf([user]).run(['list', 'x'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('delete, modify and create refuse the system EDT with edt-system-readonly', async () => {
      const edt = edtOf([system]);
      expect(await edt.run(['delete', 'Shared branches'])).toMatchObject({ ok: false, error: { code: 'edt-system-readonly' } });
      expect(await edt.run(['modify', '--topic', 'Shared branches', '--rename-to', 'x'])).toMatchObject({ ok: false, error: { code: 'edt-system-readonly' } });
      expect(await edt.run(['create', '--topic', 'shared branches', '--member', '/repo/a'])).toMatchObject({ ok: false, error: { code: 'edt-system-readonly' } });
    });

    it('switching to the system topic fails edt-not-found when it is not listed', async () => {
      expect(await edtOf([user]).run(['switch', '--to', 'Shared branches'])).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
    });
  });

  describe('edt fast-forward-shared', () => {
    const system = {
      ulid: '01SHAREDBRANCHES0000000000',
      topic: 'Shared branches',
      kind: 'system-shared' as const,
      createdAt: '1970-01-01T00:00:00.000Z',
      status: 'inactive' as const,
      members: [
        { service: 'svc-a', repoPath: '/repo/a', branch: 'development' },
        { service: 'svc-b', repoPath: '/repo/b', branch: 'development' },
      ],
    };
    const edtWith = (entries: Array<typeof system>, git: Partial<GitPort>) => {
      const edt = buildTestSubcommands({
        edtRegistry: { ...fakeEdtRegistry(), list: async () => ok(entries) },
        git: fakeGitPort({ branchExistsLocally: async () => ok(true), fetchRemote: async () => ok(undefined), listUnpushedCommits: async () => ok([]), isBranchMerged: async () => ok(false), currentBranch: async () => ok('feat/x'), fetch: async () => ok(undefined), ...git }),
      }).find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');
      return edt;
    };

    it('returns the per-service rows', async () => {
      const result = await edtWith([system], {}).run(['fast-forward-shared']);
      expect(result).toMatchObject({ ok: true, data: { rows: [{ service: 'svc-a', outcome: 'fast-forwarded' }, { service: 'svc-b', outcome: 'fast-forwarded' }] } });
    });

    it('fails fast-forward-failed, carrying every row, when a service failed', async () => {
      const result = await edtWith([system], { fetchRemote: async (p: string) => (p === '/repo/a' ? err('git-fetch-error', 'offline') : ok(undefined)) }).run(['fast-forward-shared']);
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'fast-forward-failed', details: { rows: [{ outcome: 'failed' }, { outcome: 'fast-forwarded' }] } },
      });
    });

    it('is edt-not-found when the system EDT is not listed (setting off)', async () => {
      expect(await edtWith([], {}).run(['fast-forward-shared'])).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
    });

    it('rejects extra arguments', async () => {
      expect(await edtWith([system], {}).run(['fast-forward-shared', '--x'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
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

    function restartSetup(opts: { healthy?: boolean; mode?: 'none' | 'simple' | 'clean'; withHealthUrl?: boolean; healthCheckDisabled?: string[]; currentBranch?: string } = {}) {
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
        ...(opts.currentBranch !== undefined ? { git: fakeGitPort({ currentBranch: async () => ok(opts.currentBranch as string) }) } : {}),
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

    it('emits an additive `unchanged` row and restarts nothing for a repo already on its target branch', async () => {
      const { edt, containerRestart } = restartSetup({ currentBranch: 'feat/a' });
      const result = await edt.run(['switch', '--to', 'demo', '--restart', 'simple']);
      expect(result.ok).toBe(true);
      const data = result.ok ? (result.data as { results: { service: string; outcome: string }[]; restart: unknown[] }) : null;
      expect(data?.results).toContainEqual(expect.objectContaining({ service: 'svc-a', outcome: 'unchanged' }));
      expect(containerRestart).not.toHaveBeenCalled();
      expect(data?.restart).toEqual(expect.arrayContaining([{ service: 'svc-a', mode: 'simple', state: 'skipped', detail: 'unchanged' }]));
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
