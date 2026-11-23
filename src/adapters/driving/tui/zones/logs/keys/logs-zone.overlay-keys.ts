// tui/zones/logs: logs-zone.overlay-keys — the key handlers of the two modal overlays that sit
// outside the filter editor: the `a` actions menu and the per-pane fullscreen view.
import { LOGS_ACTIONS_MENU_CLOSE, toMenuItems, type LogsActionsMenuState } from '../logs-actions-menu.js';
import { resolveMenuKey } from '../../../shared/components/lists/menu-list.js';
import { resolveFullscreenScrollDirection, resolveVisibilityToggleKey, toggleGlobalFilterEngagement, togglePaneWrapFlag, toggleVisibilityFlag } from '../logic/logs-zone.logic.js';
import type { LogsKey, LogsZoneCtx } from '../logs-zone.ctx.js';

export function handleActionsMenuKey(c: LogsZoneCtx, actionsMenu: LogsActionsMenuState, key: LogsKey): void {
  const { closeActionsMenu, restartMode, runPaneAction, setActionsMenu } = c;
  const items = toMenuItems(actionsMenu.actions ?? [], restartMode);
  const step = resolveMenuKey(key, actionsMenu.cursor, items, LOGS_ACTIONS_MENU_CLOSE);
  if (step.type === 'move') {
    // Functional update: the closed-over menu may predate a list that just loaded.
    setActionsMenu((current) => (current === null ? null : { ...current, cursor: step.cursor }));
  } else if (step.type === 'choose') {
    closeActionsMenu();
    if (step.choice !== LOGS_ACTIONS_MENU_CLOSE) {
      runPaneAction(actionsMenu.repoPath, step.choice, actionsMenu.service);
    }
  }
}

export function handleFullscreenKey(c: LogsZoneCtx, logsFullscreenTarget: string, input: string, key: LogsKey): void {
  const { clearLogsPane, closeLogsFullscreen, handlePaneScroll, openActionsMenu, openGlobalFilterEditor, openPaneFilterEditor, runPaneShortcut, serviceNameFor, setPaneFilterEngaged, setPaneWrap, setVisibility } = c;
  if (key.escape) {
    closeLogsFullscreen();
    return;
  }
  // `/`/`f`/`i` — same bare-key-scopes-to-one-pane idiom as `c`/`w` below, fullscreen's one
  // pane standing in for "the sub-focused grid pane".
  if (input === '/') {
    openGlobalFilterEditor();
    return;
  }
  if (input === 'f') {
    openPaneFilterEditor(logsFullscreenTarget);
    return;
  }
  if (input === 'i') {
    setPaneFilterEngaged((current) => toggleGlobalFilterEngagement(current, logsFullscreenTarget));
    return;
  }
  const scrollDirection = resolveFullscreenScrollDirection(key);
  if (scrollDirection !== null) {
    handlePaneScroll(logsFullscreenTarget, scrollDirection);
    return;
  }
  // Ctrl+C and W ("apply to all open logs") are deliberately no-ops here — fullscreen has
  // only the one pane, and the bare key below already covers it.
  if (key.ctrl && input === 'c') {
    return;
  }
  if (input === 'c') {
    clearLogsPane(logsFullscreenTarget);
    return;
  }
  if (input === 'W') {
    return;
  }
  if (input === 'w' && !key.ctrl) {
    setPaneWrap((current) => togglePaneWrapFlag(current, logsFullscreenTarget));
    return;
  }
  // `R` / `O` are shortcuts into the service-action registry (`R` per logs.restartMode,
  // `O` open in IDE); the registry decides availability and a disabled one shows its reason
  // on the pane. Uppercase only: lowercase `r` is the global Routes-zone mnemonic (AppShell
  // exact-matches it whenever zoneInputCaptured is false, and Ink forwards every keypress to
  // all mounted useInput hooks) and lowercase `o` is the stdout toggle.
  const fullscreenService = serviceNameFor(logsFullscreenTarget);
  if (input === 'R') {
    runPaneShortcut(logsFullscreenTarget, 'restart', fullscreenService);
    return;
  }
  if (input === 'O') {
    runPaneShortcut(logsFullscreenTarget, 'ide', fullscreenService);
    return;
  }
  if (input === 'a' && !key.ctrl && !key.meta) {
    openActionsMenu(logsFullscreenTarget, fullscreenService);
    return;
  }
  const toggle = resolveVisibilityToggleKey(input);
  if (toggle !== null) {
    setVisibility((current) => toggleVisibilityFlag(current, toggle));
  }
}
