import { describe, it, expect } from 'vitest';
import { Text } from 'ink';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import { TopBar } from './top-bar.js';
import { Footer, DEFAULT_FOOTER_HINTS, footerHintsFor } from './footer.js';
import { ZoneLayout } from './zone-layout.js';
import { ZONE_LAYOUTS, clampBoundaryRatio, resolveBoundaryFlex } from '../../zones/zone-layouts.js';
import { renderToString } from './render-to-string.js';

const EDTS: EdtRegistryEntry[] = [
  {
    ulid: 'edt-01hx2',
    topic: 'checkout-revamp',
    createdAt: '2026-08-26T00:00:00.000Z',
    status: 'active',
    members: [],
  },
];

describe('TopBar', () => {
  it('renders the app name, active EDT topic, and chrome hints in one row', async () => {
    const output = await renderToString(<TopBar activeEdt="edt-01hx2" edts={EDTS} />);
    expect(output).toContain('tui-back');
    expect(output).toContain('checkout-revamp');
    expect(output).not.toContain('edt-01hx2');
    expect(output).toContain('[/] filter');
    expect(output).toContain('[:] cmd');
  });

  it('shows a dim placeholder when no EDT is active', async () => {
    const output = await renderToString(<TopBar activeEdt={null} edts={EDTS} />);
    expect(output).toContain('no active EDT');
  });

  it('shows a dim placeholder when edts has not loaded yet', async () => {
    const output = await renderToString(<TopBar activeEdt="edt-01hx2" edts={null} />);
    expect(output).toContain('no active EDT');
    expect(output).not.toContain('edt-01hx2');
  });

  it('shows a dim placeholder when the active EDT has no matching entry', async () => {
    const output = await renderToString(<TopBar activeEdt="edt-missing" edts={[]} />);
    expect(output).toContain('no active EDT');
  });
});

describe('Footer', () => {
  it('renders contextual keybinding hints on the permanent bottom row', async () => {
    const output = await renderToString(<Footer />);
    expect(output).toContain('[?] help');
    expect(output).toContain('[q] quit');
    expect(output).toContain('resize');
  });

  it('advertises [?] help ahead of [q] quit in the default hints (UX-DR7)', () => {
    const helpIndex = DEFAULT_FOOTER_HINTS.indexOf('[?] help');
    const quitIndex = DEFAULT_FOOTER_HINTS.indexOf('[q] quit');
    expect(helpIndex).toBeGreaterThanOrEqual(0);
    expect(quitIndex).toBeGreaterThanOrEqual(0);
    expect(helpIndex).toBeLessThan(quitIndex);
  });

  it('accepts zone-specific hints', async () => {
    const output = await renderToString(<Footer hints={['[?] help']} />);
    expect(output).toContain('[?] help');
  });

  it('omits the redundant [d/e/u/l/r/s] zone mnemonic, keeping [←→] zone in the default hints (UX-DR7)', () => {
    expect(DEFAULT_FOOTER_HINTS).not.toContain('[d/e/u/l/r/s] zone');
    expect(DEFAULT_FOOTER_HINTS).toContain('[←→] zone');
  });
});

const DEFAULT_LIST_RATIO = ZONE_LAYOUTS.routes.boundaries[0]!.defaultRatio;

describe('footerHintsFor', () => {
  it('advertises ^W resize in every zone that declares a boundary', () => {
    for (const zone of ['dashboard', 'edts', 'update', 'logs', 'routes', 'shared-types'] as const) {
      expect(footerHintsFor(zone)).toContain('^W resize');
    }
  });

  it('advertises Logs wrap-all as W', () => {
    expect(footerHintsFor('logs')).toContain('[W] wrap all');
    expect(footerHintsFor('edts')).not.toContain('[W] wrap all');
  });
});

describe('resolveBoundaryFlex', () => {
  it('defaults the split to ~2:3 list:detail', () => {
    expect(DEFAULT_LIST_RATIO).toBeCloseTo(2 / 5);
    const flex = resolveBoundaryFlex('routes', 0, DEFAULT_LIST_RATIO);
    expect(flex.first).toBeCloseTo(0.4);
    expect(flex.second).toBeCloseTo(0.6);
  });

  it('keeps both panes usable by clamping extreme ratios to the boundary min/max', () => {
    expect(resolveBoundaryFlex('routes', 0, 0).first).toBe(0.2);
    expect(resolveBoundaryFlex('routes', 0, 1).first).toBe(0.8);
    expect(clampBoundaryRatio('logs', 0, 0)).toBe(0.15);
    expect(clampBoundaryRatio('logs', 0, 1)).toBe(0.5);
  });

  it('falls back to the default ratio for non-finite input', () => {
    expect(resolveBoundaryFlex('routes', 0, Number.NaN).first).toBeCloseTo(DEFAULT_LIST_RATIO);
    expect(resolveBoundaryFlex('routes', 0, Infinity).first).toBeCloseTo(DEFAULT_LIST_RATIO);
    expect(resolveBoundaryFlex('routes', 0, -Infinity).first).toBeCloseTo(DEFAULT_LIST_RATIO);
  });
});

describe('ZoneLayout', () => {
  it('renders both panes around a vertical splitter', async () => {
    const output = await renderToString(
      <ZoneLayout zoneId="routes" first={<Text>list pane</Text>} second={<Text>detail pane</Text>} />,
    );
    expect(output).toContain('list pane');
    expect(output).toContain('detail pane');
    expect(output).toContain('│');
  });

  it('renders a horizontal boundary as stacked panes around a horizontal splitter', async () => {
    const output = await renderToString(
      <ZoneLayout zoneId="edts" boundary={1} first={<Text>top pane</Text>} second={<Text>bottom pane</Text>} />,
    );
    expect(output).toContain('top pane');
    expect(output).toContain('bottom pane');
    expect(output).toContain('─');
  });
});
