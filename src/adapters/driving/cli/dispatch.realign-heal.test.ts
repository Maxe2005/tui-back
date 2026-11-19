import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../core/result.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { GitPort } from '../../../core/ports/git.js';
import { DEFAULT_SETTINGS, type SettingsPort } from '../../../core/ports/settings.js';
import { runCli } from './dispatch.js';
import { fakeState, fakeEdtRegistry, fakeGitPort, buildTestSubcommands } from './dispatch.test-support.js';

describe('subcommand registry guards — realign and heal', () => {
  describe('realign', () => {
    const active = {
      ulid: 'e1',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active' as const,
      members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
    };

    function realignSetup(
      opts: { checkout?: GitPort['checkout']; healthy?: boolean; withDocker?: boolean; registryList?: RegistryPort['list']; settings?: SettingsPort } = {},
    ) {
      const checkout = vi.fn(opts.checkout ?? (async () => ok(undefined)));
      const acquire = vi.fn(async () => ok({ release: async () => ok(undefined) }));
      const probe = vi.fn(async () => ok({ healthy: opts.healthy ?? true, status: 200 }));
      const containerRestart = vi.fn(async () => ok(undefined));
      const logAction = vi.fn(async () => ok(undefined));
      const subcommands = buildTestSubcommands({
        registry: {
          list: opts.registryList ?? (async () => ok(['/repo/a', '/repo/b'])),
          add: async () => ok(undefined),
          exists: async () => ok(true),
          scan: async () => ok({ candidates: [], skipped: [] }),
          reset: async () => ok({ path: '/p', backupPath: null }),
          remove: async () => ok(undefined),
        },
        ...(opts.settings !== undefined ? { settings: opts.settings } : {}),
        manifest: {
          load: async (repoPath: string) =>
            ok({
              service: repoPath === '/repo/a' ? 'svc-a' : 'svc-b',
              container: repoPath === '/repo/a' ? 'ctr-a' : undefined,
              healthUrl: 'http://localhost:1/health',
              sharedBranch: 'develop',
              modules: {},
            }),
        },
        // Both repos sit on `development`: svc-a drifted from feat/a, svc-b from develop.
        git: fakeGitPort({ checkout }),
        lock: { acquire, peek: async () => ok({ locked: false }) },
        edtRegistry: { ...fakeEdtRegistry(), list: async () => ok([active]), logAction },
        state: { ...fakeState(), readActiveEdt: async () => ok('e1') },
        container: { restart: containerRestart },
        ...(opts.withDocker === false
          ? {}
          : {
              docker: {
                streamLogs: () => () => {},
                fetchLogsBefore: async () => ok([]),
                getContainerHealth: async () => ok('up' as const),
                restartContainer: async () => ok(undefined),
              },
              healthProbe: { probe },
            }),
      });
      const realign = subcommands.find((subcommand) => subcommand.name === 'realign');
      if (!realign) throw new Error('expected realign subcommand');
      return { realign, checkout, acquire, containerRestart, logAction, probe, subcommands };
    }

    it.each([
      [['--scope', 'foo']],
      [['--scope']],
      [['--scope', 'edt', '--scope', 'all']],
      [['--restart', 'bogus']],
      [['--restart', 'simple', '--restart', 'none']],
      [['--service']],
      [['--service', '--scope']],
      [['--bogus']],
      [['extra']],
      [['--service', 'nope']],
    ])('rejects %j with invalid-argument before locking or touching anything', async (args) => {
      const { realign, checkout, acquire } = realignSetup();
      expect(await realign.run(args)).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(acquire).not.toHaveBeenCalled();
      expect(checkout).not.toHaveBeenCalled();
    });

    it('defaults to scope edt with no restart and returns {rows}', async () => {
      const { realign, checkout, containerRestart, logAction } = realignSetup();
      const result = await realign.run([]);
      expect(result).toEqual({
        ok: true,
        data: { rows: [{ service: 'svc-a', outcome: 'realigned', detail: { code: 'realigned', message: 'Checked out "feat/a"' } }] },
      });
      expect(checkout).toHaveBeenCalledWith('/repo/a', 'feat/a');
      expect(containerRestart).not.toHaveBeenCalled();
      expect(logAction).toHaveBeenCalledWith('e1', 'realign', 'success', expect.stringContaining('svc-a realigned'));
    });

    it('--scope none with no service is an empty success', async () => {
      const { realign, checkout } = realignSetup();
      expect(await realign.run(['--scope', 'none'])).toEqual({ ok: true, data: { rows: [] } });
      expect(checkout).not.toHaveBeenCalled();
    });

    it('--service adds a managed other to the scope', async () => {
      const { realign, checkout } = realignSetup();
      const result = await realign.run(['--scope', 'none', '--service', 'svc-b']);
      expect(result).toMatchObject({ ok: true, data: { rows: [{ service: 'svc-b', outcome: 'realigned' }] } });
      expect(checkout).toHaveBeenCalledWith('/repo/b', 'develop');
    });

    it('exits non-zero with the rows when a service fails', async () => {
      const { subcommands } = realignSetup({ checkout: async () => err('git-checkout-error', 'refused') });
      const rendered = await runCli(['realign'], subcommands, false);
      expect(rendered.exitCode).toBe(1);
      const line = JSON.parse(rendered.output) as { error: { code: string; details: { rows: unknown[] } } };
      expect(line.error.code).toBe('realign-failed');
      expect(line.error.details.rows).toEqual([{ service: 'svc-a', outcome: 'failed', detail: { code: 'git-checkout-error', message: 'refused' } }]);
    });

    it('--restart simple restarts the realigned container services and emits restart rows', async () => {
      const { realign, containerRestart } = realignSetup();
      const result = await realign.run(['--scope', 'all', '--restart', 'simple']);
      expect(result.ok).toBe(true);
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
      expect(result.ok && (result.data as { restart: unknown[] }).restart).toEqual(
        expect.arrayContaining([
          { service: 'svc-a', mode: 'simple', state: 'functional' },
          { service: 'svc-b', mode: 'simple', state: 'skipped', detail: 'no container' },
        ]),
      );
    });

    it('exits non-zero when a restarted service ends unhealthy', async () => {
      const { subcommands } = realignSetup({ healthy: false });
      let rendered: Awaited<ReturnType<typeof runCli>>;
      vi.useFakeTimers();
      try {
        const pending = runCli(['realign', '--restart', 'simple'], subcommands, false);
        await vi.advanceTimersByTimeAsync(31_000);
        rendered = await pending;
      } finally {
        vi.useRealTimers();
      }
      expect(rendered.exitCode).toBe(1);
      const line = JSON.parse(rendered.output) as { error: { code: string; details: { rows: unknown[]; restart: unknown[] } } };
      expect(line.error.code).toBe('realign-restart-needs-attention');
      expect(line.error.details.rows).toEqual([expect.objectContaining({ service: 'svc-a', outcome: 'realigned' })]);
    });

    it('exits non-zero with realign-restart-needs-attention when the restart phase cannot run', async () => {
      const list = vi
        .fn<RegistryPort['list']>()
        .mockResolvedValueOnce(ok(['/repo/a', '/repo/b']))
        .mockResolvedValueOnce(ok(['/repo/a', '/repo/b']))
        .mockResolvedValue(err('registry-read-error', 'registry.yaml vanished'));
      const { subcommands, containerRestart } = realignSetup({ registryList: list });
      const rendered = await runCli(['realign', '--restart', 'simple'], subcommands, false);
      expect(rendered.exitCode).toBe(1);
      const line = JSON.parse(rendered.output) as { error: { code: string; details: { rows: unknown[]; restartError: unknown } } };
      expect(line.error.code).toBe('realign-restart-needs-attention');
      expect(line.error.details.rows).toEqual([expect.objectContaining({ service: 'svc-a', outcome: 'realigned' })]);
      expect(line.error.details.restartError).toEqual({ code: 'registry-read-error', message: 'registry.yaml vanished' });
      expect(containerRestart).not.toHaveBeenCalled();
    });

    it('reports a failed registry listing as itself, not as an unknown service', async () => {
      const { realign, checkout } = realignSetup({ registryList: async () => err('registry-read-error', 'registry.yaml unreadable') });
      expect(await realign.run(['--service', 'svc-b'])).toEqual({
        ok: false,
        error: { code: 'registry-read-error', message: 'registry.yaml unreadable' },
      });
      expect(checkout).not.toHaveBeenCalled();
    });

    it('warns on stderr when settings cannot be read for the restart, then uses the defaults', async () => {
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { realign, containerRestart } = realignSetup({
          settings: { load: async () => err('settings-read-error', 'settings.yaml unreadable'), save: async () => ok(undefined) },
        });
        const result = await realign.run(['--restart', 'simple']);
        expect(result.ok).toBe(true);
        expect(containerRestart).toHaveBeenCalledWith('ctr-a');
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining('could not read settings, using defaults: settings.yaml unreadable'));
      } finally {
        stderr.mockRestore();
      }
    });

    function realignSettings(realign: { defaultScope: 'none' | 'edt' | 'all'; restartMode: 'none' | 'simple' | 'clean' }): SettingsPort {
      return { load: async () => ok({ settings: { ...DEFAULT_SETTINGS, realign }, warning: null }), save: async () => ok(undefined) };
    }

    it('uses realign.defaultScope and realign.restartMode when --scope and --restart are absent', async () => {
      const { realign, checkout, containerRestart } = realignSetup({ settings: realignSettings({ defaultScope: 'all', restartMode: 'clean' }) });
      const result = await realign.run([]);
      expect(result).toMatchObject({ ok: true, data: { rows: [{ service: 'svc-a', outcome: 'realigned' }, { service: 'svc-b', outcome: 'realigned' }] } });
      expect(checkout).toHaveBeenCalledTimes(2);
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
      expect(result.ok && (result.data as { restart: unknown[] }).restart).toEqual(
        expect.arrayContaining([expect.objectContaining({ service: 'svc-a', mode: 'clean', state: 'functional' })]),
      );
    });

    it('a restart never probes a service whose health check is disabled in settings', async () => {
      const settings: SettingsPort = {
        load: async () => ok({ settings: { ...DEFAULT_SETTINGS, services: { healthCheckDisabled: ['svc-a'] } }, warning: null }),
        save: async () => ok(undefined),
      };
      const { realign, containerRestart, probe } = realignSetup({ settings, healthy: false });
      const result = await realign.run(['--restart', 'simple']);
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
      expect(probe).not.toHaveBeenCalled();
      expect(result.ok && (result.data as { restart: unknown[] }).restart).toEqual(
        expect.arrayContaining([expect.objectContaining({ service: 'svc-a', mode: 'simple', state: 'up-unverified' })]),
      );
    });

    it('lets explicit --scope and --restart override the settings', async () => {
      const { realign, checkout, containerRestart } = realignSetup({ settings: realignSettings({ defaultScope: 'all', restartMode: 'clean' }) });
      const result = await realign.run(['--scope', 'edt', '--restart', 'none']);
      expect(result).toEqual({
        ok: true,
        data: { rows: [{ service: 'svc-a', outcome: 'realigned', detail: { code: 'realigned', message: 'Checked out "feat/a"' } }] },
      });
      expect(checkout).toHaveBeenCalledTimes(1);
      expect(containerRestart).not.toHaveBeenCalled();
    });

    it('warns on stderr and applies the built-in scope and restart when settings cannot be read', async () => {
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { realign, checkout, containerRestart } = realignSetup({
          settings: { load: async () => err('settings-read-error', 'settings.yaml unreadable'), save: async () => ok(undefined) },
        });
        expect(await realign.run([])).toMatchObject({ ok: true, data: { rows: [{ service: 'svc-a', outcome: 'realigned' }] } });
        expect(checkout).toHaveBeenCalledTimes(1);
        expect(containerRestart).not.toHaveBeenCalled();
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining('could not read settings, using defaults'));
      } finally {
        stderr.mockRestore();
      }
    });

    it('reads no settings when --scope and --restart none are both explicit', async () => {
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const load = vi.fn(async () => err('settings-read-error', 'settings.yaml unreadable'));
        const { realign } = realignSetup({ settings: { load, save: async () => ok(undefined) } });
        expect(await realign.run(['--scope', 'edt', '--restart', 'none'])).toMatchObject({ ok: true });
        expect(load).not.toHaveBeenCalled();
        expect(stderr).not.toHaveBeenCalled();
      } finally {
        stderr.mockRestore();
      }
    });

    it('prints a settings warning on stderr and still applies the loaded defaults', async () => {
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { realign, checkout } = realignSetup({
          settings: {
            load: async () => ok({ settings: { ...DEFAULT_SETTINGS, realign: { defaultScope: 'all', restartMode: 'none' } }, warning: 'settings.yaml: realign.defaultScope invalid' }),
            save: async () => ok(undefined),
          },
        });
        expect(await realign.run([])).toMatchObject({ ok: true });
        expect(checkout).toHaveBeenCalledTimes(2);
        expect(stderr).toHaveBeenCalledWith('tui-back: settings.yaml: realign.defaultScope invalid');
        expect(stderr).toHaveBeenCalledTimes(1);
      } finally {
        stderr.mockRestore();
      }
    });

    it('rejects a restart request up front when the Docker port is not wired', async () => {
      const { realign, acquire } = realignSetup({ withDocker: false });
      expect(await realign.run(['--restart', 'clean'])).toMatchObject({ ok: false, error: { code: 'restart-unavailable' } });
      expect(acquire).not.toHaveBeenCalled();
    });

    it('is rejected while an update, switch or realign holds the lock', async () => {
      const checkout = vi.fn(async () => ok(undefined));
      const blocked = buildTestSubcommands({
        registry: { list: async () => ok(['/repo/a']), exists: async () => ok(true) } as unknown as RegistryPort,
        manifest: { load: async () => ok({ service: 'svc-a', sharedBranch: 'develop', modules: {} }) },
        git: fakeGitPort({ checkout }),
        lock: { acquire: async () => err('action-in-progress', 'busy'), peek: async () => ok({ locked: true }) },
        edtRegistry: { ...fakeEdtRegistry(), list: async () => ok([active]) },
        state: { ...fakeState(), readActiveEdt: async () => ok('e1') },
      }).find((subcommand) => subcommand.name === 'realign');
      expect(await blocked?.run([])).toMatchObject({ ok: false, error: { code: 'realign-blocked-action-in-progress' } });
      expect(checkout).not.toHaveBeenCalled();
    });
  });

  describe('heal', () => {
    const active = {
      ulid: 'e1',
      topic: 'feat',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'active' as const,
      members: [
        { service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' },
        { service: 'svc-b', repoPath: '/repo/b', branch: 'feat/b' },
        { service: 'svc-c', repoPath: '/repo/c', branch: 'feat/c' },
      ],
    };

    // svc-a is down (target), svc-b is up (skipped), svc-c declares no container (skipped).
    // After a restart every container reads `up`; `healthyAfter` decides what the probe answers.
    function healSetup(
      opts: {
        settings?: SettingsPort;
        healthyAfter?: boolean;
        withProbe?: boolean;
        activeUlid?: string | null;
        heldLocks?: string[];
        allUp?: boolean;
        // Members beyond svc-a/b/c: `d` has an unreadable manifest, `e` is a second down target.
        extraMembers?: ('d' | 'e')[];
        restartDelayMs?: number;
      } = {},
    ) {
      const restarted = new Set<string>();
      let inFlight = 0;
      const peak = { value: 0 };
      const containerRestart = vi.fn(async (container: string) => {
        inFlight += 1;
        peak.value = Math.max(peak.value, inFlight);
        if (opts.restartDelayMs !== undefined) await new Promise((done) => setTimeout(done, opts.restartDelayMs));
        inFlight -= 1;
        restarted.add(container);
        return ok(undefined);
      });
      // The clean recipe stands in for a container restart of svc-a, the only target.
      const restartRun = vi.fn(async () => {
        restarted.add('ctr-a');
        return ok({ output: '' });
      });
      const containers: Record<string, 'up' | 'down'> = { 'ctr-a': opts.allUp === true ? 'up' : 'down', 'ctr-b': 'up', 'ctr-e': 'down' };
      const members = [
        ...active.members,
        ...(opts.extraMembers ?? []).map((name) => ({ service: `svc-${name}`, repoPath: `/repo/${name}`, branch: `feat/${name}` })),
      ];
      const manifestFor = (repoPath: string) => {
        const name = repoPath.slice(-1);
        return {
          service: `svc-${name}`,
          ...(name === 'c' ? {} : { container: `ctr-${name}` }),
          healthUrl: `http://localhost/${name}/health`,
          restartCommands: ['make clean-restart'],
          sharedBranch: 'develop',
          modules: {},
        };
      };
      const subcommands = buildTestSubcommands({
        manifest: {
          load: async (repoPath: string) =>
            repoPath === '/repo/d' ? err('manifest-validation-failed', 'container: expected string') : ok(manifestFor(repoPath)),
        },
        lock: {
          acquire: async () => ok({ release: async () => ok(undefined) }),
          peek: async (key: string) => ok({ locked: (opts.heldLocks ?? []).includes(key) }),
        },
        edtRegistry: { ...fakeEdtRegistry(), list: async () => ok([{ ...active, members }]) },
        state: { ...fakeState(), readActiveEdt: async () => ok(opts.activeUlid === undefined ? 'e1' : opts.activeUlid) },
        container: { restart: containerRestart },
        restart: { run: restartRun },
        ...(opts.settings !== undefined ? { settings: opts.settings } : {}),
        docker: {
          streamLogs: () => () => {},
          fetchLogsBefore: async () => ok([]),
          getContainerHealth: async (container: string) => ok(restarted.has(container) ? ('up' as const) : (containers[container] ?? 'down')),
          restartContainer: async () => ok(undefined),
        },
        ...(opts.withProbe === false
          ? {}
          : {
              healthProbe: {
                probe: async (url: string) => {
                  const name = url.includes('/a/') ? 'ctr-a' : url.includes('/b/') ? 'ctr-b' : url.includes('/e/') ? 'ctr-e' : 'none';
                  const healthy = name === 'ctr-b' || (restarted.has(name) ? opts.healthyAfter ?? true : containers[name] === 'up');
                  return ok(healthy ? { healthy: true, status: 200 } : { healthy: false, status: 503, reason: 'HTTP 503' });
                },
              },
            }),
      });
      const heal = subcommands.find((subcommand) => subcommand.name === 'heal');
      if (!heal) throw new Error('expected heal subcommand');
      return { heal, containerRestart, restartRun, peak };
    }

    it('restarts the down service in simple mode by default and reports targets, skipped and the restart rows', async () => {
      const { heal, containerRestart } = healSetup();
      const result = await heal.run([]);
      expect(result).toEqual({
        ok: true,
        data: {
          edt: { ulid: 'e1', topic: 'feat' },
          mode: 'simple',
          targets: ['svc-a'],
          skipped: [
            { service: 'svc-b', reason: 'up' },
            { service: 'svc-c', reason: 'no container' },
          ],
          restart: [{ service: 'svc-a', state: 'functional' }],
          summary: { functional: 1, 'up-unverified': 0, unhealthy: 0, restarting: 0, down: 0, failed: 0, skipped: 2 },
        },
      });
      expect(containerRestart).toHaveBeenCalledTimes(1);
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
    });

    it('honours services.healthCheckDisabled: a disabled service is verified container-only, never unhealthy', async () => {
      const { heal, containerRestart } = healSetup({
        healthyAfter: false,
        settings: {
          load: async () => ok({ settings: { ...DEFAULT_SETTINGS, services: { healthCheckDisabled: ['svc-a'] } }, warning: null }),
          save: async () => ok(undefined),
        },
      });
      const result = await heal.run([]);
      expect(result).toMatchObject({ ok: true, data: { targets: ['svc-a'], restart: [{ service: 'svc-a', state: 'up-unverified' }] } });
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
    });

    it('uses dashboard.restartMode when --restart is absent', async () => {
      const { heal, restartRun } = healSetup({
        settings: { load: async () => ok({ settings: { ...DEFAULT_SETTINGS, dashboard: { restartMode: 'clean' } }, warning: null }), save: async () => ok(undefined) },
      });
      const result = await heal.run([]);
      expect(result).toMatchObject({ ok: true, data: { mode: 'clean', restart: [{ service: 'svc-a', state: 'functional' }] } });
      expect(restartRun).toHaveBeenCalled();
    });

    it('lets an explicit --restart override the setting', async () => {
      const { heal, restartRun, containerRestart } = healSetup({
        settings: { load: async () => ok({ settings: { ...DEFAULT_SETTINGS, dashboard: { restartMode: 'clean' } }, warning: null }), save: async () => ok(undefined) },
      });
      expect(await heal.run(['--restart', 'simple'])).toMatchObject({ ok: true, data: { mode: 'simple' } });
      expect(restartRun).not.toHaveBeenCalled();
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
    });

    it("is ok with 'every service is up' and restarts nothing when there is no target", async () => {
      const { heal, containerRestart } = healSetup({ allUp: true });
      const result = await heal.run([]);
      expect(result).toMatchObject({ ok: true, data: { targets: [], restart: [], message: 'every service is up' } });
      expect(containerRestart).not.toHaveBeenCalled();
    });

    it('exits through heal-needs-attention with the full data when a restarted service ends unhealthy', async () => {
      const { heal } = healSetup({ healthyAfter: false });
      // verifyService polls until its timeout on an unhealthy service: drive the clock.
      vi.useFakeTimers();
      try {
        const settled = heal.run([]);
        await vi.runAllTimersAsync();
        const result = await settled;
        expect(result).toMatchObject({
          ok: false,
          error: { code: 'heal-needs-attention', details: { targets: ['svc-a'], restart: [{ service: 'svc-a', state: 'unhealthy' }] } },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('fails the row with the held lock name and exits through heal-needs-attention', async () => {
      const { heal, containerRestart } = healSetup({ heldLocks: ['group-update'] });
      const result = await heal.run([]);
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'heal-needs-attention', details: { restart: [{ service: 'svc-a', state: 'failed', detail: 'group update in progress' }] } },
      });
      expect(containerRestart).not.toHaveBeenCalled();
    });

    it('carries the cause of a status unknown skip as its detail', async () => {
      const { heal } = healSetup({ extraMembers: ['d'] });
      const result = await heal.run([]);
      expect(result.ok && (result.data as { skipped: unknown[] }).skipped).toContainEqual({
        service: 'svc-d',
        reason: 'status unknown',
        detail: 'container: expected string',
      });
    });

    it('restarts one target at a time when update.concurrency is 1', async () => {
      const { heal, containerRestart, peak } = healSetup({
        extraMembers: ['e'],
        restartDelayMs: 5,
        settings: { load: async () => ok({ settings: { ...DEFAULT_SETTINGS, update: { ...DEFAULT_SETTINGS.update, concurrency: 1 } }, warning: null }), save: async () => ok(undefined) },
      });
      const result = await heal.run([]);
      expect(result).toMatchObject({ ok: true, data: { targets: ['svc-a', 'svc-e'] } });
      expect(containerRestart).toHaveBeenCalledTimes(2);
      expect(peak.value).toBe(1);
    });

    it('warns on stderr when settings cannot be read, then heals in simple mode', async () => {
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { heal, containerRestart } = healSetup({
          settings: { load: async () => err('settings-read-error', 'settings.yaml unreadable'), save: async () => ok(undefined) },
        });
        const result = await heal.run([]);
        expect(result).toMatchObject({ ok: true, data: { mode: 'simple', restart: [{ service: 'svc-a', state: 'functional' }] } });
        expect(containerRestart).toHaveBeenCalledWith('ctr-a');
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining('could not read settings, using defaults: settings.yaml unreadable'));
      } finally {
        stderr.mockRestore();
      }
    });

    it('is err no-active-edt when no EDT is active', async () => {
      const { heal, containerRestart } = healSetup({ activeUlid: null });
      expect(await heal.run([])).toMatchObject({ ok: false, error: { code: 'no-active-edt' } });
      expect(containerRestart).not.toHaveBeenCalled();
    });

    it('is err restart-unavailable when the health probe is not wired', async () => {
      const { heal, containerRestart } = healSetup({ withProbe: false });
      expect(await heal.run([])).toMatchObject({ ok: false, error: { code: 'restart-unavailable' } });
      expect(containerRestart).not.toHaveBeenCalled();
    });

    it.each([
      [['--restart', 'none']],
      [['--restart']],
      [['--restart', '--force']],
      [['--restart', 'simple', '--restart', 'clean']],
      [['--force']],
      [['extra']],
    ])('rejects %j as invalid-argument with the usage, restarting nothing', async (args) => {
      const load = vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null }));
      const { heal, containerRestart } = healSetup({ settings: { load, save: async () => ok(undefined) } });
      const result = await heal.run(args);
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(!result.ok && result.error.message).toContain('tui-back heal [--restart simple|clean]');
      expect(containerRestart).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    });
  });

});
