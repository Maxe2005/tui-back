// tui/zones/logs: use-logs-input — registers the zone's single `useInput` and dispatches to the
// per-mode key handlers in the original priority order: actions menu, filter editor, fullscreen,
// then the zone-wide keys and the focused list/pane.
import { useInput } from '../../../shared/hooks/use-input.js';
import { useZoneInputActive } from '../../../shared/hooks/use-zone-input-active.js';
import { resolveFocusStep } from '../../../shared/keys/focus-navigation.js';
import {
  cycleLogsPaneFocus,
  DEFAULT_LOG_FILTER,
  isClearAllLogsKey,
  isWrapAllLogsKey,
  LOGS_PANE_FOCUS_NAV,
  resolveFilterClearTarget,
  resolveVisibilityToggleKey,
  setPaneGlobalFilterEngagement,
  setPaneLogFilter,
  toggleAllPanesWrapFlag,
  toggleVisibilityFlag,
} from '../logs-zone.logic.js';
import type { LogsZoneCtx } from '../logs-zone.ctx.js';
import { handleActionsMenuKey, handleFullscreenKey } from '../keys/logs-zone.overlay-keys.js';
import { handleLibraryKey, handleRuleListKey, handleSetNameKey } from '../keys/logs-zone.rule-list-keys.js';
import { handleRuleDraftKey } from '../keys/logs-zone.rule-draft-keys.js';
import { handleEdtListKey, handleOtherListKey } from '../keys/logs-zone.list-keys.js';
import { handlePaneKey } from '../keys/logs-zone.pane-keys.js';

export function useLogsInput(c: LogsZoneCtx): void {
  const {
    useStore,
    actionsMenu,
    filterEditor,
    logsFullscreenTarget,
    isPaneScopeLive,
    setFilterEditor,
    setHistoryGridCursor,
    servicesStatus,
    activePanes,
    loadEdtsBranches,
    setPaneFocus,
    openGlobalFilterEditor,
    clearLogsPane,
    setPaneWrap,
    setVisibility,
    paneFocus,
    subFocus,
    paneFilters,
    setGlobalFilter,
    setPaneFilters,
    setPaneFilterEngaged,
  } = c;
  const zoneInputActive = useZoneInputActive(useStore);
  useInput(
    (input, key) => {
      // The actions menu captures every keystroke while open: ↑/↓/Home/End move, Enter runs an
      // enabled row (the slice re-reads its availability first), Esc closes.
      if (actionsMenu !== null) {
        handleActionsMenuKey(c, actionsMenu, key);
        return;
      }

      // The filter editor captures every keystroke while open, from the grid or fullscreen —
      // checked first. Its list view manages the scope's rules (changes apply at once, Esc closes
      // and keeps them); its rule view edits one draft: Tab toggles text/regex, Ctrl+X/Ctrl+T the
      // action/target, Enter saves the rule into the list, Esc goes back to the list discarding
      // the draft.
      if (filterEditor !== null) {
        if (filterEditor.scope === 'pane' && !isPaneScopeLive(filterEditor)) {
          setFilterEditor(null);
          setHistoryGridCursor(null);
          return;
        }
        if (filterEditor.view === 'list') {
          handleRuleListKey(c, filterEditor, input, key);
          return;
        }
        if (filterEditor.view === 'library') {
          handleLibraryKey(c, filterEditor, input, key);
          return;
        }
        if (filterEditor.view === 'name') {
          handleSetNameKey(c, filterEditor, input, key);
          return;
        }
        handleRuleDraftKey(c, filterEditor, input, key);
        return;
      }

      if (logsFullscreenTarget !== null) {
        handleFullscreenKey(c, logsFullscreenTarget, input, key);
        return;
      }

      // R restarts the focused pane once panes are open, so it only retries the load when there
      // is no pane to restart.
      if (input === 'R' && servicesStatus === 'error' && activePanes.length === 0) {
        void loadEdtsBranches();
        return;
      }

      const paneStep = resolveFocusStep(input, key, LOGS_PANE_FOCUS_NAV.mode);
      if (paneStep !== null) {
        setPaneFocus((current) => cycleLogsPaneFocus(current, paneStep));
        return;
      }

      // `/` (any Logs-zone focus) opens the global filter's editor — focus-independent, so it is
      // checked ahead of the per-list dispatch below, like Tab just above.
      if (input === '/') {
        openGlobalFilterEditor();
        return;
      }

      // "Apply to all open logs" — every currently-active pane (any list focus), never
      // reachable in fullscreen (that branch already returned above).
      if (isClearAllLogsKey(input, key)) {
        for (const pane of activePanes) {
          clearLogsPane(pane.path);
        }
        return;
      }
      if (isWrapAllLogsKey(input, key)) {
        const paths = activePanes.map((pane) => pane.path);
        setPaneWrap((current) => toggleAllPanesWrapFlag(current, paths));
        return;
      }

      const toggle = resolveVisibilityToggleKey(input);
      if (toggle !== null) {
        setVisibility((current) => toggleVisibilityFlag(current, toggle));
        return;
      }

      // Escape, when no editor is open: on a sub-focused grid pane, clears its own filter if set,
      // else disengages it from the global filter; with list focus, clears the global filter.
      // resolveFilterClearTarget is the pure resolver; this dispatches its result.
      if (key.escape) {
        const focused = paneFocus === 'panes' ? activePanes[subFocus] : undefined;
        const repoPath = focused?.path ?? null;
        const hasOwnFilter = repoPath !== null && paneFilters[repoPath] !== undefined;
        const target = resolveFilterClearTarget(paneFocus === 'panes', repoPath, hasOwnFilter);
        if (target.scope === 'global') {
          setGlobalFilter(DEFAULT_LOG_FILTER);
        } else if (target.scope === 'pane-own') {
          setPaneFilters((current) => setPaneLogFilter(current, target.repoPath, null));
        } else {
          setPaneFilterEngaged((current) => setPaneGlobalFilterEngagement(current, target.repoPath, false));
        }
        return;
      }

      if (paneFocus === 'edt-list') {
        handleEdtListKey(c, input, key);
        return;
      }

      if (paneFocus === 'other-list') {
        handleOtherListKey(c, input, key);
        return;
      }

      // paneFocus === 'panes'
      handlePaneKey(c, input, key);
    },
    { isActive: zoneInputActive },
  );
}
