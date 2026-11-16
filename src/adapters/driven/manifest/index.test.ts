// adapters/driven/manifest: integration tests against real temp dirs + real files
// (AD-13). node:fs is deliberately not mocked — this adapter's whole contract is how
// the real filesystem manifests surface as Result errors (manifest-not-found vs
// manifest-read-error vs manifest-invalid-yaml vs manifest-validation-failed).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest } from './index.js';

const tmpDirs: string[] = [];

async function tempRepo(manifestContent: string | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-manifest-'));
  tmpDirs.push(dir);
  if (manifestContent !== null) {
    await writeFile(join(dir, '.tui-back.yaml'), manifestContent);
  }
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('loadManifest', () => {
  it('loads a valid manifest and exposes identity/modules as-is', async () => {
    const repo = await tempRepo(
      [
        'service: route-explorer',
        'container: route-explorer',
        'migrationCommand: npm run migration:run',
        'sharedBranch: development',
        'modules:',
        '  route-explorer:',
        '    scanner: nestjs-openapi',
        '    auth: jose-dev-jwt',
        '  shared-types-consumer: {}',
        '',
      ].join('\n'),
    );

    const result = await loadManifest(repo, {
      knownModuleIds: new Set(['route-explorer', 'shared-types-consumer']),
    });

    expect(result).toEqual({
      ok: true,
      data: {
        service: 'route-explorer',
        container: 'route-explorer',
        migrationCommand: 'npm run migration:run',
        sharedBranch: 'development',
        modules: {
          'route-explorer': { scanner: 'nestjs-openapi', auth: 'jose-dev-jwt' },
          'shared-types-consumer': { dependency: '@ianord/shared-types', packageJsonPath: 'package.json' },
        },
      },
    });
  });

  it('fails with a clear validation error naming the missing field, no throw', async () => {
    const repo = await tempRepo(
      ['container: route-explorer', 'migrationCommand: migrate', 'modules: {}'].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'manifest-validation-failed',
        message: expect.stringContaining('service'),
      },
    });
    if (!result.ok) {
      expect(result.error.details).toBeDefined();
      expect(result.error.details).toHaveProperty('issues');
    }
  });

  it('loads a manifest omitting container as having no Docker runtime', async () => {
    const repo = await tempRepo(['service: shared-types', 'modules: {}'].join('\n'));

    const result = await loadManifest(repo);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.container).toBeUndefined();
    }
  });

  it.each([['""'], ['"   "']])('rejects a present-but-blank container (%s) naming the field', async (entry) => {
    const repo = await tempRepo(['service: shared-types', `container: ${entry}`, 'modules: {}'].join('\n'));

    const result = await loadManifest(repo);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'manifest-validation-failed',
        message: expect.stringContaining('container'),
      },
    });
  });

  it('rejects an explicit null container naming the field (omit the key instead)', async () => {
    const repo = await tempRepo(['service: shared-types', 'container: null', 'modules: {}'].join('\n'));

    const result = await loadManifest(repo);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'manifest-validation-failed',
        message: expect.stringContaining('container'),
      },
    });
  });

  it('loads a manifest omitting migrationCommand as having no migrations', async () => {
    const repo = await tempRepo(
      ['service: route-explorer', 'container: route-explorer', 'modules: {}'].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.migrationCommand).toBeUndefined();
    }
  });

  it('rejects a present-but-empty migrationCommand instead of treating it as absent', async () => {
    const repo = await tempRepo(
      [
        'service: route-explorer',
        'container: route-explorer',
        'migrationCommand: "   "',
        'modules: {}',
      ].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'manifest-validation-failed',
        message: expect.stringContaining('migrationCommand'),
      },
    });
  });

  it('loads a manifest omitting restartCommands as having no clean-restart recipe', async () => {
    const repo = await tempRepo(
      ['service: route-explorer', 'container: route-explorer', 'modules: {}'].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.restartCommands).toBeUndefined();
    }
  });

  it('loads a manifest declaring an ordered restartCommands recipe as-is', async () => {
    const repo = await tempRepo(
      [
        'service: route-explorer',
        'container: route-explorer',
        'restartCommands:',
        '  - npm ci',
        '  - docker compose up -d --build',
        'modules: {}',
      ].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({
      ok: true,
      data: { restartCommands: ['npm ci', 'docker compose up -d --build'] },
    });
  });

  it('rejects a recipe containing a blank entry instead of running it', async () => {
    const repo = await tempRepo(
      [
        'service: route-explorer',
        'container: route-explorer',
        'restartCommands:',
        '  - npm ci',
        '  - "   "',
        'modules: {}',
      ].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'manifest-validation-failed',
        message: expect.stringContaining('restartCommands'),
      },
    });
  });

  describe('healthUrl', () => {
    const base = ['service: route-explorer', 'container: route-explorer', 'modules: {}'];

    it('leaves healthUrl undefined when the manifest omits it', async () => {
      const result = await loadManifest(await tempRepo(base.join('\n')));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.healthUrl).toBeUndefined();
      }
    });

    it.each([['http://localhost:3000/health'], ['https://svc.example/ping']])('accepts %s', async (url) => {
      const result = await loadManifest(await tempRepo([...base, `healthUrl: ${url}`].join('\n')));

      expect(result).toMatchObject({ ok: true, data: { healthUrl: url } });
    });

    it.each([['""'], ['"   "'], ['localhost:3000/health'], ['ftp://host/x'], ['"http://"']])(
      'rejects %s with a precise message',
      async (value) => {
        const result = await loadManifest(await tempRepo([...base, `healthUrl: ${value}`].join('\n')));

        expect(result).toMatchObject({
          ok: false,
          error: { code: 'manifest-validation-failed', message: expect.stringContaining('healthUrl') },
        });
      },
    );
  });

  describe('protectedBranches', () => {
    const base = ['service: route-explorer', 'container: route-explorer', 'modules: {}'];

    it('leaves protectedBranches undefined when the manifest omits it', async () => {
      const repo = await tempRepo(base.join('\n'));

      const result = await loadManifest(repo);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.protectedBranches).toBeUndefined();
      }
    });

    it('trims each entry and tolerates duplicates', async () => {
      const repo = await tempRepo(
        [...base, 'protectedBranches:', '  - " preprod "', '  - prod', '  - prod'].join('\n'),
      );

      const result = await loadManifest(repo);

      expect(result).toMatchObject({
        ok: true,
        data: { protectedBranches: ['preprod', 'prod', 'prod'] },
      });
    });

    it('rejects a non-list value as a schema error', async () => {
      const repo = await tempRepo([...base, 'protectedBranches: preprod'].join('\n'));

      const result = await loadManifest(repo);

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'manifest-validation-failed',
          message: expect.stringContaining('protectedBranches'),
        },
      });
    });

    it.each([['""'], ['"   "']])('rejects an empty or blank entry (%s) as a schema error', async (entry) => {
      const repo = await tempRepo([...base, 'protectedBranches:', `  - ${entry}`].join('\n'));

      const result = await loadManifest(repo);

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'manifest-validation-failed',
          message: expect.stringContaining('protectedBranches'),
        },
      });
    });
  });

  it('treats a repo with no .tui-back.yaml as unmanaged, no throw', async () => {
    const repo = await tempRepo(null);

    const result = await loadManifest(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });

  it('defaults sharedBranch to development when absent', async () => {
    const repo = await tempRepo(
      ['service: route-explorer', 'container: route-explorer', 'migrationCommand: migrate', 'modules: {}'].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({ ok: true, data: { sharedBranch: 'development' } });
  });

  it('preserves an explicit sharedBranch instead of defaulting it', async () => {
    const repo = await tempRepo(
      [
        'service: route-explorer',
        'container: route-explorer',
        'migrationCommand: migrate',
        'sharedBranch: preprod',
        'modules: {}',
      ].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({ ok: true, data: { sharedBranch: 'preprod' } });
  });

  it('rejects a bare-boolean module config with a path-naming issue (Finding-6 invariant)', async () => {
    const repo = await tempRepo(
      [
        'service: route-explorer',
        'container: route-explorer',
        'migrationCommand: migrate',
        'modules:',
        '  shared-types-consumer: true',
      ].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'manifest-validation-failed' },
    });
    if (!result.ok) {
      const issues = (result.error.details as { issues: { path: string[] }[] }).issues;
      expect(issues).toHaveLength(1);
      expect(issues[0].path.join('.')).toBe('modules.shared-types-consumer');
      expect(result.error.message).toContain('modules.shared-types-consumer');
    }
  });

  it('reports malformed YAML as manifest-invalid-yaml, no throw', async () => {
    const repo = await tempRepo('a: [unclosed');

    const result = await loadManifest(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-invalid-yaml' } });
  });

  it('reports an empty file as a clean validation failure, not a crash', async () => {
    const repo = await tempRepo('');

    const result = await loadManifest(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-validation-failed' } });
  });

  it('reports an unreadable path as a controlled read error, never a throw', async () => {
    const repo = await tempRepo(null);
    const plainFile = join(repo, 'some-file.txt');
    await writeFile(plainFile, 'not a dir');

    const result = await loadManifest(plainFile);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('manifest-read-error');
    }
  });

  it('rejects unknown top-level keys (strict schema)', async () => {
    const repo = await tempRepo(
      [
        'service: route-explorer',
        'container: route-explorer',
        'migrationCommand: migrate',
        'shared_branch: preprod',
        'modules: {}',
      ].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'manifest-validation-failed',
        message: expect.stringContaining('shared_branch'),
      },
    });
  });

  it('reports a manifest missing the modules key as a validation failure', async () => {
    const repo = await tempRepo(
      ['service: route-explorer', 'container: route-explorer', 'migrationCommand: migrate'].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-validation-failed' } });
  });

  it('rejects an empty sharedBranch instead of defaulting it', async () => {
    const repo = await tempRepo(
      [
        'service: route-explorer',
        'container: route-explorer',
        'migrationCommand: migrate',
        'sharedBranch: ""',
        'modules: {}',
      ].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'manifest-validation-failed',
        message: expect.stringContaining('sharedBranch'),
      },
    });
  });

  it('rejects whitespace-only required fields', async () => {
    const repo = await tempRepo(
      ['service: "   "', 'container: route-explorer', 'migrationCommand: migrate', 'modules: {}'].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'manifest-validation-failed',
        message: expect.stringContaining('service'),
      },
    });
  });

  it('names the root for a non-object document, no blank field', async () => {
    const repo = await tempRepo('- a\n- b\n');

    const result = await loadManifest(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-validation-failed' } });
    if (!result.ok) {
      expect(result.error.message).toContain('(root)');
    }
  });

  it('names a field when multiple required fields are missing', async () => {
    const repo = await tempRepo('modules: {}\n');

    const result = await loadManifest(repo);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'manifest-validation-failed',
        message: expect.stringContaining('service'),
      },
    });
  });

  it('rejects a non-object module config (array)', async () => {
    const repo = await tempRepo(
      [
        'service: route-explorer',
        'container: route-explorer',
        'migrationCommand: migrate',
        'modules:',
        '  shared-types-consumer: [a, b]',
      ].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-validation-failed' } });
    if (!result.ok) {
      const issues = (result.error.details as { issues: { path: string[] }[] }).issues;
      expect(issues[0].path.join('.')).toBe('modules.shared-types-consumer');
    }
  });

  it('loads an empty modules map against the empty production registry', async () => {
    const repo = await tempRepo(
      ['service: route-explorer', 'container: route-explorer', 'migrationCommand: migrate', 'modules: {}'].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({ ok: true, data: { modules: {} } });
  });

  it('fails with unknown-module naming the id and repo path for an unknown id', async () => {
    const repo = await tempRepo(
      ['service: route-explorer', 'container: route-explorer', 'migrationCommand: migrate', 'modules:', '  bogus-module: {}'].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-module' } });
    if (!result.ok) {
      expect(result.error.message).toContain('bogus-module');
      expect(result.error.message).toContain(repo);
    }
  });

  it('loads a known module id when the registry is injected', async () => {
    const repo = await tempRepo(
      ['service: route-explorer', 'container: route-explorer', 'migrationCommand: migrate', 'modules:', '  route-explorer: {}'].join('\n'),
    );

    const result = await loadManifest(repo, { knownModuleIds: new Set(['route-explorer']) });

    expect(result).toMatchObject({ ok: true, data: { modules: { 'route-explorer': {} } } });
  });

  it('fails naming the first unknown id in sorted order for multiple unknown ids', async () => {
    const repo = await tempRepo(
      ['service: s', 'container: c', 'migrationCommand: migrate', 'modules:', '  z-mod: {}', '  a-mod: {}'].join('\n'),
    );

    const result = await loadManifest(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-module' } });
    if (!result.ok) {
      expect(result.error.message).toContain('"a-mod"');
      expect(result.error.message).not.toContain('"z-mod"');
    }
  });

  it('fails with unknown-module when only one of several ids is unknown', async () => {
    const repo = await tempRepo(
      ['service: s', 'container: c', 'migrationCommand: migrate', 'modules:', '  known-mod: {}', '  unknown-x: {}'].join('\n'),
    );

    const result = await loadManifest(repo, { knownModuleIds: new Set(['known-mod']) });

    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-module' } });
    if (!result.ok) {
      expect(result.error.message).toContain('unknown-x');
    }
  });
});

describe('loadManifest shared-types module parameters', () => {
  const head = ['service: svc', 'migrationCommand: migrate', 'modules:'];

  it('fills source defaults for an empty config, with no container', async () => {
    const repo = await tempRepo([...head, '  shared-types-source: {}'].join('\n'));
    const result = await loadManifest(repo);
    expect(result).toMatchObject({
      ok: true,
      data: {
        modules: { 'shared-types-source': { publishCommand: 'npm run v', packageName: '@ianord/shared-types', registry: 'https://npm.ianord.fr' } },
      },
    });
  });

  it('loads a custom source registry and rejects a blank one', async () => {
    const custom = await loadManifest(await tempRepo([...head, '  shared-types-source:', '    registry: https://npm.example'].join('\n')));
    expect(custom).toMatchObject({ ok: true, data: { modules: { 'shared-types-source': { registry: 'https://npm.example' } } } });
    const blank = await loadManifest(await tempRepo([...head, '  shared-types-source:', '    registry: ""'].join('\n')));
    expect(blank).toMatchObject({ ok: false });
  });

  it('loads custom consumer parameters as given', async () => {
    const repo = await tempRepo(
      [...head, '  shared-types-consumer:', '    dependency: "@x/y"', '    packageJsonPath: api/package.json'].join('\n'),
    );
    const result = await loadManifest(repo);
    expect(result).toMatchObject({
      ok: true,
      data: { modules: { 'shared-types-consumer': { dependency: '@x/y', packageJsonPath: 'api/package.json' } } },
    });
  });

  it('rejects an unknown parameter naming the module and the parameter', async () => {
    const repo = await tempRepo([...head, '  shared-types-consumer:', '    bogus: 1'].join('\n'));
    const result = await loadManifest(repo);
    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-validation-failed' } });
    if (!result.ok) {
      expect(result.error.message).toContain('shared-types-consumer');
      expect(result.error.message).toContain('bogus');
    }
  });

  it('rejects a blank parameter', async () => {
    const repo = await tempRepo([...head, '  shared-types-source:', '    publishCommand: ""'].join('\n'));
    const result = await loadManifest(repo);
    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-validation-failed' } });
    if (!result.ok) {
      expect(result.error.message).toContain('publishCommand');
    }
  });
});
