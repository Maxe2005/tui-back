import { describe, it, expect } from 'vitest';
import { colors } from '../theme/theme.js';
import { TextInputLine, resolveTextInputLineLayout } from './index.js';
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

  it('does not show hint when unfocused', async () => {
    const output = await renderToString(<TextInputLine label="Topic" value="my-topic" focused={false} />);
    expect(output).not.toContain('[Enter] confirm');
    expect(output).not.toContain('[Esc] cancel');
  });

  it('shows hint when focused', async () => {
    const output = await renderToString(<TextInputLine label="Topic" value="my-topic" focused />);
    expect(output).toContain('[Enter] confirm');
    expect(output).toContain('[Esc] cancel');
  });

  it('shows label and value when focused', async () => {
    const output = await renderToString(<TextInputLine label="Branch" value="feature-x" focused />);
    expect(output).toContain('Branch: feature-x');
    expect(output).toContain('[Enter] confirm');
  });

  it('renders empty value with cursor and hint when focused (matrix: focused, empty value)', async () => {
    const output = await renderToString(<TextInputLine label="Topic" value="" focused />);
    expect(output).toContain('Topic:');
    expect(output).toContain('[Enter] confirm');
  });

  it('hides hint when topic not focused (members focus)', async () => {
    const output = await renderToString(<TextInputLine label="Topic" value="my-topic" focused={false} />);
    expect(output).not.toContain('[Enter] confirm');
  });
});
