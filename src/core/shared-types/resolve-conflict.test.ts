// core/shared-types/resolve-conflict: the block rewrite and the resolution flow against fake
// ports (an in-memory worktree standing in for git).
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../result.js';
import type { GitPort } from '../ports/git.js';
import type { RestartPort } from '../ports/restart.js';
import { autoResolveSharedTypesConflict, hasConflictMarkers, rewriteDependencyBlocks } from './resolve-conflict.js';

const DEP = '@ianord/shared-types';

function conflicted(ours: string, theirs: string): string {
  return `<<<<<<< HEAD\n${ours}=======\n${theirs}>>>>>>> origin/development\n`;
}

function packageJson(body: string): string {
  return `{\n  "dependencies": {\n    "a": "1.0.0",\n${body}    "z": "1.0.0"\n  }\n}\n`;
}

const OURS_LINE = `    "${DEP}": "0.1.20",\n`;
const THEIRS_LINE = `    "${DEP}": "0.1.18",\n`;

describe('rewriteDependencyBlocks', () => {
  it('keeps the ours value when no version is preferred, leaving the rest byte for byte', () => {
    const text = packageJson(conflicted(OURS_LINE, THEIRS_LINE));

    const result = rewriteDependencyBlocks(text, DEP, undefined);

    expect(result).toEqual({ content: packageJson(OURS_LINE), rewritten: 1, mixed: false });
  });

  it('writes the preferred version onto the kept line', () => {
    const text = packageJson(conflicted(OURS_LINE, THEIRS_LINE));

    const result = rewriteDependencyBlocks(text, DEP, '0.1.25');

    expect(result.content).toBe(packageJson(`    "${DEP}": "0.1.25",\n`));
  });

  it('keeps the other conflict blocks and their markers untouched', () => {
    const other = conflicted('    "b": "2.0.0",\n', '    "b": "3.0.0",\n');
    const text = packageJson(conflicted(OURS_LINE, THEIRS_LINE) + other);

    const result = rewriteDependencyBlocks(text, DEP, undefined);

    expect(result.content).toBe(packageJson(OURS_LINE + other));
    expect(result.rewritten).toBe(1);
    expect(hasConflictMarkers(result.content)).toBe(true);
  });

  it('is mixed, and rewrites nothing, when the block differs on other lines too', () => {
    const text = packageJson(conflicted(OURS_LINE + '    "b": "2.0.0",\n', THEIRS_LINE + '    "b": "3.0.0",\n'));

    expect(rewriteDependencyBlocks(text, DEP, '0.1.25')).toEqual({ content: text, rewritten: 0, mixed: true });
  });

  it('is mixed when only one side carries the line', () => {
    const text = packageJson(conflicted(OURS_LINE, ''));

    expect(rewriteDependencyBlocks(text, DEP, undefined).mixed).toBe(true);
  });

  it('handles diff3 base sections and CRLF line endings', () => {
    const text = `<<<<<<< HEAD\r\n${OURS_LINE.replace('\n', '\r\n')}||||||| base\r\n    "${DEP}": "0.1.1",\r\n=======\r\n${THEIRS_LINE.replace('\n', '\r\n')}>>>>>>> x\r\n`;

    expect(rewriteDependencyBlocks(text, DEP, undefined).content).toBe(OURS_LINE.replace('\n', '\r\n'));
  });
});

