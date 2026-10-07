import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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
  'adapters/driving/tui/zones/logs/logs-zone.tsx',
  'adapters/driving/tui/zones/edts/dialogs/create-wizard/override-box.logic.ts',
  'adapters/driving/tui/zones/edts/dialogs/create-wizard/step-branches.tsx',
  'adapters/driving/tui/zones/edts/dialogs/switch-resolution/switch-resolution.logic.ts',
  'adapters/driving/tui/zones/update/update-service-box.logic.ts',
  'adapters/driving/tui/zones/update/update-config-panels.logic.ts',
  'adapters/driving/tui/zones/update/update-config-dialog.logic.ts',
  'adapters/driving/tui/zones/routes/routes-zone.tsx',
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

describe('focus navigation guard', () => {
  it('reads key.tab only in the primitive and the documented text-input exceptions', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => /key\.tab\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
      .filter((file) => !ALLOWED.has(file));
    expect(offenders).toEqual([]);
  });
});
