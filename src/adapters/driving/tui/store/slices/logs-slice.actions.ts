// tui/store/slices: the Logs slice's service actions — pane notices, the registry-backed
// action list/run, restart, the `R`/`O` shortcuts, and open-in-IDE. Failures surface as a
// one-line pane notice; the public actions never reject.
import { err, type Result } from '../../../../../core/result.js';
import {
  NO_CLEAN_RECIPE_NOTICE,
  NO_CLEAN_RECIPE_REASON,
  openInIde,
  restartBlockingLocks,
  type RestartMode,
  type ServiceAction,
} from '../../../../../core/service-actions/index.js';
import { OPEN_IN_IDE_ACTION_ID, RESTART_ACTION_IDS, RESTART_MODES, TERMINAL_KINDS } from './service-action-ids.js';
import type { LogsHealthHelpers } from './logs-slice.health.js';
import {
  LOGS_ACTION_FAILED_NOTICE,
  LOGS_ACTIONS_UNAVAILABLE_NOTICE,
  RESTART_LABELS,
  unavailableNotice,
  type LogsPaneData,
  type LogsSlice,
  type LogsSliceContext,
  type LogsSliceGet,
  type LogsSliceSet,
} from './logs-slice.types.js';

export function createLogsServiceActions(
  ctx: LogsSliceContext,
  set: LogsSliceSet,
  get: LogsSliceGet,
  health: LogsHealthHelpers,
): Pick<
  LogsSlice,
  'restartLogsPane' | 'listLogsPaneActions' | 'runLogsPaneAction' | 'runLogsPaneShortcut' | 'openLogsPaneInIde'
