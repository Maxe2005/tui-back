import { describe, expect, it } from 'vitest';
import { createPersistedHistoryStore } from './persisted-history-store.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('createPersistedHistoryStore', () => {
  it('hydrates once from the persisted value', async () => {
    let live: string[] = [];
    const store = createPersistedHistoryStore<string[]>({
      read: async () => ({ ok: true, data: ['a'] }),
      write: async () => ({ ok: true, data: undefined }),
    });
    await store.load((v) => (live = v));
    expect(live).toEqual(['a']);
  });

  it('keeps the default when nothing is persisted or the read fails', async () => {
    let live: string[] = [];
    const empty = createPersistedHistoryStore<string[]>({
      read: async () => ({ ok: true, data: null }),
      write: async () => ({ ok: true, data: undefined }),
    });
    await empty.load((v) => (live = v));
    const failing = createPersistedHistoryStore<string[]>({
      read: async () => ({ ok: false, error: { code: 'x', message: 'x' } }),
      write: async () => ({ ok: true, data: undefined }),
    });
    await failing.load((v) => (live = v));
    expect(live).toEqual([]);
  });

  it('a mutation issued during the initial load waits for it and builds on the hydrated value', async () => {
    const read = deferred<{ ok: true; data: string[] }>();
    const writes: string[][] = [];
    let live: string[] = [];
    const store = createPersistedHistoryStore<string[]>({
      read: () => read.promise,
      write: async (v) => (writes.push(v), { ok: true, data: undefined }),
    });
    const loading = store.load((v) => (live = v));
    // The mutation waits for the in-flight load, so it sees the hydrated value, not the empty one.
    store.mutate(() => (live = [...live, 'new']));
    read.resolve({ ok: true, data: ['disk'] });
    await loading;
    await store.resetAndDrain(() => undefined);
    expect(live).toEqual(['disk', 'new']);
    expect(writes).toEqual([['disk', 'new']]);
  });

  it('serializes writes in request order and drains them on reset', async () => {
    const order: string[] = [];
    const gate = deferred<void>();
    const store = createPersistedHistoryStore<string[]>({
      read: async () => ({ ok: true, data: null }),
      write: async (v) => {
        if (v[0] === 'first') await gate.promise;
        order.push(v[0]!);
        return { ok: true, data: undefined };
      },
    });
    store.mutate(() => ['first']);
    store.mutate(() => ['second']);
    const drained = store.resetAndDrain(() => order.push('reset'));
    gate.resolve();
    await drained;
    expect(order).toEqual(['reset', 'first', 'second']);
  });
});
