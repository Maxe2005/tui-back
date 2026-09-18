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
import type { LogLine } from '../../../../../core/ports/docker.js';
import { CheckboxListItem } from '../../shared/components/checkbox-list-item.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import { TextInputLine } from '../../shared/components/text-input-line.js';
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
  applyLogFilters,
  compileLogFilter,
  computeGridLayout,
  computeLineRowCount,
  cycleFilterLevel,
  cycleLogsPaneFocus,
  DEFAULT_LOG_FILTER,
  DEFAULT_VISIBILITY_FLAGS,
  filterVisibleLines,
  formatLogFilterSpec,
  formatLogLine,
  isAtOldestLine,
  isClearAllLogsKey,
  isPaneEngagedInGlobalFilter,
  isPaneWrapped,
  isSelectAllKey,
  isWrapAllLogsKey,
  movePaneSubFocus,
  reindexPaneSubFocus,
  resolveFilterClearTarget,
  resolveFullscreenScrollDirection,
  resolvePaneScrollDirection,
  resolveSelectAllToggle,
  resolveVisibilityToggleKey,
  setPaneGlobalFilterEngagement,
  setPaneLogFilter,
  sliceVisibleWindow,
  toggleAllPanesWrapFlag,
  toggleFilterMode,
  toggleGlobalFilterEngagement,
  togglePaneWrapFlag,
  toggleVisibilityFlag,
  type GridLayout,
  type LogFilterMode,
  type LogFilterSpec,
  type LogLevel,
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

// Story 5.2: the filter editor's in-progress draft — `/` opens one with scope 'global',
// `f` with scope 'pane' (repoPath set to whichever pane owns it). `error` mirrors whatever
// compileLogFilter last returned for this exact draft (Design Notes: recomputed live on every
// keystroke, never just on submit) — it never blocks the draft from being edited further, it
// only blocks that particular (mode, query, level) combination from being committed into
// `globalFilter`/`paneFilters` (see applyFilterEditorDraft below).
type FilterEditorState = {
  scope: 'global' | 'pane';
  repoPath: string | null;
  mode: LogFilterMode;
  query: string;
  level: LogLevel | null;
  error: string | null;
  // Review fix: the spec that was in effect for this scope at the moment the editor opened —
  // restored verbatim on Escape (a true cancel) so a reused widget whose own hint text reads
  // "[Enter] confirm  [Esc] cancel" actually behaves that way, instead of Escape and Enter both
  // just closing the editor and leaving whatever last compiled cleanly while typing applied.
  preOpen: LogFilterSpec;
};

