// Dialog half of the bounded-rendering guard: every registered dialog is rendered at every matrix
// size inside a region the size of the shell's zone region, and the registry must cover every
// source file that renders a ModalDialog.
import { createElement } from 'react';
import { Box } from 'ink';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from '../components/render-to-string.js';
import { DIALOG_REGISTRY } from '../test-support/dialog-registry.js';
import { BoundsProvider } from './bounds-context.js';
import { SHELL_CHROME_ROWS } from './bounds.js';
import { MATRIX_SIZES, frameLines } from '../test-support/matrix.js';

const TUI_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe('dialog registry', () => {
  it('covers every source file that renders a ModalDialog', () => {
    const rendering = sourceFiles(TUI_ROOT)
      .filter((file) => readFileSync(file, 'utf8').includes('<ModalDialog'))
      .map((file) => relative(TUI_ROOT, file))
      // ModalDialog itself and the registry fixtures are not dialogs.
      .filter((file) => file !== 'shared/components/modal-dialog.tsx');
    const registered = new Set(DIALOG_REGISTRY.map((entry) => entry.file));
    expect(rendering.filter((file) => !registered.has(file))).toEqual([]);
  });

  it('has no entry pointing at a file that no longer renders a dialog', () => {
    for (const entry of DIALOG_REGISTRY) {
      // An app-level overlay that is not a ModalDialog (the Terminal) is registered for the matrix only.
      if ('overlay' in entry && entry.overlay === true) {
        expect(readFileSync(join(TUI_ROOT, entry.file), 'utf8'), entry.id).not.toContain('<ModalDialog');
        continue;
      }
      expect(readFileSync(join(TUI_ROOT, entry.file), 'utf8'), entry.id).toContain('<ModalDialog');
    }
  });
});

describe('size matrix: dialogs', () => {
  for (const entry of DIALOG_REGISTRY) {
    if ('embedded' in entry) continue;
    for (const size of MATRIX_SIZES) {
      it(`${entry.id} at ${size.columns}x${size.rows} fits its region`, async () => {
        const region = { columns: size.columns, rows: size.rows - SHELL_CHROME_ROWS };
        const output = await renderToString(
          createElement(
            Box,
            { flexDirection: 'column', height: region.rows, width: region.columns, overflow: 'hidden' },
            createElement(BoundsProvider, { ...region, children: entry.render(region.rows) }),
          ),
          size,
        );
        const frame = frameLines(output);
        expect(frame.length).toBeLessThanOrEqual(region.rows);
        for (const line of frame) {
          expect(Array.from(line).length, line).toBeLessThanOrEqual(region.columns);
        }
      });
    }
  }
});
