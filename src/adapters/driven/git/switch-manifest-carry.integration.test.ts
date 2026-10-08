// Real git + real carry adapter: a dirty .tui-back.yaml survives a switch byte for byte.
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitPort } from './index.js';
import { createManifestCarryPort } from '../manifest/carry.js';
import { loadManifest } from '../manifest/index.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { LockPort } from '../../../core/ports/lock.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { StatePort } from '../../../core/ports/state.js';
import { ok } from '../../../core/result.js';
import { switchActiveEdt } from '../../../core/edt/switch.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const manifestText = (service: string) => `service: ${service}\ncontainer: ${service}\nsharedBranch: development\nmodules: {}\n`;

function git(dir: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

// `development` carries `onDevelopment` as its manifest (null: none); `feat/x` (current) carries
// `onFeature`, which the test then dirties.
async function makeRepo(onDevelopment: string | null, onFeature: string | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'switch-carry-'));
  dirs.push(dir);
  git(dir, 'init', '-b', 'development');
  git(dir, 'config', 'user.email', 't@t.test');
  git(dir, 'config', 'user.name', 't');
  await writeFile(join(dir, 'base.txt'), 'base');
  if (onDevelopment !== null) await writeFile(join(dir, '.tui-back.yaml'), onDevelopment);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'init');
  git(dir, 'checkout', '-b', 'feat/x');
  if (onFeature === null) {
    if (onDevelopment !== null) git(dir, 'rm', '-q', '.tui-back.yaml');
  } else {
    await writeFile(join(dir, '.tui-back.yaml'), onFeature);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '--allow-empty', '-m', 'feature');
  return dir;
}

const OUTGOING: EdtRegistryEntry = { ulid: 'out', topic: 'out', createdAt: '2026-10-08T00:00:00.000Z', status: 'active', members: [] };
const TARGET: EdtRegistryEntry = { ulid: 'tgt', topic: 'tgt', createdAt: '2026-10-08T00:00:00.000Z', status: 'inactive', members: [] };

async function runSwitch(
  repo: string,
  members: EdtRegistryEntry['members'] = [],
  dirtyResolutions: Parameters<typeof switchActiveEdt>[0]['dirtyResolutions'] = {},
  targetMembers: EdtRegistryEntry['members'] = [],
) {
  const outgoing = { ...OUTGOING, members };
  const target = { ...TARGET, members: targetMembers };
  const edtRegistry = {
    list: async () => ok([outgoing, target]),
    setStatus: async () => ok(undefined),
  } as unknown as EdtRegistryPort;
  const registry = { list: async () => ok([repo]) } as unknown as RegistryPort;
  const state = { readActiveEdt: async () => ok('out'), writeActiveEdt: async () => ok(undefined) } as unknown as StatePort;
  const lock = {
    acquire: async () => ok({ release: async () => ok(undefined) }),
    peek: async () => ok({ locked: false }),
  } as unknown as LockPort;
  const manifest = { load: loadManifest };
  return switchActiveEdt({
    edtRegistry,
    registry,
    manifest,
    manifestCarry: createManifestCarryPort(),
    git: createGitPort(manifest, edtRegistry),
    lock,
    state,
    edtRegistryResourceKey: 'edts',
    topic: 'tgt',
    dirtyResolutions,
  });
}

const read = (repo: string) => readFile(join(repo, '.tui-back.yaml'), 'utf8');

