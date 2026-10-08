# Bounded-rendering inventory (story 7.9)

Static audit of `src/adapters/driving/tui/` against the bounded-rendering rule (AD-19 / UX-DR37). Columns: height source, width source, text treatment, appendable-content cap, verdict (`bounded` / `partial` / `unbounded`). Verdicts come from reading the code and are provisional until each `partial`/`unbounded` row gets its failing repro test (or documented manual repro) in the patch phase.

Legend. Height sources: `root` = shell `height={rows}` + `overflow="hidden"` clipping only; `ratio` = `ZoneLayout` flex ratio; `budget` = per-zone `useWindowSize().rows - CHROME_ROWS` constant; `measured` = `useElementSize` post-render; `none`. Text treatments: `trunc` = `wrap="truncate-end"`; `wrap` = Ink default wrap (unbounded line count); `norm` = message normalizer needed.

## Shell and chrome

| Surface | Height source | Width source | Text treatment | Appendable cap | Verdict |
|---|---|---|---|---|---|
| Shell root (`app-shell.tsx`) | `root` (`rows` only, `overflow="hidden"`) | none (columns never read) | n/a | n/a | partial: silently clips, nothing guarantees top bar/footer survive; no too-small gate |
| Top bar | 1 row | flex row, topic `Text` wraps | wrap (long EDT topic wraps to 2+ rows) | n/a | partial |
| Zone tab bar | 1 row | none | wrap when columns shrink | n/a | partial |
| Footer | 1 row | none; hints joined with 2 spaces | wrap (hint list longer than columns wraps and pushes the frame) | n/a | unbounded |
| `resetNotice` (bare `Text`, shell sibling) | unbudgeted | none | wrap | single value | unbounded |
| `?` keybinding help | fixed `DEFAULT_HELP_VISIBLE_LINES = 10` window inside `ModalDialog` | none | wrap | static registry | partial: 10 lines + chrome exceeds a short window |
| Command bar | `useWindowSize` columns only (`command-bar.tsx:405`) | columns | mixed | result lists via `.map` | partial |

## Zone layout and panes

| Surface | Height source | Width source | Text treatment | Appendable cap | Verdict |
|---|---|---|---|---|---|
| `ZoneLayout` panes | `ratio` only (`resolveBoundaryFlex`, min/max 0.2..0.8 or 0.15..0.5) | ratio | n/a | n/a | partial: no absolute min rows/cols, so a pane can be a sliver at small sizes; no bounds handed down to children |
| Persisted / restored ratios | `clampBoundaryRatio` | same | n/a | n/a | partial: valid ratios, but nothing ties them to the actual terminal size |
| `DetailPane` | none | none | wrap (`children` in one `Text`) | caller-owned strings | unbounded |
| `DimAnnotation` | none | none | wrap | static strings | unbounded |
| `StateLine` / `ZonePlaceholder` | 1 line | none | wrap | static | partial |

## Zones

| Zone | Height source | Width source | Text treatment | Appendable cap | Verdict |
|---|---|---|---|---|---|
| Dashboard (`dashboard-zone.tsx`, `launch-banner.tsx`) | none (flexGrow only) | none | wrap on banner lines and error message | none | unbounded |
| EDTs (`edts-zone.tsx`) | `budget` (`windowSize.rows - chrome`, ~:294) then `BoundedList` x2 | ratio | `ListRow` truncates; header/issues-summary lines wrap | service lists windowed; issues list lives in dialog | partial |
| Update (`update-zone.tsx`) | `budget` (:372, :667) + `resolveUpdatePaneRows`; detail pane unbudgeted | ratio | boxes/config panels trunc; `update-service-detail.tsx` step headlines, detail lines and issue log use wrap | `liveServiceIssues` (issue log) grows unbounded via `.map`; per-service step detail unbounded; error text in `UpdateServiceBox` truncated | partial |
| Logs (`logs-zone.tsx`, `logs-zone.logic.ts`) | `budget` + `measured` panes, `wrap-ansi` row counting (~:721) | measured | pane lines wrapped and counted, titles trunc, filter-editor body wraps | log lines windowed per pane (stream); filter history windowed | bounded for panes; partial for filter editor dialog |
| Routes (`routes-zone.tsx`) | `budget` (:211) + `measured` x3 | ratio | request/saved tabs trunc errors; response body via `JsonTree` (trunc + `BoundedList`) | route list windowed; response windowed | partial: surrounding dialogs (4 `ModalDialog` uses), header and hint lines unbounded |
| Shared types (`shared-types-zone.tsx`) | none | none | wrap (`formatSharedTypesDisabledMessage` lists every carrying service) | carrying-service list grows with the registry | unbounded |

