import { Box } from 'ink';
import { describe, it, expect } from 'vitest';
import { colors, spacing } from '../theme/theme.js';
import { ListRow, resolveRowLayout } from './list-row.js';
import { renderToString } from './render-to-string.js';

describe('resolveRowLayout', () => {
  it('resolves the unselected base row: transparent accent-bar column', () => {
    expect(resolveRowLayout({ label: 'api-gateway' })).toEqual({
      barGlyph: ' ',
      marker: ' ',
      background: colors.surface,
      labelColor: colors.text,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
      bold: false,
      activeSuffix: '',
    });
  });

  it('resolves the selected row: surface-selected fill, solid accent bar, › marker', () => {
    expect(resolveRowLayout({ label: 'api-gateway', selected: true })).toEqual({
      barGlyph: '▌',
      marker: '›',
      background: colors['surface-selected'],
      labelColor: colors.text,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
      bold: false,
      activeSuffix: '',
    });
  });

  it('indents nested rows by the theme indent token', () => {
    expect(resolveRowLayout({ label: 'micro-users', nested: true })).toEqual({
      barGlyph: ' ',
      marker: ' ',
      background: colors.surface,
      labelColor: colors.text,
      metaColor: colors['text-dim'],
      paddingLeft: spacing.indent,
      bold: false,
      activeSuffix: '',
    });
    expect(spacing.indent).toBe(2);
  });

  // `emphasized` (whichever row drives a categorized split) is accent+bold, independent of
  // `selected`.
  it('resolves an emphasized row: accent-colored, bold label — independent of selected', () => {
    expect(resolveRowLayout({ label: 'my-edt', emphasized: true })).toEqual({
      barGlyph: ' ',
      marker: ' ',
      background: colors.surface,
      labelColor: colors.accent,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
      bold: true,
      activeSuffix: '',
    });
  });

  it('composes emphasized with selected — the cursor treatment and the emphasized label style both apply', () => {
    expect(resolveRowLayout({ label: 'my-edt', emphasized: true, selected: true })).toEqual({
      barGlyph: '▌',
      marker: '›',
      background: colors['surface-selected'],
      labelColor: colors.accent,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
      bold: true,
      activeSuffix: '',
    });
  });

  // `active` (the tool-wide active EDT) never touches label color/bold — it's a discreet suffix,
  // decoupled from `emphasized`.
  it('resolves an active row: a discreet " active" suffix, label untouched', () => {
    expect(resolveRowLayout({ label: 'my-edt', active: true })).toEqual({
      barGlyph: ' ',
      marker: ' ',
      background: colors.surface,
      labelColor: colors.text,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
      bold: false,
      activeSuffix: ' • active',
    });
  });

  it('composes active with emphasized on the same row — both the suffix and the bold label apply', () => {
    expect(resolveRowLayout({ label: 'my-edt', active: true, emphasized: true })).toEqual({
      barGlyph: ' ',
      marker: ' ',
      background: colors.surface,
      labelColor: colors.accent,
      metaColor: colors['text-dim'],
      paddingLeft: 0,
      bold: true,
      activeSuffix: ' • active',
    });
  });
});

describe('ListRow', () => {
  it('renders the label', async () => {
    const output = await renderToString(<ListRow label="api-gateway" />);
    expect(output).toContain('api-gateway');
  });

  it('renders the › marker and ▌ accent bar when selected', async () => {
    const output = await renderToString(
      <ListRow label="api-gateway" selected />,
    );
    expect(output).toContain('›');
    expect(output).toContain('▌');
  });

  it('renders a nested row', async () => {
    const output = await renderToString(<ListRow label="micro-users" nested />);
    expect(output).toContain('micro-users');
  });

  it('renders the trailing metadata distinctly from the label', async () => {
    const output = await renderToString(
      <ListRow label="api-gateway" meta="main ↑0 ↓0" />,
    );
    expect(output).toContain('api-gateway');
    expect(output).toContain('main ↑0 ↓0');
  });

  it('does not render a marker or accent bar when unselected', async () => {
    const output = await renderToString(<ListRow label="api-gateway" />);
    expect(output).not.toContain('›');
    expect(output).not.toContain('▌');
  });

  it('renders the emphasized label — no marker/accent-bar of its own when not also selected', async () => {
    const output = await renderToString(<ListRow label="my-edt" emphasized />);
    expect(output).toContain('my-edt');
    expect(output).not.toContain('›');
    expect(output).not.toContain('▌');
  });

  it('renders emphasized composed with selected — both the › marker/▌ bar and the emphasized label appear', async () => {
    const output = await renderToString(<ListRow label="my-edt" emphasized selected />);
    expect(output).toContain('my-edt');
    expect(output).toContain('›');
    expect(output).toContain('▌');
  });

  // `active` renders a discreet "• active" suffix, decoupled from `emphasized`/`selected`. The
  // `•` glyph is required: `colors.info` is a status color and DESIGN.md mandates every status
  // color be paired with a glyph, never carried by color alone.
  it('renders the discreet "• active" suffix after the label', async () => {
    const output = await renderToString(<ListRow label="my-edt" active />);
    expect(output).toContain('my-edt • active');
  });

  it('renders the "• active" suffix after meta when both are present', async () => {
    const output = await renderToString(<ListRow label="my-edt" meta="3 members" active />);
    expect(output).toContain('my-edt 3 members • active');
  });

  it('renders active composed with selected — the cursor treatment applies alongside the discreet suffix, independent of emphasized', async () => {
    const output = await renderToString(<ListRow label="my-edt" active selected />);
    expect(output).toContain('my-edt');
    expect(output).toContain('›');
    expect(output).toContain('▌');
    expect(output).toContain('• active');
  });
});

describe('ListRow truncation', () => {
  it('keeps the selection bar and marker visible when a long label is truncated', async () => {
    const output = await renderToString(
      <Box width={20}>
        <ListRow label="GET /a/very/long/route/path/that/cannot/fit/{id}" selected />
      </Box>,
    );
    expect(output).toContain('▌›');
    expect(output).toContain('…');
  });
});
