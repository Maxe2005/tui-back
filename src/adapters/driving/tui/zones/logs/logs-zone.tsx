// tui/zones/logs: story 5.1 — replaces the placeholder with the real Logs zone. Two
// multi-select service lists (active-EDT members / other manifest services) drive an
// auto-resizing grid of scrollable log panes, with a per-pane fullscreen view. Mirrors
// edts-zone.tsx's own dispatch idiom: a single `useInput` hook, an overlay branch (here,
// fullscreen) checked first, every keystroke decision delegated to a pure function from
// logs-zone.logic.ts (or reused as-is from edts-zone.logic.ts where the logic is generic list
// navigation, not EDT-specific — see that file's own header).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, measureElement, Text, useInput, useWindowSize, type DOMElement } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import { CheckboxListItem } from '../../shared/components/checkbox-list-item.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { useAppStore, type AppStore, type LogsPaneData } from '../../store/app-store.js';
import {
  jumpSelection,
  moveSelection,
  partitionServicesByEdtMembership,
  resolveSelectionDirection,
  resolveSelectionJump,
} from '../edts/edts-zone.logic.js';
import {
  adjustScrollOffset,
  computeGridLayout,
  computeLineRowCount,
  cycleLogsPaneFocus,
  DEFAULT_VISIBILITY_FLAGS,
  filterVisibleLines,
  formatLogLine,
  isAtOldestLine,
  isSelectAllKey,
  movePaneSubFocus,
  reindexPaneSubFocus,
  resolveFullscreenScrollDirection,
  resolvePaneScrollDirection,
  resolveSelectAllToggle,
  resolveVisibilityToggleKey,
  sliceVisibleWindow,
  toggleVisibilityFlag,
  type GridLayout,
  type LogsPaneFocus,
  type VisibilityFlags,
} from './logs-zone.logic.js';

// Reserves a fixed-width left column for the two lists — this zone has no persisted/resizable
// splitter ratio (unlike every ListDetailSplit-based zone): the spec's Code Map/Design Notes
// never mention one, and the grid's own auto-resize (computeGridLayout) already absorbs
// whatever width remains.
const LIST_COLUMN_WIDTH = 32;
// Rough terminal-chrome budget (top bar, zone-tab bar, footer, this zone's own list headers/
// hints) subtracted from the raw window size before computeGridLayout ever sees it — an
// approximation is fine here since the real per-pane sizing still flows through Ink's own
// flexGrow layout; this only decides how many rows/cols to try to fit and how many lines
// worth of content each pane's own scroll window keeps in view.
const CHROME_ROWS = 8;
const PANE_CHROME_ROWS = 3;
// A grid pane's content width is its cell width minus its own border (1 col each side) and
// paddingX={1} (1 col each side) — needed to know how many terminal rows a wrapped line will
// actually take (see computeLineRowCount).
const GRID_PANE_CHROME_COLS = 4;

// User-reported review fix: CHROME_ROWS/PANE_CHROME_ROWS/GRID_PANE_CHROME_COLS above are only
// ever rough guesses (their own comments say so) — real chrome varies per pane (an optional
// streamError or "no more history" line adds a row; Yoga's flex-grow rounding hands some grid
// rows one more terminal row than a plain `floor(height / rows)` division would). Guessing wrong
// used to leave a permanent gap at the bottom of every pane, worst in wrap mode (its per-line
// row-cost estimate in computeLineRowCount compounds the same guesswork). `useElementSize`
// measures the pane's own content box for real, post-render, via Ink's `measureElement` — the
// estimate above now only seeds the very first paint (before Yoga has computed a layout to
// measure), and every commit after that self-corrects to the pane's true row/column budget.
function useElementSize(): readonly [{ current: DOMElement | null }, { width: number; height: number } | null] {
  const ref = useRef<DOMElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) {
      return;
    }
    const { width, height } = measureElement(ref.current);
    setSize((current) => (current !== null && current.width === width && current.height === height ? current : { width, height }));
  });
  return [ref, size] as const;
}

