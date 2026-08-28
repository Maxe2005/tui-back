import { describe, it, expect } from 'vitest';
import { Splitter } from './index.js';
import { renderToString } from './render-to-string.js';

describe('Splitter', () => {
  it('renders a horizontal splitter', async () => {
    const output = await renderToString(
      <Splitter orientation="horizontal" size={50} onResize={() => {}} />,
    );
    expect(output).toContain('─');
  });

  it('renders a vertical splitter', async () => {
    const output = await renderToString(
      <Splitter orientation="vertical" size={50} onResize={() => {}} />,
    );
    expect(output).toContain('│');
  });

  // Story 2.21: `targeted` is a purely visual (color) prop — this plain-text render just
  // proves the glyph itself is unaffected either way; the actual accent-vs-border color
  // assertion lives in splitter.styles.test.tsx (isolated per this repo's FORCE_COLOR
  // convention — see that file's header comment).
  it('still renders the same glyph whether or not targeted is set', async () => {
    const untargeted = await renderToString(<Splitter orientation="horizontal" size={1} />);
    const targeted = await renderToString(<Splitter orientation="horizontal" size={1} targeted={true} />);
    expect(untargeted).toContain('─');
    expect(targeted).toContain('─');
  });
});
