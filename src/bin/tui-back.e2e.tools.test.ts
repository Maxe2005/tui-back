import { afterEach, describe, expect, it } from 'vitest';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { generateBashCompletion } from '../adapters/driving/cli/completion-spec.js';
import { EXCLUDED_SUBCOMMANDS, TOOL_DEFINITIONS } from '../adapters/driving/mcp/tool-registry.js';
import { scriptPath, runCli, makeTempDir, cleanupTmpDirs } from './e2e.test-support.js';

afterEach(cleanupTmpDirs);

describe('tui-back completion bash (black-box)', () => {
  it('piped: one JSON line carrying a bash-valid script, exit 0', () => {
    const { status, stdout } = runCli(['completion', 'bash']);
    expect(status).toBe(0);
    expect(stdout.trim().split('\n')).toHaveLength(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.script.length).toBeGreaterThan(0);
    expect(spawnSync('bash', ['-n'], { input: parsed.data.script }).status).toBe(0);
  });

  it('generated script completes verbs and flags when sourced by bash', () => {
    const script = generateBashCompletion({
      commands: [
        { name: 'register', usage: 'tui-back register [--reset] <path>' },
        { name: 'registry', usage: 'tui-back registry clean --yes\ntui-back registry validate' },
        { name: 'edt', usage: 'tui-back edt create --topic <t>\ntui-back edt switch --to <t> [--force]' },
      ],
    });
    expect(spawnSync('bash', ['-n'], { input: script }).status).toBe(0);
    const probe = (words: string[], cword: number): string =>
      spawnSync(
        'bash',
        ['-c', `${script}\nCOMP_WORDS=(${words.map((w) => `'${w}'`).join(' ')}); COMP_CWORD=${cword}; _tui_back; echo "\${COMPREPLY[*]}"`],
        { encoding: 'utf8' },
      ).stdout.trim();
    expect(probe(['tui-back', 'edt', ''], 2)).toBe('create switch');
    expect(probe(['tui-back', 'edt', 'switch', '--'], 3)).toBe('--to --force');
    expect(probe(['tui-back', 'reg'], 1)).toBe('register registry');
  });

  it('rejects a missing or unsupported shell with invalid-argument, exit 1', () => {
    for (const args of [['completion'], ['completion', 'zsh']]) {
      const { status, stdout } = runCli(args);
      expect(status).toBe(1);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.error.code).toBe('invalid-argument');
      expect(parsed.error.message).toBe('Usage: tui-back completion bash');
    }
  });

  it('guard: command names in --help and in the completion script match both ways', () => {
    const help = JSON.parse(runCli(['--help']).stdout.trim());
    const helpNames = (help.data.commands as Array<{ name: string }>).map((c) => c.name).sort();
    const script: string = JSON.parse(runCli(['completion', 'bash']).stdout.trim()).data.script;
    const line = script.split('\n').find((l) => l.trim().startsWith('words="') && l.includes('--help'));
    const scriptNames = line!
      .trim()
      .slice('words="'.length, -1)
      .split(' ')
      .filter((w) => w !== '--help' && w !== '-h')
      .sort();
    expect(scriptNames).toEqual(helpNames);
  });
});

