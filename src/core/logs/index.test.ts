import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../result.js';
import type { DockerPort, LogLine } from '../ports/docker.js';
import { createLogsManager } from './index.js';

function line(text: string, stream: 'stdout' | 'stderr' = 'stdout', timestamp = '2026-01-01T00:00:00.000Z'): LogLine {
  return { timestamp, stream, text };
}

// A controllable fake DockerPort: `streamLogs` hands back its own onLine/onError callbacks so
// a test can drive the "stream" manually, and records every `stop()` call.
function fakeDocker(overrides: Partial<DockerPort> = {}): DockerPort & {
  emitLine: (container: string, line: LogLine) => void;
  emitError: (container: string, error: { code: string; message: string }) => void;
  stopped: string[];
} {
  const listeners = new Map<string, { onLine: (line: LogLine) => void; onError: (error: { code: string; message: string }) => void }>();
  const stopped: string[] = [];
  const streamLogs = vi.fn((container: string, onLine: (line: LogLine) => void, onError: (error: { code: string; message: string }) => void) => {
    listeners.set(container, { onLine, onError });
    return () => {
      stopped.push(container);
    };
  });
  const fetchLogsBefore = vi.fn(async () => ok([] as LogLine[]));
  return {
    streamLogs,
    fetchLogsBefore,
    emitLine: (container, l) => listeners.get(container)?.onLine(l),
    emitError: (container, e) => listeners.get(container)?.onError(e),
    stopped,
    ...overrides,
  };
}

