// FORCE_COLOR=1-isolated: inverse ANSI code present when focused, absent when not (mirrors splitter.styles.test.tsx)
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.FORCE_COLOR = '1';
});

describe('TextInputLine focused styling (story 2.23, AC: inverse cursor when focused)', () => {
  it('renders inverse code when focused', async () => {
    const { renderToString } = await import('./render-to-string.js');
    const { TextInputLine } = await import('./text-input-line.js');

    const output = await renderToString(<TextInputLine label="Topic" value="foo" focused />);
    // inverse ANSI is \x1b[7m
    expect(output).toContain('\u001b[7m');
  });

  it('does not render inverse code when unfocused', async () => {
    const { renderToString } = await import('./render-to-string.js');
    const { TextInputLine } = await import('./text-input-line.js');

    const output = await renderToString(<TextInputLine label="Topic" value="foo" focused={false} />);
    expect(output).not.toContain('\u001b[7m');
  });

  it('does not render inverse code when focused omitted (defaults to unfocused)', async () => {
    const { renderToString } = await import('./render-to-string.js');
    const { TextInputLine } = await import('./text-input-line.js');

    const output = await renderToString(<TextInputLine label="Topic" value="foo" />);
    expect(output).not.toContain('\u001b[7m');
  });
});