describe('tui-back mcp (black-box)', () => {
  it('guard: every --help subcommand is an MCP tool or in the exclusion list with a reason', () => {
    const help = JSON.parse(runCli(['--help']).stdout.trim());
    const helpNames = (help.data.commands as Array<{ name: string }>).map((c) => c.name);
    const wrapped = new Set(TOOL_DEFINITIONS.map((d) => d.subcommand));
    const unclassified = helpNames.filter((n) => !wrapped.has(n) && !(n in EXCLUDED_SUBCOMMANDS));
    expect(unclassified).toEqual([]);
    for (const reason of Object.values(EXCLUDED_SUBCOMMANDS)) {
      expect(reason.length).toBeGreaterThan(0);
    }
    for (const name of Object.keys(EXCLUDED_SUBCOMMANDS)) {
      if (name !== 'mcp') expect(helpNames).toContain(name);
      expect(wrapped.has(name)).toBe(false);
    }
    // Every write tool is advertised as non-read-only; destructive tools are checked below.
    const writes = TOOL_DEFINITIONS.filter((d) => d.safety === 'write').map((d) => d.name);
    expect(writes).toEqual(expect.arrayContaining(['register', 'scan', 'edt-create', 'edt-modify', 'edt-switch', 'realign', 'heal', 'fire-request', 'request-fire']));
    expect(TOOL_DEFINITIONS.filter((d) => d.safety === 'destructive').map((d) => d.name).sort()).toEqual(
      ['edt-delete', 'edt-switch-discard', 'register-reset', 'registry-clean', 'request-delete', 'update'],
    );
    // `--discard-dirty` is reachable only through edt-switch-discard.
    const discard = TOOL_DEFINITIONS.filter((d) => d.toArgs?.({ to: 'x' }).includes('--discard-dirty'));
    expect(discard.map((d) => d.name)).toEqual(['edt-switch-discard']);
  });

  it('serves tools over stdio with protocol-only stdout', async () => {
    const xdg = await makeTempDir();
    const child = spawn('node', [scriptPath, 'mcp'], { env: { ...process.env, XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg, XDG_DATA_HOME: xdg } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    try {
      const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } } });
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list-repos', arguments: {} } });
      send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'registry-validate', arguments: {} } });
      send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list-routes', arguments: {} } });
      const deadline = Date.now() + 20000;
      while (!(out.includes('"id":3') && out.includes('"id":4') && out.includes('"id":5')) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!(out.includes('"id":3') && out.includes('"id":4') && out.includes('"id":5'))) {
        throw new Error(`timed out waiting for MCP replies 3-5; stdout so far: ${out}`);
      }
      const messages = out.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
      expect(messages.every((m) => m.jsonrpc === '2.0')).toBe(true);
      const listed = messages.find((m) => m.id === 2).result.tools as Array<{ name: string; annotations: { readOnlyHint: boolean }; _meta: { safety: string } }>;
      expect(listed).toHaveLength(TOOL_DEFINITIONS.length);
      for (const tool of listed) {
        expect(tool.annotations.readOnlyHint).toBe(tool._meta.safety === 'read');
        expect(tool._meta.safety).toBe(TOOL_DEFINITIONS.find((d) => d.name === tool.name)?.safety);
      }
      const text = (id: number) => JSON.parse(messages.find((m) => m.id === id).result.content[0].text);
      expect(text(3).ok).toBe(true);
      expect(typeof text(4).ok).toBe('boolean');
      const missing = messages.find((m) => m.id === 5).result;
      expect(missing.isError).toBe(true);
      expect(JSON.parse(missing.content[0].text).error.code).toBe('missing-argument');
    } finally {
      child.kill();
    }
  }, 30000);
});

