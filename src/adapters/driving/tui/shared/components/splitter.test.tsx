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
});