describe('switchActiveEdt — dirty .tui-back.yaml with real git', () => {
  it('keeps a modified tracked manifest that differs on the target branch', async () => {
    const repo = await makeRepo(manifestText('dev'), manifestText('feat'));
    await writeFile(join(repo, '.tui-back.yaml'), manifestText('local-edit'));

    const result = await runSwitch(repo);

    expect(result.ok && result.data.results).toEqual([{ service: 'local-edit', outcome: 'switched' }]);
    expect(git(repo, 'branch', '--show-current').trim()).toBe('development');
    expect(await read(repo)).toBe(manifestText('local-edit'));
    expect(git(repo, 'stash', 'list')).toBe('');
    expect(existsSync(join(repo, '.git', 'tui-back-manifest-carry'))).toBe(false);
  });

  it('keeps an untracked manifest that the target branch tracks', async () => {
    const repo = await makeRepo(manifestText('dev'), null);
    await writeFile(join(repo, '.tui-back.yaml'), manifestText('untracked-local'));

    const result = await runSwitch(repo);

    expect(result.ok && result.data.results).toEqual([{ service: 'untracked-local', outcome: 'switched' }]);
    expect(await read(repo)).toBe(manifestText('untracked-local'));
  });

  it('keeps a deleted manifest deleted, even when the switch itself cannot proceed without it', async () => {
    const repo = await makeRepo(manifestText('dev'), manifestText('feat'));
    await rm(join(repo, '.tui-back.yaml'));

    const result = await runSwitch(repo);

    // A non-member with no readable manifest has no destination: the row fails, repo untouched.
    expect(result.ok && result.data.results[0]).toMatchObject({ outcome: 'failed', detail: { code: 'manifest-not-found' } });
    expect(git(repo, 'branch', '--show-current').trim()).toBe('feat/x');
    expect(existsSync(join(repo, '.tui-back.yaml'))).toBe(false);
  });

  it('keeps a modified manifest that the target branch does not have', async () => {
    const repo = await makeRepo(null, manifestText('feat'));
    await writeFile(join(repo, '.tui-back.yaml'), manifestText('local-edit'));
    // `development` has no manifest, so its shared branch is read before the checkout, from the current tree.

    const result = await runSwitch(repo);

    expect(result.ok && result.data.results[0]?.outcome).toBe('switched');
    expect(git(repo, 'branch', '--show-current').trim()).toBe('development');
    expect(await read(repo)).toBe(manifestText('local-edit'));
  });

  it('stashes the other dirty work of an outgoing member but leaves the manifest out of the stash', async () => {
    const repo = await makeRepo(manifestText('dev'), manifestText('feat'));
    await writeFile(join(repo, '.tui-back.yaml'), manifestText('local-edit'));
    await writeFile(join(repo, 'work.txt'), 'wip');

    const result = await runSwitch(repo, [{ service: 'feat', repoPath: repo, branch: 'feat/x' }]);

    expect(result.ok && result.data.results[0]?.outcome).toBe('switched');
    expect(await read(repo)).toBe(manifestText('local-edit'));
    expect(existsSync(join(repo, 'work.txt'))).toBe(false);
    expect(git(repo, 'stash', 'show', '--include-untracked', '--name-only', 'stash@{0}').trim()).toBe('work.txt');
  });

  it('discards the other dirty work of a non-member but never the manifest', async () => {
    const repo = await makeRepo(manifestText('dev'), manifestText('feat'));
    await writeFile(join(repo, '.tui-back.yaml'), manifestText('local-edit'));
    await writeFile(join(repo, 'base.txt'), 'changed');
    await writeFile(join(repo, 'scratch.txt'), 'x');

    const result = await runSwitch(repo, [], { [repo]: { kind: 'discard' } });

    expect(result.ok && result.data.results[0]).toMatchObject({
      outcome: 'discarded',
      detail: { discardedPaths: ['base.txt', 'scratch.txt'] },
    });
    expect(await read(repo)).toBe(manifestText('local-edit'));
    expect(existsSync(join(repo, 'scratch.txt'))).toBe(false);
  });

  it('asks for no resolution when the manifest is the only dirty path of a non-member', async () => {
    const repo = await makeRepo(manifestText('dev'), manifestText('feat'));
    await writeFile(join(repo, '.tui-back.yaml'), manifestText('local-edit'));

    const result = await runSwitch(repo, [], undefined);

    expect(result.ok && result.data.results[0]?.outcome).toBe('switched');
    expect(git(repo, 'branch', '--show-current').trim()).toBe('development');
    expect(git(repo, 'stash', 'list')).toBe('');
    expect(await read(repo)).toBe(manifestText('local-edit'));
  });

  it('carries a deleted manifest across a successful switch into a target member branch', async () => {
    const repo = await makeRepo(manifestText('dev'), manifestText('feat'));
    git(repo, 'checkout', '-q', '-b', 'feat/target');
    git(repo, 'checkout', '-q', 'feat/x');
    await rm(join(repo, '.tui-back.yaml'));

    const result = await runSwitch(repo, [], {}, [{ service: 'feat', repoPath: repo, branch: 'feat/target' }]);

    expect(result.ok && result.data.results).toEqual([{ service: 'feat', outcome: 'switched' }]);
    expect(git(repo, 'branch', '--show-current').trim()).toBe('feat/target');
    expect(existsSync(join(repo, '.tui-back.yaml'))).toBe(false);
  });
});
