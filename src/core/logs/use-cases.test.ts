import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../result.js';
import type { DockerPort } from '../ports/docker.js';
import type { LogsManager } from './index.js';
import { clearLogs, getServiceHealth, loadOlderLogs, subscribeLogs, unsubscribeLogs } from './use-cases.js';

function fakeManager(overrides: Partial<LogsManager> = {}): LogsManager {
  return {
    subscribe: vi.fn(() => ok(undefined)),
    unsubscribe: vi.fn(),
    isSubscribed: vi.fn(() => false),
    getEntry: vi.fn(() => ({ lines: [], streamError: null, noMoreHistory: false })),
    loadOlder: vi.fn(async () => ok({ appended: 0 })),
    clear: vi.fn(),
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

describe('clearLogs', () => {
  it('delegates to manager.clear and always returns ok', () => {
    const manager = fakeManager();

    const result = clearLogs({ manager, key: 'svc-a' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(manager.clear).toHaveBeenCalledWith('svc-a');
  });
});

function fakeDocker(overrides: Partial<DockerPort> = {}): DockerPort {
  return Object.assign(
    {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    },
    overrides,
  );
}

describe('getServiceHealth', () => {
  it('delegates to docker.getContainerHealth with the container, forwarding its Result as-is', async () => {
    const docker = fakeDocker({ getContainerHealth: vi.fn(async () => ok('restarting' as const)) });

    const result = await getServiceHealth({ docker, container: 'ctr-a' });

    expect(result).toEqual({ ok: true, data: 'restarting' });
    expect(docker.getContainerHealth).toHaveBeenCalledWith('ctr-a');
  });

  it('forwards a down state and a docker-unavailable error untouched', async () => {
    const down = fakeDocker({ getContainerHealth: vi.fn(async () => ok('down' as const)) });
    expect(await getServiceHealth({ docker: down, container: 'ctr-a' })).toEqual({ ok: true, data: 'down' });

    const failing = fakeDocker({ getContainerHealth: vi.fn(async () => err('docker-unavailable', 'daemon down')) });
    expect(await getServiceHealth({ docker: failing, container: 'ctr-a' })).toEqual({
      ok: false,
      error: { code: 'docker-unavailable', message: 'daemon down' },
    });
  });
});
