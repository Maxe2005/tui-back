import { describe, expect, it } from 'vitest';
import {
  createInstallSubcommand,
  githubSpecFromRepository,
  isSupportedNode,
  parseNodeMajor,
  removeRcBlock,
  renderRcBlock,
  upsertRcBlock,
  type InstallerPort,
  type NpmOutcome,
} from './install.js';

describe('node version check', () => {
  it('parses the major and gates on 24', () => {
    expect(parseNodeMajor('v24.1.0')).toBe(24);
    expect(parseNodeMajor('garbage')).toBeNull();
    expect(isSupportedNode('v24.0.0')).toBe(true);
    expect(isSupportedNode('v26.2.1')).toBe(true);
    expect(isSupportedNode('v22.12.0')).toBe(false);
    expect(isSupportedNode('nope')).toBe(false);
  });
});

describe('githubSpecFromRepository', () => {
  it('derives github:<owner>/<repo> from common URL shapes', () => {
    expect(githubSpecFromRepository('git+https://github.com/Maxe2005/tui-back.git')).toBe('github:Maxe2005/tui-back');
    expect(githubSpecFromRepository('https://github.com/a/b')).toBe('github:a/b');
    expect(githubSpecFromRepository('git@github.com:a/b.git')).toBe('github:a/b');
    expect(githubSpecFromRepository('github:a/b')).toBe('github:a/b');
    expect(githubSpecFromRepository('https://gitlab.com/a/b.git')).toBeNull();
  });
});

describe('rc block', () => {
  const block = renderRcBlock('/data/tui-back/completion.bash');

  it('renders the documented shape', () => {
    expect(block.split('\n')).toEqual([
      '# >>> tui-back >>>',
      "alias tb='tui-back'",
      "alias tbt='tui-back tui'",
      '[ -f "/data/tui-back/completion.bash" ] && source "/data/tui-back/completion.bash"',
      '# <<< tui-back <<<',
    ]);
  });

  it('appends once, then replaces in place keeping the rest byte for byte', () => {
    const base = 'export A=1\n# mid\n';
    const once = upsertRcBlock(base, block);
    expect(once).toBe(`${base}${block}\n`);
    expect(upsertRcBlock(once, block)).toBe(once);
    const edited = `${base}${block.replace('tb=', 'tb2=')}\n# tail`;
    const replaced = upsertRcBlock(edited, block);
    expect(replaced).toBe(`${base}${block}\n# tail`);
    expect(replaced.split('# >>> tui-back >>>')).toHaveLength(2);
  });

  it('adds a newline before the block when the file lacks a trailing one, and handles an empty file', () => {
    expect(upsertRcBlock('x', block)).toBe(`x\n${block}\n`);
    expect(upsertRcBlock('', block)).toBe(`${block}\n`);
  });

  it('collapses duplicate blocks to one', () => {
    const result = upsertRcBlock(`${block}\nmid\n${block}\n`, block);
    expect(result).toBe(`${block}\nmid\n`);
  });

  it('removes the block only, and reports a no-op as null', () => {
    expect(removeRcBlock(`a\n${block}\nb\n`)).toBe('a\nb\n');
    expect(removeRcBlock(`a\n${block}\n`)).toBe('a\n');
    expect(removeRcBlock('a\nb\n')).toBeNull();
    expect(removeRcBlock('')).toBeNull();
  });
});

describe('install subcommand', () => {
  function build(nodeVersion: string, npm: NpmOutcome = { ok: true }) {
    const files = new Map<string, string>();
    const calls: string[] = [];
    const installer: InstallerPort = {
      repositoryUrl: async () => 'git+https://github.com/o/r.git',
      npmGlobal: async (action, target) => {
        calls.push(`${action} ${target}`);
        return npm;
      },
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, content) => void files.set(path, content),
      removeFile: async (path) => files.delete(path),
    };
    const sub = createInstallSubcommand({
      installer,
      nodeVersion,
      env: { SHELL: '/bin/bash' },
      homedir: '/home/u',
      dataDir: '/data/tui-back',
      commands: () => [{ name: 'ping', usage: 'tui-back ping' }],
    });
    return { sub, files, calls };
  }

  it('stops on old Node without touching anything', async () => {
    const { sub, files, calls } = build('v22.0.0');
    const result = await sub.run([]);
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported-node' } });
    expect(calls).toEqual([]);
    expect(files.size).toBe(0);
  });

  it('writes nothing when npm fails', async () => {
    const { sub, files } = build('v24.0.0', { ok: false, kind: 'permission-denied', message: 'EACCES' });
    const result = await sub.run([]);
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(files.size).toBe(0);
  });

  it('rejects unknown and extra arguments', async () => {
    const { sub } = build('v24.0.0');
    for (const args of [['--nope'], ['--uninstall', 'x'], ['x']]) {
      expect(await sub.run(args)).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }
  });

  it('uninstall on a clean machine creates nothing', async () => {
    const { sub, files } = build('v24.0.0');
    expect(await sub.run(['--uninstall'])).toMatchObject({ ok: true, data: { rcBlockRemoved: false, completionRemoved: false } });
    expect(files.size).toBe(0);
  });
});

describe('github host anchoring', () => {
  it('accepts only the exact github.com host', () => {
    expect(githubSpecFromRepository('ssh://git@github.com/a/b.git')).toBe('github:a/b');
    expect(githubSpecFromRepository('git+ssh://git@github.com/a/b.git')).toBe('github:a/b');
    expect(githubSpecFromRepository('git+https://github.com/a/b.git')).toBe('github:a/b');
    expect(githubSpecFromRepository('https://notgithub.com/a/b')).toBeNull();
    expect(githubSpecFromRepository('https://github.com.evil.tld/a/b')).toBeNull();
    expect(githubSpecFromRepository('https://evil.tld/github.com/a/b')).toBeNull();
  });
});

