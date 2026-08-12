import { describe, expect, it } from 'vitest';
import { ping } from './ping.js';

describe('ping', () => {
  it('resolves a success envelope carrying a pong message', async () => {
    await expect(ping()).resolves.toEqual({ ok: true, data: { message: 'pong' } });
  });
});
