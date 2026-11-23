// tui/zones/logs: logs-zone.pane-keys — keys while the pane grid owns focus: scroll, sub-focus
// moves and the bare-key actions on the sub-focused pane (clear, wrap, filter, shortcuts, menu).
import { movePaneSubFocus, resolvePaneScrollDirection, toggleGlobalFilterEngagement, togglePaneWrapFlag } from '../logs-zone.logic.js';
import type { LogsKey, LogsZoneCtx } from '../logs-zone.ctx.js';

export function handlePaneKey(c: LogsZoneCtx, input: string, key: LogsKey): void {
  const { activePanes, clearLogsPane, handlePaneScroll, layout, openActionsMenu, openLogsFullscreen, openPaneFilterEditor, runPaneShortcut, setPaneFilterEngaged, setPaneWrap, setSubFocus, subFocus } = c;
  const scrollDirection = resolvePaneScrollDirection(key);
  if (scrollDirection !== null) {
    const focused = activePanes[subFocus];
    if (focused !== undefined) {
      handlePaneScroll(focused.path, scrollDirection);
    }
    return;
}
  if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
    const direction = key.upArrow ? 'up' : key.downArrow ? 'down' : key.leftArrow ? 'left' : 'right';
    setSubFocus((current) => movePaneSubFocus(current, direction, layout.cols, activePanes.length));
    return;
}
  if (input === 'c') {
    const focused = activePanes[subFocus];
    if (focused !== undefined) {
      clearLogsPane(focused.path);
    }
    return;
}
  if (input === 'w' && !key.ctrl) {
    const focused = activePanes[subFocus];
    if (focused !== undefined) {
      setPaneWrap((current) => togglePaneWrapFlag(current, focused.path));
    }
    return;
}
  // `f` opens the sub-focused pane's own filter editor; `i` toggles its engagement with the
  // global filter — same bare-key-scopes-to-one-pane idiom as `c`/`w` above.
  if (input === 'f') {
    const focused = activePanes[subFocus];
    if (focused !== undefined) {
      openPaneFilterEditor(focused.path);
    }
    return;
}
  if (input === 'i') {
    const focused = activePanes[subFocus];
    if (focused !== undefined) {
      setPaneFilterEngaged((current) => toggleGlobalFilterEngagement(current, focused.path));
    }
    return;
}
  // `R` / `O` / `a` on the sub-focused grid pane — the registry shortcuts and the actions
  // menu, like fullscreen (see there for why only uppercase `R`/`O`).
  if (input === 'R' || input === 'O') {
    const focused = activePanes[subFocus];
    if (focused !== undefined) {
      runPaneShortcut(focused.path, input === 'R' ? 'restart' : 'ide', focused.service);
    }
    return;
}
  if (input === 'a' && !key.ctrl && !key.meta) {
    const focused = activePanes[subFocus];
    if (focused !== undefined) {
      openActionsMenu(focused.path, focused.service);
    }
    return;
}
  if (key.return) {
    const focused = activePanes[subFocus];
    if (focused !== undefined) {
      openLogsFullscreen(focused.path, focused.service);
    }
  }
}