describe('tui-back install (black-box)', () => {
  async function makeInstallEnv(extra: NodeJS.ProcessEnv = {}, npmScript = 'exit 0'): Promise<{ env: NodeJS.ProcessEnv; home: string; data: string; log: string }> {
    const home = await makeTempDir();
    const data = await makeTempDir();
    const stubDir = await makeTempDir();
    const log = join(stubDir, 'npm.log');
    await writeFile(join(stubDir, 'npm'), `#!/bin/sh\necho "$@" >> "${log}"\n${npmScript}\n`, { mode: 0o755 });
    const env = { HOME: home, XDG_DATA_HOME: data, SHELL: '/bin/bash', PATH: `${stubDir}${delimiter}${process.env.PATH}`, ...extra };
    return { env, home, data, log };
  }

  it('installs globally, writes the completion file and one idempotent rc block', async () => {
    const { env, home, data, log } = await makeInstallEnv();
    await writeFile(join(home, '.bashrc'), 'export KEEP=1\n');
    for (let run = 0; run < 2; run++) {
      const { status, stdout } = runCli(['install'], env);
      expect(status).toBe(0);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data).toMatchObject({
        npmInstalled: true,
        completionFile: join(data, 'tui-back', 'completion.bash'),
        rcFile: join(home, '.bashrc'),
        shellWarning: null,
      });
    }
    expect((await readFile(log, 'utf8')).trim().split('\n')).toEqual(['install -g github:Maxe2005/tui-back', 'install -g github:Maxe2005/tui-back']);
    const rc = await readFile(join(home, '.bashrc'), 'utf8');
    expect(rc.startsWith('export KEEP=1\n')).toBe(true);
    expect(rc.match(/# >>> tui-back >>>/g)).toHaveLength(1);
    expect(rc).toContain("alias tb='tui-back'");
    expect(rc).toContain("alias tbt='tui-back tui'");
    const completion = await readFile(join(data, 'tui-back', 'completion.bash'), 'utf8');
    expect(completion).toContain('install');
    expect(spawnSync('bash', ['-n'], { input: completion }).status).toBe(0);
    expect(spawnSync('bash', ['-n'], { input: rc }).status).toBe(0);
  });

  it('--uninstall reverses all three pieces and leaves the rest of the rc file', async () => {
    const { env, home, data, log } = await makeInstallEnv();
    await writeFile(join(home, '.bashrc'), 'export KEEP=1\n');
    expect(runCli(['install'], env).status).toBe(0);
    const { status, stdout } = runCli(['install', '--uninstall'], env);
    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim()).data).toMatchObject({ npmRemoved: true, completionRemoved: true, rcBlockRemoved: true });
    expect(await readFile(join(home, '.bashrc'), 'utf8')).toBe('export KEEP=1\n');
    await expect(access(join(data, 'tui-back', 'completion.bash'), constants.F_OK)).rejects.toThrow();
    expect((await readFile(log, 'utf8')).trim().split('\n').pop()).toBe('uninstall -g tui-back');
  });

  it('--uninstall on a clean machine exits 0 and creates nothing', async () => {
    const { env, home, data } = await makeInstallEnv();
    const { status } = runCli(['install', '--uninstall'], env);
    expect(status).toBe(0);
    expect(await readdir(home)).toEqual([]);
    expect(await readdir(data)).toEqual([]);
  });

  it('--uninstall keeps the rc block and completion file when npm fails', async () => {
    const { env, home, data } = await makeInstallEnv();
    expect(runCli(['install'], env).status).toBe(0);
    const failing = await makeInstallEnv({}, 'echo "npm ERR! boom" >&2; exit 1');
    const failEnv = { ...env, PATH: failing.env.PATH };
    const { status, stdout } = runCli(['install', '--uninstall'], failEnv);
    expect(status).toBe(1);
    expect(JSON.parse(stdout.trim()).error.code).toBe('npm-failed');
    expect(await readFile(join(home, '.bashrc'), 'utf8')).toContain('# >>> tui-back >>>');
    await access(join(data, 'tui-back', 'completion.bash'), constants.F_OK);
  });

  it('reports EACCES with the prefix remedy and changes no file', async () => {
    const { env, home, data } = await makeInstallEnv({}, 'echo "npm ERR! code EACCES" >&2; exit 243');
    const { status, stdout } = runCli(['install'], env);
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.error.code).toBe('permission-denied');
    expect(parsed.error.message).toContain('npm config set prefix ~/.local');
    expect(parsed.error.message).toContain('PATH');
    expect(await readdir(home)).toEqual([]);
    expect(await readdir(data)).toEqual([]);
  });

  it('warns on a non-bash shell but still installs', async () => {
    const { env } = await makeInstallEnv({ SHELL: '/usr/bin/zsh' });
    const { status, stdout } = runCli(['install'], env);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.data.npmInstalled).toBe(true);
    expect(parsed.data.shellWarning).toContain('zsh');
  });

  it('rejects unknown flags and extra arguments with invalid-argument', async () => {
    const { env } = await makeInstallEnv();
    for (const args of [['install', '--bogus'], ['install', 'extra']]) {
      const { status, stdout } = runCli(args, env);
      expect(status).toBe(1);
      expect(JSON.parse(stdout.trim()).error.code).toBe('invalid-argument');
    }
  });
});
