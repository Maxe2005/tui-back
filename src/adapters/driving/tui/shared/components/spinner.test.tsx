import { describe, it, expect } from 'vitest';
import { Spinner } from './index.js';
import { renderToString } from './render-to-string.js';

describe('Spinner', () => {
  it('renders the info glyph when active', async () => {
    const output = await renderToString(<Spinner active={true} />);
    expect(output).toContain('⣾');
  });

  it('renders nothing when inactive', async () => {
    const output = await renderToString(<Spinner active={false} />);
    expect(output).toBe('\n');
  });
});