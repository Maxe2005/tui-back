// core/shell/tty-guard: fail fast on commands that need an interactive terminal. The shell
// session is line-oriented (no PTY, stdin closed), so a full-screen program or a bare REPL
// would either hang or misbehave; detecting the obvious cases upfront lets the view show a
// hint instead. A heuristic, not a parser: it looks at the program word of each `;` / `&&` /
// `||` / `|` / `&` / `)` segment (quote-aware, comments ignored), after any leading
// `VAR=value` assignments and wrapper commands (sudo, env, exec, nohup, time, command).
// Known blind spots: command substitution (`$(vim)`), `eval`, aliases and functions.

// Always interactive, unless only asked for their version/help (or `top` in batch mode).
const FULL_SCREEN = new Set(['vi', 'vim', 'nvim', 'nano', 'emacs', 'less', 'more', 'man', 'top', 'htop', 'watch']);
const NON_INTERACTIVE_FLAGS = new Set(['--version', '--help', '-h']);
const TOP_BATCH = /^-[^-]*b/;

// Interactive only when started with no further arguments (a REPL / login shell).
const BARE_REPL = new Set(['sh', 'bash', 'zsh', 'python', 'python3', 'node', 'psql', 'mysql', 'redis-cli']);

// ssh option letters that consume a value (the rest of the word, or the next word).
const SSH_VALUE_LETTERS = new Set(['B', 'b', 'c', 'D', 'E', 'e', 'F', 'I', 'i', 'J', 'L', 'l', 'm', 'O', 'o', 'P', 'p', 'Q', 'R', 'S', 'W', 'w']);

// Wrapper commands that run the next word as the program, with their value-taking options.
const WRAPPERS = new Map<string, ReadonlySet<string>>([
  ['sudo', new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-U', '-r', '-t', '-R', '-T'])],
  ['env', new Set(['-u', '-C', '-S'])],
  ['exec', new Set(['-a'])],
  ['nohup', new Set()],
  ['time', new Set()],
  ['command', new Set()],
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// A redirection word: optional fd (or `&`), the operator, then its target if attached.
const REDIRECTION = /^(\d*|&)(>&|<&|>>|>\||<<<|<<|>|<)(.*)$/s;

// Splits a command line into segments of words. Quotes group words and hide operators;
// backslash escapes the next character outside single quotes; an unquoted `#` starting a word
// comments out the rest of the line; a leading `(` / `{` on a word is a grouping, not part of
// the program name; the `&` of `>&` / `2>&1` / `&>` is a redirection, not a separator.
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
    } else if (!inWord && char === '#') {
      // Comment: skip to the end of the line (the newline itself still ends the segment).
      while (index + 1 < command.length && command.charAt(index + 1) !== '\n') {
        index += 1;
      }
    } else if (!inWord && (char === '(' || char === '{')) {
      // Grouping before a word: not part of the program name.
    } else if (char === '&' && (command.charAt(index - 1) === '>' || command.charAt(index - 1) === '<' || command.charAt(index + 1) === '>')) {
      word += char;
      inWord = true;
    } else if (char === ';' || char === '|' || char === '&' || char === ')' || char === '\n') {
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

// Drops redirection words (`>f`, `2>&1`, `&>f`) and, for a bare operator (`>`, `<`), the
// target word that follows it.
export function withoutRedirections(args: readonly string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    const match = REDIRECTION.exec(arg);
    if (match !== null) {
      if (match[3] === '') {
        index += 1;
      }
      continue;
    }
    kept.push(arg);
  }
  return kept;
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
      // Possibly bundled (`-vp 22`, `-p22`): the first value-taking letter consumes the rest
      // of the word, or the next word when it is the last letter.
      for (let letter = 1; letter < arg.length; letter += 1) {
        if (SSH_VALUE_LETTERS.has(arg.charAt(letter))) {
          if (letter === arg.length - 1) {
            index += 1;
          }
          break;
        }
      }
      continue;
    }
    positional += 1;
  }
  // The first positional word is the destination; anything after it is the remote command.
  return positional >= 2;
}

// Returns the index of the program word of `segment` after assignments and wrapper commands,
// or undefined when the segment runs no program (or only looks one up, as `command -v`).
function programIndex(segment: readonly string[]): number | undefined {
  let index = 0;
  for (;;) {
    while (index < segment.length && ASSIGNMENT.test(segment[index] ?? '')) {
      index += 1;
    }
    const word = segment[index];
    if (word === undefined) {
      return undefined;
    }
    const valueOptions = WRAPPERS.get(basename(word));
    if (valueOptions === undefined) {
      return index;
    }
    index += 1;
    if (basename(word) === 'command' && (segment[index] === '-v' || segment[index] === '-V')) {
      return undefined;
    }
    while (index < segment.length && (segment[index] ?? '').startsWith('-') && (segment[index] ?? '').length > 1) {
      const option = segment[index] ?? '';
      index += 1;
      if (option === '--') {
        break;
      }
      if (valueOptions.has(option)) {
        index += 1;
      }
    }
  }
}

function hint(program: string): string {
  return `"${program}" needs an interactive terminal (TTY), which this line-oriented shell cannot provide — run it in a real terminal instead`;
}

// Returns a hint for the first segment that needs a TTY, or null when the command looks
// line-oriented.
export function detectTtyCommand(command: string): string | null {
  for (const segment of splitSegments(command)) {
    const first = programIndex(segment);
    if (first === undefined) {
      continue;
    }
    const program = basename(segment[first] ?? '');
    const args = withoutRedirections(segment.slice(first + 1));
    if (FULL_SCREEN.has(program)) {
      const nonInteractive =
        args.some((arg) => NON_INTERACTIVE_FLAGS.has(arg)) || (program === 'top' && args.some((arg) => TOP_BATCH.test(arg)));
      if (!nonInteractive) {
        return hint(program);
      }
      continue;
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
