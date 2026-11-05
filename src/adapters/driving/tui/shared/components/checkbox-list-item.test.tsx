import { describe, it, expect } from 'vitest';
import { colors, spacing } from '../theme/theme.js';
import { CheckboxListItem, resolveCheckboxItemLayout } from './index.js';
import { renderToString } from './render-to-string.js';

describe('resolveCheckboxItemLayout', () => {
  it('resolves the unchecked row', () => {
    expect(resolveCheckboxItemLayout({ label: 'api-gateway' })).toEqual({
      boxGlyph: '[ ]',
      labelColor: colors.text,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
    });
  });

  it('resolves the checked row', () => {
    expect(resolveCheckboxItemLayout({ label: 'api-gateway', state: 'checked' })).toEqual({
      boxGlyph: '[x]',
      labelColor: colors.text,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
    });
  });

  it('indents nested rows by the theme indent token', () => {
    expect(resolveCheckboxItemLayout({ label: 'micro-users', nested: true })).toEqual({
      boxGlyph: '[ ]',
      labelColor: colors.text,
      metaColor: colors['text-dim'],
      paddingLeft: spacing.indent,
    });
    expect(spacing.indent).toBe(2);
  });
});

describe('resolveCheckboxItemLayout — disabled', () => {
  it('dims a disabled row and shows a [-] box whatever its state', () => {
    expect(resolveCheckboxItemLayout({ label: 'api', state: 'checked', disabled: true })).toEqual({
      boxGlyph: '[-]',
      labelColor: colors['text-dim'],
      metaColor: colors['text-dim'],
      paddingLeft: 0,
    });
  });
});

describe('CheckboxListItem', () => {
  it('renders a disabled row with its dim reason', async () => {
    const output = await renderToString(<CheckboxListItem label="api" disabled disabledReason="no healthUrl" />);
    expect(output).toContain('[-]');
    expect(output).toContain('api');
    expect(output).toContain('(no healthUrl)');
  });

  it('renders the unchecked state', async () => {
    const output = await renderToString(<CheckboxListItem label="api-gateway" />);
    expect(output).toContain('[ ]');
  });

  it('renders the checked state', async () => {
    const output = await renderToString(
      <CheckboxListItem label="api-gateway" state="checked" />,
    );
    expect(output).toContain('[x]');
  });

  it('renders the label', async () => {
    const output = await renderToString(<CheckboxListItem label="api-gateway" />);
    expect(output).toContain('api-gateway');
  });

  it('renders trailing metadata distinctly from the label', async () => {
    const output = await renderToString(
      <CheckboxListItem label="api-gateway" meta="main ↑0 ↓0" />,
    );
    expect(output).toContain('api-gateway');
    expect(output).toContain('main ↑0 ↓0');
  });

  it('does not render a marker or accent bar when unselected', async () => {
    const output = await renderToString(<CheckboxListItem label="api-gateway" />);
    expect(output).not.toContain('[x]');
  });
});