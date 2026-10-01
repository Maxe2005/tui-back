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

  // `targeted` is a purely visual (color) prop — this plain-text render only proves the glyph is
  // unaffected; the accent-vs-border color assertion lives in splitter.styles.test.tsx (see its
  // header for the FORCE_COLOR isolation).
  it('still renders the same glyph whether or not targeted is set', async () => {
    const untargeted = await renderToString(<Splitter orientation="horizontal" size={1} />);
    const targeted = await renderToString(<Splitter orientation="horizontal" size={1} targeted={true} />);
    expect(untargeted).toContain('─');
    expect(targeted).toContain('─');
  });
});
