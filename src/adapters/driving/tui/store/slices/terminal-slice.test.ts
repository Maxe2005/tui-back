// tui/store/slices/terminal-slice: the slice runs the real core shell session against a fake
// ShellSessionPort, so these verify the wiring — open per target, echo/stream/status lines, the
// batching, the busy and blank paths, cancel, close discarding the session, the bounded display
// and the shared in-memory history.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '../../../../../core/result.js';
import type { HealthState } from '../../../../../core/ports/docker.js';
import type { Manifest, ManifestPort } from '../../../../../core/ports/manifest.js';
import type { ShellLine, ShellRunOutcome, ShellSessionPort, ShellTarget } from '../../../../../core/ports/shell-session.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';
import { NO_SHELL_ERROR, TERMINAL_FLUSH_MS, TERMINAL_MAX_LINES, appendTerminalLines } from './terminal-slice.js';

type Run = {
  target: ShellTarget;
  cwd: string | undefined;
  command: string;
  emit: (line: ShellLine) => void;
  finish: (outcome: ShellRunOutcome) => void;
  cancel: ReturnType<typeof vi.fn>;
};

function fakeShell() {
  const runs: Run[] = [];
  const port: ShellSessionPort = {
    run: vi.fn((target, cwd, command, onLine) => {
      let resolve!: (outcome: ShellRunOutcome) => void;
      const done = new Promise<ShellRunOutcome>((r) => {
        resolve = r;
      });
      const cancel = vi.fn(() => resolve({ status: 'cancelled' }));
      runs.push({ target, cwd, command, emit: onLine, finish: resolve, cancel });
      return { cancel, done };
    }),
  };
  return { port, runs };
}

