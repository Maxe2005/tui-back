import { describe, it, expect } from 'vitest';
import { Box } from 'ink';
import { colors } from '../theme/theme.js';
import { TextInputLine, resolveTextInputLineLayout } from './index.js';
import { windowAroundCaret } from './text-input-line.js';
import { renderToString } from './render-to-string.js';

describe('resolveTextInputLineLayout', () => {
  it('resolves unfocused: text color, no cursor', () => {
    expect(resolveTextInputLineLayout({ label: 'Topic', value: 'foo' })).toEqual({
      labelColor: colors.text,
      showCursor: false,
    });
    expect(resolveTextInputLineLayout({ label: 'Topic', value: 'foo', focused: false })).toEqual({
      labelColor: colors.text,
      showCursor: false,
    });
  });

  it('resolves focused: accent color, cursor shown', () => {
    expect(resolveTextInputLineLayout({ label: 'Topic', value: 'foo', focused: true })).toEqual({
      labelColor: colors.accent,
      showCursor: true,
    });
  });
});

describe('TextInputLine', () => {
  it('renders label and value when unfocused', async () => {
    const output = await renderToString(<TextInputLine label="Topic" value="my-topic" />);
    expect(output).toContain('Topic: my-topic');
  });

  it('shows label and value when focused, without printing a key hint of its own', async () => {
    const output = await renderToString(<TextInputLine label="Branch" value="feature-x" focused />);
    expect(output).toContain('Branch: feature-x');
    expect(output).not.toContain('[Enter]');
    expect(output).not.toContain('[Esc]');
  });

  it('renders an empty value with the caret when focused', async () => {
    const output = await renderToString(<TextInputLine label="Topic" value="" focused />);
    expect(output).toContain('Topic:');
  });
});

describe('TextInputLine cursor navigation', () => {
  it('renders the glyph after the last character when cursor is omitted', async () => {
    const output = await renderToString(<TextInputLine label="Topic" value="abc" focused />);
    expect(output).toContain('Topic: abc');
  });

  it('renders the full value unchanged, mid-string cursor included, when reconstructed left to right', async () => {
    const output = await renderToString(<TextInputLine label="Topic" value="abcd" cursor={2} focused />);
    // Assert the exact reconstructed "label: value" substring (order and completeness both), not
    // three independent substring checks that would still pass on a scrambled or duplicated
    // reassembly (e.g. "Topic: adbc" or "Topic: abccd").
    expect(output).toContain('Topic: abcd');
  });

  it('places the caret at the start when cursor is 0', async () => {
    const output = await renderToString(<TextInputLine label="Topic" value="abc" cursor={0} focused />);
    expect(output).toContain('Topic:');
    expect(output).toContain('abc');
  });

  it('does not affect the unfocused render at all', async () => {
    const output = await renderToString(<TextInputLine label="Topic" value="abcd" cursor={2} focused={false} />);
    expect(output).toContain('Topic: abcd');
  });
});

describe('TextInputLine at a narrow width', () => {
  const LONG = 'abcdefghijklmnopqrstuvwxyz';

  it('keeps the caret and the last typed characters on screen, on one line', async () => {
    const output = await renderToString(
      <Box width={20}>
        <TextInputLine label="Topic" value={LONG} focused />
      </Box>,
    );
    const lines = output.split('\n').filter((line) => line.trim() !== '');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('xyz');
    expect(lines[0]!.trimEnd().length).toBeLessThanOrEqual(20);
  });

  it('shows the character under a mid-value caret', async () => {
    const output = await renderToString(
      <Box width={20}>
        <TextInputLine label="Topic" value={LONG} cursor={10} focused />
      </Box>,
    );
    expect(output).toContain('k');
    expect(output).not.toContain('xyz');
  });
});

describe('windowAroundCaret', () => {
  it('slides with the caret and always leaves a cell for it', () => {
    expect(windowAroundCaret('abcdefghij', 10, 7, 12)).toEqual({ start: 7, text: 'hij' });
    expect(windowAroundCaret('abcdefghij', 0, 7, 12)).toEqual({ start: 0, text: 'abcd' });
    expect(windowAroundCaret('abc', 3, 7, 5)).toEqual({ start: 3, text: '' });
  });
});
