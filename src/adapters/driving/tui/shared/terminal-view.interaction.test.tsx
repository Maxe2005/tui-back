// tui/shared/terminal-view: real keypresses on the mounted Terminal overlay over the real
// terminal slice and core shell session (fake ShellSessionPort) — run, stream, history, cancel,
// confirm-close, focus, help and fullscreen — plus the shell-level key ownership (nothing global
// fires behind it).
import { createElement } from 'react';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { ok } from '../../../../core/result.js';
import type { Manifest } from '../../../../core/ports/manifest.js';
import type { ShellLine, ShellRunOutcome, ShellSessionPort, ShellTarget } from '../../../../core/ports/shell-session.js';
import { AppShell } from '../app-shell.js';
import { createAppStore, type AppStoreDeps } from '../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from './test-support/fake-tty.js';
import { footerIdOf } from './test-support/mount-for-test.js';
import { TerminalView } from './terminal-view.js';

const CTRL_C = '\x03';
const CTRL_F = '\x06';

type Run = { target: ShellTarget; command: string; emit: (line: ShellLine) => void; finish: (outcome: ShellRunOutcome) => void; cancel: ReturnType<typeof vi.fn> };

function fakeShell() {
  const runs: Run[] = [];
  const port: ShellSessionPort = {
    run: vi.fn((target, _cwd, command, onLine) => {
      let resolve!: (outcome: ShellRunOutcome) => void;
      const done = new Promise<ShellRunOutcome>((r) => {
        resolve = r;
      });
      const cancel = vi.fn(() => resolve({ status: 'cancelled' }));
      runs.push({ target, command, emit: onLine, finish: resolve, cancel });
      return { cancel, done };
    }),
  };
  return { port, runs };
}

function terminalStore() {
  const shell = fakeShell();
  const store = createAppStore({
    shell: shell.port,
    manifest: { load: vi.fn(async () => ok({ service: 'api', sharedBranch: 'development', modules: {}, container: 'api-ctr' } as Manifest)) },
    docker: { getContainerHealth: vi.fn(async () => ok('up')) },
  } as unknown as AppStoreDeps);
  return { store, shell };
}

function mount(node: Parameters<typeof render>[0]) {
  const stdout = new FakeTtyStdout();
  Object.assign(stdout, { columns: 100, rows: 30 });
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdin, stdout };
}

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

// A lone ESC is only delivered once Ink's own pending-input timer fires (see app-shell.interaction).
async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
  await press(instance, stdin, KEYS.escape);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await instance.waitUntilRenderFlush();
}

async function type(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, text: string): Promise<void> {
  for (const char of text) {
    await press(instance, stdin, char);
  }
}

async function settle(instance: ReturnType<typeof render>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 80));
  await instance.waitUntilRenderFlush();
}

