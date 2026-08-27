import { describe, it, expect } from 'vitest';
import { colors, spacing } from '../theme/theme.js';
import { ListRow, resolveRowLayout } from './list-row.js';
import { renderToString } from './render-to-string.js';

describe('resolveRowLayout', () => {
  it('resolves the unselected base row: transparent accent-bar column (AC2)', () => {
    expect(resolveRowLayout({ label: 'api-gateway' })).toEqual({
      barGlyph: ' ',
      marker: ' ',
      background: colors.surface,
      labelColor: colors.text,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
      bold: false,
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
      bold: false,
    });
  });

  it('indents nested rows by the theme indent token (AC3)', () => {
    expect(resolveRowLayout({ label: 'micro-users', nested: true })).toEqual({
      barGlyph: ' ',
      marker: ' ',
      background: colors.surface,
      labelColor: colors.text,
      metaColor: colors['text-dim'],
      paddingLeft: spacing.indent,
      bold: false,
    });
    expect(spacing.indent).toBe(2);
  });

  // Story 2.18: `active` (the tool-wide active EDT) is accent+bold, independent of `selected`.
  it('resolves an active row: accent-colored, bold label — independent of selected', () => {
    expect(resolveRowLayout({ label: 'my-edt', active: true })).toEqual({
      barGlyph: ' ',
      marker: ' ',
      background: colors.surface,
      labelColor: colors.accent,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
      bold: true,
    });
  });

  it('composes active with selected — the cursor treatment and the active label style both apply', () => {
    expect(resolveRowLayout({ label: 'my-edt', active: true, selected: true })).toEqual({
      barGlyph: '▌',
      marker: '›',
      background: colors['surface-selected'],
      labelColor: colors.accent,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
      bold: true,
    });
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

  it('renders a nested row (AC3)', async () => {
    const output = await renderToString(<ListRow label="micro-users" nested />);
    expect(output).toContain('micro-users');
  });

  it('renders the trailing metadata distinctly from the label (AC4)', async () => {
    const output = await renderToString(
      <ListRow label="api-gateway" meta="main ↑0 ↓0" />,
    );
    expect(output).toContain('api-gateway');
    expect(output).toContain('main ↑0 ↓0');
  });

  it('does not render a marker or accent bar when unselected (AC2)', async () => {
    const output = await renderToString(<ListRow label="api-gateway" />);
    expect(output).not.toContain('›');
    expect(output).not.toContain('▌');
  });

  it('renders the active label (story 2.18) — no marker/accent-bar of its own when not also selected', async () => {
    const output = await renderToString(<ListRow label="my-edt" active />);
    expect(output).toContain('my-edt');
    expect(output).not.toContain('›');
    expect(output).not.toContain('▌');
  });

  it('renders active composed with selected — both the › marker/▌ bar and the active label appear', async () => {
    const output = await renderToString(<ListRow label="my-edt" active selected />);
    expect(output).toContain('my-edt');
    expect(output).toContain('›');
    expect(output).toContain('▌');
  });
});
