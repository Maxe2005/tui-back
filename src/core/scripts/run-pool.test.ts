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

  it('a released slot lets the next item start; reacquire queues behind waiting items', async () => {
    const order: string[] = [];
    let resume: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => {
      resume = resolveGate;
    });
    const run = runPool([1, 2], { ...base, concurrency: 1 }, async (item, control) => {
      if (item === 1) {
        order.push('1:pause');
        control.release();
        await gate;
        await control.reacquire();
        order.push('1:resume');
        return 'r1';
      }
      order.push('2:run');
      await tick();
      resume();
      return 'r2';
    });
    expect(await run).toEqual(['r1', 'r2']);
    expect(order).toEqual(['1:pause', '2:run', '1:resume']);
  });

  it('never runs two items with the same key together', async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool(
      [1, 2, 3],
      { ...base, concurrency: 3, keyOf: (item) => (item === 3 ? 'other' : 'same') },
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight -= 1;
        return 'ok';
      },
    );
    expect(peak).toBe(2);
  });

  it('runs stages in ascending order, each finished before the next', async () => {
    const order: string[] = [];
    await runPool(
      [1, 2, 3],
      { ...base, concurrency: 3, stageOf: (item) => (item === 2 ? 0 : 1) },
      async (item) => {
        order.push(`s${item}`);
        await tick();
        order.push(`e${item}`);
        return 'ok';
      },
    );
    expect(order.slice(0, 2)).toEqual(['s2', 'e2']);
  });

  it('cancel stops unstarted items, which get the cancelled row', async () => {
    const rows = await runPool(
      [1, 2, 3],
      { ...base, concurrency: 1, onCancelled: (item) => `cancelled:${item}` },
      async (item, control) => {
        if (item === 1) {
          control.cancel();
        }
        return `r${item}`;
      },
    );
    expect(rows).toEqual(['r1', 'cancelled:2', 'cancelled:3']);
  });

  it('survives an onError that throws itself', async () => {
    const rows = await runPool(
      [1, 2],
      {
        ...base,
        concurrency: 2,
        onError: () => {
          throw new Error('mapper broke');
        },
      },
      async (item) => {
        if (item === 1) {
          throw new Error('boom');
        }
        return `r${item}`;
      },
    );
    expect(rows).toEqual([undefined, 'r2']);
  });

  it('a cancel in an early stage sends every later-stage item to onCancelled', async () => {
    const rows = await runPool(
      [1, 2, 3],
      { ...base, concurrency: 3, stageOf: (item) => (item === 1 ? 0 : 1), onCancelled: (item) => `cancelled:${item}` },
      async (item, control) => {
        control.cancel();
        return `r${item}`;
      },
    );
    expect(rows).toEqual(['r1', 'cancelled:2', 'cancelled:3']);
  });

  describe('afterStage', () => {
    it('runs after each stage with that stage rows, before the next stage starts', async () => {
      const log: string[] = [];
      await runPool(
        [1, 2, 3],
        {
          ...base,
          concurrency: 3,
          stageOf: (item) => (item === 1 ? 0 : 1),
          afterStage: (stage, rows) => {
            log.push(`after${stage}:${rows.join(',')}`);
          },
        },
        async (item) => {
          log.push(`run${item}`);
          return `r${item}`;
        },
      );
      expect(log).toEqual(['run1', 'after0:r1', 'run2', 'run3', 'after1:r2,r3']);
    });

    it('cancelling in the hook sends later stages through onCancelled', async () => {
      const rows = await runPool(
        [1, 2, 3],
        {
          ...base,
          concurrency: 3,
          stageOf: (item) => (item === 1 ? 0 : 1),
          onCancelled: (item) => `cancelled:${item}`,
          afterStage: async (_stage, _rows, control) => {
            await tick();
            control.cancel();
          },
        },
        async (item) => `r${item}`,
      );
      expect(rows).toEqual(['r1', 'cancelled:2', 'cancelled:3']);
    });

    it('a throwing hook cancels the remaining stages and never rejects', async () => {
      const rows = await runPool(
        [1, 2],
        {
          ...base,
          concurrency: 1,
          stageOf: (item) => item - 1,
          onCancelled: (item) => `cancelled:${item}`,
          afterStage: () => {
            throw new Error('boom');
          },
        },
        async (item) => `r${item}`,
      );
      expect(rows).toEqual(['r1', 'cancelled:2']);
    });
  });
});
