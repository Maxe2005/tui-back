import { describe, expect, it } from 'vitest';
import { err, ok } from './result.js';

describe('ok', () => {
  it('wraps data in a success envelope', () => {
    expect(ok({ message: 'pong' })).toEqual({ ok: true, data: { message: 'pong' } });
  });
});

describe('err', () => {
  it('wraps a code/message in a failure envelope with no details key when omitted', () => {
    const result = err('unknown-subcommand', 'Unknown subcommand: "bogus"');

    expect(result).toEqual({
      ok: false,
      error: { code: 'unknown-subcommand', message: 'Unknown subcommand: "bogus"' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toHaveProperty('details');
    }
  });

  it('includes details when provided', () => {
    const result = err('internal-error', 'boom', { cause: 'fixture' });

    expect(result).toEqual({
      ok: false,
      error: { code: 'internal-error', message: 'boom', details: { cause: 'fixture' } },
    });
  });
});