export function LogsZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  const services = useStore((state) => state.edtsBranches);
  const servicesStatus = useStore((state) => state.edtsBranchesStatus);
  const loadEdtsBranches = useStore((state) => state.loadEdtsBranches);
  const edts = useStore((state) => state.edts);
  const loadEdts = useStore((state) => state.loadEdts);
  const activeEdtUlid = useStore((state) => state.activeEdt);

  const logsEdtSelected = useStore((state) => state.logsEdtSelected);
  const logsOtherSelected = useStore((state) => state.logsOtherSelected);
  const toggleLogsEdtSelection = useStore((state) => state.toggleLogsEdtSelection);
  const toggleLogsOtherSelection = useStore((state) => state.toggleLogsOtherSelection);
  const selectAllLogsEdtServices = useStore((state) => state.selectAllLogsEdtServices);
  const deselectAllLogsEdtServices = useStore((state) => state.deselectAllLogsEdtServices);
  const logsFullscreenTarget = useStore((state) => state.logsFullscreenTarget);
  const logsFullscreenServiceName = useStore((state) => state.logsFullscreenServiceName);
  const openLogsFullscreen = useStore((state) => state.openLogsFullscreen);
  const closeLogsFullscreen = useStore((state) => state.closeLogsFullscreen);
  const logsPanes = useStore((state) => state.logsPanes);
  const subscribeLogsPane = useStore((state) => state.subscribeLogsPane);
  const unsubscribeLogsPane = useStore((state) => state.unsubscribeLogsPane);
  const loadOlderLogsPane = useStore((state) => state.loadOlderLogsPane);
  const clearLogsPane = useStore((state) => state.clearLogsPane);
  const setLogsPaneScrollOffset = useStore((state) => state.setLogsPaneScrollOffset);
  const commandBarOpen = useStore((state) => state.commandBarOpen);
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const settingsScreenOpen = useStore((state) => state.settingsScreenOpen);
  const resizeMode = useStore((state) => state.resizeMode);
  const setZoneInputCaptured = useStore((state) => state.setZoneInputCaptured);
  const setLogsPaneGridArrowsActive = useStore((state) => state.setLogsPaneGridArrowsActive);

  useEffect(() => {
    void loadEdtsBranches();
    void loadEdts();
    // Fires once on mount only, mirrors edts-zone.tsx's own mount effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = servicesStatus === 'error' ? [] : (services ?? []);
  const focusedEdt = (edts ?? []).find((entry) => entry.ulid === activeEdtUlid);
  // Boundaries: "Any manifest service can be streamed, not only active-EDT members" — the
  // partition is against the tool-wide *active* EDT (not a selected row, unlike edts-zone's
  // own use of this same function), since the Logs zone has no EDT selector of its own.
  const { edtServices, otherServices } = partitionServicesByEdtMembership(rows, focusedEdt);

  const [paneFocus, setPaneFocus] = useState<LogsPaneFocus>('edt-list');
  const [edtCursor, setEdtCursor] = useState(0);
  const [otherCursor, setOtherCursor] = useState(0);
  const [subFocus, setSubFocus] = useState(0);
  const [visibility, setVisibility] = useState<VisibilityFlags>(DEFAULT_VISIBILITY_FLAGS);

  const clampedEdtCursor = edtServices.length === 0 ? 0 : Math.min(edtCursor, edtServices.length - 1);
  const clampedOtherCursor = otherServices.length === 0 ? 0 : Math.min(otherCursor, otherServices.length - 1);

  // Active panes render in a stable order (EDT-list selections first, then other-list ones) so
  // `subFocus`'s index keeps a consistent meaning as selections change.
  const activeRepoPaths = useMemo(() => [...logsEdtSelected, ...logsOtherSelected], [logsEdtSelected, logsOtherSelected]);
  const activePanes = useMemo(
    () => activeRepoPaths.map((path) => rows.find((row) => row.path === path)).filter((row): row is ServiceBranchDivergence => row !== undefined),
    [activeRepoPaths, rows],
  );

  // Reconciles docker subscriptions with whichever repoPaths are currently "active" (selected
  // in either list, or the ad hoc fullscreen preview target) — I/O matrix SELECTION_CHANGE:
  // "that stream stops"; FULLSCREEN_PREVIEW: "stream started ad hoc" / "Escape stops that ad
  // hoc stream". A key both selected and previewed (Enter on an already-selected row) is only
  // ever subscribed once (subscribeLogsPane/LogsManager.subscribe are both idempotent).
  const previousActiveKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const nextKeys = new Set(activeRepoPaths);
    if (logsFullscreenTarget !== null) {
      nextKeys.add(logsFullscreenTarget);
    }
    const previousKeys = previousActiveKeysRef.current;
    for (const path of nextKeys) {
      if (!previousKeys.has(path)) {
        const service = rows.find((row) => row.path === path)?.service ?? path;
        void subscribeLogsPane(path, service);
      }
    }
    for (const path of previousKeys) {
      if (!nextKeys.has(path)) {
        unsubscribeLogsPane(path);
      }
    }
    previousActiveKeysRef.current = nextKeys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepoPaths, logsFullscreenTarget, rows]);

  // Leaving the Logs zone (unmount) must never leave a docker child process running
  // unattended — tears down every still-active subscription.
  useEffect(
    () => () => {
      for (const path of previousActiveKeysRef.current) {
        unsubscribeLogsPane(path);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Boundaries: "grid reflows and sub-focus moves to the nearest remaining pane".
  useEffect(() => {
    setSubFocus((current) => reindexPaneSubFocus(current, activePanes.length));
  }, [activePanes.length]);

  const dialogOpen = logsFullscreenTarget !== null;
  useEffect(() => {
    setZoneInputCaptured(dialogOpen);
  }, [dialogOpen, setZoneInputCaptured]);
  useEffect(() => () => setZoneInputCaptured(false), [setZoneInputCaptured]);

  // Review fix (story 5.1): AppShell's own Left/Right global zone-switch (story 2.12) fires
  // on the very same keypress as this zone's own `useInput` below — Ink dispatches to every
  // mounted hook, not just this one — so without this flag, moving pane sub-focus with
  // Left/Right always switched the active zone out from under the grid instead. Only set
  // while pane focus actually owns the arrows (fullscreen already captures everything via
  // zoneInputCaptured above, so this stays false there).
  useEffect(() => {
    setLogsPaneGridArrowsActive(paneFocus === 'panes' && !dialogOpen);
  }, [paneFocus, dialogOpen, setLogsPaneGridArrowsActive]);
  useEffect(() => () => setLogsPaneGridArrowsActive(false), [setLogsPaneGridArrowsActive]);

  const windowSize = useWindowSize();
  const gridAvailableWidth = Math.max(windowSize.columns - LIST_COLUMN_WIDTH - spacing['pane-padding-x'], 20);
  const gridAvailableHeight = Math.max(windowSize.rows - CHROME_ROWS, 5);
  const layout = computeGridLayout(activePanes.length, gridAvailableWidth, gridAvailableHeight);
  const paneVisibleLines = Math.max(layout.cellHeight - PANE_CHROME_ROWS, 1);
  const paneContentWidth = Math.max(layout.cellWidth - GRID_PANE_CHROME_COLS, 1);
  const fullscreenVisibleLines = Math.max(windowSize.rows - CHROME_ROWS, 3);
  const fullscreenContentWidth = Math.max(windowSize.columns - spacing['pane-padding-x'] * 2, 1);

  function handlePaneScroll(repoPath: string, direction: 'up' | 'down'): void {
    const pane = logsPanes[repoPath];
    // Scroll math (and the "at oldest line" history-fetch trigger below) must be computed
    // against the *visible* (stdout/stderr-filtered) line count, not the pane's raw buffered
    // `lines.length` — otherwise, with a stream toggled off, scroll position and the
    // oldest-line trigger diverge from what's actually rendered (review fix).
    const visibleLineCount = pane ? filterVisibleLines(pane.lines, visibility).length : 0;
    const nextOffset = adjustScrollOffset(pane?.scrollOffset ?? 0, direction, visibleLineCount);
    setLogsPaneScrollOffset(repoPath, nextOffset);
    if (direction === 'up' && isAtOldestLine(nextOffset, visibleLineCount) && pane && !pane.noMoreHistory) {
      void loadOlderLogsPane(repoPath);
    }
  }

  useInput(
    (input, key) => {
      if (logsFullscreenTarget !== null) {
        if (key.escape) {
          closeLogsFullscreen();
          return;
        }
        const scrollDirection = resolveFullscreenScrollDirection(key);
        if (scrollDirection !== null) {
          handlePaneScroll(logsFullscreenTarget, scrollDirection);
          return;
        }
        if (input === 'c') {
          clearLogsPane(logsFullscreenTarget);
          return;
        }
        const toggle = resolveVisibilityToggleKey(input);
        if (toggle !== null) {
          setVisibility((current) => toggleVisibilityFlag(current, toggle));
        }
        return;
      }

      if (key.tab) {
        setPaneFocus((current) => cycleLogsPaneFocus(current));
        return;
      }

      const toggle = resolveVisibilityToggleKey(input);
      if (toggle !== null) {
        setVisibility((current) => toggleVisibilityFlag(current, toggle));
        return;
      }

      if (paneFocus === 'edt-list') {
        if (isSelectAllKey(input, key)) {
          const edtPaths = edtServices.map((service) => service.path);
          if (resolveSelectAllToggle(edtPaths, logsEdtSelected) === 'select-all') {
            selectAllLogsEdtServices(edtPaths);
          } else {
            deselectAllLogsEdtServices();
          }
          return;
        }
        const jump = resolveSelectionJump(key);
        if (jump !== null) {
          setEdtCursor(jumpSelection(jump, edtServices.length));
          return;
        }
        const direction = resolveSelectionDirection(key);
        if (direction !== null) {
          setEdtCursor((current) => moveSelection(current, direction, edtServices.length));
          return;
        }
        if (input === ' ') {
          const service = edtServices[clampedEdtCursor];
          if (service !== undefined) {
            toggleLogsEdtSelection(service.path);
          }
          return;
        }
        if (key.return) {
          const service = edtServices[clampedEdtCursor];
          if (service !== undefined) {
            openLogsFullscreen(service.path, service.service);
          }
        }
        return;
      }

      if (paneFocus === 'other-list') {
        const jump = resolveSelectionJump(key);
        if (jump !== null) {
          setOtherCursor(jumpSelection(jump, otherServices.length));
          return;
        }
        const direction = resolveSelectionDirection(key);
        if (direction !== null) {
          setOtherCursor((current) => moveSelection(current, direction, otherServices.length));
          return;
        }
        if (input === ' ') {
          const service = otherServices[clampedOtherCursor];
          if (service !== undefined) {
            toggleLogsOtherSelection(service.path);
          }
          return;
        }
        if (key.return) {
          const service = otherServices[clampedOtherCursor];
          if (service !== undefined) {
            openLogsFullscreen(service.path, service.service);
          }
        }
        return;
      }

      // paneFocus === 'panes'
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
      if (key.return) {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          openLogsFullscreen(focused.path, focused.service);
        }
      }
    },
    { isActive: !commandBarOpen && !registryScreenOpen && !settingsScreenOpen && !resizeMode },
  );

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      {logsFullscreenTarget !== null ? (
        <FullscreenPane
          serviceName={logsFullscreenServiceName}
          pane={logsPanes[logsFullscreenTarget]}
          visibility={visibility}
          visibleLines={fullscreenVisibleLines}
          contentWidth={fullscreenContentWidth}
        />
      ) : (
        <Box flexDirection="column" flexGrow={1} minHeight={0}>
          <Text color={colors['text-dim']}>LOGS</Text>
          <Box flexDirection="row" flexGrow={1} minHeight={0}>
            <Box flexDirection="column" width={LIST_COLUMN_WIDTH} paddingX={spacing['pane-padding-x']} minHeight={0} overflow="hidden">
              <Text color={paneFocus === 'edt-list' ? colors.accent : colors['text-dim']}>ACTIVE EDT MEMBERS</Text>
              {servicesStatus === 'loading' && rows.length === 0 ? <Text color={colors['text-dim']}>Loading services…</Text> : null}
              {servicesStatus === 'error' ? <Text color={colors.error}>Failed to load services</Text> : null}
              {focusedEdt === undefined ? <DimAnnotation text="No active EDT." /> : null}
              {focusedEdt !== undefined && edtServices.length === 0 && servicesStatus !== 'error' ? (
                <DimAnnotation text="No services in the active EDT." />
              ) : null}
              {edtServices.map((service, index) => (
                <Box key={service.path} flexDirection="row">
                  <Text color={colors.accent}>{paneFocus === 'edt-list' && index === clampedEdtCursor ? '›' : ' '}</Text>
                  <CheckboxListItem label={service.service} state={logsEdtSelected.includes(service.path) ? 'checked' : 'unchecked'} />
                </Box>
              ))}

              <Text color={paneFocus === 'other-list' ? colors.accent : colors['text-dim']}>OTHER SERVICES</Text>
              {otherServices.length === 0 && servicesStatus !== 'loading' && servicesStatus !== 'error' ? (
                <DimAnnotation text="No other managed services." />
              ) : null}
              {otherServices.map((service, index) => (
                <Box key={service.path} flexDirection="row">
                  <Text color={colors.accent}>{paneFocus === 'other-list' && index === clampedOtherCursor ? '›' : ' '}</Text>
                  <CheckboxListItem label={service.service} state={logsOtherSelected.includes(service.path) ? 'checked' : 'unchecked'} />
                </Box>
              ))}

              <Box flexDirection="column" marginTop={spacing['section-gap']}>
                <DimAnnotation text="[Space] toggle" />
                <DimAnnotation text="[Enter] preview" />
                <DimAnnotation text="[Ctrl+A] toggle all" />
                <DimAnnotation text={`[t] timestamps ${visibility.showTimestamps ? 'on' : 'off'}`} />
                <DimAnnotation text={`[o] stdout ${visibility.showStdout ? 'on' : 'off'}`} />
                <DimAnnotation text={`[p] stderr ${visibility.showStderr ? 'on' : 'off'}`} />
                <DimAnnotation text={`[w] ${visibility.wrapLines ? 'wrap' : 'truncate'}`} />
                <DimAnnotation text="[Ctrl+↑/↓] scroll pane" />
                <DimAnnotation text="[c] clear focused pane" />
              </Box>
            </Box>

            <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
              {activePanes.length === 0 ? (
                <DimAnnotation text="No service selected — select one or more services on the left to stream their logs." />
              ) : (
                <LogsGrid
                  panes={activePanes}
                  logsPanes={logsPanes}
                  layout={layout}
                  visibleLines={paneVisibleLines}
                  contentWidth={paneContentWidth}
                  visibility={visibility}
                  subFocused={paneFocus === 'panes' ? subFocus : -1}
                />
              )}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function LogsGrid({
  panes,
  logsPanes,
  layout,
  visibleLines,
  contentWidth,
  visibility,
  subFocused,
}: {
  panes: ServiceBranchDivergence[];
  logsPanes: Record<string, LogsPaneData>;
  layout: GridLayout;
  visibleLines: number;
  contentWidth: number;
  visibility: VisibilityFlags;
  subFocused: number;
}) {
  const cols = Math.max(layout.cols, 1);
  const rowsOfPanes: ServiceBranchDivergence[][] = [];
  for (let i = 0; i < panes.length; i += cols) {
    rowsOfPanes.push(panes.slice(i, i + cols));
  }
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      {rowsOfPanes.map((rowPanes, rowIndex) => (
        <Box key={rowIndex} flexDirection="row" flexGrow={1} flexBasis={0} minHeight={0}>
          {rowPanes.map((service, colIndex) => {
            const index = rowIndex * cols + colIndex;
            return (
              <LogsPaneView
                key={service.path}
                service={service}
                pane={logsPanes[service.path]}
                visibility={visibility}
                visibleLines={visibleLines}
                contentWidth={contentWidth}
                focused={index === subFocused}
              />
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

function LogsPaneView({
  service,
  pane,
  visibility,
  visibleLines,
  contentWidth,
  focused,
}: {
  service: ServiceBranchDivergence;
  pane: LogsPaneData | undefined;
  visibility: VisibilityFlags;
  visibleLines: number;
  contentWidth: number;
  focused: boolean;
}) {
  const [contentRef, measuredSize] = useElementSize();
  const rowBudget = measuredSize !== null ? measuredSize.height : visibleLines;
  const resolvedContentWidth = measuredSize !== null ? Math.max(measuredSize.width, 1) : contentWidth;
  const lines = pane ? filterVisibleLines(pane.lines, visibility) : [];
  const windowLines = sliceVisibleWindow(lines, pane?.scrollOffset ?? 0, rowBudget, (line) =>
    computeLineRowCount(formatLogLine(line, visibility.showTimestamps), resolvedContentWidth, visibility.wrapLines),
  );
  // A pane with buffered lines that the current stdout/stderr filters happen to hide entirely
  // must read differently from "no lines have arrived yet" — otherwise a user who toggled off
  // both stdout and stderr is misleadingly told the stream itself is empty (review fix).
  const allLinesHiddenByFilters = (pane?.lines.length ?? 0) > 0 && lines.length === 0;
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      minHeight={0}
      minWidth={0}
      overflow="hidden"
      borderStyle="single"
      borderColor={focused ? colors.accent : colors.border}
      paddingX={1}
    >
      <Text bold={focused} color={focused ? colors.accent : colors.text} wrap="truncate-end">
        {service.service}
      </Text>
      {pane?.streamError ? <DimAnnotation text={pane.streamError.message} /> : null}
      {pane?.noMoreHistory && (pane?.scrollOffset ?? 0) > 0 ? <DimAnnotation text="no more history" /> : null}
      <Box ref={contentRef} flexDirection="column" flexGrow={1} minHeight={0} minWidth={0}>
        {windowLines.length === 0 && !pane?.streamError ? (
          <Text color={colors['text-dim']}>{allLinesHiddenByFilters ? 'All lines hidden by filters' : 'Waiting for logs…'}</Text>
        ) : null}
        {windowLines.map((line, index) => (
          <Text key={index} color={line.stream === 'stderr' ? colors.error : colors.text} wrap={visibility.wrapLines ? 'wrap' : 'truncate-end'}>
            {formatLogLine(line, visibility.showTimestamps)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function FullscreenPane({
  serviceName,
  pane,
  visibility,
  visibleLines,
  contentWidth,
}: {
  // Captured directly at the point fullscreen was opened (store's logsFullscreenServiceName)
  // rather than re-derived via a live `rows.find(...)` lookup, which can miss (e.g. a
  // transient services-list load error while the preview is open) and silently fall back to a
  // bare "Logs" label right when the user needs the service name most (review fix).
  serviceName: string | null;
  pane: LogsPaneData | undefined;
  visibility: VisibilityFlags;
  visibleLines: number;
  contentWidth: number;
}) {
  const [contentRef, measuredSize] = useElementSize();
  const rowBudget = measuredSize !== null ? measuredSize.height : visibleLines;
  const resolvedContentWidth = measuredSize !== null ? Math.max(measuredSize.width, 1) : contentWidth;
  const lines = pane ? filterVisibleLines(pane.lines, visibility) : [];
  const windowLines = sliceVisibleWindow(lines, pane?.scrollOffset ?? 0, rowBudget, (line) =>
    computeLineRowCount(formatLogLine(line, visibility.showTimestamps), resolvedContentWidth, visibility.wrapLines),
  );
  // A pane with buffered lines that the current stdout/stderr filters happen to hide entirely
  // must read differently from "no lines have arrived yet" — otherwise a user who toggled off
  // both stdout and stderr is misleadingly told the stream itself is empty (review fix).
  const allLinesHiddenByFilters = (pane?.lines.length ?? 0) > 0 && lines.length === 0;
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
      <Text color={colors.accent} bold>
        {serviceName ?? 'Logs'}
      </Text>
      {pane?.streamError ? <DimAnnotation text={pane.streamError.message} /> : null}
      {pane?.noMoreHistory && (pane?.scrollOffset ?? 0) > 0 ? <DimAnnotation text="no more history" /> : null}
      <Box ref={contentRef} flexDirection="column" flexGrow={1} minHeight={0}>
        {windowLines.length === 0 && !pane?.streamError ? (
          <Text color={colors['text-dim']}>{allLinesHiddenByFilters ? 'All lines hidden by filters' : 'Waiting for logs…'}</Text>
        ) : null}
        {windowLines.map((line, index) => (
          <Text key={index} color={line.stream === 'stderr' ? colors.error : colors.text} wrap={visibility.wrapLines ? 'wrap' : 'truncate-end'}>
            {formatLogLine(line, visibility.showTimestamps)}
          </Text>
        ))}
      </Box>
      <DimAnnotation text="[Esc] back  [↑/↓] scroll  [c] clear  [t/o/p] toggle timestamps/stdout/stderr  [w] wrap/truncate" />
    </Box>
  );
}
