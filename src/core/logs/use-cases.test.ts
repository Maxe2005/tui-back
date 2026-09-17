import { describe, expect, it, vi } from 'vitest';
import { ok } from '../result.js';
import type { LogsManager } from './index.js';
import { loadOlderLogs, subscribeLogs, unsubscribeLogs } from './use-cases.js';

function fakeManager(overrides: Partial<LogsManager> = {}): LogsManager {
  return {
    subscribe: vi.fn(() => ok(undefined)),
    unsubscribe: vi.fn(),
    isSubscribed: vi.fn(() => false),
    getEntry: vi.fn(() => ({ lines: [], streamError: null, noMoreHistory: false })),
    loadOlder: vi.fn(async () => ok({ appended: 0 })),
    ...overrides,
  };
}

describe('subscribeLogs', () => {
  it('delegates to manager.subscribe with the given params, forwarding its Result as-is', () => {
    const manager = fakeManager();
    const onUpdate = () => {};

    const result = subscribeLogs({ manager, key: 'svc-a', container: 'ctr-a', bufferSize: 500, onUpdate });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(manager.subscribe).toHaveBeenCalledWith('svc-a', 'ctr-a', 500, onUpdate);
  });
});

describe('unsubscribeLogs', () => {
  it('delegates to manager.unsubscribe and always returns ok', () => {
    const manager = fakeManager();

    const result = unsubscribeLogs({ manager, key: 'svc-a' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(manager.unsubscribe).toHaveBeenCalledWith('svc-a');
  });
});

describe('loadOlderLogs', () => {
  it('delegates to manager.loadOlder, forwarding its Result as-is', async () => {
    const manager = fakeManager({ loadOlder: vi.fn(async () => ok({ appended: 3 })) });

    const result = await loadOlderLogs({ manager, key: 'svc-a', container: 'ctr-a' });

    expect(result).toEqual({ ok: true, data: { appended: 3 } });
    expect(manager.loadOlder).toHaveBeenCalledWith('svc-a', 'ctr-a');
  });
});
