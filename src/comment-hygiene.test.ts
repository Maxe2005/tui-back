// Guard for AD-17: nothing under src/ may reference stories, ACs or review-patch history —
// that lives in commits and story files. The allow-list is deliberately empty.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url));

// `[ ]` rather than a literal space keeps this file from matching its own pattern.
const HISTORY_REFERENCE = /\b[Ss]tory \d+\.\d+|\bAC\d+\b|review[ ]patch/;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

describe('source comment hygiene (AD-17)', () => {
  it('finds no story, AC or review-patch reference anywhere under src/', () => {
    const offenders = listFiles(SRC_ROOT).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          HISTORY_REFERENCE.test(line) ? [`${relative(SRC_ROOT, file)}:${index + 1}: ${line.trim()}`] : [],
        ),
    );

    expect(offenders).toEqual([]);
  });

  it('recognizes each forbidden reference shape', () => {
    const story = 'Story' + ' 2.9';
    const acceptance = 'A' + 'C3';
    const patch = 'review' + ' patch';

    expect(HISTORY_REFERENCE.test(`// ${story}: adds the gate`)).toBe(true);
    expect(HISTORY_REFERENCE.test(`it('rejects it (${acceptance})')`)).toBe(true);
    expect(HISTORY_REFERENCE.test(`// ${patch}: normalize paths`)).toBe(true);
    expect(HISTORY_REFERENCE.test('// history lives in commit messages')).toBe(false);
  });
});
