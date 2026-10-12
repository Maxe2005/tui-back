import { describe, expect, it } from 'vitest';
import { runPool } from './run-pool.js';

const tick = () => new Promise<void>((resolveTick) => setTimeout(resolveTick, 1));

const base = {
  onCancelled: () => undefined,
  onError: (item: number, error: unknown) => `err:${item}:${error instanceof Error ? error.message : String(error)}`,
};

describe('runPool', () => {
  it('concurrency 1 runs items one at a time in input order', async () => {
    const order: string[] = [];
    const rows = await runPool([1, 2, 3], { ...base, concurrency: 1 }, async (item) => {
      order.push(`start${item}`);
      await tick();
      order.push(`end${item}`);
      return `r${item}`;
    });
    expect(rows).toEqual(['r1', 'r2', 'r3']);
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2', 'start3', 'end3']);
  });

  it('never has more than `concurrency` workers in flight and keeps result order', async () => {
    let inFlight = 0;
    let peak = 0;
    const rows = await runPool([5, 4, 3, 2, 1], { ...base, concurrency: 3 }, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      for (let i = 0; i < item; i += 1) {
        await tick();
      }
      inFlight -= 1;
      return `r${item}`;
    });
    expect(peak).toBe(3);
    expect(rows).toEqual(['r5', 'r4', 'r3', 'r2', 'r1']);
  });

  it('converts a throwing worker into its row and keeps going (never rejects)', async () => {
    const rows = await runPool([1, 2], { ...base, concurrency: 2 }, async (item) => {
      if (item === 1) {
        throw new Error('boom');
      }
      return `r${item}`;
    });
    expect(rows).toEqual(['err:1:boom', 'r2']);
  });

  it('floors invalid concurrency to 1', async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool([1, 2, 3], { ...base, concurrency: 0 }, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
      return 'ok';
    });
    expect(peak).toBe(1);
  });
});
