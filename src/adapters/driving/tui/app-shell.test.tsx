import { describe, it, expect } from 'vitest';
import type { ResolveTabVisibilityData } from '../../../core/edt/resolve-tab-visibility.js';
import {
  AppShell,
  shouldCloseHelp,
  shouldOpenHelp,
  shouldQuit,
  shouldSwitchZone,
  shouldOpenCommand,
  shouldOpenFilter,
  resolveZoneArrowSwitch,
  shouldFallbackToDashboard,
  shouldEnterResizeMode,
  isVerticalResizeBoundary,
  resolveResizeStep,
  shouldExitResizeMode,
  RESIZE_STEP,
} from './app-shell.js';
import { createAppStore, type AppState, type ZoneEvents, type ZoneRatios } from './store/app-store.js';
import { ZONES, type ZoneId } from './zones/zones.js';
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

  it('never mounts the command bar on initial render — commandBarOpen defaults closed (story 2.14)', async () => {
    const store = createAppStore();
    const output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).not.toContain('COMMAND');
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
      // (see edts-zone.test.tsx for its own coverage). Story 3.1: same for Update
      // (see update-zone.test.tsx) — every other zone is still the placeholder these
      // two literal strings come from.
      if (zone.id !== 'edts' && zone.id !== 'update') {
        expect(output).toContain('list pane');
        expect(output).toContain('detail pane');
      }
    }
  });

  it('opens the repo registry screen from the store (reachable only via the `registry` command inside the `:` command bar, story 2.14) and hides it again', async () => {
    const store = createAppStore();
    let output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).not.toContain('REPO REGISTRY');

    store.getState().openRegistryScreen();
    output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).toContain('REPO REGISTRY');
    expect(output).toContain('Root path:');

    store.getState().closeRegistryScreen();
    output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).not.toContain('REPO REGISTRY');
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

  it('shows the launch banner on every Dashboard visit, including after switching away and back (story 2.16)', async () => {
    const store = createAppStore();
    let output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }

    store.getState().setActiveZone('logs');
    const logsOutput = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    // The banner is scoped to DashboardZone — it must never appear while another zone is active.
    for (const line of BANNER_LINES) {
      expect(logsOutput).not.toContain(line);
    }

    store.getState().setActiveZone('dashboard');
    const output2 = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    for (const line of BANNER_LINES) {
      expect(output2).toContain(line);
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

    describe('reachable-set gating (story 2.13)', () => {
      it('shouldSwitchZone returns null for an omitted zone\'s mnemonic — never lands on it', () => {
        const reachable: ReadonlySet<ZoneId> = new Set(['dashboard', 'edts', 'update', 'logs', 'shared-types']);
        expect(shouldSwitchZone('r', reachable)).toBeNull();
      });

      it('shouldSwitchZone still resolves a disabled (but reachable) zone\'s mnemonic', () => {
        const reachable: ReadonlySet<ZoneId> = new Set(['dashboard', 'edts', 'update', 'logs', 'routes', 'shared-types']);
        expect(shouldSwitchZone('r', reachable)).toBe('routes');
      });

      it('resolveZoneArrowSwitch skips an omitted tab during wrap traversal', () => {
        const reachable: ReadonlySet<ZoneId> = new Set(['dashboard', 'edts', 'update', 'logs', 'shared-types']);
        expect(resolveZoneArrowSwitch({ rightArrow: true }, 'logs', reachable)).toBe('shared-types');
      });

      it('resolveZoneArrowSwitch lands on a disabled (still reachable) tab', () => {
        const reachable: ReadonlySet<ZoneId> = new Set(['dashboard', 'edts', 'update', 'logs', 'routes']);
        expect(resolveZoneArrowSwitch({ rightArrow: true }, 'logs', reachable)).toBe('routes');
      });
    });

    describe('shouldFallbackToDashboard (story 2.13)', () => {
      function tabVisibility(overrides: Partial<ResolveTabVisibilityData> = {}): ResolveTabVisibilityData {
        return {
          routes: { status: 'enabled', carryingServices: [] },
          sharedTypes: { status: 'enabled', carryingServices: [] },
          ...overrides,
        };
      }

      it('is true when the active zone is routes and routes is omitted', () => {
        const visibility = tabVisibility({ routes: { status: 'omitted', carryingServices: [] } });
        expect(shouldFallbackToDashboard('routes', visibility)).toBe(true);
      });

      it('is true when the active zone is shared-types and shared-types is omitted', () => {
        const visibility = tabVisibility({ sharedTypes: { status: 'omitted', carryingServices: [] } });
        expect(shouldFallbackToDashboard('shared-types', visibility)).toBe(true);
      });

      it('is false when the active zone is merely disabled (content swaps in place, no forced nav)', () => {
        const visibility = tabVisibility({ routes: { status: 'disabled', carryingServices: ['api-gateway'] } });
        expect(shouldFallbackToDashboard('routes', visibility)).toBe(false);
      });

      it('is false for a non-gated active zone regardless of tabVisibility', () => {
        const visibility = tabVisibility({
          routes: { status: 'omitted', carryingServices: [] },
          sharedTypes: { status: 'omitted', carryingServices: [] },
        });
        expect(shouldFallbackToDashboard('dashboard', visibility)).toBe(false);
        expect(shouldFallbackToDashboard('logs', visibility)).toBe(false);
      });
    });

    it('shouldOpenFilter returns true for /', () => {
      expect(shouldOpenFilter('/')).toBe(true);
      expect(shouldOpenFilter('j')).toBe(false);
    });

    describe('resolveZoneArrowSwitch (story 2.12)', () => {
      it('resolves rightArrow to the next zone in ZONES order', () => {
        expect(resolveZoneArrowSwitch({ rightArrow: true }, 'dashboard')).toBe('edts');
        expect(resolveZoneArrowSwitch({ rightArrow: true }, 'edts')).toBe('update');
      });

      it('resolves leftArrow to the previous zone in ZONES order', () => {
        expect(resolveZoneArrowSwitch({ leftArrow: true }, 'edts')).toBe('dashboard');
        expect(resolveZoneArrowSwitch({ leftArrow: true }, 'update')).toBe('edts');
      });

      it('wraps forward past the last zone back to the first', () => {
        expect(resolveZoneArrowSwitch({ rightArrow: true }, 'shared-types')).toBe('dashboard');
      });

      it('wraps backward past the first zone to the last', () => {
        expect(resolveZoneArrowSwitch({ leftArrow: true }, 'dashboard')).toBe('shared-types');
      });

      it('returns null when neither arrow key is set', () => {
        expect(resolveZoneArrowSwitch({}, 'dashboard')).toBeNull();
      });
    });

    describe('resize-mode dispatch helpers (story 2.21, Ctrl+W)', () => {
      describe('shouldEnterResizeMode', () => {
        it('is true for ctrl+w while the EDTs zone is active', () => {
          expect(shouldEnterResizeMode('w', { ctrl: true }, 'edts')).toBe(true);
        });

        it('is false without the ctrl modifier', () => {
          expect(shouldEnterResizeMode('w', { ctrl: false }, 'edts')).toBe(false);
        });

        it('is false for a different letter, even with ctrl', () => {
          expect(shouldEnterResizeMode('q', { ctrl: true }, 'edts')).toBe(false);
        });

        it('is false while any other zone is active (Boundaries: "a no-op elsewhere")', () => {
          for (const zone of ZONES) {
            if (zone.id === 'edts') {
              continue;
            }
            expect(shouldEnterResizeMode('w', { ctrl: true }, zone.id)).toBe(false);
          }
        });
      });

      describe('isVerticalResizeBoundary', () => {
        it('is true only for boundary 0', () => {
          expect(isVerticalResizeBoundary(0)).toBe(true);
          expect(isVerticalResizeBoundary(1)).toBe(false);
          expect(isVerticalResizeBoundary(2)).toBe(false);
        });
      });

      describe('resolveResizeStep', () => {
        it('boundary 0 (vertical): leftArrow/rightArrow move it, upArrow/downArrow do not', () => {
          expect(resolveResizeStep({ leftArrow: true }, 0)).toBe(-RESIZE_STEP);
          expect(resolveResizeStep({ rightArrow: true }, 0)).toBe(RESIZE_STEP);
          expect(resolveResizeStep({ upArrow: true }, 0)).toBeNull();
          expect(resolveResizeStep({ downArrow: true }, 0)).toBeNull();
        });

        it('boundary 1/2 (horizontal): upArrow/downArrow move it, leftArrow/rightArrow do not', () => {
          expect(resolveResizeStep({ upArrow: true }, 1)).toBe(-RESIZE_STEP);
          expect(resolveResizeStep({ downArrow: true }, 1)).toBe(RESIZE_STEP);
          expect(resolveResizeStep({ leftArrow: true }, 2)).toBeNull();
          expect(resolveResizeStep({ rightArrow: true }, 2)).toBeNull();
        });

        it('returns null for a non-arrow key', () => {
          expect(resolveResizeStep({}, 0)).toBeNull();
          expect(resolveResizeStep({}, 1)).toBeNull();
        });
      });

      describe('shouldExitResizeMode', () => {
        it('is true for Enter or Escape', () => {
          expect(shouldExitResizeMode({ return: true })).toBe(true);
          expect(shouldExitResizeMode({ escape: true })).toBe(true);
        });

        it('is false for every other key', () => {
          expect(shouldExitResizeMode({})).toBe(false);
        });
      });
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
        setSplitterRatio: async () => {},
        loadSplitterRatios: async () => {},
        resizeMode: null,
        enterResizeMode: () => {},
        exitResizeMode: () => {},
        cycleResizeTargetBoundary: () => {},
        activeEdt: null,
        setActiveEdt: () => {},
        helpOpen: false,
        openHelp: () => {},
        closeHelp: () => {},
        runInProgress: false,
        setRunInProgress: () => {},
        edtsBranches: null,
        edtsBranchesStatus: 'idle',
        edtsBranchesError: null,
        edtsUnreachable: [],
        edtsErrors: [],
        loadEdtsBranches: async () => {},
        tabVisibility: {
          routes: { status: 'enabled', carryingServices: [] },
          sharedTypes: { status: 'enabled', carryingServices: [] },
        },
        tabVisibilityStatus: 'idle',
        tabVisibilityError: null,
        loadTabVisibility: async () => {},
        registryScreenOpen: false,
        openRegistryScreen: () => {},
        closeRegistryScreen: () => {},
        commandBarOpen: false,
        openCommandBar: () => {},
        closeCommandBar: () => {},
        // Story 2.19
        settings: { commandPalette: { gridMaxRows: 8 }, edts: { hiddenActionHints: [], hiddenActionTypes: [] } },
        settingsWarning: null,
        settingsScreenOpen: false,
        loadSettings: async () => {},
        updateSettings: async () => {},
        openSettingsScreen: () => {},
        closeSettingsScreen: () => {},
        registrySessionId: 0,
        registryEmpty: null,
        registryEmptyStatus: 'idle',
        checkRegistryEmpty: async () => {},
        registryScanStatus: 'idle',
        registryScanError: null,
        registryScanResult: null,
        scanRegistryRoot: async () => {},
        registryRegisterStatus: 'idle',
        registryRegisterResults: null,
        registerRegistryCandidates: async () => {},
        resetRegistryScreen: () => {},
        edts: null,
        edtsStatus: 'idle',
        edtsError: null,
        loadEdts: async () => {},
        createEdt: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        switchEdt: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        modifyEdt: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        deleteEdt: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        resolveMemberDeleteStatuses: async () => [],
        listBranches: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        createMemberBranch: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        renameBranch: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        zoneInputCaptured: false,
        setZoneInputCaptured: () => {},
        quitRequested: false,
        requestQuit: () => {},
        // Story 2.15: EDT action state
        currentEdtAction: null,
        setCurrentEdtAction: () => {},
        edtActionLog: [],
        edtActionLogStatus: 'idle',
        loadEdtActionLog: async () => {},
        openEdtCreateDialog: () => {},
        openEdtSwitchDialog: () => {},
        openEdtModifyDialog: () => {},
        openEdtDeleteDialog: () => {},
        logEdtAction: async () => {},
        // Story 3.1: Update zone run state
        updateStatus: 'idle',
        updateResults: [],
        updateNote: null,
        updateTopic: null,
        updateError: null,
        updateErrorCode: null,
        updateUlid: null,
        updateScope: null,
        updateBlocker: null,
        resolveUpdateBlocker: () => {},
        runGroupUpdate: async () => {},
        markUpdateInterrupted: async () => {},
        clearUpdate: () => {},
      };
      expect(shouldQuit('q', {}, minimalState)).toBe(true);
      expect(shouldQuit('q', {}, { ...minimalState, runInProgress: true })).toBe(false);
      expect(shouldQuit('j', {}, minimalState)).toBe(false);
    });
  });
});