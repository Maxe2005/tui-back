import { describe, expect, it } from 'vitest';
import { createInFlightGuard } from './in-flight-guard.js';

describe('createInFlightGuard', () => {
  it('refuses a second poll of the same key until the first ends', () => {
    const guard = createInFlightGuard();
    const first = guard.begin('a');
    expect(first).not.toBeNull();
    expect(guard.begin('a')).toBeNull();
    expect(guard.begin('b')).not.toBeNull();
    guard.end('a', first!);
    expect(guard.begin('a')).not.toBeNull();
  });

  it('a released token is no longer current and cannot free a newer poll', () => {
    const guard = createInFlightGuard();
    const old = guard.begin('a')!;
    guard.release('a');
    expect(guard.isCurrent('a', old)).toBe(false);
    const fresh = guard.begin('a')!;
    guard.end('a', old);
    expect(guard.isCurrent('a', fresh)).toBe(true);
    expect(guard.begin('a')).toBeNull();
  });

  it('releaseAll invalidates every token', () => {
    const guard = createInFlightGuard();
    const a = guard.begin('a')!;
    const b = guard.begin('b')!;
    guard.releaseAll();
    expect(guard.isCurrent('a', a)).toBe(false);
    expect(guard.isCurrent('b', b)).toBe(false);
  });
});