// Review fix: shared by applyFilterEditorDraft's commit path and the Escape-cancel path below
// — a spec deep-equal to DEFAULT_LOG_FILTER (empty query, no level restriction, either mode)
// is a no-op filter and must never be stored as an explicit paneFilters[repoPath] entry (that
// would leave the "pane filter: on" annotation/hasOwnFilter check seeing a filter that isn't
// actually filtering anything).
function isDefaultLogFilterSpec(spec: LogFilterSpec): boolean {
  return spec.mode === DEFAULT_LOG_FILTER.mode && spec.query === DEFAULT_LOG_FILTER.query && spec.level === DEFAULT_LOG_FILTER.level;
}

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
  // User-reported: wrap/truncate ('w') used to be one flag shared by every pane. Per-pane now
  // (keyed by repoPath) so 'w' can target just the sub-focused/fullscreen pane, with Ctrl+W as
  // the explicit "apply to every open pane" escape hatch (see isWrapAllLogsKey).
  const [paneWrap, setPaneWrap] = useState<Record<string, boolean>>({});
  // Story 5.2: the global filter every pane is engaged with by default (Boundaries: "one
  // global LogFilterSpec every pane is engaged with by default, and an optional per-pane
  // LogFilterSpec"), the per-pane engagement flags ('g' opts a single pane out), and each
  // pane's own filter ('f'). None of these are persisted (Never: "Persist any filter to
  // settings.ts or disk — ephemeral UI state only").
  const [globalFilter, setGlobalFilter] = useState<LogFilterSpec>(DEFAULT_LOG_FILTER);
  const [paneFilterEngaged, setPaneFilterEngaged] = useState<Record<string, boolean>>({});
  const [paneFilters, setPaneFilters] = useState<Record<string, LogFilterSpec>>({});
  const [filterEditor, setFilterEditor] = useState<FilterEditorState | null>(null);

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

  // Story 5.2: the filter editor is a modal too — every existing dialogOpen consumer
  // (zoneInputCaptured, logsPaneGridArrowsActive) must treat it the same as fullscreen, since
  // both capture the entire keystroke stream while open.
  const dialogOpen = logsFullscreenTarget !== null || filterEditor !== null;
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
    // against the *visible* (stdout/stderr- and story-5.2-filtered) line count, not the
    // pane's raw buffered `lines.length` — otherwise, with a stream toggled off or a filter
    // narrowing what's shown, scroll position and the oldest-line trigger diverge from what's
    // actually rendered (review fix, extended by story 5.2 to the new filter layer).
    const engagedGlobal = isPaneEngagedInGlobalFilter(paneFilterEngaged, repoPath) ? globalFilter : null;
    const ownFilter = paneFilters[repoPath] ?? null;
    const visibleLineCount = pane ? applyLogFilters(filterVisibleLines(pane.lines, visibility), engagedGlobal, ownFilter).length : 0;
    const nextOffset = adjustScrollOffset(pane?.scrollOffset ?? 0, direction, visibleLineCount);
    setLogsPaneScrollOffset(repoPath, nextOffset);
    if (direction === 'up' && isAtOldestLine(nextOffset, visibleLineCount) && pane && !pane.noMoreHistory) {
      void loadOlderLogsPane(repoPath);
    }
  }

  // Story 5.2: opens the filter-editor modal — `/` (global, any Logs-zone focus) or `f`
  // (pane, sub-focused grid pane / fullscreen only). Pre-fills the draft from whichever spec
  // is already active for that scope, so re-opening an already-filtered pane/global scope
  // shows what's currently applied rather than resetting it.
  function openGlobalFilterEditor(): void {
    setFilterEditor({
      scope: 'global',
      repoPath: null,
      mode: globalFilter.mode,
      query: globalFilter.query,
      level: globalFilter.level,
      error: null,
      preOpen: globalFilter,
    });
  }
  function openPaneFilterEditor(repoPath: string): void {
    const existing = paneFilters[repoPath] ?? DEFAULT_LOG_FILTER;
    setFilterEditor({ scope: 'pane', repoPath, mode: existing.mode, query: existing.query, level: existing.level, error: null, preOpen: existing });
  }

  // Story 5.2 (Design Notes): "compileLogFilter recomputes on every editor keystroke (not
  // just submit) so the inline regex error appears/clears live". The draft itself always
  // updates (so typed characters/level cycles are never lost); the actual applied
  // globalFilter/paneFilters state only ever advances to a draft that compiles cleanly
  // (Boundaries: "the previously-active filter ... stays in effect" on an invalid regex).
  function applyFilterEditorDraft(next: FilterEditorState): void {
    const spec: LogFilterSpec = { mode: next.mode, query: next.query, level: next.level };
    const compiled = compileLogFilter(spec);
    if (!compiled.ok) {
      setFilterEditor({ ...next, error: compiled.error });
      return;
    }
    if (next.scope === 'global') {
      setGlobalFilter(spec);
      setFilterEditor({ ...next, error: null });
      return;
    }
    const repoPath = next.repoPath;
    if (repoPath === null) {
      // Review fix: `scope === 'pane' && repoPath === null` is currently unreachable
      // (openPaneFilterEditor always sets repoPath) but the type still permits it — rather than
      // silently discarding a compiled spec with no feedback, surface it as an editor error.
      setFilterEditor({ ...next, error: 'no pane targeted' });
      return;
    }
    // Review fix: committing a vacuous spec (deep-equal to DEFAULT_LOG_FILTER, e.g. after
    // backspacing the query back to empty) as an explicit paneFilters[repoPath] entry left a
    // no-op-but-present key — both the "pane filter: on" annotation and
    // resolveFilterClearTarget's `hasOwnFilter` check key off entry *presence*, not content, so
    // the pane kept reading as filtered even though its effective filter was a no-op. Passing
    // `null` instead removes the key exactly like the explicit-clear path (Escape /
    // resolveFilterClearTarget) already does.
    setPaneFilters((current) => setPaneLogFilter(current, repoPath, isDefaultLogFilterSpec(spec) ? null : spec));
    setFilterEditor({ ...next, error: null });
  }

  useInput(
    (input, key) => {
      // Story 5.2: the filter editor captures every keystroke while open, regardless of
      // whether it was opened from the grid or fullscreen (Code Map: "extend useInput in
      // both the grid ... and fullscreen ... branches for /`/`f`/`g`/Escape-clear + editor
      // text capture") — checked first so it works from either view. Tab toggles text/regex
      // mode; Ctrl+Left/Right cycle the level restriction (user-reported: bare Left/Right used
      // to do this, but that's the same key a text cursor would use — Ctrl disambiguates it as
      // a level change rather than caret movement).
      //
      // Review fix: TextInputLine (reused by LogFilterEditor) always renders "[Enter] confirm
      // [Esc] cancel" while focused, but Escape and Enter used to be treated identically here
      // — neither one actually reverted anything. Escape now restores the scope's pre-open
      // spec (captured in filterEditor.preOpen) — a true cancel; Enter just closes the editor,
      // keeping whatever is currently committed — a true confirm.
      if (filterEditor !== null) {
        if (key.escape) {
          if (filterEditor.scope === 'global') {
            setGlobalFilter(filterEditor.preOpen);
          } else if (filterEditor.repoPath !== null) {
            const repoPath = filterEditor.repoPath;
            const preOpen = filterEditor.preOpen;
            setPaneFilters((current) => setPaneLogFilter(current, repoPath, isDefaultLogFilterSpec(preOpen) ? null : preOpen));
          }
          setFilterEditor(null);
          return;
        }
        if (key.return) {
          setFilterEditor(null);
          return;
        }
        if (key.tab) {
          applyFilterEditorDraft({ ...filterEditor, mode: toggleFilterMode(filterEditor.mode) });
          return;
        }
        if (key.ctrl && (key.leftArrow || key.rightArrow)) {
          applyFilterEditorDraft({ ...filterEditor, level: cycleFilterLevel(filterEditor.level, key.rightArrow ? 'next' : 'previous') });
          return;
        }
        if (key.backspace || key.delete) {
          applyFilterEditorDraft({ ...filterEditor, query: filterEditor.query.slice(0, -1) });
          return;
        }
        if (!key.ctrl && !key.meta && !key.upArrow && !key.downArrow && input.length > 0) {
          applyFilterEditorDraft({ ...filterEditor, query: filterEditor.query + input });
        }
        return;
      }

      if (logsFullscreenTarget !== null) {
        if (key.escape) {
          closeLogsFullscreen();
          return;
        }
        // Story 5.2: `/`/`f`/`g` — same bare-key-scopes-to-one-pane idiom as `c`/`w` below,
        // fullscreen's one pane standing in for "the sub-focused grid pane".
        if (input === '/') {
          openGlobalFilterEditor();
          return;
        }
        if (input === 'f') {
          openPaneFilterEditor(logsFullscreenTarget);
          return;
        }
        if (input === 'g') {
          setPaneFilterEngaged((current) => toggleGlobalFilterEngagement(current, logsFullscreenTarget));
          return;
        }
        const scrollDirection = resolveFullscreenScrollDirection(key);
        if (scrollDirection !== null) {
          handlePaneScroll(logsFullscreenTarget, scrollDirection);
          return;
        }
        // Ctrl+C/Ctrl+W ("apply to all open logs") are deliberately no-ops here — fullscreen
        // has only the one pane, and the bare key below already covers it (user-reported).
        if (key.ctrl && (input === 'c' || input === 'w')) {
          return;
        }
        if (input === 'c') {
          clearLogsPane(logsFullscreenTarget);
          return;
        }
        if (input === 'w') {
          setPaneWrap((current) => togglePaneWrapFlag(current, logsFullscreenTarget));
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

      // Story 5.2 (Boundaries): "`/` (any Logs-zone focus) opens the editor for the global
      // filter" — focus-independent, so it's checked ahead of the per-list dispatch below,
      // mirroring how Tab is handled just above.
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

      // Story 5.2 (Boundaries): "Escape, when no editor is open: if a pane is sub-focused in
      // the grid ... clears that pane's own filter if set, else disengages it from the
      // global filter; if no pane is sub-focused (list-focus), clears the global filter
      // entirely." resolveFilterClearTarget is the pure resolver; this just dispatches its
      // result. No prior Escape binding exists outside fullscreen (handled above), so this is
      // the first and only Escape handling reached here.
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
      if (input === 'w') {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          setPaneWrap((current) => togglePaneWrapFlag(current, focused.path));
        }
        return;
      }
      // Story 5.2 (Boundaries): "`f` (bare, same scope as `g`) opens a filter-editor modal
      // for that pane's own filter" / "`g` (bare, sub-focused grid pane or fullscreen pane)
      // toggles that one pane's engagement with the global filter" — same bare-key-scopes-
      // to-one-pane idiom as `c`/`w` above.
      if (input === 'f') {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          openPaneFilterEditor(focused.path);
        }
        return;
      }
      if (input === 'g') {
        const focused = activePanes[subFocus];
        if (focused !== undefined) {
          setPaneFilterEngaged((current) => toggleGlobalFilterEngagement(current, focused.path));
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
          repoPath={logsFullscreenTarget}
          serviceName={logsFullscreenServiceName}
          pane={logsPanes[logsFullscreenTarget]}
          visibility={visibility}
          wrapLines={isPaneWrapped(paneWrap, logsFullscreenTarget)}
          visibleLines={fullscreenVisibleLines}
          contentWidth={fullscreenContentWidth}
          globalFilter={globalFilter}
          engaged={isPaneEngagedInGlobalFilter(paneFilterEngaged, logsFullscreenTarget)}
          ownFilter={paneFilters[logsFullscreenTarget] ?? null}
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
                <DimAnnotation text="[Ctrl+↑/↓] scroll pane" />
                <DimAnnotation text="[c] clear focused pane" />
                <DimAnnotation text="[Ctrl+C] clear all panes" />
                <DimAnnotation text="[w] wrap/truncate focused pane" />
                <DimAnnotation text="[Ctrl+W] wrap/truncate all panes" />
                <DimAnnotation text="[/] edit global filter" />
                <DimAnnotation text="[f] edit focused pane's filter" />
                <DimAnnotation text="[g] toggle focused pane's global filter" />
                <DimAnnotation text="[Esc] clear filter (pane -> engagement -> global)" />
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
                  paneWrap={paneWrap}
                  subFocused={paneFocus === 'panes' ? subFocus : -1}
                  globalFilter={globalFilter}
                  paneFilterEngaged={paneFilterEngaged}
                  paneFilters={paneFilters}
                />
              )}
            </Box>
          </Box>
        </Box>
      )}
      {filterEditor !== null ? (
        <LogFilterEditor editor={filterEditor} serviceName={filterEditor.repoPath !== null ? (rows.find((row) => row.path === filterEditor.repoPath)?.service ?? null) : null} />
      ) : null}
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
  paneWrap,
  subFocused,
  globalFilter,
  paneFilterEngaged,
  paneFilters,
}: {
  panes: ServiceBranchDivergence[];
  logsPanes: Record<string, LogsPaneData>;
  layout: GridLayout;
  visibleLines: number;
  contentWidth: number;
  visibility: VisibilityFlags;
  paneWrap: Record<string, boolean>;
  subFocused: number;
  globalFilter: LogFilterSpec;
  paneFilterEngaged: Record<string, boolean>;
  paneFilters: Record<string, LogFilterSpec>;
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
                wrapLines={isPaneWrapped(paneWrap, service.path)}
                visibleLines={visibleLines}
                contentWidth={contentWidth}
                focused={index === subFocused}
                globalFilter={globalFilter}
                engaged={isPaneEngagedInGlobalFilter(paneFilterEngaged, service.path)}
                ownFilter={paneFilters[service.path] ?? null}
              />
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

// Boundaries: "A pane's effective filter is (engaged ? global : pass) AND (own ?? pass)" —
// shared by LogsPaneView and FullscreenPane (both call applyLogFilters the same way, right
// after filterVisibleLines, same layer 5.1's stdout/stderr toggle already lives on).
function resolveEffectiveLines(pane: LogsPaneData | undefined, visibility: VisibilityFlags, globalFilter: LogFilterSpec, engaged: boolean, ownFilter: LogFilterSpec | null): LogLine[] {
  if (!pane) {
    return [];
  }
  return applyLogFilters(filterVisibleLines(pane.lines, visibility), engaged ? globalFilter : null, ownFilter);
}

function LogsPaneView({
  service,
  pane,
  visibility,
  wrapLines,
  visibleLines,
  contentWidth,
  focused,
  globalFilter,
  engaged,
  ownFilter,
}: {
  service: ServiceBranchDivergence;
  pane: LogsPaneData | undefined;
  visibility: VisibilityFlags;
  wrapLines: boolean;
  visibleLines: number;
  contentWidth: number;
  focused: boolean;
  globalFilter: LogFilterSpec;
  engaged: boolean;
  ownFilter: LogFilterSpec | null;
}) {
  const [contentRef, measuredSize] = useElementSize();
  const rowBudget = measuredSize !== null ? measuredSize.height : visibleLines;
  const resolvedContentWidth = measuredSize !== null ? Math.max(measuredSize.width, 1) : contentWidth;
  const lines = resolveEffectiveLines(pane, visibility, globalFilter, engaged, ownFilter);
  const windowLines = sliceVisibleWindow(lines, pane?.scrollOffset ?? 0, rowBudget, (line) =>
    computeLineRowCount(formatLogLine(line, visibility.showTimestamps), resolvedContentWidth, wrapLines),
  );
  // A pane with buffered lines that the current stdout/stderr/story-5.2 filters happen to
  // hide entirely must read differently from "no lines have arrived yet" — otherwise a user
  // who toggled off both stdout and stderr, or set an aggressive filter, is misleadingly told
  // the stream itself is empty (review fix, story 5.1; extended to the new filter layer).
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
      {/* User-reported: always bold (not just when sub-focused) so a service name stands out
          from its own log text at a glance, in a grid where several panes are visible at once. */}
      <Text bold color={focused ? colors.accent : colors.text} wrap="truncate-end">
        {service.service}
      </Text>
      {pane?.streamError ? <DimAnnotation text={pane.streamError.message} /> : null}
      {pane?.noMoreHistory && (pane?.scrollOffset ?? 0) > 0 ? <DimAnnotation text="no more history" /> : null}
      {!engaged ? (
        <DimAnnotation text="global filter: off" />
      ) : !isDefaultLogFilterSpec(globalFilter) ? (
        <DimAnnotation text={`global filter: ${formatLogFilterSpec(globalFilter)}`} />
      ) : null}
      {ownFilter !== null ? <DimAnnotation text={`pane filter: ${formatLogFilterSpec(ownFilter)}`} /> : null}
      <Box ref={contentRef} flexDirection="column" flexGrow={1} minHeight={0} minWidth={0}>
        {windowLines.length === 0 && !pane?.streamError ? (
          <Text color={colors['text-dim']}>{allLinesHiddenByFilters ? 'All lines hidden by filters' : 'Waiting for logs…'}</Text>
        ) : null}
        {windowLines.map((line, index) => (
          <Text key={index} color={line.stream === 'stderr' ? colors.error : colors.text} wrap={wrapLines ? 'wrap' : 'truncate-end'}>
            {formatLogLine(line, visibility.showTimestamps)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function FullscreenPane({
  repoPath,
  serviceName,
  pane,
  visibility,
  wrapLines,
  visibleLines,
  contentWidth,
  globalFilter,
  engaged,
  ownFilter,
}: {
  repoPath: string;
  // Captured directly at the point fullscreen was opened (store's logsFullscreenServiceName)
  // rather than re-derived via a live `rows.find(...)` lookup, which can miss (e.g. a
  // transient services-list load error while the preview is open) and silently fall back to a
  // bare "Logs" label right when the user needs the service name most (review fix).
  serviceName: string | null;
  pane: LogsPaneData | undefined;
  visibility: VisibilityFlags;
  wrapLines: boolean;
  visibleLines: number;
  contentWidth: number;
  globalFilter: LogFilterSpec;
  engaged: boolean;
  ownFilter: LogFilterSpec | null;
}) {
  const [contentRef, measuredSize] = useElementSize();
  const rowBudget = measuredSize !== null ? measuredSize.height : visibleLines;
  const resolvedContentWidth = measuredSize !== null ? Math.max(measuredSize.width, 1) : contentWidth;
  const lines = resolveEffectiveLines(pane, visibility, globalFilter, engaged, ownFilter);
  const windowLines = sliceVisibleWindow(lines, pane?.scrollOffset ?? 0, rowBudget, (line) =>
    computeLineRowCount(formatLogLine(line, visibility.showTimestamps), resolvedContentWidth, wrapLines),
  );
  // A pane with buffered lines that the current stdout/stderr/story-5.2 filters happen to
  // hide entirely must read differently from "no lines have arrived yet" — otherwise a user
  // who toggled off both stdout and stderr, or set an aggressive filter, is misleadingly told
  // the stream itself is empty (review fix, story 5.1; extended to the new filter layer).
  const allLinesHiddenByFilters = (pane?.lines.length ?? 0) > 0 && lines.length === 0;
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
      <Text color={colors.accent} bold>
        {serviceName ?? 'Logs'}
      </Text>
      {pane?.streamError ? <DimAnnotation text={pane.streamError.message} /> : null}
      {pane?.noMoreHistory && (pane?.scrollOffset ?? 0) > 0 ? <DimAnnotation text="no more history" /> : null}
      {!engaged ? (
        <DimAnnotation text="global filter: off" />
      ) : !isDefaultLogFilterSpec(globalFilter) ? (
        <DimAnnotation text={`global filter: ${formatLogFilterSpec(globalFilter)}`} />
      ) : null}
      {ownFilter !== null ? <DimAnnotation text={`pane filter: ${formatLogFilterSpec(ownFilter)}`} /> : null}
      <Box ref={contentRef} flexDirection="column" flexGrow={1} minHeight={0}>
        {windowLines.length === 0 && !pane?.streamError ? (
          <Text color={colors['text-dim']}>{allLinesHiddenByFilters ? 'All lines hidden by filters' : 'Waiting for logs…'}</Text>
        ) : null}
        {windowLines.map((line, index) => (
          <Text key={index} color={line.stream === 'stderr' ? colors.error : colors.text} wrap={wrapLines ? 'wrap' : 'truncate-end'}>
            {formatLogLine(line, visibility.showTimestamps)}
          </Text>
        ))}
      </Box>
      <DimAnnotation text="[Esc] back  [↑/↓] scroll  [c] clear  [t/o/p] toggle timestamps/stdout/stderr  [w] wrap/truncate" />
      <DimAnnotation text="[/] global filter  [f] pane filter  [g] toggle global engagement" />
    </Box>
  );
}

// Story 5.2: renders whichever scope's editor is open — one shared component/validation for
// both `/` (global) and `f` (pane), per Boundaries ("Both editors share one component and
// validation"). Purely presentational, mirroring ModalDialog's other call sites — all the
// actual keystroke handling lives in LogsZone's own useInput (Code Map: never a
// component-owned useInput here, same convention as BranchPicker/TextInputLine).
function LogFilterEditor({ editor, serviceName }: { editor: FilterEditorState; serviceName: string | null }) {
  const title = editor.scope === 'global' ? 'GLOBAL LOG FILTER' : `PANE LOG FILTER — ${serviceName ?? 'unknown'}`;
  return (
    <ModalDialog title={title} onConfirm={() => {}} onCancel={() => {}} open>
      <TextInputLine label={editor.mode === 'regex' ? 'Regex' : 'Text'} value={editor.query} focused />
      <Text color={colors.text}>Level: {editor.level ?? 'ALL'}</Text>
      {editor.error !== null ? <DimAnnotation text={editor.error} /> : null}
      <DimAnnotation text="[Tab] text/regex  [Ctrl+←/→] level  [Enter/Esc] done" />
    </ModalDialog>
  );
}