> {
  const { deps, logsManager, serviceActions } = ctx;
  const { pollPaneHealth } = health;
  function patchPaneNotice(repoPath: string, notice: string | null): void {
    set((state) => {
      const current = state.logsPanes[repoPath];
      return current ? { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, notice } } } : {};
    });
  }

  function settingsRestartMode(): RestartMode {
    return get().settings.logs.restartMode === 'clean' ? 'clean' : 'simple';
  }

  async function listPaneActions(repoPath: string): Promise<ServiceAction[] | null> {
    if (serviceActions === null) {
      return null;
    }
    const listed = await serviceActions
      .list(repoPath, { blockingLocks: restartBlockingLocks(get().activeEdt) })
      .catch((): Result<ServiceAction[]> => err('internal-error', 'Listing the service actions failed.'));
    return listed.ok ? listed.data : null;
  }

  // Runs one freshly-listed registry entry: a disabled one only shows its reason on the pane.
  async function runEntry(repoPath: string, entry: ServiceAction, service: string, restartNotice?: string): Promise<void> {
    if (!entry.availability.available) {
      patchPaneNotice(repoPath, unavailableNotice(entry.label, entry.availability.reason));
      return;
    }
    if (entry.id === OPEN_IN_IDE_ACTION_ID) {
      get().openLogsPaneInIde(repoPath);
      return;
    }
    const terminalKind = TERMINAL_KINDS[entry.id];
    if (terminalKind !== undefined) {
      await get().openTerminal(repoPath, terminalKind, service);
      return;
    }
    const mode = RESTART_MODES[entry.id];
    if (mode !== undefined) {
      await restartPane(repoPath, mode, restartNotice);
      return;
    }
    patchPaneNotice(repoPath, unavailableNotice(entry.label, 'not supported in Logs'));
  }

  // Re-lists the registry right before running (never trusting a cached availability) and
  // finds `actionId`. Null — with the reason already on the pane, or the pane gone — when
  // nothing should run.
  async function freshEntry(repoPath: string, actionId: string): Promise<{ entry: ServiceAction; fresh: ServiceAction[] } | null> {
    const fresh = await listPaneActions(repoPath);
    if (!get().logsPanes[repoPath]) {
      return null;
    }
    if (fresh === null) {
      patchPaneNotice(repoPath, LOGS_ACTIONS_UNAVAILABLE_NOTICE);
      return null;
    }
    const entry = fresh.find((action) => action.id === actionId);
    if (entry === undefined) {
      patchPaneNotice(repoPath, unavailableNotice(actionId, 'not offered for this service'));
      return null;
    }
    return { entry, fresh };
  }

  // The public actions never reject: an unexpected throw becomes a pane notice.
  async function guarded(repoPath: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch {
      patchPaneNotice(repoPath, LOGS_ACTION_FAILED_NOTICE);
    }
  }

  // `fallbackNotice` is shown after a restart that stood in for another one (the `R`
  // clean→simple fallback), next to the streamError when it fails; the restart's own notice
  // wins when it has one.
  async function restartPane(repoPath: string, mode: RestartMode, fallbackNotice?: string): Promise<void> {
    if (!logsManager) {
      return;
    }
    const pane = get().logsPanes[repoPath];
    if (!pane) {
      return;
    }
    // A pane already restarting (requested here, or reported by the health poll) never gets a
    // second concurrent restart; a container-less pane has nothing to restart. Either way the
    // pane says why instead of silently ignoring the key.
    const label = RESTART_LABELS[mode];
    if (pane.restarting || pane.health === 'restarting') {
      patchPaneNotice(repoPath, unavailableNotice(label, 'restart in progress'));
      return;
    }
    if (pane.noContainer === true || pane.health === 'no-container') {
      patchPaneNotice(repoPath, unavailableNotice(label, 'no container'));
      return;
    }
    const patchPane = (patch: Partial<LogsPaneData>) =>
      set((state) => {
        const current = state.logsPanes[repoPath];
        return current ? { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, ...patch } } } : {};
      });
    patchPane({ restarting: true, notice: null, streamError: null });
    const restarted: Result<{ notice?: string }> = serviceActions
      ? await serviceActions
          .restart(repoPath, mode)
          .catch((): Result<{ notice?: string }> => err('internal-error', 'The restart failed unexpectedly.'))
      : err('restart-unavailable', 'No restart ports are wired — cannot restart the service.');
    if (!restarted.ok) {
      // Failure surfaces inline on the pane; the badge keeps last-known health, except a
      // manifest that turned out to declare no container.
      patchPane({
        restarting: false,
        notice: fallbackNotice ?? null,
        ...(restarted.error.code === 'no-container' ? { noContainer: true, health: 'no-container' as const } : {}),
        streamError: { code: restarted.error.code, message: restarted.error.message },
      });
      return;
    }
    patchPane({ restarting: false, streamError: null, notice: restarted.data.notice ?? fallbackNotice ?? null });
    // After the restart call resolves, health is re-polled immediately so the badge
    // reflects the new state.
    await pollPaneHealth(repoPath);
  }
  return {
    restartLogsPane: (repoPath, mode) => restartPane(repoPath, mode ?? settingsRestartMode()),

    listLogsPaneActions: (repoPath) => listPaneActions(repoPath),

    runLogsPaneAction: (repoPath, actionId, service) =>
      guarded(repoPath, async () => {
        // Open in IDE is always available: never held up by a failed or slow listing.
        if (actionId === OPEN_IN_IDE_ACTION_ID) {
          get().openLogsPaneInIde(repoPath);
          return;
        }
        if (serviceActions === null) {
          patchPaneNotice(repoPath, LOGS_ACTIONS_UNAVAILABLE_NOTICE);
          return;
        }
        const found = await freshEntry(repoPath, actionId);
        if (found !== null) {
          await runEntry(repoPath, found.entry, service);
        }
      }),

    runLogsPaneShortcut: (repoPath, shortcut, service) =>
      guarded(repoPath, async () => {
        if (shortcut === 'ide') {
          get().openLogsPaneInIde(repoPath);
          return;
        }
        if (serviceActions === null) {
          // Unwired restart ports: restartPane reports why it cannot restart.
          await restartPane(repoPath, settingsRestartMode());
          return;
        }
        const found = await freshEntry(repoPath, RESTART_ACTION_IDS[settingsRestartMode()]);
        if (found === null) {
          return;
        }
        const { availability } = found.entry;
        if (!availability.available && availability.reason === NO_CLEAN_RECIPE_REASON) {
          // A clean restart disabled only for its missing recipe falls back to the simple one
          // (which may itself be disabled: then its own reason shows).
          const simple = found.fresh.find((action) => action.id === RESTART_ACTION_IDS.simple);
          if (simple === undefined) {
            patchPaneNotice(repoPath, unavailableNotice(RESTART_LABELS.simple, 'not offered for this service'));
            return;
          }
          await runEntry(repoPath, simple, service, NO_CLEAN_RECIPE_NOTICE);
          return;
        }
        await runEntry(repoPath, found.entry, service);
      }),

    openLogsPaneInIde: (repoPath) => {
      const patchNotice = (notice: string | null) =>
        set((state) => {
          const current = state.logsPanes[repoPath];
          return current ? { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, notice } } } : {};
        });
      patchNotice(null);
      const ctx = { editorCommand: get().settings.general.editorCommand };
      const opened: Result<void> = serviceActions
        ? serviceActions.openInIde(repoPath, ctx)
        : deps?.editor
          ? openInIde(deps.editor, repoPath, ctx)
          : err('editor-unavailable', 'No editor port is wired — cannot open the repo in an editor.');
      if (!opened.ok) {
        patchNotice(opened.error.message.split('\n')[0] ?? opened.error.message);
      }
    },
  };
}
