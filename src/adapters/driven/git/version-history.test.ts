// adapters/driven/git: the read-only version-history primitives against a real temp repo —
// bumps newest first, depth/scan bounds, abort, unknown ref, branches containing a commit.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { VersionBump } from '../../../core/ports/git.js';
import { err } from '../../../core/result.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import { createGitPort, listBranchesContaining, listVersionBumpCommits } from './index.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// A hermetic git: no user/system config (signing, hooks, templates) leaks into the fixtures.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

function git(dir: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...GIT_ENV, ...env } });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function bumpRaw(dir: string, content: string, label: string, date: string): Promise<string> {
  await writeFile(join(dir, 'package.json'), content);
  git(dir, ['add', 'package.json']);
  git(dir, ['commit', '-m', label], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return git(dir, ['rev-parse', 'HEAD']);
}

async function bump(dir: string, version: string, date: string): Promise<string> {
  return bumpRaw(dir, `{\n  "name": "@x/shared-types",\n  "version": "${version}",\n  "private": true\n}\n`, `bump ${version}`, date);
}

async function makeRepo(versions: string[]): Promise<{ dir: string; commits: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-history-'));
  dirs.push(dir);
  git(dir, ['init', '-b', 'development']);
  git(dir, ['config', 'user.email', 'h@tui-back.test']);
  git(dir, ['config', 'user.name', 'history test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  const commits: string[] = [];
  let day = 1;
  for (const version of versions) {
    commits.push(await bump(dir, version, `2026-01-${String(day).padStart(2, '0')}T10:00:00Z`));
    day += 1;
  }
  return { dir, commits };
}

async function walk(dir: string, ref: string, opts: { limit?: number; maxScanned?: number; signal?: AbortSignal; pickaxeVersion?: string; allRefs?: boolean } = {}) {
  const entries: VersionBump[] = [];
  const result = await listVersionBumpCommits(dir, ref, {
    limit: opts.limit ?? 100,
    maxScanned: opts.maxScanned ?? 1000,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    ...(opts.pickaxeVersion === undefined ? {} : { pickaxeVersion: opts.pickaxeVersion }),
    ...(opts.allRefs === true ? { allRefs: true } : {}),
    onEntry: (bump) => entries.push(bump),
  });
  return { result, entries };
}

describe('listVersionBumpCommits', () => {
  it('lists bumps newest first and reports an exhausted branch', async () => {
    const { dir, commits } = await makeRepo(['0.1.1', '0.1.2', '0.1.3']);
    const { result, entries } = await walk(dir, 'development');
    expect(entries.map((entry) => entry.version)).toEqual(['0.1.3', '0.1.2', '0.1.1']);
    expect(entries[0]?.commit).toBe(commits[2]);
    expect(entries[0]?.date).toContain('2026-01-03');
    expect(result).toEqual({ ok: true, data: { endedBy: 'exhausted', scanned: 3 } });
  });

  it('stops at the depth limit', async () => {
    const { dir } = await makeRepo(['0.1.1', '0.1.2', '0.1.3']);
    const { result, entries } = await walk(dir, 'development', { limit: 2 });
    expect(entries.map((entry) => entry.version)).toEqual(['0.1.3', '0.1.2']);
    expect(result).toMatchObject({ ok: true, data: { endedBy: 'limit' } });
  });

  it('stops at the scan bound and says so', async () => {
    const { dir } = await makeRepo(['0.1.1', '0.1.2', '0.1.3', '0.1.4']);
    const { result, entries } = await walk(dir, 'development', { maxScanned: 2 });
    expect(entries.map((entry) => entry.version)).toEqual(['0.1.4', '0.1.3']);
    expect(result).toEqual({ ok: true, data: { endedBy: 'scanned', scanned: 2 } });
  });

  it('is exhausted, not scanned, when the history has exactly maxScanned commits', async () => {
    const { dir } = await makeRepo(['0.1.1', '0.1.2']);
    const { result } = await walk(dir, 'development', { maxScanned: 2 });
    expect(result).toMatchObject({ ok: true, data: { endedBy: 'exhausted' } });
  });

  it('ignores package.json commits that do not change the version line', async () => {
    const { dir } = await makeRepo(['0.1.1']);
    await writeFile(join(dir, 'package.json'), '{\n  "name": "@x/renamed",\n  "version": "0.1.1",\n  "private": true\n}\n');
    git(dir, ['commit', '-am', 'rename']);
    const { entries } = await walk(dir, 'development');
    expect(entries.map((entry) => entry.version)).toEqual(['0.1.1']);
  });

  it('reports an unknown ref as an error result, not a throw', async () => {
    const { dir } = await makeRepo(['0.1.1']);
    const { result } = await walk(dir, 'no-such-branch');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('git-history-error');
    }
  });

  it('refuses a ref that looks like an option, including --all', async () => {
    const { dir } = await makeRepo(['0.1.1']);
    for (const ref of ['--output=/tmp/x', '--all', '']) {
      expect((await walk(dir, ref)).result.ok).toBe(false);
    }
  });

  it('reads compact and oddly spaced version lines', async () => {
    const { dir } = await makeRepo([]);
    await bumpRaw(dir, '{"name":"x","version":"1.0.0"}\n', 'compact', '2026-01-01T10:00:00Z');
    await bumpRaw(dir, '{\n\t"name": "x",\n\t"version"  :   "1.0.1",\n\t"private": true\n}\n', 'odd', '2026-01-02T10:00:00Z');
    const { entries } = await walk(dir, 'development');
    expect(entries.map((entry) => entry.version)).toEqual(['1.0.1', '1.0.0']);
    const found = await walk(dir, '', { allRefs: true, pickaxeVersion: '1.0.1' });
    expect(found.entries.map((entry) => entry.version)).toEqual(['1.0.1']);
    const compact = await walk(dir, '', { allRefs: true, pickaxeVersion: '1.0.0' });
    expect(compact.entries.map((entry) => entry.version)).toEqual(['1.0.0']);
  });

  it('does not match a version that only shares a prefix (the dots are literal)', async () => {
    const { dir } = await makeRepo(['0.1.37700', '0.1X3770']);
    const { entries } = await walk(dir, '', { allRefs: true, pickaxeVersion: '0.1.3770' });
    expect(entries).toEqual([]);
  });

  it('never returns a commit that exists only on the stash', async () => {
    const { dir } = await makeRepo(['0.1.1']);
    await writeFile(join(dir, 'package.json'), '{\n  "version": "7.7.7"\n}\n');
    git(dir, ['stash', 'push', '-m', 'wip']);
    const { entries } = await walk(dir, '', { allRefs: true, pickaxeVersion: '7.7.7' });
    expect(entries).toEqual([]);
  });

  it('turns a throwing onEntry into an error result and kills the walk', async () => {
    const { dir } = await makeRepo(['0.1.1', '0.1.2']);
    const result = await listVersionBumpCommits(dir, 'development', {
      limit: 10,
      maxScanned: 100,
      onEntry: () => {
        throw new Error('consumer blew up');
      },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'git-history-error' } });
  });

  it('resolves ok with endedBy aborted when the signal is already aborted', async () => {
    const { dir } = await makeRepo(['0.1.1']);
    const controller = new AbortController();
    controller.abort();
    const { result, entries } = await walk(dir, 'development', { signal: controller.signal });
    expect(result).toMatchObject({ ok: true, data: { endedBy: 'aborted' } });
    expect(entries).toEqual([]);
  });

  it('kills the walk when aborted mid-stream', async () => {
    const { dir } = await makeRepo(['0.1.1', '0.1.2', '0.1.3']);
    const controller = new AbortController();
    const entries: string[] = [];
    const result = await listVersionBumpCommits(dir, 'development', {
      limit: 100,
      maxScanned: 1000,
      signal: controller.signal,
      onEntry: (bump) => {
        entries.push(bump.version);
        controller.abort();
      },
    });
    expect(result).toMatchObject({ ok: true, data: { endedBy: 'aborted' } });
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it('is reachable through createGitPort, abort included', async () => {
    const { dir, commits } = await makeRepo(['0.1.1', '0.1.2']);
    const port = createGitPort({ load: async () => err('manifest-not-found', 'none') } as ManifestPort);
    const seen: string[] = [];
    const walked = await port.listVersionBumpCommits(dir, 'development', { limit: 10, maxScanned: 100, onEntry: (bump) => seen.push(bump.version) });
    expect(walked).toEqual({ ok: true, data: { endedBy: 'exhausted', scanned: 2 } });
    expect(seen).toEqual(['0.1.2', '0.1.1']);
    const contained = await port.listBranchesContaining(dir, commits[0] as string);
    expect(contained).toEqual({ ok: true, data: ['development'] });
    const controller = new AbortController();
    controller.abort();
    const aborted = await port.listVersionBumpCommits(dir, 'development', { limit: 10, maxScanned: 100, signal: controller.signal, onEntry: () => {} });
    expect(aborted).toMatchObject({ ok: true, data: { endedBy: 'aborted' } });
    expect(await port.listBranchesContaining(dir, commits[0] as string, controller.signal)).toMatchObject({ ok: false, error: { code: 'git-history-aborted' } });
  });

  it('finds the commit that set a version across all refs (pickaxe)', async () => {
    const { dir, commits } = await makeRepo(['0.1.1', '0.1.2']);
    git(dir, ['checkout', '-b', 'feature']);
    const featureCommit = await bump(dir, '0.1.3770', '2026-02-01T10:00:00Z');
    git(dir, ['checkout', 'development']);
    const { result, entries } = await walk(dir, '', { allRefs: true, pickaxeVersion: '0.1.3770' });
    expect(result).toMatchObject({ ok: true });
    expect(entries.map((entry) => entry.commit)).toEqual([featureCommit]);
    expect(commits).not.toContain(featureCommit);
    const absent = await walk(dir, '', { allRefs: true, pickaxeVersion: '9.9.9' });
    expect(absent.entries).toEqual([]);
  });
});

describe('listBranchesContaining', () => {
  it('lists every branch holding the commit', async () => {
    const { dir, commits } = await makeRepo(['0.1.1', '0.1.2']);
    git(dir, ['branch', 'feature', commits[0] as string]);
    const first = await listBranchesContaining(dir, commits[0] as string);
    expect(first).toMatchObject({ ok: true });
    expect(first.ok && [...first.data].sort()).toEqual(['development', 'feature']);
    const second = await listBranchesContaining(dir, commits[1] as string);
    expect(second.ok && second.data).toEqual(['development']);
  });

  it('excludes the bare remote name and <remote>/HEAD, and includes remote-tracking branches', async () => {
    const { dir, commits } = await makeRepo(['0.1.1']);
    const sha = commits[0] as string;
    git(dir, ['update-ref', 'refs/remotes/origin/feat/x', sha]);
    git(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/feat/x']);
    const result = await listBranchesContaining(dir, sha);
    expect(result.ok && [...result.data].sort()).toEqual(['development', 'origin/feat/x']);
    expect(result.ok && result.data).not.toContain('origin');
    expect(result.ok && result.data).not.toContain('origin/HEAD');
  });

  it('does not list a stash or tag as a branch', async () => {
    const { dir, commits } = await makeRepo(['0.1.1']);
    git(dir, ['tag', 'v1', commits[0] as string]);
    const result = await listBranchesContaining(dir, commits[0] as string);
    expect(result.ok && result.data).toEqual(['development']);
  });

  it('rejects a non-hex commit and reports an unknown commit as an error', async () => {
    const { dir } = await makeRepo(['0.1.1']);
    expect((await listBranchesContaining(dir, '--all')).ok).toBe(false);
    expect((await listBranchesContaining(dir, 'deadbeefdeadbeef')).ok).toBe(false);
  });
});
