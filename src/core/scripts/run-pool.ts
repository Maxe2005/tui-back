// core/scripts/run-pool: the bounded worker pool behind the group update. At most `concurrency`
// workers are in flight; results come back in input (configuration) order whatever order the
// workers finish in. Pure — no ports, no I/O — and it never rejects: a throwing worker is
// converted to its item's row by the caller-provided `onError`.

// What a worker may do to the pool around its own work.
export interface PoolControl {
  // The effective (normalised) pool size.
  readonly concurrency: number;
  // Gives the worker's slot back while it waits on the developer; the next waiting item
  // starts. A no-op when the slot is already released.
  release(): void;
  // Takes a slot again before the worker continues (queues behind the waiting items).
  reacquire(): Promise<void>;
  // True once the run was cancelled: nothing unstarted starts and workers stop at their next
  // step boundary.
  cancelled(): boolean;
  cancel(): void;
}

export interface RunPoolOptions<T, R> {
  concurrency: number;
  // Items sharing a key are never in flight together (e.g. the resolved repoPath).
  keyOf?: (item: T) => string;
  // Items run stage by stage in ascending order; a stage starts once the previous one has
  // fully finished (a later story runs `shared-types` alone first). Default: one stage.
  stageOf?: (item: T) => number;
  // The row for an item that never started because the run was cancelled.
  onCancelled: (item: T) => R | undefined | Promise<R | undefined>;
  // The row for a worker that threw (never-throw invariant).
  onError: (item: T, error: unknown) => R | undefined;
}

class Semaphore {
  private free: number;
  private readonly waiters: (() => void)[] = [];

  constructor(size: number) {
    this.free = size;
  }

  acquire(): Promise<void> {
    if (this.free > 0) {
      this.free -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolveWaiter) => {
      this.waiters.push(resolveWaiter);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next();
    } else {
      this.free += 1;
    }
  }
}

export async function runPool<T, R>(
  items: readonly T[],
  options: RunPoolOptions<T, R>,
  worker: (item: T, control: PoolControl) => Promise<R | undefined>,
): Promise<(R | undefined)[]> {
  const size = Number.isFinite(options.concurrency) ? Math.max(1, Math.floor(options.concurrency)) : 1;
  const semaphore = new Semaphore(size);
  const results: (R | undefined)[] = new Array<R | undefined>(items.length).fill(undefined);
  const tails = new Map<string, Promise<void>>();
  let cancelled = false;

  const runOne = async (index: number): Promise<void> => {
    const item = items[index] as T;
    const key = options.keyOf?.(item);
    let previous: Promise<void> = Promise.resolve();
    let finishKey: () => void = () => {};
    if (key !== undefined) {
      previous = tails.get(key) ?? Promise.resolve();
      const mine = new Promise<void>((resolveKey) => {
        finishKey = resolveKey;
      });
      tails.set(key, previous.then(() => mine));
    }
    try {
      await previous;
      await semaphore.acquire();
      let held = true;
      const control: PoolControl = {
        concurrency: size,
        release: () => {
          if (held) {
            held = false;
            semaphore.release();
          }
        },
        reacquire: async () => {
          if (!held) {
            await semaphore.acquire();
            held = true;
          }
        },
        cancelled: () => cancelled,
        cancel: () => {
          cancelled = true;
        },
      };
      try {
        if (cancelled) {
          results[index] = await options.onCancelled(item);
        } else {
          results[index] = await worker(item, control);
        }
      } catch (error) {
        results[index] = options.onError(item, error);
      } finally {
        control.release();
      }
    } finally {
      finishKey();
    }
  };

  const stages = new Map<number, number[]>();
  items.forEach((item, index) => {
    const stage = options.stageOf?.(item) ?? 0;
    stages.set(stage, [...(stages.get(stage) ?? []), index]);
  });
  for (const stage of [...stages.keys()].sort((a, b) => a - b)) {
    await Promise.all((stages.get(stage) ?? []).map((index) => runOne(index)));
  }
  return results;
}
