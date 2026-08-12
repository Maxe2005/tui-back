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
  it('loads a valid manifest and exposes identity/modules as-is (AC1, AC5)', async () => {
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

    const result = await loadManifest(repo);

    expect(result).toEqual({
      ok: true,
      data: {
        service: 'route-explorer',
        container: 'route-explorer',
        migrationCommand: 'npm run migration:run',
        sharedBranch: 'development',
        modules: {
          'route-explorer': { scanner: 'nestjs-openapi', auth: 'jose-dev-jwt' },
          'shared-types-consumer': {},
        },
      },
    });
  });

  it('fails with a clear validation error naming the missing field (AC2), no throw', async () => {
    const repo = await tempRepo(['service: route-explorer', 'container: route-explorer', 'modules: {}'].join('\n'));

    const result = await loadManifest(repo);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'manifest-validation-failed',
        message: expect.stringContaining('migrationCommand'),
      },
    });
    if (!result.ok) {
      expect(result.error.details).toBeDefined();
      expect(result.error.details).toHaveProperty('issues');
    }
  });

  it('treats a repo with no .tui-back.yaml as unmanaged (AC3), no throw', async () => {
    const repo = await tempRepo(null);

    const result = await loadManifest(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });

  it('defaults sharedBranch to development when absent (AC4)', async () => {
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
});
