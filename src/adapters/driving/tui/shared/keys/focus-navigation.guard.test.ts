import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../../../../', import.meta.url));

// Files allowed to read `key.tab`: the primitive itself and the documented text-input /
// value-toggle exceptions, where Tab is not a focus-navigation key.
const ALLOWED = new Set([
  'adapters/driving/tui/shared/keys/focus-navigation.ts',
  'adapters/driving/tui/shared/command-bar.tsx',
  'adapters/driving/tui/shared/components/text-edit.ts',
  'adapters/driving/tui/shared/components/branch-picker.tsx',
  'adapters/driving/tui/zones/edts/dialogs/create-wizard/step-branches.tsx',
  'adapters/driving/tui/zones/routes/routes-zone.tsx',
  // History view: Tab toggles the by-branch / by-version search mode, not a focus move.
  'adapters/driving/tui/zones/shared-types/shared-types-history.logic.ts',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const READS_TAB = /key\??\.tab\b|key\[['"]tab['"]\]|\{[^}]*\btab\b[^}]*\}\s*=\s*key\b/;

function relPath(file: string): string {
  return relative(SRC, file).split(sep).join('/');
}

describe('focus navigation guard', () => {
  const files = sourceFiles(SRC);

  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('reads key.tab only in the primitive and the documented text-input exceptions', () => {
    const offenders = files
      .filter((file) => READS_TAB.test(readFileSync(file, 'utf8')))
      .map(relPath)
      .filter((file) => !ALLOWED.has(file));
    expect(offenders).toEqual([]);
  });

  it('keeps no stale allowlist entries', () => {
    const readers = new Set(files.filter((file) => READS_TAB.test(readFileSync(file, 'utf8'))).map(relPath));
    expect([...ALLOWED].filter((entry) => !readers.has(entry))).toEqual([]);
  });
});
