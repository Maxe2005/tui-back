---
title: 'EDT Zone — Active/Emphasized Coloring Split (Story 2.18 amendment)'
type: 'feature'
created: '2026-08-27'
status: 'done'
route: 'one-shot'
baseline_commit: '91a980ce822c4fc5840316b54683b6195fbcd1a7'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-27.md'
  - '_bmad-output/implementation-artifacts/epic-2/spec-2-18-edt-zone-active-highlight-fixed-width-detail-pane-categorized-services-per-service-actions.md'
---

# EDT Zone — Active/Emphasized Coloring Split (Story 2.18 amendment)

## Intent

**Problem:** Story 2.18's `active` `list-row` state (accent+bold) was wired to the tool-wide active EDT, but the EDT SERVICES/OTHER SERVICES split is partitioned against the *selected* EDT (`focusedEdt`, persists across pane focus). When the two differ, the strongly-highlighted row and the row whose members actually drive the panes below it are different rows — disorienting in real usage, reported directly by Max after using the still-unmerged Story 2.18 branch.

**Approach:** Split `ListRow`'s single `active` prop into two decoupled indicators: a new `emphasized` prop takes over the accent+bold label treatment, now driven by whichever row's membership currently drives the categorized split (persists across all three EDT-zone panes, not just while the EDT selector has focus); the repurposed `active` prop renders a discreet, glyph-paired `colors.info` "• active" suffix for the tool-wide active EDT instead — decoupled, can land on the same or a different row. Full analysis in the linked Sprint Change Proposal, §4 "Story 2.18 — AC1 amendment".

## Suggested Review Order

**The coloring split — the core mechanism**

- `ListRowProps` gains `emphasized` (takes over accent+bold) and repurposes `active` (now a discreet suffix, no longer label color/bold) — read both doc comments together, they explain the decoupling and why.
  [`list-row.tsx:13`](../../../src/adapters/driving/tui/shared/components/list-row.tsx#L13)

- `resolveRowLayout` — `bold`/`labelColor` now derive from `emphasized`; `activeSuffix` is new, derives from `active`, with the `•` glyph required by DESIGN.md's status-color rule (colors.info must never be color-only).
  [`list-row.tsx:38`](../../../src/adapters/driving/tui/shared/components/list-row.tsx#L38)

- `ListRow`'s render — `activeSuffix` renders as its own `colors.info` `<Text>` after `meta`, independent of the label's own color/bold.
  [`list-row.tsx:54`](../../../src/adapters/driving/tui/shared/components/list-row.tsx#L54)

**Wiring into the EDT zone**

- `formatEdtRowMeta` simplified — no longer takes `isActive`/builds the "— active" string itself, now a pure member-count formatter.
  [`edts-zone.tsx:268`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L268)

- The EDT selector's `ListRow` call site — `emphasized` is keyed off `clampedEdtsSelected` (persists across all three panes' focus), `active` keeps its original `activeEdtUlid` trigger condition.
  [`edts-zone.tsx:1396`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L1396)

**Tests — the behavioral proof**

- `resolveRowLayout` pure-function coverage for `active` alone and composed with `emphasized`, pinning the `•` glyph in `activeSuffix`.
  [`list-row.test.tsx:78`](../../../src/adapters/driving/tui/shared/components/list-row.test.tsx#L78)

- `ListRow` render coverage for the discreet suffix alone, after `meta`, and composed with `selected` (a real, previously-untested combination).
  [`list-row.test.tsx:156`](../../../src/adapters/driving/tui/shared/components/list-row.test.tsx#L156)

- `FORCE_COLOR=1` styling proof that the cursor-index row is bold (emphasized) and the active EDT's row carries the info-colored suffix — on two different rows.
  [`edts-zone.styles.test.tsx:42`](../../../src/adapters/driving/tui/zones/edts/edts-zone.styles.test.tsx#L42)

- New regression proving `emphasized` persists after focus tabs away from the EDT selector to EDT SERVICES/OTHER SERVICES, unlike the pane-local cursor bar — the specific claim this amendment makes that Story 2.18's original tests never covered.
  [`edts-zone.styles.test.tsx:76`](../../../src/adapters/driving/tui/zones/edts/edts-zone.styles.test.tsx#L76)

- `formatEdtRowMeta` test simplified to match its narrower signature.
  [`edts-zone.test.tsx:504`](../../../src/adapters/driving/tui/zones/edts/edts-zone.test.tsx#L504)
