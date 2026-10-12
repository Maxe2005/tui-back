import { describe, it, expect, vi } from 'vitest';
import type { ResolveTabVisibilityData } from '../../../core/edt/resolve-tab-visibility.js';
import {
  AppShell,
  shouldCloseHelp,
  shouldOpenHelp,
  shouldQuit,
  shouldSwitchZone,
  shouldOpenCommand,
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

describe('help-open decision helpers', () => {
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
  it('advertises W wrap-all and [Ctrl+W] resize in the Logs footer, and no [W] hint in another zone', async () => {
    const store = createAppStore();
    const onQuit = vi.fn();
    store.getState().setActiveZone('logs');
    const logsOutput = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(logsOutput).toContain('[W] wrap all');
    expect(logsOutput).toContain('[Ctrl+W] resize');

    store.getState().setActiveZone('edts');
    const edtsOutput = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(edtsOutput).toContain('[Ctrl+W] resize');
    expect(edtsOutput).not.toContain('[W] wrap all');
  });

  const onQuit = () => {};

  it('shows the top bar, six-zone tab bar, and footer simultaneously', async () => {
    const store = createAppStore();
    let output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).toContain('tui-back');
    for (const zone of ZONES) {
      expect(output).toContain(`[${zone.mnemonic}] ${zone.label}`);
    }
  });

  it('never mounts the command bar on initial render — commandBarOpen defaults closed', async () => {
    const store = createAppStore();
    const output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).not.toContain('COMMAND');
  });

  it('still renders its full chrome (top bar, zone tabs, footer) once the root height is bound to the terminal rows', async () => {
    // render-to-string.ts pins the test harness's stdout to a fixed 40-row size, mirroring
    // Ink's own useWindowSize() height binding on AppShell's root Box — this guards against
    // that height binding clipping content off the bottom of a real, shorter terminal.
    const store = createAppStore();
    const output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).toContain('tui-back');
    for (const zone of ZONES) {
      expect(output).toContain(`[${zone.mnemonic}] ${zone.label}`);
    }
    expect(output).toContain('[q] quit');
  });

  it('shows a glyph+counter badge while the developer is elsewhere and clears it once the zone is visited', async () => {
    const store = createAppStore();
    store.getState().addZoneEvent('logs');
    let output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).toContain('●1');

    store.getState().setActiveZone('logs');
    output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
    expect(output).not.toContain('●1');
  });

  it('mounts a placeholder screen for every zone at its tab — none missing or unreachable', async () => {
    const store = createAppStore();
    for (const zone of ZONES) {
      store.getState().setActiveZone(zone.id);
      const output = await renderToString(<AppShell useStore={store} onQuit={onQuit} />);
      expect(output).toContain(zone.label.toUpperCase());
      // EDTs, Update, Logs, Routes and shared-types render real content (covered by their own zone tests);
      // every other zone is still the placeholder these two literal strings come from.
      if (zone.id !== 'edts' && zone.id !== 'update' && zone.id !== 'logs' && zone.id !== 'routes' && zone.id !== 'shared-types') {
        expect(output).toContain('list pane');
        expect(output).toContain('detail pane');
      }
    }
  });

  it('opens the repo registry screen from the store (reachable only via the `registry` command inside the `:` command bar) and hides it again', async () => {
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

  it('opens the keybinding-help modal from the store and hides it again', async () => {
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

  it('shows the launch banner on every Dashboard visit, including after switching away and back', async () => {
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

    describe('reachable-set gating', () => {
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

    describe('shouldFallbackToDashboard', () => {
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

    describe('resolveZoneArrowSwitch', () => {
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

    describe('resize-mode dispatch helpers (Ctrl+W)', () => {
      describe('shouldEnterResizeMode', () => {
        it('is true for ctrl+w in every zone declaring a boundary', () => {
          expect(shouldEnterResizeMode('w', { ctrl: true }, 'edts')).toBe(true);
        });

        it('is false without the ctrl modifier', () => {
          expect(shouldEnterResizeMode('w', { ctrl: false }, 'edts')).toBe(false);
        });

        it('is false for a different letter, even with ctrl', () => {
          expect(shouldEnterResizeMode('q', { ctrl: true }, 'edts')).toBe(false);
        });

        it('is true in every zone, each declaring at least one boundary', () => {
          for (const zone of ZONES) {
            expect(shouldEnterResizeMode('w', { ctrl: true }, zone.id)).toBe(true);
          }
        });
      });

      describe('isVerticalResizeBoundary', () => {
        it('follows the zone spec: EDTs boundary 0 vertical, 1/2 horizontal; Logs boundary 0 vertical', () => {
          expect(isVerticalResizeBoundary('edts', 0)).toBe(true);
          expect(isVerticalResizeBoundary('edts', 1)).toBe(false);
          expect(isVerticalResizeBoundary('edts', 2)).toBe(false);
          expect(isVerticalResizeBoundary('logs', 0)).toBe(true);
        });
      });

      describe('resolveResizeStep', () => {
        it('boundary 0 (vertical): leftArrow/rightArrow move it, upArrow/downArrow do not', () => {
          expect(resolveResizeStep({ leftArrow: true }, 'edts', 0)).toBe(-RESIZE_STEP);
          expect(resolveResizeStep({ rightArrow: true }, 'edts', 0)).toBe(RESIZE_STEP);
          expect(resolveResizeStep({ upArrow: true }, 'edts', 0)).toBeNull();
          expect(resolveResizeStep({ downArrow: true }, 'edts', 0)).toBeNull();
        });

        it('boundary 1/2 (horizontal): upArrow/downArrow move it, leftArrow/rightArrow do not', () => {
          expect(resolveResizeStep({ upArrow: true }, 'edts', 1)).toBe(-RESIZE_STEP);
          expect(resolveResizeStep({ downArrow: true }, 'edts', 1)).toBe(RESIZE_STEP);
          expect(resolveResizeStep({ leftArrow: true }, 'edts', 2)).toBeNull();
          expect(resolveResizeStep({ rightArrow: true }, 'edts', 2)).toBeNull();
        });

        it('returns null for a non-arrow key', () => {
          expect(resolveResizeStep({}, 'edts', 0)).toBeNull();
          expect(resolveResizeStep({}, 'edts', 1)).toBeNull();
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
        footerContexts: [],
        setFooterContext: () => {},
        // Settings
        settings: { general: { quitShortcutEnabled: true, editorCommand: '' }, commandPalette: { gridMaxRows: 8 }, edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true } },
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
        registryCleanScanStatus: 'idle',
        registryCleanScanError: null,
        registryCleanCandidates: null,
        registryCleanErrors: [],
        scanRegistryStaleEntries: async () => {},
        registryCleanStatus: 'idle',
        registryCleanResults: null,
        removeStaleRegistryCandidates: async () => {},
        resetRegistryScreen: () => {},
        edts: null,
        edtsStatus: 'idle',
        edtsError: null,
        loadEdts: async () => {},
        createEdt: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        activateEdt: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        switchEdt: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        switchDirtyRepos: null,
        resolveSwitchDirtyRepos: () => {},
        modifyEdt: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        deleteEdt: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        resolveMemberDeleteStatuses: async () => [],
        listBranches: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        listCreateBranches: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        createMemberBranch: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        renameBranch: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        zoneInputCaptured: false,
        setZoneInputCaptured: () => {},
        logsPaneGridArrowsActive: false,
        setLogsPaneGridArrowsActive: () => {},
        quitRequested: false,
        requestQuit: () => {},
        // EDT action state
        currentEdtAction: null,
        setCurrentEdtAction: () => {},
        edtActionLog: [],
        edtActionLogStatus: 'idle',
        loadEdtActionLog: async () => {},
        openEdtCreateDialog: () => {},
        openEdtSwitchDialog: () => {},
        openEdtModifyDialog: () => {},
        openEdtDeleteDialog: () => {},
        openEdtCreateFromDialog: () => {},
        logEdtAction: async () => {},
        // Update zone run state
        updateStatus: 'idle',
        updateResults: [],
        updateNote: null,
        updateTopic: null,
        updateError: null,
        updateErrorCode: null,
        updateUlid: null,
        updateScope: null,
        updateSelection: null,
        incidents: [],
        incidentPopupOpen: false,
        incidentToast: null,
        resolveUpdateIncident: () => {},
        openIncidentPopup: () => {},
        closeIncidentPopup: () => {},
        clearIncidentToast: () => {},
        runGroupUpdate: async () => {},
        // Pre-run configuration screen state
        updateConfig: null,
        openUpdateConfig: async () => {},
        // Single-service command entry point + service quick-pick state
        openUpdateServiceDialog: async () => {},
        updateServiceSelectRequest: false,
        clearUpdateServiceSelectionRequest: () => {},
        updateServicePick: null,
        openUpdateServicePick: async () => {},
        closeUpdateServicePick: () => {},
        setUpdateConfig: () => {},
        closeUpdateConfig: () => {},
        listMergeSourceEdts: async () => [],
        chooseMergeSourceEdt: async () => {},
        confirmUpdateConfig: async () => {},
        // Per-service standalone restart in-flight map + runner
        serviceRestartInFlight: {},
        runServiceRestart: async () => {},
        describeServiceRestart: async () => ({ restartAvailable: true }),
        markUpdateInterrupted: async () => {},
        clearUpdate: () => {},
        // Update zone service-list health poll + last-outcome map
        updateServiceHealth: {},
        lastServiceOutcomes: {},
        startUpdateHealthPolling: () => {},
        stopUpdateHealthPolling: () => {},
        // Live per-service run tracking + issue log
        liveServicePhase: {},
        liveServiceIssues: {},
        liveServiceSteps: {},
        liveServiceDone: {},
        updateNotice: null,
        lastServiceRuns: {},
        // Logs zone state
        logsEdtSelected: [],
        logsOtherSelected: [],
        logsFullscreenTarget: null,
        logsFullscreenServiceName: null,
        logsPanes: {},
        toggleLogsEdtSelection: () => {},
        toggleLogsOtherSelection: () => {},
        selectAllLogsEdtServices: () => {},
        deselectAllLogsEdtServices: () => {},
        selectAllLogsOtherServices: () => {},
        deselectAllLogsOtherServices: () => {},
        logsNoContainer: {},
        resolveLogsContainerPresence: () => {},
        logsListedHealth: {},
        startLogsListedHealthPolling: () => {},
        stopLogsListedHealthPolling: () => {},
        openLogsFullscreen: () => {},
        closeLogsFullscreen: () => {},
        subscribeLogsPane: async () => {},
        unsubscribeLogsPane: () => {},
        restartLogsPane: async () => {},
        loadOlderLogsPane: async () => {},
        clearLogsPane: () => {},
        setLogsPaneScrollOffset: () => {},
        stopAllLogsPanes: () => {},
        // Filter-history state
        filterHistory: {},
        loadFilterHistory: async () => {},
        commitFilterHistoryEntry: () => {},
        clearGlobalFilterHistory: () => {},
        clearServiceFilterHistory: () => {},
        clearFilterHistoryAndDrainSaves: async () => {},
        resetScreenOpen: false,
        resetNotice: null,
        resetPreview: null,
        resetStatus: 'idle',
        resetResult: null,
        resetError: null,
        openResetScreen: () => false,
        closeResetScreen: () => {},
        dismissResetNotice: () => {},
        runReset: async () => {},
        // Routes zone state
        routesRepoPath: null,
        routes: null,
        routesStatus: 'idle',
        routesError: null,
        loadRoutes: async () => {},
        // Routes zone fire state (per route) and right-pane focus/tab
        fireRoute: async () => {},
        requestDrafts: {},
        responses: {},
        ensureRequestDraft: () => {},
        updateRequestDraft: () => {},
        routesPaneFocus: 'list',
        routesPaneTab: 'request',
        setRoutesPaneFocus: () => {},
        setRoutesPaneTab: () => {},
        routesFilter: { value: '', cursor: 0 },
        setRoutesFilter: () => {},
        routesSelected: 0,
        setRoutesSelected: () => {},
        // JsonTree session state
        jsonTreeStates: {},
        updateJsonTreeState: () => {},
        // Body-draft session state
        bodyDrafts: {},
        bodyEditErrors: {},
        ensureBodyDraft: () => {},
        updateBodyDraft: () => {},
        setBodyEditError: () => {},
        setBodyEditErrors: () => {},
        // Saved-request library state
        draftOrigins: {},
        savedRequests: null,
        savedRequestsError: null,
        refreshSavedRequests: async () => {},
        saveRequestDraft: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        loadSavedRequest: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        deleteSavedRequest: async () => ({ ok: false, error: { code: 'unwired', message: 'unwired' } }),
        sharedTypesConsumers: [],
        sharedTypesIssues: [],
        sharedTypesConsumersStatus: 'idle',
        sharedTypesConsumersError: null,
        sharedTypesRun: { status: 'idle', version: '', options: { install: false, cleanRestart: false, commit: false }, blocked: null, results: [], live: null },
        sharedTypesSources: [],
        sharedTypesSourceIssues: [],
        sharedTypesSourcesStatus: 'idle',
        sharedTypesSourcesError: null,
        sharedTypesPublish: { status: 'idle', version: null, output: null, error: null, notice: null },
        loadSharedTypesConsumers: async () => {},
        runSharedTypesPropagation: async () => {},
        retrySharedTypesService: async () => {},
        resetSharedTypesRun: () => {},
        loadSharedTypesSource: async () => {},
        runSharedTypesPublish: async () => {},
        retrySharedTypesPublish: async () => {},
        resetSharedTypesPublish: () => {},
      };
      expect(shouldQuit('q', {}, minimalState)).toBe(true);
      expect(shouldQuit('q', {}, { ...minimalState, runInProgress: true })).toBe(false);
      expect(shouldQuit('j', {}, minimalState)).toBe(false);
      expect(
        shouldQuit('q', {}, { ...minimalState, settings: { ...minimalState.settings, general: { quitShortcutEnabled: false, editorCommand: '' } } }),
      ).toBe(false);
    });
  });
});