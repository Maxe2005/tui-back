import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../../core/result.js';
import type { ManifestPort } from '../../../../core/ports/vcs/manifest.js';
import type { RegistryPort } from '../../../../core/ports/storage/registry.js';
import { fakeGitPort, buildTestSubcommands } from './dispatch.test-support.js';

// `registry clean`'s interactive TTY branch drives a real `node:readline/promises` prompt —
// mocked here so the list-then-confirm flow is exercised under test (the e2e suite's
// spawnSync stdin is never a real TTY).
vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(),
}));
import { createInterface } from 'node:readline/promises';

describe('subcommand registry guards — registry', () => {
  describe('registry clean', () => {
    function findRegistry(subcommands: ReturnType<typeof buildTestSubcommands>) {
      const registry = subcommands.find((subcommand) => subcommand.name === 'registry');
      if (!registry) throw new Error('expected registry subcommand');
      return registry;
    }

    it('rejects an unknown registry action', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const result = await registry.run(['bogus']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects an unknown registry clean flag', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const result = await registry.run(['clean', '--force']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects --path given without --yes, and --yes given without --path', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const pathOnly = await registry.run(['clean', '--path', '/repo/a']);
      const yesOnly = await registry.run(['clean', '--yes']);

      expect(pathOnly).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(yesOnly).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects --path with a missing value', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const result = await registry.run(['clean', '--yes', '--path']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects a --path value that looks like another flag instead of silently consuming it as a literal path', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const looksLikeYes = await registry.run(['clean', '--yes', '--path', '--yes']);
      const looksLikePath = await registry.run(['clean', '--yes', '--path', '--path']);

      expect(looksLikeYes).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(looksLikePath).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects an empty-string --path value instead of silently resolving it to cwd', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const empty = await registry.run(['clean', '--yes', '--path', '']);
      const blank = await registry.run(['clean', '--yes', '--path', '   ']);

      expect(empty).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(blank).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('de-duplicates the same resolved path given via multiple --path flags, never a duplicate outcome row', async () => {
      const remove = vi.fn(async () => ok(undefined));
      const registryPort: RegistryPort = {
        list: async () => ok([]),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove,
      };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort }));

      const result = await registry.run(['clean', '--yes', '--path', '/repo/a', '--path', '/repo/a']);

      expect(result).toEqual({ ok: true, data: { results: [{ path: '/repo/a', outcome: 'removed' }] } });
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it('--yes --path <p1> --path <p2> removes each path via RegistryPort.remove, one path failing never blocking the other', async () => {
      const remove = vi.fn(async (path: string) =>
        path === '/repo/bad' ? err('registry-write-error', 'disk full') : ok(undefined),
      );
      const registryPort: RegistryPort = {
        list: async () => ok([]),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove,
      };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort }));

      const result = await registry.run(['clean', '--yes', '--path', '/repo/good', '--path', '/repo/bad']);

      expect(result).toEqual({
        ok: true,
        data: {
          results: [
            { path: '/repo/good', outcome: 'removed' },
            { path: '/repo/bad', outcome: 'failed', detail: { code: 'registry-write-error', message: 'disk full' } },
          ],
        },
      });
      expect(remove).toHaveBeenCalledWith('/repo/good');
      expect(remove).toHaveBeenCalledWith('/repo/bad');
    });

    it('scripted removal is a no-op success for a path that is not currently registered', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const result = await registry.run(['clean', '--yes', '--path', '/repo/never-registered']);

      expect(result).toEqual({ ok: true, data: { results: [{ path: '/repo/never-registered', outcome: 'removed' }] } });
    });

    it('bare invocation on a fully healthy registry reports zero candidates explicitly, never silently', async () => {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/a']),
        add: async () => ok(undefined),
        exists: async () => ok(true),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const manifest: ManifestPort = { load: async () => ok({ service: 'svc', container: 'ctr', sharedBranch: 'development', modules: {} }) };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort, manifest }));

      const result = await registry.run(['clean']);

      expect(result).toEqual({ ok: true, data: { candidates: [], errors: [], results: [] } });
    });

    it('bare invocation off a TTY (isTTY not set) requires confirmation instead of silently doing nothing, and names the candidates', async () => {
      // buildTestSubcommands' default registry.exists() -> ok(false) and manifest.load() ->
      // manifest-not-found together make the default fixture path classify as unreachable,
      // so no override is needed to produce a candidate.
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/gone']),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort }));

      const result = await registry.run(['clean']);

      expect(result).toMatchObject({ ok: false, error: { code: 'confirmation-required' } });
      if (!result.ok) {
        expect(result.error.message).toContain('--yes');
        expect(result.error.details).toMatchObject({
          candidates: [{ path: '/repo/gone', reason: 'unreachable' }],
          errors: [],
        });
      }
    });

    it('surfaces a path that could not even be checked in `errors`, never silently dropped', async () => {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/gone', '/repo/unknown']),
        add: async () => ok(undefined),
        exists: async (path: string) => (path === '/repo/unknown' ? err('registry-stat-error', 'permission denied') : ok(false)),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort }));

      const result = await registry.run(['clean']);

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'confirmation-required',
          details: {
            candidates: [{ path: '/repo/gone', reason: 'unreachable' }],
            errors: [{ path: '/repo/unknown', code: 'registry-stat-error', message: 'permission denied' }],
          },
        },
      });
    });
  });

  describe('registry validate', () => {
    function findRegistry(subcommands: ReturnType<typeof buildTestSubcommands>) {
      const registry = subcommands.find((subcommand) => subcommand.name === 'registry');
      if (!registry) throw new Error('expected registry subcommand');
      return registry;
    }

    function healthyDeps() {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/a']),
        add: async () => ok(undefined),
        exists: async () => ok(true),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const manifest: ManifestPort = {
        load: async () => ok({ service: 'svc', container: 'ctr', sharedBranch: 'development', modules: {} }),
      };
      return { registry: registryPort, manifest };
    }

    it('validates a healthy repo as valid', async () => {
      const registry = findRegistry(buildTestSubcommands(healthyDeps()));

      const result = await registry.run(['validate']);

      expect(result).toEqual({ ok: true, data: { results: [{ path: '/repo/a', outcome: 'valid' }] } });
    });

    it('reports a missing sharedBranch as invalid with shared-branch-missing', async () => {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/a']),
        add: async () => ok(undefined),
        exists: async () => ok(true),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const manifest: ManifestPort = {
        load: async () => ok({ service: 'svc', container: 'ctr', sharedBranch: 'release', modules: {} }),
      };
      const subcommands = buildTestSubcommands({
        registry: registryPort,
        manifest,
        git: fakeGitPort({ branchExistsLocally: async () => ok(false) }),
      });
      const validate = subcommands.find((subcommand) => subcommand.name === 'registry');
      if (!validate) throw new Error('expected registry subcommand');

      const result = await validate.run(['validate']);

      expect(result).toMatchObject({
        ok: true,
        data: { results: [{ path: '/repo/a', outcome: 'invalid', detail: { code: 'shared-branch-missing' } }] },
      });
    });

    it('reports an unreachable path as unreachable', async () => {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/gone']),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort }));

      const result = await registry.run(['validate']);

      expect(result).toEqual({ ok: true, data: { results: [{ path: '/repo/gone', outcome: 'unreachable' }] } });
    });

    it('surfaces a loader failure with its exact code as invalid', async () => {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/a']),
        add: async () => ok(undefined),
        exists: async () => ok(true),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const manifest: ManifestPort = { load: async () => err('unknown-module', 'Unknown module id "bogus"') };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort, manifest }));

      const result = await registry.run(['validate']);

      expect(result).toEqual({
        ok: true,
        data: { results: [{ path: '/repo/a', outcome: 'invalid', detail: { code: 'unknown-module', message: 'Unknown module id "bogus"' } }] },
      });
    });

    it('maps a git-read error to inconclusive', async () => {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/a']),
        add: async () => ok(undefined),
        exists: async () => ok(true),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const manifest: ManifestPort = {
        load: async () => ok({ service: 'svc', container: 'ctr', sharedBranch: 'development', modules: {} }),
      };
      const git = fakeGitPort({
        branchExistsLocally: async () => err('git-branch-check-error', 'Cannot verify branch state'),
      });
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort, manifest, git }));

      const result = await registry.run(['validate']);

      expect(result).toMatchObject({
        ok: true,
        data: { results: [{ path: '/repo/a', outcome: 'inconclusive', detail: { code: 'git-branch-check-error' } }] },
      });
    });

    it('rejects excess args with invalid-argument and a validate usage', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const result = await registry.run(['validate', 'extra']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      if (!result.ok) {
        expect(result.error.message).toContain('tui-back registry validate');
      }
    });

    it('returns an explicit empty results list for an empty registry, exit 0 shape', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const result = await registry.run(['validate']);

      expect(result).toEqual({ ok: true, data: { results: [] } });
    });
  });

  describe('registry clean — interactive TTY flow', () => {
    function findRegistry(subcommands: ReturnType<typeof buildTestSubcommands>) {
      const registry = subcommands.find((subcommand) => subcommand.name === 'registry');
      if (!registry) throw new Error('expected registry subcommand');
      return registry;
    }

    it('a confirmed ("y") answer prints the candidate list and removes exactly those paths', async () => {
      const remove = vi.fn(async () => ok(undefined));
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/gone']),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove,
      };
      const question = vi.fn(async () => 'y');
      const close = vi.fn();
      vi.mocked(createInterface).mockReturnValue({ question, close } as unknown as ReturnType<typeof createInterface>);
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        const registry = findRegistry(buildTestSubcommands({ registry: registryPort, isTTY: true }));

        const result = await registry.run(['clean']);

        expect(result).toEqual({
          ok: true,
          data: {
            candidates: [{ path: '/repo/gone', reason: 'unreachable', memberOfEdts: [] }],
            errors: [],
            results: [{ path: '/repo/gone', outcome: 'removed' }],
          },
        });
        expect(remove).toHaveBeenCalledWith('/repo/gone');
        expect(close).toHaveBeenCalled();
        expect(question).toHaveBeenCalled();
        const printed = writeSpy.mock.calls.map((call) => String(call[0])).join('');
        expect(printed).toContain('/repo/gone');
        expect(printed).toContain('unreachable');
      } finally {
        writeSpy.mockRestore();
      }
    });

    it('a declined ("n") answer prints the list but never calls registry.remove, returning empty results', async () => {
      const remove = vi.fn(async () => ok(undefined));
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/gone']),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove,
      };
      const question = vi.fn(async () => 'n');
      const close = vi.fn();
      vi.mocked(createInterface).mockReturnValue({ question, close } as unknown as ReturnType<typeof createInterface>);
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        const registry = findRegistry(buildTestSubcommands({ registry: registryPort, isTTY: true }));

        const result = await registry.run(['clean']);

        expect(result).toEqual({
          ok: true,
          data: {
            candidates: [{ path: '/repo/gone', reason: 'unreachable', memberOfEdts: [] }],
            errors: [],
            results: [],
          },
        });
        expect(remove).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
        const printed = writeSpy.mock.calls.map((call) => String(call[0])).join('');
        expect(printed).toContain('/repo/gone');
      } finally {
        writeSpy.mockRestore();
      }
    });
  });
});