## Dialogs and overlays (all through `ModalDialog` unless stated)

`ModalDialog` has an optional `maxHeight` only; no consumer is guaranteed window-bounded. 17 consumer files, 21 `<ModalDialog` usages.

| Surface | Height source | Text treatment | Appendable cap | Verdict |
|---|---|---|---|---|
| EDTs `issues-dialog` | hard `maxHeight={20}` (ignores window; clips body, no indicator) | wrap (`entry.message` raw, multi-line/ANSI possible) | unreachable + errors uncapped | unbounded (repro: 5k-char message, 100 issues) |
| EDTs `create-wizard` (+ `step-name/services/branches/activation`, `override-box`) | steps use `BoundedList` with budgets; frame itself none | activation lines trunc; branches/override/name steps wrap | service list windowed; failed-result lines unbounded | partial |
| EDTs `add-to-edt`, `modify`, `quick-pick`, `service-actions`, `switch` (+ `switch-resolution-view`) | `FilterablePickList`/`BranchPlanTable` budgeted; dialog frame none | switch result rows trunc; modify/service-actions messages and failure lines wrap | pick lists windowed; per-repo failure lists via `FailedResultList` uncapped | partial |
| EDTs `delete-dialog` | none | wrap (blocker/message text) | blocker list `.map` uncapped | unbounded |
| `FailedResultList` | none | wrap (`row.message` raw) | uncapped | unbounded (repro: 300 rows, multi-line message) |
| Logs `log-filter-editor` | none on frame | wrap | filter history list partly windowed in the zone | partial |
| Routes dialogs (4 usages) | none on frame | wrap | request lists windowed by `BoundedList` | partial |
| Update `update-config-panels` (3 dialogs), `update-service-menu-dialog`, `update-service-pick-dialog`, `update-zone` dialogs (2) | config rows trunc; pick/menu `.map` uncapped | menu/pick labels wrap | pick list `.map` over all services | partial: pick dialog unbounded in service count |
| Shared `repo-registry-screen` | none | wrap (13 `Text`, 0 trunc) | scan results/repos `.map` x8 | unbounded |
| Shared `settings-screen` | none | wrap (28 `Text`, 0 trunc) | groups/filter-history `.map` x7 | unbounded |
| Shared `reset-screen` | none | wrap (10 `Text`, 0 trunc) | step list `.map` x2 | unbounded |
| Shared `command-bar` | columns only | wrap | result rows `.map` x5 | partial |
| `branch-picker`, `branch-autocomplete-input`, `filterable-pick-list` | `FilterablePickList`/autocomplete windowed | autocomplete trunc, picker wraps (6 `Text`, 0 trunc) | windowed | partial |

## Errors

| Source | Treatment | Verdict |
|---|---|---|
| `error.message` rendered raw in dialogs, update boxes, `FailedResultList`, issues dialog, settings/registry/reset screens | no normalizer exists (multi-line, ANSI, thousands of chars all pass through); only the Update boxes/config panels and the Routes tabs truncate | unbounded outside those. Full text must stay in logs / CLI JSON |

## Proposals for the validated mechanisms

