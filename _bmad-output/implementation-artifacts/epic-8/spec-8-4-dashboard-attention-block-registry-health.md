---
title: 'Story 8.4: Dashboard — Attention Block & Registry Health'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '4b7167788fb5c712f8eed29c2f0d9deef40486b3'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Dashboard shows service rows and a one-line registry summary, but nothing tells the developer which services need attention (protected branch, missing upstream, dirty tree, behind, branch shared with another EDT) and the registry health has no success state or shortcut.

**Approach:** Derive an Attention list purely from the loaded services section (pure logic, severity-ordered, count in header, single success line when empty), render it plus an upgraded registry-health block with its `[:registry]` shortcut, and let `↑/↓` + `Enter` on an attention line write the target service name to a store field that Story 8.3's table will read to focus the row.

## Boundaries & Constraints

**Always:** Attention items come only from the existing `DashboardService` fields (`protectedBranch`, `divergence`, `workingTree`, `usedByEdts`); no new probe, no snapshot/CLI change. Order: protected branch → no-upstream / unknown-offline → uncommitted / merge / rebase → behind (`behind > 0`, no threshold) → used by another EDT (naming those EDTs). One line per (service, reason); each names its service and reason. Header shows the count. Block and registry block render bounded (`BoundedList`, `TruncatedText`, `useRowBudget` chrome rows accounted), each in its own section state (spinner/error follow the services/registry section status). Keys gated by `useZoneInputActive`. Footer/`?` help from `KEYBINDINGS`. Zone logic in `*.logic.ts`, English, header comments ≤ 5 lines, no story/AC references in `src/`.

**Ask First:** Changing `DashboardService`/snapshot shape; binding any key other than `↑/↓`/`Enter` for the attention cursor.

