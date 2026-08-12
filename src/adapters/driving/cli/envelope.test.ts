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
});