describe('TerminalView interaction', () => {
  it('runs a command, streams its output, recalls history and cancels with Ctrl+C', async () => {
    const { store, shell } = terminalStore();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    const { instance, stdin, stdout } = mount(createElement(TerminalView, { useStore: store }));
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Terminal · api');
      expect(stdout.output).toContain('/repo/api');
      expect(footerIdOf(store)).toBe('terminal-prompt');

      await type(instance, stdin, 'ls');
      await press(instance, stdin, KEYS.enter);
      await vi.waitFor(() => expect(shell.runs).toHaveLength(1));
      expect(shell.runs[0]!.command).toBe('ls');
      expect(footerIdOf(store)).toBe('terminal-running');
      shell.runs[0]!.emit({ stream: 'stdout', text: 'README.md' });
      shell.runs[0]!.emit({ stream: 'stderr', text: 'warning: dim' });
      shell.runs[0]!.finish({ status: 'exited', exitCode: 0, cwd: '/repo/api' });
      await settle(instance);
      expect(stdout.output).toContain('$ ls');
      expect(stdout.output).toContain('README.md');
      expect(stdout.output).toContain('warning: dim');

      // Up recalls the last command into the prompt; Enter runs it again.
      await press(instance, stdin, KEYS.up);
      await press(instance, stdin, KEYS.enter);
      await vi.waitFor(() => expect(shell.runs).toHaveLength(2));
      expect(shell.runs[1]!.command).toBe('ls');

      // Enter while it runs keeps the draft and shows the busy notice.
      await type(instance, stdin, 'pwd');
      await press(instance, stdin, KEYS.enter);
      expect(shell.runs).toHaveLength(2);
      expect(store.getState().terminalNotice).toBe('a command is running');

      await press(instance, stdin, CTRL_C);
      await settle(instance);
      expect(shell.runs[1]!.cancel).toHaveBeenCalled();
      expect(store.getState().terminalLines.at(-1)).toEqual({ kind: 'status', text: 'cancelled' });
      expect(store.getState().terminalOpen).toBe(true);

      // The kept draft runs once idle; Ctrl+C on an idle prompt only clears the draft.
      await press(instance, stdin, KEYS.enter);
      await vi.waitFor(() => expect(shell.runs).toHaveLength(3));
      expect(shell.runs[2]!.command).toBe('pwd');
      shell.runs[2]!.finish({ status: 'exited', exitCode: 0 });
      await settle(instance);
      await type(instance, stdin, 'junk');
      await press(instance, stdin, CTRL_C);
      await press(instance, stdin, KEYS.enter);
      expect(shell.runs).toHaveLength(3);
      expect(store.getState().terminalHistory).toEqual(['pwd', 'ls']);
    } finally {
      instance.unmount();
    }
  });

  it('asks before closing on a running command: Esc keeps it, Enter cancels it and closes', async () => {
    const { store, shell } = terminalStore();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    const { instance, stdin, stdout } = mount(createElement(TerminalView, { useStore: store }));
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'sleep 30');
      await press(instance, stdin, KEYS.enter);
      await vi.waitFor(() => expect(shell.runs).toHaveLength(1));

      await pressEscape(instance, stdin);
      expect(stdout.output).toContain('Enter cancels it and closes');
      expect(footerIdOf(store)).toBe('terminal-confirm-close');
      await pressEscape(instance, stdin);
      expect(store.getState().terminalOpen).toBe(true);
      expect(shell.runs[0]!.cancel).not.toHaveBeenCalled();

      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      expect(shell.runs[0]!.cancel).toHaveBeenCalled();
      expect(store.getState().terminalOpen).toBe(false);
    } finally {
      instance.unmount();
    }
  });

  it('Tab focuses the output (scroll, ? help); a printable key types back into the prompt; Ctrl+F toggles fullscreen', async () => {
    const { store } = terminalStore();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    store.setState({ terminalLines: Array.from({ length: 100 }, (_, i) => ({ kind: 'stdout' as const, text: `line ${i}` })) });
    const { instance, stdin, stdout } = mount(createElement(TerminalView, { useStore: store }));
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      expect(footerIdOf(store)).toBe('terminal-output');
      await press(instance, stdin, KEYS.up);
      await press(instance, stdin, KEYS.pageUp);
      expect(stdout.output).toMatch(/↑ \d+ back/);

      await press(instance, stdin, '?');
      expect(store.getState().helpOpen).toBe(true);
      store.getState().closeHelp();
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, 'x');
      expect(footerIdOf(store)).toBe('terminal-prompt');
      expect(stdout.output).toContain('$ x');

      await press(instance, stdin, CTRL_F);
      expect(store.getState().terminalFullscreen).toBe(true);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, CTRL_F);
      expect(store.getState().terminalFullscreen).toBe(false);

      await pressEscape(instance, stdin);
      expect(store.getState().terminalOpen).toBe(false);
    } finally {
      instance.unmount();
    }
  });

  it('keeps the draft when the store refuses the run', async () => {
    const { store } = terminalStore();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    const runTerminalCommand = vi.fn((_command: string) => ({ accepted: false, done: Promise.resolve() }));
    store.setState({ runTerminalCommand });
    const { instance, stdin, stdout } = mount(createElement(TerminalView, { useStore: store }));
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'ls');
      await press(instance, stdin, KEYS.enter);
      runTerminalCommand.mockReturnValue({ accepted: true, done: Promise.resolve() });
      await press(instance, stdin, KEYS.enter);
      expect(runTerminalCommand.mock.calls).toEqual([['ls'], ['ls']]);
      await press(instance, stdin, KEYS.enter);
      expect(runTerminalCommand).toHaveBeenLastCalledWith('');
      expect(stdout.output).toContain('$ ls');
    } finally {
      instance.unmount();
    }
  });

  it('opens with an error line and a disabled prompt when no shell port is wired', async () => {
    const store = createAppStore();
    await store.getState().openTerminal('/repo/api', 'service', 'api');
    const { instance, stdin, stdout } = mount(createElement(TerminalView, { useStore: store }));
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('no shell port is wired');
      expect(stdout.output).toContain('prompt unavailable');
      await type(instance, stdin, 'ls');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().terminalHistory).toEqual([]);
      await pressEscape(instance, stdin);
      expect(store.getState().terminalOpen).toBe(false);
    } finally {
      instance.unmount();
    }
  });
});

describe('AppShell with the Terminal open', () => {
  it('types q, :, ? and zone mnemonics into the prompt while nothing global or zone-level fires', async () => {
    const store = createAppStore();
    const runTerminalCommand = vi.fn((_command: string) => ({ accepted: true, done: Promise.resolve() }));
    store.setState({
      terminalOpen: true,
      terminalReady: true,
      terminalTarget: { kind: 'service', repoPath: '/repo/api', label: 'api' },
      terminalCwd: '/repo/api',
      runTerminalCommand,
    });
    const onQuit = vi.fn();
    const { instance, stdin } = mount(createElement(AppShell, { useStore: store, onQuit }));
    try {
      await settle(instance);
      const zoneBefore = store.getState().activeZone;
      for (const key of ['q', ':', '?', 'e', 'u', 'A', KEYS.right]) {
        await press(instance, stdin, key);
      }
      await press(instance, stdin, '\x17');
      expect(onQuit).not.toHaveBeenCalled();
      expect(store.getState()).toMatchObject({ activeZone: zoneBefore, commandBarOpen: false, helpOpen: false, realignScreenOpen: false, resizeMode: null });
      expect(footerIdOf(store)).toBe('terminal-prompt');

      await press(instance, stdin, KEYS.enter);
      expect(runTerminalCommand).toHaveBeenCalledWith('q:?euA');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