**Never:** Services table, row focus rendering, per-service actions (8.3); EDT actions (8.5); drift lines (8.6); probe-error lines in Attention (those stay as row markers); live polling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Several issues | one service protected, another behind 2, third on a branch of EDT "x" | header `Attention (3)`; lines in severity order, each with service + reason | N/A |
| Same service, two reasons | protected and dirty | two lines, same service | N/A |
| Nothing to flag | no flags, `behind` 0/null | header + single success line | N/A |
| Probe error field | `divergence`/`workingTree` errored | not an attention line; row marker unchanged | N/A |
| No active EDT / services error | section not ready | no Attention block | existing section state |
| Registry all clear | invalid/unreachable/issues all 0 | repo count + single success line, `[:registry]` hint | N/A |
| Registry problems | any count > 0 | counts shown, `[:registry]` hint | N/A |
| Enter on a line | cursor on attention line | `dashboardFocusedService` = that service name | ignored when overlay open |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts` -- add `buildAttentionItems(services)` (pure, severity order), `formatAttentionLine`, extend `formatRegistrySummary`/`registryAllClear`; `formatRegistrySummary` is already used by body + logic test.
- `src/adapters/driving/tui/zones/dashboard/dashboard-body.tsx` -- add Attention + registry-health sections after the service list; `BODY_CHROME_ROWS` (7) must cover the new fixed rows.
- `src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx` -- `useInput` for ↑/↓/Enter next to `R` (gated by `zoneInputActive`).
- `src/adapters/driving/tui/store/slices/dashboard-slice.ts` -- add `dashboardFocusedService: string | null` + `focusDashboardService(name)`; clear on reload when the service vanishes.
- `src/adapters/driving/tui/keybindings/keybindings.ts:171` -- `R (Dashboard)` row is the pattern; add `↑/↓ attention` and `Enter focus` rows with `footer.zones: ['dashboard']` if they do not collide with existing rows (check keybinding tests/guards).
- `src/adapters/driving/tui/shared/components/{bounded-list,state-line,dim-annotation,truncated-text,hints}.tsx` -- reuse; `StatusBadge` for severity glyphs.
- `src/core/dashboard/snapshot.ts:20-50` -- read-only: `DashboardService`, `DashboardRegistrySummary` shapes.
- `dashboard-zone.test.tsx`, `dashboard-zone.interaction.test.tsx`, `dashboard.logic.test.ts`, `dashboard-slice.test.ts` -- extend.

## Tasks & Acceptance

**Execution:**
- [x] `dashboard.logic.ts` (+ test) -- attention derivation, ordering, line formatting, registry all-clear -- pure logic for every matrix row
- [x] `dashboard-slice.ts` (+ test) -- `dashboardFocusedService` field and setter, reset when service disappears -- hand-off to 8.3
- [x] `dashboard-body.tsx` (+ test) -- Attention block (header count, bounded lines, cursor mark, success line) and registry-health block with `[:registry]` -- rendering
- [x] `dashboard-zone.tsx`, `keybindings.ts` (+ interaction/keybinding tests) -- ↑/↓/Enter on attention lines, overlay inertness, footer/help -- keys

**Acceptance Criteria:**
- Given services with several issues, when rendered, then the Attention block lists one line per issue in severity order with the count in its header.
- Given a member with `behind > 0` on its shared branch, when rendered, then it is listed; with `behind` 0 or null it is not.
- Given nothing to flag, when rendered, then the block shows a single success line; same for an all-clear registry.
- Given registry problems, when rendered, then the repo, invalid, unreachable and listing-issue counts show with `[:registry]`.
- Given the cursor on an attention line, when `Enter` is pressed, then the store holds that service name; with an overlay open, nothing happens.
- Given any terminal size, when rendered, then output stays bounded (bounded-rendering guards pass).
- Given `npm test`, `typecheck`, `depcheck`, then all pass.

## Spec Change Log

- After merging story 8.3 (user-requested adjustment): 8.3 owns `↑/↓`/`Enter` for the service-row cursor, so the attention cursor and the `dashboardFocusedService` hand-off field were dropped. `a` now steps through the Attention lines (wrapping) and moves 8.3's row cursor to the line's service (matched by repo path), which satisfies "focus moves to that service's row". Known-bad state avoided: two competing `↑/↓` handlers and a write-only store field. Layout: the success states were folded onto one line each (attention header + success, registry counts + healthy) because the `:reset` overlay shares the 24-row terminal with the dashboard and the extra rows garbled it.

## Design Notes

Attention is derived in the TUI from the services section, not added to the snapshot, so the CLI envelope is unchanged. The focus field is intentionally the only coupling to Story 8.3: 8.3 renders the focused row from `dashboardFocusedService`; until it lands, the field is write-only. Attention probe errors are excluded on purpose — a failed probe is not evidence of an issue and already shows on its row.

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no violations

## Suggested Review Order

**Attention derivation**

- Entry point: pure, severity-ordered items from the loaded services only.
  [`dashboard.logic.ts:68`](../../src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts#L68)

- Line wording per reason, naming service and other EDTs.
  [`dashboard.logic.ts:97`](../../src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts#L97)

- Registry all-clear, never true for an empty registry.
  [`dashboard.logic.ts:105`](../../src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts#L105)

**Rendering**

- Attention block: header count, bounded lines, success line.
  [`dashboard-body.tsx:95`](../../src/adapters/driving/tui/zones/dashboard/dashboard-body.tsx#L95)

- Registry counts with the `[:registry]` shortcut.
  [`dashboard-body.tsx:127`](../../src/adapters/driving/tui/zones/dashboard/dashboard-body.tsx#L127)

**Keys and hand-off to the services table**

- Enter writes the focused service; cursor stays in range.
  [`dashboard-zone.tsx:69`](../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx#L69)

- Only coupling point with the services table (read by the next story).
  [`dashboard-slice.ts:43`](../../src/adapters/driving/tui/store/slices/dashboard-slice.ts#L43)

- Footer and help declarations for the new keys.
  [`keybindings.ts:176`](../../src/adapters/driving/tui/keybindings/keybindings.ts#L176)

**Tests**

- Cursor movement, Enter focus and overlay inertness.
  [`dashboard-zone.interaction.test.tsx:87`](../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.interaction.test.tsx#L87)
