import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TUI = fileURLToPath(new URL('../../', import.meta.url));

// Files allowed to spell a `[Key] verb` literal: the helper that defines the format, and the
// Dashboard, which belongs to a later story and keeps its own empty-registry sentence.
const ALLOWED = new Set(['shared/components/hints.ts', 'zones/dashboard/dashboard-zone.tsx']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const KEY =
  '(?:Enter|Esc|Space|Tab|Home|End|Ctrl\\+[^\\]\\s]+|Shift\\+[^\\]\\s]+|[↑↓←→/]+|[A-Za-z0-9+\\-?:]{1,3}(?:/[A-Za-z0-9+\\-]{1,3})*)';
// A bracketed key followed by a word, not directly after an identifier or a closing bracket (so
// `rows[i] value` is not a hint). Prose such as "Enter to open" or "Press [" is caught too.
const HAND_WRITTEN_HINT = new RegExp(`(?<![\\w)\\]])\\[(?!x\\])${KEY}\\]\\s+[A-Za-z]|\\b(?:Enter|Esc|Space|Tab) to [a-z]|Press \\[`);

function isComment(line: string): boolean {
  return /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);
}

function offendersIn(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, index) => (!isComment(line) && HAND_WRITTEN_HINT.test(line) ? [`${index + 1}: ${line.trim()}`] : []));
}

describe('hint format guard', () => {
  const files = sourceFiles(TUI).map((file) => ({ file, path: relative(TUI, file).split(sep).join('/') }));

  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('builds every hint through formatHints, never as a hand-written literal', () => {
    const offenders = files
      .filter(({ path }) => !ALLOWED.has(path))
      .flatMap(({ file, path }) => offendersIn(file).map((line) => `${path}:${line}`));
    expect(offenders).toEqual([]);
  });

  it('recognises hand-written hints and leaves plain code alone', () => {
    expect(HAND_WRITTEN_HINT.test("'[Enter] confirm  [Esc] cancel'")).toBe(true);
    expect(HAND_WRITTEN_HINT.test('`[R] retry`')).toBe(true);
    expect(HAND_WRITTEN_HINT.test('Space to toggle')).toBe(true);
    expect(HAND_WRITTEN_HINT.test('const label = rows[index] ?? other')).toBe(false);
    expect(HAND_WRITTEN_HINT.test("'[x] yes'")).toBe(false);
  });

  it('keeps no stale allowlist entries', () => {
    const paths = new Set(files.map(({ path }) => path));
    expect([...ALLOWED].filter((entry) => !paths.has(entry))).toEqual([]);
  });
});
