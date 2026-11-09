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