function fakes(initial: { files?: Record<string, string>; unmerged: string[] }) {
  const files: Record<string, string> = { ...initial.files };
  // A conflicted lockfile carries markers unless the test says the developer resolved it.
  for (const path of initial.unmerged) {
    if (path.endsWith('package-lock.json') && files[path] === undefined) {
      files[path] = '<<<<<<< HEAD\n=======\n>>>>>>> x\n';
    }
  }
  let dirty: string[] = [];
  let unmerged = [...initial.unmerged];
  const order: string[] = [];
  const cwds: string[] = [];
  const git = {
    listUnmergedPaths: vi.fn(async () => ok([...unmerged])),
    readWorktreeFile: vi.fn(async (_repo: string, path: string) => (path in files ? ok(files[path] as string) : err('git-read-error', 'missing'))),
    writeResolvedFile: vi.fn(async (_repo: string, path: string, content: string, opts: { stage: boolean }) => {
      order.push(`write:${path}`);
      files[path] = content;
      if (opts.stage) {
        unmerged = unmerged.filter((entry) => entry !== path);
      }
      return ok(undefined);
    }),
    checkoutSide: vi.fn(async (_repo: string, path: string) => {
      order.push(`ours:${path}`);
      return ok(undefined);
    }),
    listDirtyPaths: vi.fn(async () => ok([...dirty])),
    stagePaths: vi.fn(async (_repo: string, paths: string[]) => {
      order.push(`stage:${paths.join(',')}`);
      unmerged = unmerged.filter((entry) => !paths.includes(entry));
      return ok(undefined);
    }),
  } as unknown as GitPort;
  const restart: RestartPort = {
    run: vi.fn(async (_repo: string, command: string) => {
      order.push(`run:${command}`);
      cwds.push(_repo);
      return ok({ output: '' });
    }),
  };
  return { git, restart, files, order, cwds, setDirty: (paths: string[]) => (dirty = paths), unmerged: () => unmerged };
}

const consumer = { dependency: DEP, packageJsonPath: 'package.json' };