describe('renderRcBlock escaping', () => {
  it('escapes characters special inside double quotes', () => {
    const line = renderRcBlock('/d/a"b$c`d\\e/completion.bash').split('\n')[3];
    expect(line).toBe('[ -f "/d/a\\"b\\$c\\`d\\\\e/completion.bash" ] && source "/d/a\\"b\\$c\\`d\\\\e/completion.bash"');
  });
});

describe('install subcommand edge cases', () => {
  const RC = '/home/u/.bashrc';
  function harness(opts: { npm?: NpmOutcome; repo?: string | null; files?: Record<string, string>; throwOn?: string } = {}) {
    const files = new Map<string, string>(Object.entries(opts.files ?? {}));
    const npmCalls: string[] = [];
    const installer: InstallerPort = {
      repositoryUrl: async () => (opts.repo === undefined ? 'https://github.com/o/r.git' : opts.repo),
      npmGlobal: async (action, target) => {
        npmCalls.push(`${action} ${target}`);
        return opts.npm ?? { ok: true };
      },
      readFile: async (path) => {
        if (opts.throwOn === 'read') throw new Error('EIO read');
        return files.get(path) ?? null;
      },
      writeFile: async (path, content) => {
        if (opts.throwOn === 'write') throw new Error('EROFS write');
        files.set(path, content);
      },
      removeFile: async (path) => {
        if (opts.throwOn === 'remove') throw new Error('EBUSY remove');
        return files.delete(path);
      },
    };
    const sub = createInstallSubcommand({
      installer,
      nodeVersion: 'v24.0.0',
      env: { SHELL: '/bin/bash' },
      homedir: '/home/u',
      dataDir: '/data/tui-back',
      commands: () => [],
    });
    return { sub, files, npmCalls };
  }
  const block = renderRcBlock('/data/tui-back/completion.bash');

  it('maps npm-not-found and generic npm failure on install, leaving files alone', async () => {
    for (const [kind, code] of [['npm-not-found', 'npm-not-found'], ['failed', 'npm-failed']] as const) {
      const { sub, files } = harness({ npm: { ok: false, kind, message: 'boom' } });
      expect(await sub.run([])).toMatchObject({ ok: false, error: { code } });
      expect(files.size).toBe(0);
    }
  });

  it('reports repository-unresolved without calling npm', async () => {
    for (const repo of [null, 'https://gitlab.com/a/b.git']) {
      const { sub, npmCalls } = harness({ repo });
      expect(await sub.run([])).toMatchObject({ ok: false, error: { code: 'repository-unresolved' } });
      expect(npmCalls).toEqual([]);
    }
  });

  it('uninstall: npm failure keeps rc block and completion file', async () => {
    const files = { [RC]: `${block}\n`, '/data/tui-back/completion.bash': 'x' };
    const { sub, files: after } = harness({ npm: { ok: false, kind: 'failed', message: 'boom' }, files });
    expect(await sub.run(['--uninstall'])).toMatchObject({ ok: false, error: { code: 'npm-failed' } });
    expect(after.get(RC)).toBe(`${block}\n`);
    expect(after.has('/data/tui-back/completion.bash')).toBe(true);
  });

  it('uninstall: npm-not-found is skipped and local pieces are still removed', async () => {
    const files = { [RC]: `${block}\n`, '/data/tui-back/completion.bash': 'x' };
    const { sub, files: after } = harness({ npm: { ok: false, kind: 'npm-not-found', message: 'x' }, files });
    expect(await sub.run(['--uninstall'])).toMatchObject({ ok: true, data: { npmRemoved: false, rcBlockRemoved: true, completionRemoved: true } });
    expect(after.get(RC)).toBe('');
  });

  it('turns port rejections into io-failed', async () => {
    for (const throwOn of ['read', 'write', 'remove']) {
      for (const args of [[], ['--uninstall']]) {
        const { sub } = harness({ throwOn, files: { [RC]: `${block}\n`, '/data/tui-back/completion.bash': 'x' } });
        const result = await sub.run(args);
        if (!result.ok) {
          expect(result.error.code).toBe('io-failed');
        } else {
          expect(throwOn === 'remove' && args.length === 0).toBe(true);
        }
      }
    }
  });

  it('refuses a start marker without an end marker on install and uninstall', async () => {
    const files = { [RC]: 'a\n# >>> tui-back >>>\nalias x=y\n' };
    for (const args of [[], ['--uninstall']]) {
      const { sub, files: after, npmCalls } = harness({ files });
      const result = await sub.run(args);
      expect(result).toMatchObject({ ok: false, error: { code: 'rc-block-corrupt' } });
      expect(!result.ok && result.error.message).toContain(RC);
      expect(after.get(RC)).toBe(files[RC]);
      expect(npmCalls).toEqual([]);
    }
  });

  it('renders human text for install, uninstall and the shell warning', async () => {
    const { sub } = harness();
    const text = sub.humanText!;
    expect(text({ npmInstalled: true, completionFile: '/c', rcFile: '/r', shellWarning: null, nextStep: 'Run `source ~/.bashrc`' })).toContain('source ~/.bashrc');
    const warned = text({ npmInstalled: true, completionFile: '/c', rcFile: '/r', shellWarning: 'not bash', nextStep: 'n' });
    expect(warned).toContain('Warning: not bash');
    expect(text({ npmInstalled: true, completionFile: '/c', rcFile: '/r', shellWarning: null, nextStep: 'n' })).not.toContain('Warning');
    const removed = text({ npmRemoved: true, completionRemoved: true, rcBlockRemoved: false, nextStep: 'n' });
    expect(removed).toContain('Removed tui-back');
    expect(removed).toContain('rc block absent');
  });
});
