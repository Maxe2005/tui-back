// Black-box test per AD-13: "adapters/driving/cli tested black-box (invoke subcommand as
// child process, assert AD-3 envelope)". Spawns the real, shipped binary — no npm link
// required; node resolves package imports (tsx/esm/api) upward from the script's own
// location regardless of this test's cwd.
//
// Deliberately does not attempt to simulate a real TTY (no pty library in the Stack table).
// spawnSync's stdout is a pipe by default, so every case here exercises the non-TTY
// JSON-line branch; the TTY/human-text branch is covered directly by envelope.test.ts.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./tui-back.mjs', import.meta.url));

function runCli(args: string[]) {
  return spawnSync('node', [scriptPath, ...args], { encoding: 'utf8' });
}

describe('tui-back CLI (black-box)', () => {
  it('ping succeeds with the AD-3 envelope on stdout and exits 0', () => {
    const { status, stdout } = runCli(['ping']);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { message: 'pong' } });
  });

  it('an unknown subcommand fails with the AD-3 envelope and exits 1, without crashing', () => {
    const { status, stdout, stderr } = runCli(['bogus']);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('unknown-subcommand');
    expect(stderr).not.toMatch(/at .*\(.*:\d+:\d+\)/); // no raw stack trace
  });

  it('no subcommand at all follows the same unknown-subcommand path and exits 1', () => {
    const { status, stdout } = runCli([]);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('unknown-subcommand');
  });

  it("package.json's bin field has exactly one entry — no per-action executable (AD-2)", async () => {
    const pkg = await import('../../package.json', { with: { type: 'json' } });
    expect(Object.keys(pkg.default.bin)).toEqual(['tui-back']);
  });
});
