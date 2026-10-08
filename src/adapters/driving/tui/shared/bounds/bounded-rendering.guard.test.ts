// Static half of the bounded-rendering guard. Outside the shared primitives, dynamic text must be
// truncated (or go through TruncatedText/ClampedParagraph), and a list built with .map in JSX
// must iterate a windowed, capped or constant collection. The allow-list is empty on purpose:
// a new surface is bounded, not excused.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TUI = fileURLToPath(new URL('../../', import.meta.url));

const ALLOWED = new Set<string>();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

// The primitives that implement bounding, and the test fixtures, may use raw Text and .map.
function isPrimitive(path: string): boolean {
  return path.startsWith('shared/components/') || path.startsWith('shared/bounds/') || path.startsWith('shared/test-support/');
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

export function dynamicTextOffenders(source: string): number[] {
  const offenders: number[] = [];
  const text = /<Text\b([^>]*?)>([\s\S]*?)<\/Text>/g;
  for (let match = text.exec(source); match !== null; match = text.exec(source)) {
    const [, attrs = '', body = ''] = match;
    if (/wrap=(?:"truncate|\{[^}]*truncate)/.test(attrs)) continue;
    // A JSX expression that is not a plain string literal.
    if (/\{(?!\s*['"`][^'"`{}]*['"`]\s*\})/.test(body)) offenders.push(lineOf(source, match.index));
  }
  return offenders;
}

// A receiver is bounded when it is a constant, a window/visible slice, an explicit cap, or the
// output of a bounding helper.
const BOUNDED_RECEIVER = /^(?:[A-Z][A-Z0-9_]+\b|visible\w*|window\w*|.*\.slice\(|.*capOlder\()/;

// The text of a call's argument list, from just after its opening parenthesis to the match.
function callText(source: string, start: number): string {
  let depth = 1;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

function rendersJsx(call: string): boolean {
  return /=>\s*\(?\s*<[A-Za-z>]/.test(call) || /return\s*\(?\s*<[A-Za-z>]/.test(call);
}

export function unwindowedMapOffenders(source: string): number[] {
  const offenders: number[] = [];
  const map = /([A-Za-z_$][\w$.?!()[\]]*?)\.map\(/g;
  for (let match = map.exec(source); match !== null; match = map.exec(source)) {
    const receiver = (match[1] ?? '').replace(/^\(/, '');
    if (!rendersJsx(callText(source, match.index + match[0].length))) continue;
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const prefix = source.slice(lineStart, match.index);
    const fullReceiver = prefix.trimStart().replace(/^[{?:&|() ]+/, '') + (match[1] ?? '');
    if (BOUNDED_RECEIVER.test(receiver) || BOUNDED_RECEIVER.test(fullReceiver)) continue;
    offenders.push(lineOf(source, match.index));
  }
  return offenders;
}

describe('bounded-rendering static guard', () => {
  const files = sourceFiles(TUI)
    .map((file) => ({ file, path: relative(TUI, file).split(sep).join('/') }))
    .filter(({ path }) => !isPrimitive(path) && !ALLOWED.has(path));

  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('has an empty allow-list', () => {
    expect([...ALLOWED]).toEqual([]);
  });

  it('truncates every dynamic Text outside the shared primitives', () => {
    const offenders = files.flatMap(({ file, path }) =>
      dynamicTextOffenders(readFileSync(file, 'utf8')).map((line) => `${path}:${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it('windows or caps every list rendered with .map in JSX', () => {
    const offenders = files.flatMap(({ file, path }) =>
      unwindowedMapOffenders(readFileSync(file, 'utf8')).map((line) => `${path}:${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it('detects the patterns it guards against', () => {
    expect(dynamicTextOffenders('<Text color="x">{error}</Text>')).toEqual([1]);
    expect(dynamicTextOffenders('<Text wrap="truncate-end">{error}</Text>')).toEqual([]);
    expect(dynamicTextOffenders('<Text color="x">static</Text>')).toEqual([]);
    expect(unwindowedMapOffenders('{rows.map((row) => (\n  <Box key={row} />\n))}')).toEqual([1]);
    expect(unwindowedMapOffenders('{visibleRows.map((row) => (\n  <Box key={row} />\n))}')).toEqual([]);
    expect(unwindowedMapOffenders('{TABS.map((t) => <Box key={t} />)}')).toEqual([]);
    expect(unwindowedMapOffenders('const ids = rows.map((row) => row.id);')).toEqual([]);
  });
});
