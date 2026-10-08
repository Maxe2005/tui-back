import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ZoneTabBar } from './zone-tab-bar.js';
import { BoundsProvider } from '../bounds/bounds-context.js';
import { renderToString } from './render-to-string.js';

const NO_EVENTS = { dashboard: 0, edts: 0, update: 0, logs: 3, routes: 0, 'shared-types': 0 };

describe('ZoneTabBar on a narrow terminal', () => {
  it('collapses inactive tabs to their mnemonic but keeps a one-glyph badge', async () => {
    const out = await renderToString(
      createElement(BoundsProvider, { columns: 40, rows: 12, children: createElement(ZoneTabBar, { activeZone: 'dashboard', events: NO_EVENTS }) }),
      { columns: 40, rows: 12 },
    );
    expect(out).toContain('[d] Dashboard');
    expect(out).toContain('[l]●');
    expect(out).not.toContain('Logs');
    expect(out).not.toContain('●3');
  });
});
