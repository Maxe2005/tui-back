import { describe, it, expect } from 'vitest';
import { AppShell } from './app-shell.js';
import { createAppStore } from './store/app-store.js';
import { ZONES } from './zones/zones.js';
import { renderToString } from './shared/components/render-to-string.js';

describe('AppShell', () => {
  it('shows the top bar, six-zone tab bar, and footer simultaneously (AC1)', async () => {
    const output = await renderToString(<AppShell />);
    expect(output).toContain('tui-back');
    for (const zone of ZONES) {
      expect(output).toContain(`[${zone.mnemonic}] ${zone.label}`);
    }
    expect(output).toContain('[/] filter');
  });

  it('shows a glyph+counter badge while the developer is elsewhere and clears it once the zone is visited (AC3)', async () => {
    const store = createAppStore();
    store.getState().addZoneEvent('logs');
    let output = await renderToString(<AppShell useStore={store} />);
    expect(output).toContain('●1');

    store.getState().setActiveZone('logs');
    output = await renderToString(<AppShell useStore={store} />);
    expect(output).not.toContain('●1');
  });

  it('mounts a placeholder screen for every zone at its tab — none missing or unreachable (AC6)', async () => {
    const store = createAppStore();
    for (const zone of ZONES) {
      store.getState().setActiveZone(zone.id);
      const output = await renderToString(<AppShell useStore={store} />);
      expect(output).toContain(zone.label.toUpperCase());
      expect(output).toContain('list pane');
      expect(output).toContain('detail pane');
    }
  });
});