---
title: 'Story 7.9: Bounded-rendering audit, global fix & regression guard (UX-DR37, AD-19)'
type: 'feature'
created: '2026-10-08'
baseline_commit: '783a0081c31b65f600718396669be4876dc57e95'
status: 'in-review'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Lines vanish: the shell root clips silently (`overflow="hidden"`), most dynamic `Text` wraps unbounded, `ModalDialog` has an optional `maxHeight`, panes use ratios only, growing data (Update issue log, error lists) is uncapped, and Dashboard/shared-types have no bounding at all.

**Approach:** Audit first (committed inventory, developer-validated), then a foundation (top-down bounds context, truncating text + clamped paragraph, message normalizer, generalized scroll region, always-bounded `ModalDialog`, absolute pane minimums, "terminal too small" screen), then one patch commit per zone/dialog family, then guard tests (size-matrix render + static guard + registry coverage) so the guard lands green. Behavior is unchanged on terminals where nothing overflowed.

## Boundaries & Constraints

**Always:** Inventory (`epic-7/bounded-rendering-inventory-7-9.md`) committed before any code change, each surface recording height source, width source, text treatment, appendable-content cap, verdict; every unbounded/partial surface gets a failing test (or documented manual repro) before its patch; clipping (`overflow="hidden"`) is the safety net, never the plan; reuse `zone-layout.tsx`, `bounded-list.tsx`, `use-element-size.ts`, `keybinding-help.tsx` windowing — no third scrolling mechanism; minimum size is a named constant justified in the inventory; AD-17 comment rule; imports first; Conventional Commits with `(story 7.9)` on this story branch; existing tests change only where a rendering deliberately changed (listed in the story file's Spec Change Log).

**Ask First:** HALT after the inventory commit for developer validation of the inventory and chosen mechanisms before the patch phase. If the patch list exceeds one story, propose follow-ups 7.9b… from the validated inventory (foundation and guard always ship in 7.9).

**Never:** Redesign visible behavior on large terminals; add a new dependency; use raw `Text` from `ink` for dynamic content outside `shared/`; drop the full error text where it already lives (logs, CLI JSON line); touch core/CLI behavior; seed the static-guard allow-list with entries (it starts empty).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Long/multi-line error | `error.message` with newlines, ANSI, 5k chars | Normalized to one capped line, ellipsis-truncated to its width | Full text stays in logs / JSON |
| Growing collection | hundreds of issues/log lines/services | Scroll region with ▲/▼ indicators; stream-fed collections capped with "N older hidden" | Cursor/scroll key where interactive |
| Dialog taller than window | content > terminal rows | Title + footer kept, body scrolls, recomputed on resize | N/A |
| Extreme pane ratio / persisted ratio / shrink | `Ctrl+W` or restore at small size | Absolute min rows/cols enforced; neither pane a sliver | Ratios stay valid |
| Below minimum size | cols×rows < constant | Single "Terminal too small — need at least C×R (now c×r)" screen; live return on grow | N/A |
| Large terminal | nothing overflowed before | Output identical to before | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/app-shell.tsx:201,364-376` -- reads only `rows`; root `height={rows} overflow="hidden"`; sibling overlays (`KeybindingHelp`, registry/settings/reset screens, `resetNotice` bare `Text`, `CommandBar`); add bounds provider + too-small gate.
- `src/adapters/driving/tui/zones/{zones.ts,index.ts,zone-layouts.ts}` -- `ZONES`, `ZONE_SCREENS`, `ZONE_LAYOUTS` registries; matrix enumerates zones from them. No dialog registry exists: create one (dialogs listed below) for matrix coverage.
- `shared/components/{zone-layout,bounded-list,modal-dialog,detail-pane,dim-annotation,keybinding-help}.tsx`, `shared/hooks/use-element-size.ts` -- primitives to extend (`resolveBoundaryFlex` ratios only; `ModalDialog` optional `maxHeight`; `DetailPane`/`DimAnnotation` unbounded `Text`; help window fixed at 10 lines).
- `ModalDialog` consumers (17): `shared/{command-bar,repo-registry-screen,settings-screen}`, `zones/edts/dialogs/*` (add-to-edt, create-wizard, delete, issues, modify, quick-pick, service-actions, switch), `zones/logs/log-filter-editor`, `zones/routes/routes-zone`, `zones/update/{update-config-panels,update-service-menu-dialog,update-service-pick-dialog,update-zone}`.
- Ad-hoc `useWindowSize` budgets: `edts-zone:294`, `update-zone:372,667`, `routes-zone:211`, `command-bar:7`, logs via `logs-zone.logic` (`wrap-ansi` helpers ~:721 are the closest clamp primitive). Dashboard and shared-types: unbounded.
- Error normalizer: none exists (only a local ANSI strip in `core/scripts/group-update.ts:93`); put the TUI one in `shared/`.
- Guard precedents: `src/comment-hygiene.test.ts` (recursive scan, empty allow-list), `shared/components/hints.guard.test.ts` (`ALLOWED` Set, `fileURLToPath(new URL(...))` roots). Render helpers: `shared/components/render-to-string.ts`, `shared/test-support/{mount-for-test,fake-tty}.ts` (`FakeTtyStdout.columns/rows` mutable; resize precedent `app-shell.alternate-screen.test.tsx:46-74`).
- Docs: `ARCHITECTURE-SPINE.md` AD-19 (:241, already written), `EXPERIENCE.md` › Interaction Primitives (:188), `AGENTS.md` › Code conventions (:20, two-line rule). Inventory format precedent: `epic-7/interaction-inventory-7-4.md`.

## Tasks & Acceptance

**Execution:**
- [x] `epic-7/bounded-rendering-inventory-7-9.md` -- audit table of every surface (zones, panes, dialogs, DetailPane, Update boxes/log, errors, Dashboard, shared-types, command bar, `?` help, footer, top bar) -- commit first, then HALT for validation.
- [x] `shared/` bounds context/hook + `app-shell.tsx` + `zone-layout.tsx` -- zone bounds from `useWindowSize()` minus rendered chrome; pane bounds from ratios; absolute minimums; too-small screen with named constant -- foundation.
- [x] `shared/` truncating text, clamped paragraph (`maxLines`, "… +N lines"), message normalizer (+ unit tests) -- bounded text by default.
- [x] `bounded-list.tsx` generalized to heterogeneous blocks; stream/retry collections capped with "N older hidden" -- single scroll mechanism.
- [x] `modal-dialog.tsx` -- always window-bounded, scrolling body, live resize; dialog registry -- no dialog can exceed the terminal.
- [x] One patch commit per family (EDTs, Logs, Routes, Update, Dashboard, shared-types, shared screens), each preceded by its failing repro test.
- [x] Guard tests last: size-matrix render (zones + dialogs × 120×40, 80×24, 60×15, minimum × adversarial fixtures), static guard (empty allow-list), registry-coverage test.
- [x] Docs: EXPERIENCE.md primitive entry, AGENTS.md two-line rule.

**Acceptance Criteria:**
- Given any matrix cell, when rendered, then no frame exceeds terminal rows or any line exceeds columns, and top bar, footer and cursor row stay visible.
- Given a new zone or dialog missing from the registries, when `npm test` runs, then a test fails.
- Given a raw `Text` with dynamic content or an un-windowed `.map()` over a growing collection outside approved primitives, when `npm test` runs, then the static guard fails.
- Given a terminal where nothing overflowed before, when any zone is used, then output is unchanged.

## Spec Change Log

- `zones/logs/logs-zone.interaction.test.tsx`, "keeps a column's display width stable as its own vertical scroll changes" and "the grid gains a 'more below' indicator once the terminal shrinks…": the shrink step now resizes to 12 rows instead of 10, because 10 rows is below the new 40x12 minimum and now shows the too-small screen instead of the zone.
- Rendering that deliberately changed without touching an existing test: dynamic `Text` outside `shared/` now truncates to its line (wrapping text such as the activation explanations, health labels and annotations clamps to 3 lines instead); `DetailPane`/`DimAnnotation`/`FailedResultList` clamp their text and window their rows; the footer wraps to at most 3 rows; the tab bar collapses inactive tabs to `[mnemonic]` when the full labels do not fit; `ModalDialog` is capped to the zone region, no longer shrinks under it, and scrolls its body with PgUp/PgDn.
- `shared/components/render-to-string.ts` gained an optional size argument (defaults unchanged).

## Verification

**Commands:**
- `npm test` -- expected: all pass, including matrix and static guard.
- `npm run typecheck` -- expected: clean.
- `npm run depcheck` -- expected: clean.

**Manual checks (if no CLI):**
- Run the TUI in a shrunk terminal and drag `Ctrl+W` extremes: no vanished lines, "too small" screen appears and recovers live.
