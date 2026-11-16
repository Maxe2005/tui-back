import { describe, expect, it } from 'vitest';
import { ok, err } from '../../../core/result.js';
import { renderResult } from './envelope.js';

describe('renderResult — non-TTY (AD-3 envelope)', () => {
  it('renders a success result as exactly one JSON line', () => {
    const { output, exitCode } = renderResult(ok({ message: 'pong' }), false);

    expect(output).toBe('{"ok":true,"data":{"message":"pong"}}\n');
    expect(output.split('\n')).toEqual(['{"ok":true,"data":{"message":"pong"}}', '']);
    expect(exitCode).toBe(0);
  });

  it('renders a failure result as exactly one JSON line, omitting details when absent', () => {
    const { output, exitCode } = renderResult(err('unknown-subcommand', 'Unknown subcommand: "bogus"'), false);

    expect(output).toBe('{"ok":false,"error":{"code":"unknown-subcommand","message":"Unknown subcommand: \\"bogus\\""}}\n');
    expect(exitCode).toBe(1);
  });

  it('includes details in the JSON line when present', () => {
    const { output, exitCode } = renderResult(err('internal-error', 'boom', { cause: 'fixture' }), false);

    expect(output).toBe('{"ok":false,"error":{"code":"internal-error","message":"boom","details":{"cause":"fixture"}}}\n');
    expect(exitCode).toBe(1);
  });
});

describe('renderResult — TTY (human-readable text)', () => {
  it('renders a success result as human-readable text, not raw JSON', () => {
    const { output, exitCode } = renderResult(ok({ message: 'pong' }), true);

    expect(output).not.toBe('{"ok":true,"data":{"message":"pong"}}\n');
    expect(output).toContain('pong');
    expect(exitCode).toBe(0);
  });

  it('renders a failure result as human-readable text containing the message and code', () => {
    const { output, exitCode } = renderResult(err('unknown-subcommand', 'Unknown subcommand: "bogus"'), true);

    expect(output).not.toMatch(/^\{/);
    expect(output).toContain('Unknown subcommand: "bogus"');
    expect(output).toContain('unknown-subcommand');
    expect(exitCode).toBe(1);
  });

  it('renders details when present', () => {
    const { output } = renderResult(err('internal-error', 'boom', { cause: 'fixture' }), true);

    expect(output).toContain('boom');
    expect(output).toContain('fixture');
  });

  it('renders a primitive success payload instead of discarding it as OK', () => {
    expect(renderResult(ok('pong'), true).output).toBe('"pong"\n');
    expect(renderResult(ok(42), true).output).toBe('42\n');
    expect(renderResult(ok(false), true).output).toBe('false\n');
  });

  it('renders a non-empty array success payload instead of discarding it as OK', () => {
    const { output } = renderResult(ok(['a', 'b']), true);

    expect(output).toBe('[\n  "a",\n  "b"\n]\n');
  });

  it('still renders OK for a genuinely empty object payload', () => {
    const { output } = renderResult(ok({}), true);

    expect(output).toBe('OK\n');
  });
});

describe('renderResult — humanText hook', () => {
  const hook = (data: unknown): string => (data as { script: string }).script;

  it('prints the hook text raw on a TTY', () => {
    expect(renderResult(ok({ script: 'echo hi\n' }), true, hook).output).toBe('echo hi\n');
  });

  it('is ignored when piped', () => {
    expect(renderResult(ok({ script: 'x' }), false, hook).output).toBe('{"ok":true,"data":{"script":"x"}}\n');
  });

  it('is ignored for errors', () => {
    expect(renderResult(err('boom', 'bad'), true, hook).output).toBe('Error: bad (code: boom)\n');
  });
});
