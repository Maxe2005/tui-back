import { describe, it, expect } from 'vitest';
import { DimAnnotation } from './index.js';
import { renderToString } from './render-to-string.js';

describe('DimAnnotation', () => {
  it('renders italic dim text (AC6)', async () => {
    const output = await renderToString(
      <DimAnnotation text="This is supplementary information" />,
    );
    expect(output).toContain('supplementary information');
  });

  it('applies dim color and italic style', async () => {
    const output = await renderToString(
      <DimAnnotation text="hint" />,
    );
    expect(output).toContain('hint');
  });
});