describe('autoResolveSharedTypesConflict', () => {
  it('settles the line, takes the lock from ours, runs npm i and stages the lock, in that order', async () => {
    const f = fakes({
      files: { 'package.json': packageJson(conflicted(OURS_LINE, THEIRS_LINE)) },
      unmerged: ['package.json', 'package-lock.json'],
    });

    const result = await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer, preferredVersion: '0.1.25' });

    expect(result).toEqual({ touched: true });
    expect(f.files['package.json']).toBe(packageJson(`    "${DEP}": "0.1.25",\n`));
    expect(f.order).toEqual(['write:package.json', 'ours:package-lock.json', 'run:npm i', 'stage:package-lock.json']);
    expect(f.unmerged()).toEqual([]);
  });

  it('keeps the consumer own value when nothing was published in the run', async () => {
    const f = fakes({ files: { 'package.json': packageJson(conflicted(OURS_LINE, THEIRS_LINE)) }, unmerged: ['package.json'] });

    await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer });

    expect(f.files['package.json']).toBe(packageJson(OURS_LINE));
  });

  it('defers npm i and the lock while another package.json block still conflicts, without staging', async () => {
    const other = conflicted('    "b": "2.0.0",\n', '    "b": "3.0.0",\n');
    const f = fakes({
      files: { 'package.json': packageJson(conflicted(OURS_LINE, THEIRS_LINE) + other) },
      unmerged: ['package.json', 'package-lock.json'],
    });

    const result = await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer });

    expect(result).toEqual({ touched: true });
    expect(f.restart.run).not.toHaveBeenCalled();
    expect(f.git.checkoutSide).not.toHaveBeenCalled();
    expect((f.git.writeResolvedFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[3]).toEqual({ stage: false });
    expect(f.unmerged()).toEqual(['package.json', 'package-lock.json']);
  });

  it('rerun after the developer resolved and staged package.json regenerates and stages the lock', async () => {
    const f = fakes({ files: { 'package.json': packageJson(OURS_LINE) }, unmerged: ['package-lock.json'] });

    const result = await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer });

    expect(result).toEqual({ touched: true });
    expect(f.order).toEqual(['ours:package-lock.json', 'run:npm i', 'stage:package-lock.json']);
  });

  it('waits for a package.json the developer edited but did not stage yet', async () => {
    const f = fakes({ files: { 'package.json': packageJson(OURS_LINE) }, unmerged: ['package.json', 'package-lock.json'] });

    const result = await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer });

    // package.json carries no marker, so the lock is regenerated; staging package.json stays theirs to do.
    expect(result).toEqual({ touched: true });
    expect(f.unmerged()).toEqual(['package.json']);
  });

  it('does nothing when neither package.json nor the lock is conflicted', async () => {
    const f = fakes({ unmerged: ['src/other.ts'] });

    expect(await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer })).toEqual({ touched: false });
    expect(f.git.readWorktreeFile).not.toHaveBeenCalled();
  });

  it('reports an issue and writes nothing when the block is mixed', async () => {
    const f = fakes({
      files: { 'package.json': packageJson(conflicted(OURS_LINE + '    "b": "2.0.0",\n', THEIRS_LINE + '    "b": "3.0.0",\n')) },
      unmerged: ['package.json', 'package-lock.json'],
    });

    const result = await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer });

    expect(result.touched).toBe(false);
    expect(result.issue).toContain('also differs elsewhere');
    expect(f.git.writeResolvedFile).not.toHaveBeenCalled();
    expect(f.restart.run).not.toHaveBeenCalled();
  });

  it('reports an issue when the dependency line is missing', async () => {
    const text = conflicted('    "b": "2.0.0",\n', '    "b": "3.0.0",\n');
    const f = fakes({ files: { 'package.json': `{\n  "dependencies": {\n${text}  }\n}\n` }, unmerged: ['package.json'] });

    const result = await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer });

    expect(result).toMatchObject({ touched: false, issue: expect.stringContaining('was not found') });
  });

  it('turns an npm i failure into an issue, leaving the lock unstaged', async () => {
    const f = fakes({ files: { 'package.json': packageJson(OURS_LINE) }, unmerged: ['package-lock.json'] });
    (f.restart.run as ReturnType<typeof vi.fn>).mockResolvedValue(err('restart-error', 'ERESOLVE'));

    const result = await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer });

    expect(result.issue).toContain('npm i failed');
    expect(f.git.stagePaths).not.toHaveBeenCalled();
    expect(f.unmerged()).toEqual(['package-lock.json']);
  });

  it('resolves a nested package.json against its own sibling lock', async () => {
    const f = fakes({ files: { 'api/package.json': packageJson(conflicted(OURS_LINE, THEIRS_LINE)) }, unmerged: ['api/package.json', 'api/package-lock.json'] });

    await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer: { dependency: DEP, packageJsonPath: 'api/package.json' } });

    expect(f.order).toEqual(['write:api/package.json', 'ours:api/package-lock.json', 'run:npm i', 'stage:api/package-lock.json']);
  });

  it('never overwrites a lockfile the developer already resolved, but still regenerates and stages it', async () => {
    const f = fakes({ files: { 'package.json': packageJson(OURS_LINE), 'package-lock.json': '{"resolved":true}' }, unmerged: ['package-lock.json'] });

    await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer });

    expect(f.git.checkoutSide).not.toHaveBeenCalled();
    expect(f.order).toEqual(['run:npm i', 'stage:package-lock.json']);
  });

  it('runs npm i in the directory of the consumer package.json', async () => {
    const f = fakes({ files: { 'api/package.json': packageJson(OURS_LINE) }, unmerged: ['api/package-lock.json'] });

    await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer: { dependency: DEP, packageJsonPath: 'api/package.json' } });

    expect(f.cwds).toEqual(['/r/api']);
  });

  it('re-stages package.json with the lock when npm i dirtied it', async () => {
    const f = fakes({ files: { 'package.json': packageJson(OURS_LINE) }, unmerged: ['package-lock.json'] });
    f.setDirty(['package.json']);

    await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer });

    expect(f.order).toContain('stage:package-lock.json,package.json');
  });

  it('does not stage a package.json the developer edited but left unstaged', async () => {
    const f = fakes({ files: { 'package.json': packageJson(OURS_LINE) }, unmerged: ['package.json', 'package-lock.json'] });
    f.setDirty(['package.json']);

    await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer });

    expect(f.order).toContain('stage:package-lock.json');
  });

  it('reports an issue for an unterminated conflict block around the line', async () => {
    const f = fakes({ files: { 'package.json': `{\n  "dependencies": {\n<<<<<<< HEAD\n${OURS_LINE}=======\n${THEIRS_LINE}` }, unmerged: ['package.json'] });

    const result = await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer });

    expect(result).toMatchObject({ touched: false, issue: expect.stringContaining('unterminated') });
    expect(f.git.writeResolvedFile).not.toHaveBeenCalled();
  });

  it('stays silent when the line sits outside the conflicted hunks', async () => {
    const other = conflicted('    "b": "2.0.0",\n', '    "b": "3.0.0",\n');
    const f = fakes({ files: { 'package.json': packageJson(OURS_LINE + other) }, unmerged: ['package.json'] });

    expect(await autoResolveSharedTypesConflict({ git: f.git, restart: f.restart, repoPath: '/r', consumer })).toEqual({ touched: false });
  });
});
