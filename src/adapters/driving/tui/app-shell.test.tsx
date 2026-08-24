import { describe, it, expect } from 'vitest';
import { AppShell, shouldCloseHelp, shouldOpenHelp, shouldQuit, shouldSwitchZone, shouldOpenCommand, shouldOpenFilter } from './app-shell.js';
import { createAppStore, type AppState, type ZoneEvents, type ZoneRatios } from './store/app-store.js';
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
  const onQuit = () => {};

  it('shows the top bar, six-zone tab bar, and footer simultaneously (AC1)', async () => {
    const store = createAppStore();
    let output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).toContain('tui-back');
    for (const zone of ZONES) {
      expect(output).toContain(`[${zone.mnemonic}] ${zone.label}`);
    }
    expect(output).toContain('[/] filter');
  });

  it('still renders its full chrome (top bar, zone tabs, footer) once the root height is bound to the terminal rows (story 2.8)', async () => {
    // render-to-string.ts pins the test harness's stdout to a fixed 40-row size, mirroring
    // Ink's own useWindowSize() height binding on AppShell's root Box — this guards against
    // that height binding clipping content off the bottom of a real, shorter terminal.
    const store = createAppStore();
    const output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).toContain('tui-back');
    for (const zone of ZONES) {
      expect(output).toContain(`[${zone.mnemonic}] ${zone.label}`);
    }
    expect(output).toContain('[/] filter');
    expect(output).toContain('[q] quit');
  });

  it('shows a glyph+counter badge while the developer is elsewhere and clears it once the zone is visited (AC3)', async () => {
    const store = createAppStore();
    store.getState().addZoneEvent('logs');
    let output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).toContain('●1');

    store.getState().setActiveZone('logs');
    output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).not.toContain('●1');
  });

  it('mounts a placeholder screen for every zone at its tab — none missing or unreachable (AC6)', async () => {
    const store = createAppStore();
    for (const zone of ZONES) {
      store.getState().setActiveZone(zone.id);
      const output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
      expect(output).toContain(zone.label.toUpperCase());
      // Story 2.6: EDTs is no longer a ZonePlaceholder stub — it renders real content
      // (see edts-zone.test.tsx for its own coverage) — every other zone is still the
      // placeholder these two literal strings come from.
      if (zone.id !== 'edts') {
        expect(output).toContain('list pane');
        expect(output).toContain('detail pane');
      }
    }
  });

  it('opens the keybinding-help modal from the store and hides it again (AC2, AC3)', async () => {
    const store = createAppStore();
    let output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).not.toContain('KEYBINDINGS');

    store.getState().openHelp();
    output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).toContain('KEYBINDINGS');
    expect(output).toContain('[?]');
    expect(output).toContain('Open the keybinding-help screen');

    store.getState().closeHelp();
    output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).not.toContain('KEYBINDINGS');
  });

  it('shows the launch banner on the first Dashboard visit only (AC1)', async () => {
    const store = createAppStore();
    let output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }
    expect(store.getState().launchBannerShown).toBe(false);

    store.getState().setActiveZone('logs');
    await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(store.getState().launchBannerShown).toBe(true);

    store.getState().setActiveZone('dashboard');
    const output2 = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    for (const line of BANNER_LINES) {
      expect(output2).not.toContain(line);
    }
  });

  it('prevents the launch banner from reappearing once the store flag is set (AC1 regression guard)', async () => {
    const store = createAppStore();
    store.getState().markLaunchBannerShown();
    const output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    for (const line of BANNER_LINES) {
      expect(output).not.toContain(line);
    }
  });

  describe('pure key dispatch helpers', () => {
    it('shouldSwitchZone maps mnemonics to ZoneId and returns null for unknown', () => {
      expect(shouldSwitchZone('d')).toBe('dashboard');
      expect(shouldSwitchZone('e')).toBe('edts');
      expect(shouldSwitchZone('u')).toBe('update');
      expect(shouldSwitchZone('l')).toBe('logs');
      expect(shouldSwitchZone('r')).toBe('routes');
      expect(shouldSwitchZone('s')).toBe('shared-types');
      expect(shouldSwitchZone('x')).toBeNull();
    });

    it('shouldOpenFilter returns true for /', () => {
      expect(shouldOpenFilter('/')).toBe(true);
      expect(shouldOpenFilter('j')).toBe(false);
    });

    it('shouldOpenCommand returns true for :', () => {
      expect(shouldOpenCommand(':')).toBe(true);
      expect(shouldOpenCommand('j')).toBe(false);
    });

it('shouldQuit returns true for q', () => {
const minimalState: AppState = {
        activeZone: 'dashboard',
        setActiveZone: () => {},
        zoneEvents: {} as ZoneEvents,
        addZoneEvent: () => {},
        splitterRatios: {} as ZoneRatios,
        setSplitterRatio: () => {},
        activeEdt: null,
        setActiveEdt: () => {},
        helpOpen: false,
        openHelp: () => {},
        closeHelp: () => {},
        launchBannerShown: false,
        markLaunchBannerShown: () => {},
        runInProgress: false,
        setRunInProgress: () => {},
        edtsBranches: null,
        edtsBranchesStatus: 'idle',
        edtsBranchesError: null,
        edtsUnreachable: [],
        edtsErrors: [],
        loadEdtsBranches: async () => {},
        edts: null,
        edtsStatus: 'idle',
        edtsError: null,
        loadEdts: async () => {},
        createEdt: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        switchEdt: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        modifyEdt: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        zoneInputCaptured: false,
        setZoneInputCaptured: () => {},
        quitRequested: false,
        requestQuit: () => {},
      };
      expect(shouldQuit('q', {}, minimalState)).toBe(true);
      expect(shouldQuit('q', {}, { ...minimalState, runInProgress: true })).toBe(false);
      expect(shouldQuit('j', {}, minimalState)).toBe(false);
    });
  });
});