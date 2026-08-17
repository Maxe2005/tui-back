import { describe, it, expect } from 'vitest';
import { AppShell, shouldCloseHelp, shouldOpenHelp } from './app-shell.js';
import { createAppStore } from './store/app-store.js';
import { ZONES } from './zones/zones.js';
import { BANNER_LINES } from './zones/dashboard/launch-banner.js';
import { renderToString } from './shared/components/render-to-string.js';

describe('help-open decision helpers (AC2, AC3)', () => {
  it('opens help on ? only', () => {
    expect(shouldOpenHelp('?')).toBe(true);
    expect(shouldOpenHelp('j')).toBe(false);
    expect(shouldOpenHelp('')).toBe(false);
  });

  it('closes help on ? or Esc only', () => {
    expect(shouldCloseHelp('?', {})).toBe(true);
    expect(shouldCloseHelp('', { escape: true })).toBe(true);
    expect(shouldCloseHelp('j', {})).toBe(false);
    expect(shouldCloseHelp('', {})).toBe(false);
  });
});

describe('AppShell', () => {
  it('shows the top bar, six-zone tab bar, and footer simultaneously (AC1)', async () => {
    const store = createAppStore();
    let output = await renderToString(<AppShell useStore={store} />);
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

  it('opens the keybinding-help modal from the store and hides it again (AC2, AC3)', async () => {
    const store = createAppStore();
    let output = await renderToString(<AppShell useStore={store} />);
    expect(output).not.toContain('KEYBINDINGS');

    store.getState().openHelp();
    output = await renderToString(<AppShell useStore={store} />);
    expect(output).toContain('KEYBINDINGS');
    expect(output).toContain('[?]');
    expect(output).toContain('Open the keybinding-help screen');

    store.getState().closeHelp();
    output = await renderToString(<AppShell useStore={store} />);
    expect(output).not.toContain('KEYBINDINGS');
  });

  it('shows the launch banner on the first Dashboard visit only (AC1)', async () => {
    const store = createAppStore();
    let output = await renderToString(<AppShell useStore={store} />);
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }
    expect(store.getState().launchBannerShown).toBe(false);

    store.getState().setActiveZone('logs');
    await renderToString(<AppShell useStore={store} />);
    expect(store.getState().launchBannerShown).toBe(true);

    store.getState().setActiveZone('dashboard');
    const output2 = await renderToString(<AppShell useStore={store} />);
    for (const line of BANNER_LINES) {
      expect(output2).not.toContain(line);
    }
  });

  it('prevents the launch banner from reappearing once the store flag is set (AC1 regression guard)', async () => {
    const store = createAppStore();
    store.getState().markLaunchBannerShown();
    const output = await renderToString(<AppShell useStore={store} />);
    for (const line of BANNER_LINES) {
      expect(output).not.toContain(line);
    }
  });
});