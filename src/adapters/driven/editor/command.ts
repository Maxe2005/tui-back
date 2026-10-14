// adapters/driven/editor/command: pure editor command-line parsing — tokenizing and argv resolution.

// The placeholder a configured editor command carries where the blocked repo's path goes
// (`code <repo>`, `idea --line 1 <repo>`, `--folder-uri=<repo>`).
export const EDITOR_REPO_PLACEHOLDER = '<repo>';

// Splits a command line into argv tokens on whitespace, honoring single/double quotes so a
// binary or argument containing spaces stays one token (`"/opt/My Editor/bin/ed" <repo>`).
// No shell is ever involved (the command is spawned directly), so there is no escaping,
// globbing, or variable expansion to emulate — quotes only group.
export function tokenizeCommandLine(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const char of command) {
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (started) {
    tokens.push(current);
  }
  return tokens;
}

// Resolves the argv the "Open in editor" choice spawns on a blocked repo. Precedence: the
// `general.editorCommand` setting, then `$EDITOR`, then `vi` — a blank value at any level
// falls through to the next. Every `<repo>` occurrence is replaced by the repo path; a
// command without the placeholder gets the path appended as its last argument (the
// `$EDITOR` convention: `code --wait` -> `code --wait <path>`).
export function resolveEditorCommand(
  configured: string,
  envEditor: string | undefined,
  repoPath: string,
): { binary: string; args: string[] } {
  const source = [configured, envEditor ?? ''].map((candidate) => tokenizeCommandLine(candidate)).find((tokens) => tokens.length > 0);
  const [binary = 'vi', ...rest] = source ?? [];
  if (!rest.some((token) => token.includes(EDITOR_REPO_PLACEHOLDER))) {
    return { binary, args: [...rest, repoPath] };
  }
  return { binary, args: rest.map((token) => token.split(EDITOR_REPO_PLACEHOLDER).join(repoPath)) };
}
