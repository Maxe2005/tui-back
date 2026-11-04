// core/shell/tty-guard: fail fast on commands that need an interactive terminal. The shell
// session is line-oriented (no PTY, stdin closed), so a full-screen program or a bare REPL
// would either hang or misbehave; detecting the obvious cases upfront lets the view show a
// hint instead. A heuristic, not a parser: it looks at the first word of each `;` / `&&` /
// `||` / `|` / `&` segment (quote-aware), after any leading `VAR=value` assignments.

// Always interactive, whatever their arguments.
const FULL_SCREEN = new Set(['vi', 'vim', 'nvim', 'nano', 'emacs', 'less', 'more', 'man', 'top', 'htop', 'watch']);

// Interactive only when started with no further arguments (a REPL / login shell).
const BARE_REPL = new Set(['sh', 'bash', 'zsh', 'python', 'python3', 'node', 'psql', 'mysql', 'redis-cli']);

// ssh options that consume the following word as their value.
const SSH_VALUE_OPTIONS = new Set([
  '-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m', '-O', '-o', '-P', '-p', '-Q', '-R', '-S', '-W', '-w',
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Splits a command line into segments of words. Quotes group words and hide operators;
// backslash escapes the next character outside single quotes.
export function splitSegments(command: string): string[][] {
  const segments: string[][] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: '"' | "'" | undefined;

  const endWord = (): void => {
    if (inWord) {
      words.push(word);
    }
    word = '';
    inWord = false;
  };
  const endSegment = (): void => {
    endWord();
    if (words.length > 0) {
      segments.push(words);
    }
    words = [];
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command.charAt(index);
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else if (char === '\\' && quote === '"' && index + 1 < command.length) {
        index += 1;
        word += command.charAt(index);
      } else {
        word += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      inWord = true;
    } else if (char === '\\' && index + 1 < command.length) {
      index += 1;
      word += command.charAt(index);
      inWord = true;
    } else if (char === ';' || char === '|' || char === '&' || char === '\n') {
      endSegment();
      // `&&` / `||` are two characters; skip the second one.
      if ((char === '|' || char === '&') && command.charAt(index + 1) === char) {
        index += 1;
      }
    } else if (char === ' ' || char === '\t') {
      endWord();
    } else {
      word += char;
      inWord = true;
    }
  }
  endSegment();
  return segments;
}

function basename(word: string): string {
  const slash = word.lastIndexOf('/');
  return slash >= 0 ? word.slice(slash + 1) : word;
}

function sshHasRemoteCommand(args: readonly string[]): boolean {
  let positional = 0;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--') {
      positional += args.length - index - 1;
      break;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      if (SSH_VALUE_OPTIONS.has(arg)) {
        index += 1;
      }
      continue;
    }
    positional += 1;
  }
  // The first positional word is the destination; anything after it is the remote command.
  return positional >= 2;
}

function hint(program: string): string {
  return `"${program}" needs an interactive terminal (TTY), which this line-oriented shell cannot provide — run it in a real terminal instead`;
}

// Returns a hint for the first segment that needs a TTY, or null when the command looks
// line-oriented.
export function detectTtyCommand(command: string): string | null {
  for (const segment of splitSegments(command)) {
    let first = 0;
    while (first < segment.length && ASSIGNMENT.test(segment[first] ?? '')) {
      first += 1;
    }
    const word = segment[first];
    if (word === undefined) {
      continue;
    }
    const program = basename(word);
    const args = segment.slice(first + 1);
    if (FULL_SCREEN.has(program)) {
      return hint(program);
    }
    if (program === 'ssh') {
      if (!sshHasRemoteCommand(args)) {
        return hint('ssh');
      }
      continue;
    }
    if (BARE_REPL.has(program) && args.length === 0) {
      return hint(program);
    }
  }
  return null;
}
