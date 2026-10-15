# Sprint Change Proposal — 2026-10-07

**Project:** tui-back
**Author:** Max (via bmad-correct-course)
**Mode:** Batch (single change)
**Status:** Artifacts updated, awaiting Max's approval

---

## 1. Issue Summary

Since `Ctrl+W` resize was generalized to every zone (Story 7.3) and since error messages started being surfaced in more places (notably the Update zone), lines regularly overflow and **disappear visually** in many places of the tool. The behavior must be made correct at all times — small terminal, endless error messages, panes resized left/right — and the defect class must be made impossible to reintroduce.

**Evidence gathered (2026-10-07, code inspection, no repro run yet):**

- `app-shell.tsx:383` — the root is `height={rows} overflow="hidden"`. Anything that grows past the terminal is **clipped silently at the bottom**: this is the mechanism that makes lines vanish rather than scroll.
- Ink's `Text` defaults to `wrap="wrap"`. Only ~77 call sites set a bound (`truncate-end`, `maxHeight`, `overflow`), concentrated in Logs, Routes, JsonTree and a few dialogs. Many dynamic texts are unbounded: `update-service-detail.tsx` (steps, issue log, context), `DetailPane` (`<Text>{children}</Text>`), `DimAnnotation` fed with `error.message` (`routes-zone.tsx:1289`, `edts-zone.tsx:953/962`, `repo-registry-screen.tsx:441`, `logs-pane-view.tsx:96`), dialog error lines (`add-to-edt`, `service-actions`, `switch`, `create-wizard`).
- `ModalDialog` takes an **optional** `maxHeight` and no `overflow="hidden"`; 20 consumers, each responsible for bounding its own children (`modal-dialog.tsx`).
- Bounding is per-zone and uneven: `bounded-list`/`useWindowSize` is used in EDTs, Logs, Routes, Update; **Dashboard and shared-types have none** (and Dashboard is about to grow in 7.5/7.6).
- `ZoneLayout` derives panes from ratios only (`zone-layout.tsx`): no absolute min rows/columns tied to the real terminal, so a pane can collapse to a sliver on a narrow terminal or after a `Ctrl+W` move.
- Story 5.5 fixed the same defect class for Logs and EDTs only. The class returned in every surface built or extended since (Update, Routes, wizard, dialogs) — evidence that per-surface fixes do not hold.

---

## 2. Impact Analysis

| Item | Status | Notes |
|------|--------|-------|
| Triggering story | [x] | 7.3 (Ctrl+W everywhere) made pane-size variability universal; Update error paths made long messages common |
| Core problem | [x] | Missing **contract**: no top-down bounds, no default-truncating text, no bounded dialog, no cap on growing data, no min-size screen, no guard |
| Epic 7 | [x] | Completes as planned + 1 story (7.9). Order: …7.3 → 7.7 → **7.9** → 7.4 → 7.5/7.6 |
| Other epics | [x] | Epics 1–6 done/untouched in scope; their surfaces are *patched* by 7.9, not replanned |
| PRD | [N/A] | Quality/consistency NFR; no functional requirement added |
| Architecture | [!] | **AD-19** added to ARCHITECTURE-SPINE.md (done) |
| UX | [!] | **UX-DR37** added to epics.md requirements (done); EXPERIENCE.md Interaction Primitives entry to be written by 7.9 itself |
| Sprint status | [x] | `7-9-bounded-rendering-audit-global-fix-regression-guard: backlog` added (done) |

Risks: story is large (audit + foundation + ~20 dialogs + 6 zones + guard). Mitigation written into the story: inventory first and validated by Max; foundation and guard stay in 7.9; remaining per-surface patches may split into 7.9b… from the validated inventory (same precedent as 7.4).

---

## 3. Recommended Approach

**Direct Adjustment** — add one story to Epic 7, placed before 7.4 so alignment consumes the new primitives and before 7.5/7.6 so the Dashboard is built bounded from day one.

Proposed global mechanism (details to be validated at the end of the audit phase):

1. **Bounds flow top-down**: shell → zone body → `ZoneLayout` pane → component, from `useWindowSize()` minus the chrome actually rendered.
2. **Text is bounded by default**: shared truncating text primitive; wrapping only via an explicit clamped paragraph (`maxLines` + "… +N lines"); messages normalized (single line, no ANSI, capped) before display.
3. **One scroll region** (generalizing `bounded-list`) for anything that grows; in-memory collections capped with a visible "N older hidden".
4. **`ModalDialog` always bounded** to the window, body scrolls.
5. **Absolute pane minimums** + a **"terminal too small"** screen below a named minimum.
6. **Enforcement**: size-matrix render test (all zones/dialogs × several sizes × adversarial fixtures, asserting rows ≤ terminal rows and widths ≤ columns, anchors visible), a static guard test (like 7.1's), and automatic coverage of any new zone/dialog via the registry.

Effort: High (largest story of the epic). Risk: Medium (broad surface, behavior-neutral on large terminals by AC). Timeline: slots in before 7.4; no impact on completed work.

---

## 4. Detailed Change Proposals (applied)

| Artifact | Change |
|----------|--------|
| `epics.md` | + Story 7.9 (after 7.8); + UX-DR37 in requirements; Epic 7 implementation notes/execution order updated |
| `ARCHITECTURE-SPINE.md` | + AD-19 — every rendered region bounded in both axes |
| `sprint-status.yaml` | + `7-9-…: backlog`; execution-order comment updated |
| `EXPERIENCE.md` | Deferred to Story 7.9 (AC: contract recorded in Interaction Primitives) |
| `AGENTS.md` | Deferred to Story 7.9 (AC: two-line rule in Code conventions) |

---

## 5. Implementation Handoff

**Scope classification: Moderate** — one story added, additive architecture/UX amendments, no replan.

| Role | Responsibility |
|------|----------------|
| Developer agent (`bmad-build`) | Story 7.9 on its own branch from `epic-7-tui-consistency-dashboard-code-hygiene`: audit commit first, foundation, per-surface patches, guard last |
| Max | Approve this proposal; validate the audit inventory and the mechanisms before the patch phase |
| PO (sprint-status) | Entry already added as `backlog` |

**Success criteria:** committed inventory with zero "unbounded" verdicts left; size-matrix test and static guard green; at 60×15 and minimum size, with endless error messages and extreme pane ratios, no line count/width overflow and anchors always visible; `npm test && npm run typecheck && npm run depcheck` green.
