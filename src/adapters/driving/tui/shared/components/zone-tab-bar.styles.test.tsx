import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.FORCE_COLOR = '1';
});

describe('ZoneTabBar rendered styling (AC2/AC3)', () => {
  it('applies the accent background and bold to the active tab only (AC2)', async () => {
    const { renderToString } = await import('./render-to-string.js');
    const { ZoneTabBar } = await import('./zone-tab-bar.js');
    const output = await renderToString(
      <ZoneTabBar
        activeZone="dashboard"
        events={{
          dashboard: 0,
          edts: 0,
          update: 0,
          logs: 0,
          routes: 0,
          'shared-types': 0,
        }}
      />,
    );
    expect(output).toContain('\u001b[48;2;201;161;59m');
    expect(output).toContain('\u001b[1m');
  });

  it('renders the pending-event badge in the zone status color (AC3)', async () => {
    const { renderToString } = await import('./render-to-string.js');
    const { ZoneTabBar } = await import('./zone-tab-bar.js');
    const output = await renderToString(
      <ZoneTabBar
        activeZone="dashboard"
        events={{
          dashboard: 0,
          edts: 0,
          update: 0,
          logs: 2,
          routes: 0,
          'shared-types': 0,
        }}
      />,
    );
    expect(output).toContain('\u001b[38;2;79;128;168m');
    expect(output).toContain('●2');
  });
});
