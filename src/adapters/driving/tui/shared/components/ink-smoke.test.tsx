import { describe, it, expect } from 'vitest';
import { Text } from 'ink';
import { renderToString } from './render-to-string.js';

describe('ink install smoke', () => {
  it('renders a React element through Ink to a string', async () => {
    const output = await renderToString(<Text>ink works</Text>);
    expect(output).toContain('ink works');
  });
});
