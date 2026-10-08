import { createElement } from 'react';
import { Text } from 'ink';
import { describe, expect, it } from 'vitest';
import { ModalDialog } from './modal-dialog.js';
import { BoundsProvider } from '../bounds/bounds-context.js';
import { renderToString } from './render-to-string.js';

describe('ModalDialog bounds', () => {
  it('never exceeds its bounds, keeps the title, pins the footer', async () => {
    const body = Array.from({ length: 50 }, (_, i) => createElement(Text, { key: i }, `row-${i}`));
    const out = await renderToString(
      createElement(
        BoundsProvider,
        { columns: 60, rows: 12, children: null },
        createElement(ModalDialog, { title: 'BIG', footer: createElement(Text, null, 'FOOT') }, ...body),
      ),
    );
    const lines = out.split('\n').filter((l) => l.includes('║') || l.includes('╔') || l.includes('╚'));
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(out).toContain('BIG');
    expect(out).toContain('FOOT');
    expect(out).toContain('row-0');
    expect(out).not.toContain('row-49');
  });
});
