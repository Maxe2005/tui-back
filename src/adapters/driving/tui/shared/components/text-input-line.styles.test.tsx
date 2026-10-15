// FORCE_COLOR=1-isolated: inverse ANSI code present when focused, absent when not (mirrors splitter.styles.test.tsx)
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.FORCE_COLOR = '1';
});

describe('TextInputLine focused styling (inverse cursor when focused)', () => {
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

describe('TextInputLine cursor placement styling (inverse glyph tracks cursor)', () => {
  it('wraps the character at `cursor` in the inverse code, not the trailing character', async () => {
    const { renderToString } = await import('./render-to-string.js');
    const { TextInputLine } = await import('./text-input-line.js');

    // cursor: 1 sits on 'b' — the inverse escape must immediately precede 'b', not 'd' (the
    // last character), proving the caret tracks `cursor` rather than always trailing.
    const output = await renderToString(<TextInputLine label="Topic" value="abcd" cursor={1} focused />);
    expect(output).toContain('\u001b[7mb');
  });

  it("wraps the trailing inverse space when cursor equals value.length (today's look, unchanged)", async () => {
    const { renderToString } = await import('./render-to-string.js');
    const { TextInputLine } = await import('./text-input-line.js');

    const output = await renderToString(<TextInputLine label="Topic" value="abcd" cursor={4} focused />);
    expect(output).toContain('\u001b[7m \u001b[27m');
  });

  it("wraps the character at cursor:2 in the inverse code (matches the plain-text test's mid-string scenario)", async () => {
    const { renderToString } = await import('./render-to-string.js');
    const { TextInputLine } = await import('./text-input-line.js');

    const output = await renderToString(<TextInputLine label="Topic" value="abcd" cursor={2} focused />);
    expect(output).toContain('\u001b[7mc');
  });
});
