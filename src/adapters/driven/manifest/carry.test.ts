import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifestCarryPort } from './carry.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repoDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'carry-'));
  dirs.push(dir);
  await mkdir(join(dir, '.git'));
  return dir;
}

describe('createManifestCarryPort', () => {
  it('captures exact bytes, keeps a safety copy and restores them', async () => {
    const repo = await repoDir();
    const bytes = Buffer.from([0x73, 0x3a, 0x20, 0xff, 0x0a]);
    await writeFile(join(repo, '.tui-back.yaml'), bytes);
    const port = createManifestCarryPort();

    const captured = await port.capture(repo);
    expect(captured).toMatchObject({ ok: true, data: { kind: 'present' } });
    expect(existsSync(join(repo, '.git', 'tui-back-manifest-carry'))).toBe(true);

    await writeFile(join(repo, '.tui-back.yaml'), 'other');
    if (!captured.ok) throw new Error('capture failed');
    expect(await port.restore(repo, captured.data)).toEqual({ ok: true, data: undefined });
    expect(Buffer.compare(await readFile(join(repo, '.tui-back.yaml')), bytes)).toBe(0);
    expect(existsSync(join(repo, '.git', 'tui-back-manifest-carry'))).toBe(false);
  });

  it('captures an absent manifest and restores it as absent', async () => {
    const repo = await repoDir();
    const port = createManifestCarryPort();

    const captured = await port.capture(repo);
    expect(captured).toEqual({ ok: true, data: { kind: 'absent' } });

    await writeFile(join(repo, '.tui-back.yaml'), 'appeared');
    await port.restore(repo, { kind: 'absent' });
    expect(existsSync(join(repo, '.tui-back.yaml'))).toBe(false);
  });

  it('keeps the safety copy and names it when the restore fails', async () => {
    const repo = await repoDir();
    await writeFile(join(repo, '.tui-back.yaml'), 'keep me');
    const port = createManifestCarryPort();
    const captured = await port.capture(repo);
    if (!captured.ok) throw new Error('capture failed');

    await rm(join(repo, '.tui-back.yaml'));
    await mkdir(join(repo, '.tui-back.yaml'));

    const restored = await port.restore(repo, captured.data);
    expect(restored).toMatchObject({ ok: false, error: { code: 'manifest-carry-restore-error' } });
    if (restored.ok) throw new Error('expected failure');
    expect(restored.error.message).toContain('tui-back-manifest-carry');
    expect(await readFile(join(repo, '.git', 'tui-back-manifest-carry'), 'utf8')).toBe('keep me');
  });

  it('refuses to overwrite a safety copy left by an earlier failed restore', async () => {
    const repo = await repoDir();
    await writeFile(join(repo, '.tui-back.yaml'), 'new');
    await writeFile(join(repo, '.git', 'tui-back-manifest-carry'), 'unrecovered');

    const captured = await createManifestCarryPort().capture(repo);

    expect(captured).toMatchObject({ ok: false, error: { code: 'manifest-carry-stale-copy' } });
    expect(await readFile(join(repo, '.git', 'tui-back-manifest-carry'), 'utf8')).toBe('unrecovered');
  });

  it('keeps its safety copy in the real git dir of a worktree', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'carry-wt-'));
    dirs.push(repo);
    const realGitDir = await mkdtemp(join(tmpdir(), 'carry-gitdir-'));
    dirs.push(realGitDir);
    await writeFile(join(repo, '.git'), `gitdir: ${realGitDir}\n`);
    await writeFile(join(repo, '.tui-back.yaml'), 'wt');
    const port = createManifestCarryPort();

    const captured = await port.capture(repo);

    expect(existsSync(join(realGitDir, 'tui-back-manifest-carry'))).toBe(true);
    if (!captured.ok) throw new Error('capture failed');
    await port.restore(repo, captured.data);
    expect(existsSync(join(realGitDir, 'tui-back-manifest-carry'))).toBe(false);
    expect(existsSync(join(repo, '.tui-back.yaml.carry-tmp'))).toBe(false);
  });
});