1. **Bounds context** in `shared/`: `BoundsProvider`/`useBounds()` carries `{ columns, rows }` for the current region; the shell provides `useWindowSize()` minus rendered chrome (top bar, tab bar, footer, cursor/command row), `ZoneLayout` derives each pane's bounds from the ratio with absolute minimums.
2. **Minimum size** (named constant `MIN_TERMINAL_COLUMNS x MIN_TERMINAL_ROWS`): proposed 40 x 12. Justification: chrome is top bar 1 + tab bar 1 + footer 1 + cursor row 1 = 4 rows, leaving 8 content rows (a title, a header, three list rows, two indicators, one detail row); 40 columns keeps `▲ more above` indicators, the `[:] cmd` hint and a 12-char service name plus status glyph on one line. The matrix still includes 60 x 15 as a "small but usable" cell above this. Subject to developer confirmation, and to measurement against the tab bar's width during the foundation commit.
3. **Absolute pane minimums**: `MIN_PANE_ROWS = 3` (header + 1 row + indicator), `MIN_PANE_COLUMNS = 12` in the same constants module; the effective ratio is clamped so both panes meet them, persisted ratios remain valid.
4. **Text primitives** in `shared/`: `TruncatedText` (single line, `wrap="truncate-end"`, normalizes first) and `ClampedParagraph` (`maxLines`, ends with `… +N lines`), plus `normalizeMessage(text, maxChars)` (strip ANSI, collapse whitespace/newlines, cap length). `DetailPane` and `DimAnnotation` use them internally.
5. **Single scroll mechanism**: generalize `bounded-list.tsx` to heterogeneous blocks (rows with known heights) and add a "N older hidden" cap helper for stream-fed collections (Update issue log, failed-result lists). `keybinding-help.tsx` switches from its fixed 10-line window to the bounds-driven one. No third mechanism.
6. **`ModalDialog`** always bounded: reads `useBounds()`, keeps title and footer, scrolls the body, recomputes on resize; `maxHeight` stays as an optional tighter cap. New `DIALOG_REGISTRY` (view + adversarial fixture per dialog) feeds the matrix and a registry-coverage test.
7. **Too-small screen** in `app-shell.tsx`: when `columns < MIN_COLUMNS || rows < MIN_ROWS`, render only "Terminal too small — need at least C x R (now c x r)"; hooks and state stay mounted so the return on grow is live.

## Patch plan (one commit per family, repro test first)

1. EDTs dialogs: issues, delete, FailedResultList consumers, create-wizard frame, modify, service-actions, add-to-edt, switch, quick-pick.
2. Logs: filter-editor dialog and zone header lines.
3. Routes: dialogs and header/hint lines.
4. Update: issue log cap, step detail, config dialogs, pick/menu dialogs.
5. Dashboard (banner, error line) and shared-types (carrying-service list clamp).
6. Shared screens: registry, settings, reset, command bar, `resetNotice`, help, footer/top bar/tab bar.

Estimated size: foundation + guard + six patch commits fits one story; if the validated inventory shows more partial surfaces than listed here, split the tail into 7.9b.

## Outcome

- Minimum size 40 x 12 kept. The tab bar needs about 77 columns for full labels; below that it collapses inactive tabs to `[mnemonic]` (about 38 columns with the active label), so it fits 40 columns; on the Update tab the `⇄ updating` badge can clip at exactly 40 columns.
- Every `partial`/`unbounded` row above is fixed by one of: the shell region (pinned top bar, tab bar, footer), `ZoneLayout` minimums, `ModalDialog` bounds + PgUp/PgDn, truncating/clamped text, `BoundedList`/`BoundedBlocks`/`capOlder`. The dialog registry (`shared/test-support/dialog-registry.tsx`) lists the dialogs; `update-zone.tsx`, `update-config-panels.tsx` and `routes-zone.tsx` open theirs from local state, so the matrix reaches them through the owning zone rather than forcing them open.
