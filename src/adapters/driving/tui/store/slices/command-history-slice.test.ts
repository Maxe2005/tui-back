import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../../../core/ports/settings.js';
import { ok } from '../../../../../core/result.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';

function fakeStatePort(initial: string[] | null) {
  const writes: string[][] = [];
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(null)),
    writeFilterHistory: vi.fn(async () => ok(undefined)),
    readCommandHistory: vi.fn(async () => ok(initial)),
    writeCommandHistory: vi.fn(async (history: string[]) => {
      writes.push(history);
      return ok(undefined);
    }),
    readLogRules: vi.fn(async () => ok(null)),
    writeLogRules: vi.fn(async () => ok(undefined)),
    readLogRuleSets: vi.fn(async () => ok(null)),
    writeLogRuleSets: vi.fn(async () => ok(undefined)),
  };
  return { state, writes };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('command history slice', () => {
  it('hydrates the persisted list on load', async () => {
    const { state } = fakeStatePort(['settings']);
    const store = createAppStore({ state } as unknown as AppStoreDeps);
    await store.getState().loadCommandHistory();
    expect(store.getState().commandHistory).toEqual(['settings']);
  });

  it('pushes to the front, optimistically, and persists the whole list', async () => {
    const { state, writes } = fakeStatePort(['registry']);
    const store = createAppStore({ state } as unknown as AppStoreDeps);
    await store.getState().loadCommandHistory();
    store.getState().commitCommandHistoryEntry('settings');
    await flush();
    expect(store.getState().commandHistory).toEqual(['settings', 'registry']);
    await flush();
    expect(writes).toEqual([['settings', 'registry']]);
  });

  it('honors historyDedup: move-to-front everywhere when on, top-only when off', async () => {
    const { state } = fakeStatePort(['a', 'b']);
    const store = createAppStore({ state } as unknown as AppStoreDeps);
    await store.getState().loadCommandHistory();
    store.getState().commitCommandHistoryEntry('b');
    await flush();
    expect(store.getState().commandHistory).toEqual(['b', 'a']);

    store.setState({ settings: { ...DEFAULT_SETTINGS, commandPalette: { ...DEFAULT_SETTINGS.commandPalette, historyDedup: false } } });
    store.getState().commitCommandHistoryEntry('a');
    await flush();
    expect(store.getState().commandHistory).toEqual(['a', 'b', 'a']);
  });

  it('trims to historySize', async () => {
    const { state } = fakeStatePort(['a', 'b', 'c']);
    const store = createAppStore({ state } as unknown as AppStoreDeps);
    await store.getState().loadCommandHistory();
    store.setState({ settings: { ...DEFAULT_SETTINGS, commandPalette: { ...DEFAULT_SETTINGS.commandPalette, historySize: 2 } } });
    store.getState().commitCommandHistoryEntry('d');
    await flush();
    expect(store.getState().commandHistory).toEqual(['d', 'a']);
  });

  it('waits for an in-flight load before mutating, so disk history is never discarded', async () => {
    const { state, writes } = fakeStatePort(['disk']);
    const store = createAppStore({ state } as unknown as AppStoreDeps);
    const loading = store.getState().loadCommandHistory();
    store.getState().commitCommandHistoryEntry('new');
    await loading;
    await flush();
    await flush();
    expect(store.getState().commandHistory).toEqual(['new', 'disk']);
    expect(writes).toEqual([['new', 'disk']]);
  });

  it('clear empties the list and persists the empty list', async () => {
    const { state, writes } = fakeStatePort(['a']);
    const store = createAppStore({ state } as unknown as AppStoreDeps);
    await store.getState().loadCommandHistory();
    store.getState().clearCommandHistory();
    await flush();
    await flush();
    expect(store.getState().commandHistory).toEqual([]);
    expect(writes.at(-1)).toEqual([]);
  });
});
