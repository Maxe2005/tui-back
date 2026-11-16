// adapters/driven/shell-session (pure parts): command wrapping, line splitting and the cwd
// sentinel filter. No I/O here, so every edge case is unit-testable without spawning.

// Wraps the user's command so the shell reports its final working directory on stdout when it
// exits. The report comes from an EXIT trap installed *before* the command, so it still fires
// when the command calls `exit`, runs under `set -e`, ends with a dangling backslash or an
// unterminated heredoc — anything short of a signal (or the command replacing the trap). The
// trap preserves the exit status. Its printf starts with a newline so the sentinel always
// starts a fresh line, even after output without a trailing newline. The sentinel is made of
// [A-Za-z0-9_:] only, so it is safe inside the quoting below.
export function wrapCommand(command: string, sentinel: string): string {
  return `trap '__rc=$?; printf "\\n%s%s\\n" "${sentinel}" "$PWD"; exit $__rc' EXIT\n${command}`;
}

// Longest line the splitter buffers: past this many characters without a `\n`, the pending
// text is emitted as a line of its own so memory stays bounded.
export const MAX_LINE_LENGTH = 8192;

export interface LineSplitter {
  push(chunk: string): void;
  // Flushes a trailing partial line (output not ending with a newline).
  end(): void;
}

// Splits a decoded stream into lines: `\n` terminators, a trailing `\r` stripped, empty lines
// kept (they are real output), over-long lines cut every MAX_LINE_LENGTH characters, and the
// unterminated tail flushed on `end()`.
export function createLineSplitter(emit: (text: string) => void, maxLineLength = MAX_LINE_LENGTH): LineSplitter {
  let pending = '';
  let ended = false;
  return {
    push(chunk) {
      if (ended) {
        return;
      }
      pending += chunk;
      for (;;) {
        const index = pending.indexOf('\n');
        if (index >= 0 && index <= maxLineLength) {
          emit(pending.slice(0, index).replace(/\r$/, ''));
          pending = pending.slice(index + 1);
        } else if (pending.length >= maxLineLength) {
          emit(pending.slice(0, maxLineLength));
          pending = pending.slice(maxLineLength);
        } else {
          break;
        }
      }
    },
    end() {
      if (ended) {
        return;
      }
      ended = true;
      if (pending !== '') {
        emit(pending.replace(/\r$/, ''));
        pending = '';
      }
    },
  };
}

export interface SentinelFilter {
  line(text: string): void;
  // Emits a held-back empty line now (called before a stderr line is delivered, so the
  // stdout/stderr order is preserved).
  flushHeld(): void;
  // Flushes any held-back line; returns the cwd the sentinel reported, if one was seen.
  end(): { cwd?: string };
}

// Hides the sentinel line from stdout and captures the path it carries. The trap's printf
// starts with a newline, which shows up as one extra empty line whenever the command's own
// output already ended with a newline: an empty line is therefore held back until the next
// line proves whether it was that artifact (sentinel follows → dropped) or real output.
export function createSentinelFilter(sentinel: string, emit: (text: string) => void): SentinelFilter {
  let heldEmpty = false;
  let cwd: string | undefined;
  let ended = false;
  const flushHeld = (): void => {
    if (heldEmpty) {
      heldEmpty = false;
      emit('');
    }
  };
  return {
    line(text) {
      if (ended) {
        return;
      }
      if (cwd === undefined && text.startsWith(sentinel)) {
        heldEmpty = false;
        cwd = text.slice(sentinel.length);
        return;
      }
      flushHeld();
      if (text === '' && cwd === undefined) {
        heldEmpty = true;
        return;
      }
      emit(text);
    },
    flushHeld() {
      if (!ended) {
        flushHeld();
      }
    },
    end() {
      if (!ended) {
        flushHeld();
        ended = true;
      }
      return cwd === undefined || cwd === '' ? {} : { cwd };
    },
  };
}
