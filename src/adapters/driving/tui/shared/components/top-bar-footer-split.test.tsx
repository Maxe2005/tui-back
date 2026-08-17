import { describe, it, expect } from 'vitest';
import { Text } from 'ink';
import { TopBar } from './top-bar.js';
import { Footer, DEFAULT_FOOTER_HINTS } from './footer.js';
import {
  ListDetailSplit,
  resolveSplitFlex,
  DEFAULT_LIST_RATIO,
} from './list-detail-split.js';
import { renderToString } from './render-to-string.js';

describe('TopBar', () => {
  it('renders the app name, active EDT, and chrome hints in one row (AC1)', async () => {
    const output = await renderToString(<TopBar activeEdt="edt-01hx2" />);
    expect(output).toContain('tui-back');
    expect(output).toContain('edt-01hx2');
    expect(output).toContain('[/] filter');
    expect(output).toContain('[:] cmd');
  });

  it('shows a dim placeholder when no EDT is active', async () => {
    const output = await renderToString(<TopBar activeEdt={null} />);
    expect(output).toContain('no active EDT');
  });
});

describe('Footer', () => {
  it('renders contextual keybinding hints on the permanent bottom row (AC1)', async () => {
    const output = await renderToString(<Footer />);
    expect(output).toContain(DEFAULT_FOOTER_HINTS.join('  '));
  });

  it('accepts zone-specific hints', async () => {
    const output = await renderToString(<Footer hints={['[?] help']} />);
    expect(output).toContain('[?] help');
  });
});

describe('resolveSplitFlex', () => {
  it('defaults the split to ~2:3 list:detail (AC4)', () => {
    expect(DEFAULT_LIST_RATIO).toBeCloseTo(2 / 5);
    const flex = resolveSplitFlex(DEFAULT_LIST_RATIO);
    expect(flex.list).toBeCloseTo(0.4);
    expect(flex.detail).toBeCloseTo(0.6);
  });

  it('keeps both panes usable by clamping extreme ratios', () => {
    expect(resolveSplitFlex(0).list).toBe(0.2);
    expect(resolveSplitFlex(1).list).toBe(0.8);
  });

  it('falls back to the default ratio for non-finite input', () => {
    expect(resolveSplitFlex(Number.NaN).list).toBeCloseTo(DEFAULT_LIST_RATIO);
    expect(resolveSplitFlex(Infinity).list).toBeCloseTo(DEFAULT_LIST_RATIO);
    expect(resolveSplitFlex(-Infinity).list).toBeCloseTo(DEFAULT_LIST_RATIO);
  });
});

describe('ListDetailSplit', () => {
  it('renders list and detail panes around a vertical splitter (AC4)', async () => {
    const output = await renderToString(
      <ListDetailSplit
        ratio={DEFAULT_LIST_RATIO}
        list={<Text>list pane</Text>}
        detail={<Text>detail pane</Text>}
      />,
    );
    expect(output).toContain('list pane');
    expect(output).toContain('detail pane');
    expect(output).toContain('│');
  });
});
