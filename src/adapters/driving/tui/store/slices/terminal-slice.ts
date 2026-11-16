// tui/store/slices: the Terminal overlay — one `core/shell` session on a service's
// repo dir or its container, owned here and nowhere else. The slice holds what the view shows:
// the target, the bounded display lines (output plus the echoed command and status lines), the
// cwd, the running flag, fullscreen and a one-line notice. Streamed lines are batched so a noisy
// command costs at most one store update per TERMINAL_FLUSH_MS. Closing discards the session.
// The command history is in-memory only, shared by every terminal for the app run.
import type { StateCreator } from 'zustand';
import type { Manifest } from '../../../../../core/ports/manifest.js';
import type { ShellLine, ShellTarget } from '../../../../../core/ports/shell-session.js';
import { err, type Result } from '../../../../../core/result.js';
import { createShellSession, type ShellRunResult, type ShellSession } from '../../../../../core/shell/index.js';
import { DEFAULT_MAX_LINES } from '../../../../../core/shell/line-buffer.js';
import { pushHistoryEntry } from '../../shared/input-history/index.js';
import { TERMINAL_BUSY_NOTICE, firstLine, terminalEchoText, terminalStatusText } from './terminal-text.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

export type TerminalKind = 'service' | 'container';

export type TerminalTarget = {
  kind: TerminalKind;
  repoPath: string;
  // The service name for a service terminal, the container name once the manifest named it.
  label: string;
};

// `command` is the echoed `$ <command>`, `status` an `exit N` / `cancelled` / error line; both
// are display-only (never part of the shell's own output).
export type TerminalLineKind = 'stdout' | 'stderr' | 'command' | 'status';

export type TerminalLine = { kind: TerminalLineKind; text: string };

export type TerminalRun = { accepted: boolean; done: Promise<void> };

const REFUSED_RUN: TerminalRun = { accepted: false, done: Promise.resolve() };
const ACCEPTED_NOOP_RUN: TerminalRun = { accepted: true, done: Promise.resolve() };

export type TerminalSlice = {
  terminalOpen: boolean;
  terminalTarget: TerminalTarget | null;
  terminalLines: TerminalLine[];
  // Lines dropped off the head of `terminalLines` to keep it bounded.
  terminalDroppedCount: number;
  terminalCwd: string | null;
  terminalRunning: boolean;
  // A session exists and the prompt accepts commands.
  terminalReady: boolean;
  terminalFullscreen: boolean;
  terminalNotice: string | null;
  terminalHistory: string[];
  openTerminal: (repoPath: string, kind: TerminalKind, service: string) => Promise<void>;
  // Decided synchronously: `accepted` is false when the command was refused (no session, or one
  // already running — the busy notice then shows), so the caller keeps its draft. A blank
  // command is accepted as a no-op. `done` settles once the run is over.
  runTerminalCommand: (command: string) => TerminalRun;
  cancelTerminalCommand: () => void;
  toggleTerminalFullscreen: () => void;
  setTerminalNotice: (notice: string | null) => void;
  closeTerminal: () => void;
};

export const TERMINAL_FLUSH_MS = 50;
export const TERMINAL_HISTORY_MAX = 200;
export const TERMINAL_MAX_LINES = DEFAULT_MAX_LINES;
export const NO_SHELL_ERROR = 'error: no shell port is wired — the terminal cannot run commands';
export const MANIFEST_LOADING_NOTICE = 'reading the manifest…';

// Appends `batch` and keeps only the last `max` lines, counting what fell off the head.
export function appendTerminalLines(
  current: { lines: readonly TerminalLine[]; droppedCount: number },
  batch: readonly TerminalLine[],
  max: number = TERMINAL_MAX_LINES,
): { lines: TerminalLine[]; droppedCount: number } {
  const merged = [...current.lines, ...batch];
  const overflow = Math.max(0, merged.length - max);
  return { lines: overflow > 0 ? merged.slice(overflow) : merged, droppedCount: current.droppedCount + overflow };
}

