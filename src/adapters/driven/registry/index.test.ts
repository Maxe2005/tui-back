// adapters/driven/registry: integration tests against real temp dirs + real files
// (AD-13). node:fs is deliberately not mocked — this adapter's whole contract is how the
// real filesystem manifests as Result errors (registry-invalid-yaml/-format, missing file
// → empty list, scan-root-not-found) and how registry.yaml is persisted/deduped.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  addRegistry,
  listRegistry,
  registryPathExists,
  scanRoot,
  resolveRegistryFile,
} from './index.js';

const tmpDirs: string[] = [];

function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'tui-back-registry-')).then((dir) => {
    tmpDirs.push(dir);
    return dir;
  });
}

async function tempRepo(root: string, name: string, manifest = true): Promise<string> {
  const repo = join(root, name);
  await mkdir(repo, { recursive: true });
  if (manifest) {
    await writeFile(join(repo, '.tui-back.yaml'), 'service: svc\ncontainer: ctr\n');
  }
  return repo;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('resolveRegistryFile', () => {
  it('derives the registry file path from the XDG config dir', () => {
    expect(resolveRegistryFile({ configDir: '/c', dataDir: '/d', stateDir: '/s', cacheDir: '/k' })).toBe(
      join('/c', 'registry.yaml'),
    );
  });
});

describe('addRegistry', () => {
  it('creates configDir and persists the path as a strict { repos } map', async () => {
    const root = await tempRoot();
    const file = join(root, 'tui-back', 'registry.yaml');

    const result = await addRegistry(file, '/abs/repo');

    expect(result).toEqual({ ok: true, data: undefined });
    const content = await readFile(file, 'utf8');
    expect(parse(content)).toEqual({ repos: ['/abs/repo'] });
  });

  it('appends new paths preserving registration order', async () => {
    const root = await tempRoot();
    const file = join(root, 'registry.yaml');

    await addRegistry(file, '/m/a');
    await addRegistry(file, '/m/b');

    expect(parse(await readFile(file, 'utf8'))).toEqual({ repos: ['/m/a', '/m/b'] });
  });

  it('dedupes an already-present path, leaving the file unchanged (FR-1)', async () => {
    const root = await tempRoot();
    const file = join(root, 'registry.yaml');

    await addRegistry(file, '/m/a');
    await addRegistry(file, '/m/a');
    await addRegistry(file, '/m/a');

    expect(parse(await readFile(file, 'utf8'))).toEqual({ repos: ['/m/a'] });
  });

  it('propagates a corrupt existing registry instead of silently overwriting it', async () => {
    const root = await tempRoot();
    const file = join(root, 'registry.yaml');
    await writeFile(file, 'a: [unclosed');

    await expect(addRegistry(file, '/m/a')).resolves.toMatchObject({
      ok: false,
      error: { code: 'registry-invalid-yaml' },
    });
  });
});

describe('listRegistry', () => {
  it('treats a missing registry file as an empty list', async () => {
    const root = await tempRoot();

    await expect(listRegistry(join(root, 'nope.yaml'))).resolves.toEqual({ ok: true, data: [] });
  });

  it('returns the registered paths in file order', async () => {
    const root = await tempRoot();
    const file = join(root, 'registry.yaml');
    await addRegistry(file, '/m/z');
    await addRegistry(file, '/m/a');

    await expect(listRegistry(file)).resolves.toEqual({ ok: true, data: ['/m/z', '/m/a'] });
  });

  it('reports malformed YAML as registry-invalid-yaml, no throw', async () => {
    const root = await tempRoot();
    const file = join(root, 'registry.yaml');
    await writeFile(file, 'a: [unclosed');

    const result = await listRegistry(file);

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-invalid-yaml' } });
  });

  it('reports a wrong-shaped registry as registry-invalid-format, no throw', async () => {
    const root = await tempRoot();
    const file = join(root, 'registry.yaml');
    await writeFile(file, 'repositories: [/m/a]\n');

    const result = await listRegistry(file);

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-invalid-format' } });
  });

  it('reports an empty registry file as a clean format failure, not a crash', async () => {
    const root = await tempRoot();
    const file = join(root, 'registry.yaml');
    await writeFile(file, '');

    const result = await listRegistry(file);

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-invalid-format' } });
  });
});

describe('registryPathExists', () => {
  it('returns true for an existing path and false for a missing one', async () => {
    const root = await tempRoot();
    const existing = await tempRepo(root, 'a');
    const missing = join(root, 'gone');

    await expect(registryPathExists(existing)).resolves.toEqual({ ok: true, data: true });
    await expect(registryPathExists(missing)).resolves.toEqual({ ok: true, data: false });
  });
});

describe('scanRoot', () => {
  it('proposes manifest-carrying dirs under the root, sorted, without registering anything', async () => {
    const root = await tempRoot();
    const repoA = await tempRepo(root, 'b-repo');
    const repoB = await tempRepo(root, 'a-repo');

    const result = await scanRoot(root);

    expect(result).toEqual({ ok: true, data: [repoB, repoA] });
    await expect(readFile(join(root, 'registry.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('proposes the root itself when it carries a manifest', async () => {
    const root = await tempRoot();
    await tempRepo(root, 'nested');
    await writeFile(join(root, '.tui-back.yaml'), 'service: svc\ncontainer: ctr\n');

    const result = await scanRoot(root);

    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toContain(root);
    expect(result.data).toContain(join(root, 'nested'));
  });

  it('skips dot-dirs, node_modules, and nested manifests inside them', async () => {
    const root = await tempRoot();
    const candidate = await tempRepo(root, 'repo');
    await mkdir(join(candidate, 'node_modules', 'dep-with-manifest'), { recursive: true });
    await writeFile(join(candidate, 'node_modules', 'dep-with-manifest', '.tui-back.yaml'), 'service: x\n');
    await mkdir(join(candidate, '.hidden', 'repo-with-manifest'), { recursive: true });
    await writeFile(join(candidate, '.hidden', 'repo-with-manifest', '.tui-back.yaml'), 'service: x\n');

    const result = await scanRoot(root);

    expect(result).toEqual({ ok: true, data: [candidate] });
  });

  it('does not follow directory symlinks', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const target = await tempRepo(outside, 'target');
    await symlink(target, join(root, 'link-to-target'), 'dir');

    const result = await scanRoot(root);

    expect(result).toEqual({ ok: true, data: [] });
  });

  it('returns ok with an empty candidate list for a manifest-less root', async () => {
    const root = await tempRoot();
    await mkdir(join(root, 'plain'), { recursive: true });

    await expect(scanRoot(root)).resolves.toEqual({ ok: true, data: [] });
  });

  it('reports a nonexistent root as scan-root-not-found, no throw', async () => {
    const root = await tempRoot();

    await expect(scanRoot(join(root, 'does-not-exist'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'scan-root-not-found' },
    });
  });

  it('reports a non-directory root as scan-root-not-found', async () => {
    const root = await tempRoot();
    const file = join(root, 'plain.txt');
    await writeFile(file, 'hi');

    await expect(scanRoot(file)).resolves.toMatchObject({
      ok: false,
      error: { code: 'scan-root-not-found' },
    });
  });
});