function setup(options: { shell?: boolean; manifest?: Result<Manifest>; health?: HealthState } = {}) {
  const shell = fakeShell();
  const manifest: ManifestPort = {
    load: vi.fn(async () => options.manifest ?? ok({ service: 'api', sharedBranch: 'development', modules: {}, container: 'api-ctr' } as Manifest)),
  };
  const docker = { getContainerHealth: vi.fn(async () => ok(options.health ?? 'up')) };
  const deps = { manifest, docker, ...(options.shell === false ? {} : { shell: shell.port }) } as unknown as AppStoreDeps;
  const store = createAppStore(deps);
  return { store, shell, manifest, docker };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('appendTerminalLines', () => {
  it('keeps the last max lines and counts the dropped ones', () => {
    const line = (text: string) => ({ kind: 'stdout' as const, text });
    const next = appendTerminalLines({ lines: [line('a'), line('b')], droppedCount: 3 }, [line('c'), line('d')], 3);
    expect(next).toEqual({ lines: [line('b'), line('c'), line('d')], droppedCount: 4 });
  });
});

describe('terminal slice', () => {
  it('opens a service terminal on the repo path, ready, cwd = repo', async () => {
    const { store } = setup();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    const state = store.getState();
    expect(state).toMatchObject({
      terminalOpen: true,
      terminalTarget: { kind: 'service', repoPath: '/repo/api', label: 'api' },
      terminalReady: true,
      terminalCwd: '/repo/api',
      terminalLines: [],
    });
  });

  it('opens a container terminal named after the manifest container and runs through it', async () => {
    const { store, shell, manifest } = setup();
    await store.getState().openTerminal('/repo/api', 'container', 'api');
    expect(manifest.load).toHaveBeenCalledWith('/repo/api');
    expect(store.getState().terminalTarget).toEqual({ kind: 'container', repoPath: '/repo/api', label: 'api-ctr' });
    expect(store.getState().terminalCwd).toBeNull();
    const running = store.getState().runTerminalCommand('ls').done;
    await vi.waitFor(() => expect(shell.runs).toHaveLength(1));
    expect(shell.runs[0]!.target).toEqual({ kind: 'container', container: 'api-ctr' });
    shell.runs[0]!.finish({ status: 'exited', exitCode: 0, cwd: '/app' });
    await running;
    expect(store.getState().terminalCwd).toBe('/app');
  });

  it('shows one error status line when the container is not running, the prompt stays usable', async () => {
    const { store, shell } = setup({ health: 'down' });
    await store.getState().openTerminal('/repo/api', 'container', 'api');
    await store.getState().runTerminalCommand('ls').done;
    expect(shell.runs).toHaveLength(0);
    const lines = store.getState().terminalLines;
    expect(lines).toEqual([
      { kind: 'command', text: '$ ls' },
      { kind: 'status', text: expect.stringMatching(/^error: Container api-ctr is not running/) },
    ]);
    expect(store.getState()).toMatchObject({ terminalRunning: false, terminalReady: true });
  });

  it('reports an unreadable manifest or a container-less one, prompt disabled', async () => {
    const broken = setup({ manifest: err('manifest-invalid', 'bad yaml\nmore') });
    await broken.store.getState().openTerminal('/repo/api', 'container', 'api');
    expect(broken.store.getState().terminalLines).toEqual([{ kind: 'status', text: 'error: could not read the manifest — bad yaml' }]);
    expect(broken.store.getState().terminalReady).toBe(false);

    const none = setup({ manifest: ok({ service: 'api', sharedBranch: 'development', modules: {} } as Manifest) });
    await none.store.getState().openTerminal('/repo/api', 'container', 'api');
    expect(none.store.getState().terminalLines).toEqual([{ kind: 'status', text: 'error: the manifest declares no container' }]);
    expect(none.store.getState().terminalReady).toBe(false);
  });

  it('opens with an error line and a disabled prompt when no shell port is wired, never throwing', async () => {
    const { store } = setup({ shell: false });
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    expect(store.getState()).toMatchObject({ terminalOpen: true, terminalReady: false, terminalLines: [{ kind: 'status', text: NO_SHELL_ERROR }] });
    const refused = store.getState().runTerminalCommand('ls');
    expect(refused.accepted).toBe(false);
    await expect(refused.done).resolves.toBeUndefined();
    await expect(createAppStore().getState().openTerminal('/repo/api', 'service', 'api')).resolves.toBeUndefined();
  });

  it('echoes the command, streams stdout/stderr, and leaves an exit status on a non-zero exit', async () => {
    const { store, shell } = setup();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    const running = store.getState().runTerminalCommand('make').done;
    await vi.waitFor(() => expect(shell.runs).toHaveLength(1));
    expect(store.getState().terminalRunning).toBe(true);
    shell.runs[0]!.emit({ stream: 'stdout', text: 'building' });
    shell.runs[0]!.emit({ stream: 'stderr', text: 'oops' });
    shell.runs[0]!.finish({ status: 'exited', exitCode: 2, cwd: '/repo/api/src' });
    await running;
    expect(store.getState().terminalLines).toEqual([
      { kind: 'command', text: '$ make' },
      { kind: 'stdout', text: 'building' },
      { kind: 'stderr', text: 'oops' },
      { kind: 'status', text: 'exit 2' },
    ]);
    expect(store.getState()).toMatchObject({ terminalRunning: false, terminalCwd: '/repo/api/src' });
    expect(shell.runs[0]!.cwd).toBe('/repo/api');
  });

  it('adds no status line on a clean exit and carries the new cwd into the next command', async () => {
    const { store, shell } = setup();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    const first = store.getState().runTerminalCommand('cd src').done;
    await vi.waitFor(() => expect(shell.runs).toHaveLength(1));
    shell.runs[0]!.finish({ status: 'exited', exitCode: 0, cwd: '/repo/api/src' });
    await first;
    expect(store.getState().terminalLines).toEqual([{ kind: 'command', text: '$ cd src' }]);
    const second = store.getState().runTerminalCommand('pwd').done;
    await vi.waitFor(() => expect(shell.runs).toHaveLength(2));
    expect(shell.runs[1]!.cwd).toBe('/repo/api/src');
    shell.runs[1]!.finish({ status: 'exited', exitCode: 0, cwd: '/repo/api/src' });
    await second;
  });

  it('batches streamed lines into at most one store update per flush interval', async () => {
    vi.useFakeTimers();
    const { store, shell } = setup();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    const running = store.getState().runTerminalCommand('yes').done;
    await vi.waitFor(() => expect(shell.runs).toHaveLength(1));
    const updates = vi.fn();
    const unsubscribe = store.subscribe(updates);
    for (let index = 0; index < 100; index += 1) {
      shell.runs[0]!.emit({ stream: 'stdout', text: `line ${index}` });
    }
    expect(updates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TERMINAL_FLUSH_MS);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(store.getState().terminalLines).toHaveLength(101);
    unsubscribe();
    shell.runs[0]!.finish({ status: 'exited', exitCode: 0 });
    await running;
  });

  it('keeps the display bounded with a dropped count on huge output', async () => {
    const { store, shell } = setup();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    const running = store.getState().runTerminalCommand('seq 10000').done;
    await vi.waitFor(() => expect(shell.runs).toHaveLength(1));
    for (let index = 0; index < 10_000; index += 1) {
      shell.runs[0]!.emit({ stream: 'stdout', text: String(index) });
    }
    shell.runs[0]!.finish({ status: 'exited', exitCode: 0 });
    await running;
    const { terminalLines, terminalDroppedCount } = store.getState();
    expect(terminalLines).toHaveLength(TERMINAL_MAX_LINES);
    expect(terminalDroppedCount).toBe(10_001 - TERMINAL_MAX_LINES);
    expect(terminalLines.at(-1)).toEqual({ kind: 'stdout', text: '9999' });
  });

  it('refuses a second command while one runs with the busy notice, and no-ops a blank one', async () => {
    const { store, shell } = setup();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    const blank = store.getState().runTerminalCommand('   ');
    expect(blank.accepted).toBe(true);
    await blank.done;
    expect(shell.runs).toHaveLength(0);
    expect(store.getState().terminalLines).toEqual([]);
    expect(store.getState().terminalHistory).toEqual([]);
    const running = store.getState().runTerminalCommand('sleep 30').done;
    await vi.waitFor(() => expect(shell.runs).toHaveLength(1));
    expect(store.getState().runTerminalCommand('ls').accepted).toBe(false);
    expect(shell.runs).toHaveLength(1);
    expect(store.getState().terminalNotice).toBe('a command is running');
    store.getState().cancelTerminalCommand();
    await running;
    expect(shell.runs[0]!.cancel).toHaveBeenCalled();
    expect(store.getState().terminalLines.at(-1)).toEqual({ kind: 'status', text: 'cancelled' });
    expect(store.getState()).toMatchObject({ terminalRunning: false, terminalOpen: true, terminalNotice: null });
  });

  it('shows the TTY hint for an interactive program without running it', async () => {
    const { store, shell } = setup();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    await store.getState().runTerminalCommand('vim').done;
    expect(shell.runs).toHaveLength(0);
    const last = store.getState().terminalLines.at(-1);
    expect(last?.kind).toBe('status');
    expect(last?.text).not.toMatch(/^error:/);
    expect(last?.text.length).toBeGreaterThan(0);
  });

  it('close cancels the running command, discards the session and ignores its late lines; history is kept', async () => {
    const { store, shell } = setup();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    const running = store.getState().runTerminalCommand('sleep 30').done;
    await vi.waitFor(() => expect(shell.runs).toHaveLength(1));
    store.getState().closeTerminal();
    expect(shell.runs[0]!.cancel).toHaveBeenCalled();
    shell.runs[0]!.emit({ stream: 'stdout', text: 'late' });
    await running;
    await tick();
    expect(store.getState()).toMatchObject({ terminalOpen: false, terminalLines: [], terminalRunning: false, terminalTarget: null, terminalHistory: ['sleep 30'] });

    await store.getState().openTerminal('/repo/web', 'service', 'web');
    expect(store.getState()).toMatchObject({ terminalCwd: '/repo/web', terminalLines: [], terminalHistory: ['sleep 30'] });
    store.getState().closeTerminal();
    store.getState().closeTerminal();
    expect(store.getState().terminalOpen).toBe(false);
  });

  it('drops a container manifest load that lands after the terminal closed', async () => {
    const { store, manifest } = setup();
    let release!: (value: Result<Manifest>) => void;
    vi.mocked(manifest.load).mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const opening = store.getState().openTerminal('/repo/api', 'container', 'api');
    expect(store.getState().terminalNotice).toBe('reading the manifest…');
    store.getState().closeTerminal();
    release(ok({ service: 'api', sharedBranch: 'development', modules: {}, container: 'api-ctr' } as Manifest));
    await opening;
    expect(store.getState()).toMatchObject({ terminalOpen: false, terminalReady: false, terminalTarget: null });
  });

  it('keeps only the first line of a notice', () => {
    const { store } = setup();
    store.getState().setTerminalNotice('first\nsecond\nthird');
    expect(store.getState().terminalNotice).toBe('first');
    store.getState().setTerminalNotice(null);
    expect(store.getState().terminalNotice).toBeNull();
  });

  it('records the trimmed command in the history, so padded repeats are one entry', async () => {
    const { store, shell } = setup();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    for (const [index, command] of [' ls', 'ls  '].entries()) {
      const running = store.getState().runTerminalCommand(command).done;
      await vi.waitFor(() => expect(shell.runs).toHaveLength(index + 1));
      shell.runs.at(-1)!.finish({ status: 'exited', exitCode: 0 });
      await running;
    }
    expect(store.getState().terminalHistory).toEqual(['ls']);
  });

  it('toggles fullscreen only while open', async () => {
    const { store } = setup();
    store.getState().toggleTerminalFullscreen();
    expect(store.getState().terminalFullscreen).toBe(false);
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    store.getState().toggleTerminalFullscreen();
    expect(store.getState().terminalFullscreen).toBe(true);
    store.getState().closeTerminal();
    expect(store.getState().terminalFullscreen).toBe(false);
  });
});