const CLOSED_STATE = {
  terminalOpen: false,
  terminalTarget: null,
  terminalLines: [],
  terminalDroppedCount: 0,
  terminalCwd: null,
  terminalRunning: false,
  terminalReady: false,
  terminalFullscreen: false,
  terminalNotice: null,
} satisfies Partial<TerminalSlice>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createTerminalSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], TerminalSlice> {
  return (set, get) => {
    let session: ShellSession | null = null;
    // Bumped on every open and close: anything resolving for an older generation is dropped.
    let generation = 0;
    let pending: TerminalLine[] = [];
    let pendingDropped = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const append = (batch: readonly TerminalLine[], extraDropped = 0) => {
      set((state) => {
        const next = appendTerminalLines({ lines: state.terminalLines, droppedCount: state.terminalDroppedCount + extraDropped }, batch);
        return { terminalLines: next.lines, terminalDroppedCount: next.droppedCount };
      });
    };
    const discardPending = () => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pending = [];
      pendingDropped = 0;
    };
    const flush = () => {
      const batch = pending;
      const dropped = pendingDropped;
      discardPending();
      if (batch.length > 0 || dropped > 0) {
        append(batch, dropped);
      }
    };
    const queue = (line: TerminalLine) => {
      pending.push(line);
      // A burst between two flushes stays bounded too.
      if (pending.length > TERMINAL_MAX_LINES * 2) {
        const overflow = pending.length - TERMINAL_MAX_LINES;
        pending = pending.slice(overflow);
        pendingDropped += overflow;
      }
      if (flushTimer === null) {
        flushTimer = setTimeout(flush, TERMINAL_FLUSH_MS);
      }
    };
    const status = (text: string) => append([{ kind: 'status', text }]);
    // Runs one accepted command to its end: echo, streamed output, status line.
    const execute = async (active: ShellSession, command: string): Promise<void> => {
      const current = generation;
      flush();
      set((state) => ({
        terminalHistory: pushHistoryEntry(state.terminalHistory, command.trim(), TERMINAL_HISTORY_MAX),
        terminalRunning: true,
        terminalNotice: null,
      }));
      append([{ kind: 'command', text: terminalEchoText(command) }]);
      let result: Result<ShellRunResult>;
      try {
        result = await active.run(command, (line: ShellLine) => {
          if (current === generation) {
            queue({ kind: line.stream, text: line.text });
          }
        });
      } catch (error) {
        result = err('shell-unavailable', errorMessage(error));
      }
      if (current !== generation) {
        return;
      }
      flush();
      const text = terminalStatusText(result);
      if (text !== null) {
        status(text);
      }
      set({ terminalRunning: false, terminalCwd: active.cwd() ?? null, terminalNotice: null });
    };


    return {
      ...CLOSED_STATE,
      terminalHistory: [],
      openTerminal: async (repoPath, kind, service) => {
        if (get().terminalOpen) {
          return;
        }
        generation += 1;
        const current = generation;
        discardPending();
        session = null;
        set({ ...CLOSED_STATE, terminalOpen: true, terminalTarget: { kind, repoPath, label: service } });
        if (deps?.shell === undefined) {
          status(NO_SHELL_ERROR);
          return;
        }
        let target: ShellTarget;
        if (kind === 'service') {
          target = { kind: 'service', repoPath };
        } else {
          set({ terminalNotice: MANIFEST_LOADING_NOTICE });
          let loaded: Result<Manifest>;
          try {
            loaded = await deps.manifest.load(repoPath);
          } catch (error) {
            loaded = err('manifest-unreadable', errorMessage(error));
          }
          if (current !== generation) {
            return;
          }
          set({ terminalNotice: null });
          if (!loaded.ok) {
            status(`error: could not read the manifest — ${firstLine(loaded.error.message)}`);
            return;
          }
          const container = loaded.data.container?.trim() ?? '';
          if (container === '') {
            status('error: the manifest declares no container');
            return;
          }
          target = { kind: 'container', container };
          set({ terminalTarget: { kind, repoPath, label: container } });
        }
        const created = createShellSession({ shell: deps.shell, docker: deps.docker }, target);
        if (!created.ok) {
          status(`error: ${firstLine(created.error.message)}`);
          return;
        }
        session = created.data;
        set({ terminalReady: true, terminalCwd: session.cwd() ?? null });
      },
      runTerminalCommand: (command) => {
        const active = session;
        if (active === null || !get().terminalOpen) {
          return REFUSED_RUN;
        }
        if (active.isRunning() || get().terminalRunning) {
          set({ terminalNotice: TERMINAL_BUSY_NOTICE });
          return REFUSED_RUN;
        }
        if (command.trim() === '') {
          return ACCEPTED_NOOP_RUN;
        }
        return { accepted: true, done: execute(active, command) };
      },
      cancelTerminalCommand: () => {
        session?.cancel();
      },
      toggleTerminalFullscreen: () => {
        if (get().terminalOpen) {
          set((state) => ({ terminalFullscreen: !state.terminalFullscreen }));
        }
      },
      // The notice has a one-row budget in the view: only its first line is kept.
      setTerminalNotice: (notice) => {
        const next = notice === null ? null : firstLine(notice);
        if (get().terminalNotice !== next) {
          set({ terminalNotice: next });
        }
      },
      // Idempotent; also the app's exit-path cleanup: the running command is cancelled and the
      // session, its cwd and its output are dropped. The history stays for the next terminal.
      closeTerminal: () => {
        generation += 1;
        try {
          session?.cancel();
        } catch {
          // Best-effort: closing must never throw.
        }
        session = null;
        discardPending();
        if (get().terminalOpen) {
          set({ ...CLOSED_STATE });
        }
      },
    };
  };
}
