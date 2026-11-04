// adapters/driven/shell-session (pure parts): command wrapping, line splitting and the cwd
// sentinel filter. No I/O here, so every edge case is unit-testable without spawning.

// Wraps the user's command so the shell reports its final working directory on stdout after
// it ran: `<cmd>`, then on its own line the exit status is saved, the sentinel + `$PWD` is
// printed (prefixed by a newline so it always starts a fresh line, even after output without a
// trailing newline), and the shell exits with the command's status. The newline after `<cmd>`
// also ends any trailing `# comment` in it. A command that calls `exit` itself never reaches
// the sentinel — the caller then keeps the previous cwd.
export function wrapCommand(command: string, sentinel: string): string {
  return `${command}\n__rc=$?; printf '\\n%s%s\\n' '${sentinel}' "$PWD"; exit $__rc`;
}

export interface LineSplitter {
  push(chunk: string): void;
  // Flushes a trailing partial line (output not ending with a newline).
  end(): void;
}

// Splits a decoded stream into lines: `\n` terminators, a trailing `\r` stripped, empty lines
// kept (they are real output), and the unterminated tail flushed on `end()`.
export function createLineSplitter(emit: (text: string) => void): LineSplitter {
  let pending = '';
  let ended = false;
  return {
    push(chunk) {
      if (ended) {
        return;
      }
      pending += chunk;
      let index = pending.indexOf('\n');
      while (index >= 0) {
        emit(pending.slice(0, index).replace(/\r$/, ''));
        pending = pending.slice(index + 1);
        index = pending.indexOf('\n');
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
  // Flushes any held-back line; returns the cwd the sentinel reported, if one was seen.
  end(): { cwd?: string };
}

// Hides the sentinel line from stdout and captures the path it carries. The wrapper's printf
// starts with a newline, which shows up as one extra empty line whenever the command's own
// output already ended with a newline: an empty line is therefore held back until the next
// line proves whether it was that artifact (sentinel follows → dropped) or real output.
export function createSentinelFilter(sentinel: string, emit: (text: string) => void): SentinelFilter {
  let heldEmpty = false;
  let cwd: string | undefined;
  let ended = false;
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
      if (heldEmpty) {
        heldEmpty = false;
        emit('');
      }
      if (text === '' && cwd === undefined) {
        heldEmpty = true;
        return;
      }
      emit(text);
    },
    end() {
      if (!ended) {
        ended = true;
        if (heldEmpty) {
          heldEmpty = false;
          emit('');
        }
      }
      return cwd === undefined || cwd === '' ? {} : { cwd };
    },
  };
}
