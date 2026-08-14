import { describe, it, expect } from 'vitest';
import { colors, spacing } from '../theme/theme.js';
import { ListRow, resolveRowLayout } from './list-row.js';
import { renderToString } from './render-to-string.js';

describe('resolveRowLayout', () => {
  it('resolves the unselected base row: transparent accent-bar column (AC2)', () => {
    expect(resolveRowLayout({ label: 'api-gateway' })).toEqual({
      barGlyph: ' ',
      marker: '',
      background: colors.surface,
      labelColor: colors.text,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
    });
  });

  it('resolves the selected row: surface-selected fill, solid accent bar, › marker (AC2)', () => {
    expect(resolveRowLayout({ label: 'api-gateway', selected: true })).toEqual({
      barGlyph: '▌',
      marker: '›',
      background: colors['surface-selected'],
      labelColor: colors.text,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
    });
  });

  it('indents nested rows by the theme indent token (AC3)', () => {
    expect(resolveRowLayout({ label: 'micro-users', nested: true })).toEqual({
      barGlyph: ' ',
      marker: '',
      background: colors.surface,
      labelColor: colors.text,
      metaColor: colors['text-dim'],
      paddingLeft: spacing.indent,
    });
    expect(spacing.indent).toBe(2);
  });
});

describe('ListRow', () => {
  it('renders the label (AC2)', async () => {
    const output = await renderToString(<ListRow label="api-gateway" />);
    expect(output).toContain('api-gateway');
  });

  it('renders the › marker and ▌ accent bar when selected (AC2)', async () => {
    const output = await renderToString(
      <ListRow label="api-gateway" selected />,
    );
    expect(output).toContain('›');
    expect(output).toContain('▌');
  });

  it('renders the trailing metadata distinctly from the label (AC4)', async () => {
    const output = await renderToString(
      <ListRow label="api-gateway" meta="main ↑0 ↓0" />,
    );
    expect(output).toContain('api-gateway');
    expect(output).toContain('main ↑0 ↓0');
  });

  it('does not render a marker when unselected (AC2)', async () => {
    const output = await renderToString(<ListRow label="api-gateway" />);
    expect(output).not.toContain('›');
  });
});