describe('createLogsManager', () => {
  it('subscribe() starts a stream and getEntry() reflects lines pushed via onLine', () => {
    const docker = fakeDocker();
    const manager = createLogsManager(docker);
    const onUpdate = vi.fn();

    const result = manager.subscribe('svc-a', 'ctr-a', 500, onUpdate);
    expect(result).toEqual({ ok: true, data: undefined });
    expect(docker.streamLogs).toHaveBeenCalledTimes(1);

    docker.emitLine('ctr-a', line('hello'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(manager.getEntry('svc-a').lines).toEqual([line('hello')]);
  });

  it('caps the ring buffer at bufferSize, dropping the oldest line first', () => {
    const docker = fakeDocker();
    const manager = createLogsManager(docker);
    manager.subscribe('svc-a', 'ctr-a', 2, () => {});

    docker.emitLine('ctr-a', line('one'));
    docker.emitLine('ctr-a', line('two'));
    docker.emitLine('ctr-a', line('three'));

    expect(manager.getEntry('svc-a').lines.map((l) => l.text)).toEqual(['two', 'three']);
  });

  it('subscribe() is idempotent — a second call for an already-streaming key never calls streamLogs again', () => {
    const docker = fakeDocker();
    const manager = createLogsManager(docker);
    manager.subscribe('svc-a', 'ctr-a', 500, () => {});
    manager.subscribe('svc-a', 'ctr-a', 500, () => {});

    expect(docker.streamLogs).toHaveBeenCalledTimes(1);
  });

  it('subscribe() returns err("docker-unavailable", ...) when the adapter calls onError synchronously (I/O matrix DOCKER_UNAVAILABLE)', () => {
    const docker = fakeDocker({
      streamLogs: vi.fn((_container, _onLine, onError) => {
        onError({ code: 'docker-unavailable', message: 'docker is not running' });
        return () => {};
      }),
    });
    const manager = createLogsManager(docker);

    const result = manager.subscribe('svc-a', 'ctr-a', 500, () => {});

    expect(result).toEqual({ ok: false, error: { code: 'docker-unavailable', message: 'docker is not running' } });
    expect(manager.isSubscribed('svc-a')).toBe(false);
  });

  it('a stream error occurring after a successful subscribe is reported through getEntry(), not by rejecting subscribe()', () => {
    const docker = fakeDocker();
    const manager = createLogsManager(docker);
    const onUpdate = vi.fn();
    manager.subscribe('svc-a', 'ctr-a', 500, onUpdate);

    docker.emitError('ctr-a', { code: 'docker-unavailable', message: 'container removed' });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(manager.getEntry('svc-a').streamError).toEqual({ code: 'docker-unavailable', message: 'container removed' });
  });

  it('unsubscribe() calls the stream stop function and discards the buffer (idempotent for an unknown key)', () => {
    const docker = fakeDocker();
    const manager = createLogsManager(docker);
    manager.subscribe('svc-a', 'ctr-a', 500, () => {});
    docker.emitLine('ctr-a', line('hello'));

    manager.unsubscribe('svc-a');

    expect(docker.stopped).toEqual(['ctr-a']);
    expect(manager.isSubscribed('svc-a')).toBe(false);
    expect(manager.getEntry('svc-a').lines).toEqual([]);
    expect(() => manager.unsubscribe('svc-a')).not.toThrow();
    expect(() => manager.unsubscribe('never-subscribed')).not.toThrow();
  });

  it('getEntry() for an unknown key returns an empty, no-error entry', () => {
    const manager = createLogsManager(fakeDocker());
    expect(manager.getEntry('nope')).toEqual({ lines: [], streamError: null, noMoreHistory: false });
  });

  it('loadOlder() prepends fetched lines and reports how many were appended', async () => {
    const olderLine = line('older', 'stdout', '2025-12-31T23:59:00.000Z');
    const docker = fakeDocker({ fetchLogsBefore: vi.fn(async () => ok([olderLine])) });
    const manager = createLogsManager(docker);
    manager.subscribe('svc-a', 'ctr-a', 500, () => {});
    docker.emitLine('ctr-a', line('recent'));

    const result = await manager.loadOlder('svc-a', 'ctr-a');

    expect(result).toEqual({ ok: true, data: { appended: 1 } });
    expect(manager.getEntry('svc-a').lines.map((l) => l.text)).toEqual(['older', 'recent']);
    // Cursor is the oldest currently-buffered line's own timestamp (the only line so far).
    expect(docker.fetchLogsBefore).toHaveBeenCalledWith('ctr-a', line('recent').timestamp, 500);
  });

  it('loadOlder() drops any returned line whose timestamp is not strictly older than the current oldest buffered line (review fix: no re-fetched duplicate)', async () => {
    const cursorTimestamp = line('recent').timestamp;
    const duplicateLine = line('recent-duplicate', 'stdout', cursorTimestamp);
    const genuinelyOlderLine = line('older', 'stdout', '2025-12-31T23:59:00.000Z');
    const docker = fakeDocker({ fetchLogsBefore: vi.fn(async () => ok([genuinelyOlderLine, duplicateLine])) });
    const manager = createLogsManager(docker);
    manager.subscribe('svc-a', 'ctr-a', 500, () => {});
    docker.emitLine('ctr-a', line('recent'));

    const result = await manager.loadOlder('svc-a', 'ctr-a');

    expect(result).toEqual({ ok: true, data: { appended: 1 } });
    expect(manager.getEntry('svc-a').lines.map((l) => l.text)).toEqual(['older', 'recent']);
  });

  it('loadOlder() marks noMoreHistory on a genuinely-empty fetch, without erroring', async () => {
    const docker = fakeDocker({ fetchLogsBefore: vi.fn(async () => ok([])) });
    const manager = createLogsManager(docker);
    manager.subscribe('svc-a', 'ctr-a', 500, () => {});

    const result = await manager.loadOlder('svc-a', 'ctr-a');

    expect(result).toEqual({ ok: true, data: { appended: 0 } });
    expect(manager.getEntry('svc-a').noMoreHistory).toBe(true);
  });

  it('loadOlder() folds an adapter failure into noMoreHistory too (I/O matrix: "fetch fails -> ... scrolling stops at the edge")', async () => {
    const docker = fakeDocker({ fetchLogsBefore: vi.fn(async () => err('docker-unavailable', 'daemon down')) });
    const manager = createLogsManager(docker);
    manager.subscribe('svc-a', 'ctr-a', 500, () => {});

    const result = await manager.loadOlder('svc-a', 'ctr-a');

    expect(result).toEqual({ ok: true, data: { appended: 0 } });
    expect(manager.getEntry('svc-a').noMoreHistory).toBe(true);
  });

  it('loadOlder() short-circuits once noMoreHistory is already set — never calls the adapter again', async () => {
    const fetchLogsBefore = vi.fn(async () => ok([]));
    const docker = fakeDocker({ fetchLogsBefore });
    const manager = createLogsManager(docker);
    manager.subscribe('svc-a', 'ctr-a', 500, () => {});

    await manager.loadOlder('svc-a', 'ctr-a');
    await manager.loadOlder('svc-a', 'ctr-a');

    expect(fetchLogsBefore).toHaveBeenCalledTimes(1);
  });

  it('loadOlder() for an unknown key is a harmless no-op', async () => {
    const manager = createLogsManager(fakeDocker());
    const result = await manager.loadOlder('nope', 'ctr-nope');
    expect(result).toEqual({ ok: true, data: { appended: 0 } });
  });

  it('clear() wipes buffered lines without touching the live subscription — new lines keep arriving', () => {
    const docker = fakeDocker();
    const manager = createLogsManager(docker);
    manager.subscribe('svc-a', 'ctr-a', 500, () => {});
    docker.emitLine('ctr-a', line('one'));
    docker.emitLine('ctr-a', line('two'));

    manager.clear('svc-a');

    expect(manager.getEntry('svc-a').lines).toEqual([]);
    expect(manager.isSubscribed('svc-a')).toBe(true);
    expect(docker.stopped).toEqual([]);

    docker.emitLine('ctr-a', line('three'));
    expect(manager.getEntry('svc-a').lines.map((l) => l.text)).toEqual(['three']);
  });

  it('clear() resets noMoreHistory — a fresh scrollback attempt can fetch again', async () => {
    const docker = fakeDocker({ fetchLogsBefore: vi.fn(async () => ok([])) });
    const manager = createLogsManager(docker);
    manager.subscribe('svc-a', 'ctr-a', 500, () => {});
    await manager.loadOlder('svc-a', 'ctr-a');
    expect(manager.getEntry('svc-a').noMoreHistory).toBe(true);

    manager.clear('svc-a');

    expect(manager.getEntry('svc-a').noMoreHistory).toBe(false);
  });

  it('clear() for an unknown key is a harmless no-op', () => {
    const manager = createLogsManager(fakeDocker());
    expect(() => manager.clear('nope')).not.toThrow();
  });

  it('bufferSize is captured per-subscription: a later subscribe() with a different size never resizes a still-running one', () => {
    const docker = fakeDocker();
    const manager = createLogsManager(docker);
    manager.subscribe('svc-a', 'ctr-a', 2, () => {});
    docker.emitLine('ctr-a', line('one'));
    docker.emitLine('ctr-a', line('two'));

    // Already subscribed — idempotent no-op, bufferSize argument here is ignored.
    manager.subscribe('svc-a', 'ctr-a', 500, () => {});
    docker.emitLine('ctr-a', line('three'));

    expect(manager.getEntry('svc-a').lines.map((l) => l.text)).toEqual(['two', 'three']);
  });
});
