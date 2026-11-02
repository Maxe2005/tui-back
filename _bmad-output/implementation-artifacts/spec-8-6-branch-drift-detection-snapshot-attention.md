---
title: 'Story 8.6: Branch Drift Detection — Snapshot & Attention'
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: '46a8947fc5fc84d50d26ea1de8d3f8fc9c498af7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A repo can silently leave the branch it should be on (manual checkout, tooling, a past operation) and nothing flags it, so the developer builds or tests on the wrong code.

**Approach:** Extend the dashboard snapshot with a per-service drift state — members against their branch for the active EDT, other managed services against their `sharedBranch` (new `others` collection) — and surface each drifted service as an Attention line; the CLI `dashboard` emits it unchanged in its envelope.

## Boundaries & Constraints

**Always:** Drift is `aligned | drifted | unknown`; a detached HEAD is `drifted` (current branch `null`); any other failed probe is `unknown`, never drifted or aligned, and affects only that service. Members reuse the branch already read by `readServiceDivergence` (no new git call); others make exactly one `currentBranch` call each. Others = registered paths not in the active EDT whose manifest loads; unreachable, unmanaged (`manifest-not-found`) and invalid-manifest paths are left to registry health. No active EDT → `others: []` and no drift data. Existing member fields keep their shape and meaning (new fields are additive). Attention drift lines sit after the protected-branch line and before every other item, are counted in the header, and name service, current vs expected branch and "EDT member" / "other service". Core stays pure (ports injected, `Result<T>`, kebab-case codes); zone logic in `*.logic.ts`; English, header comments ≤ 5 lines, no story/AC refs in `src/`.

**Ask First:** Changing any existing snapshot field; adding a git call per member; listing invalid-manifest repos in `others`.

**Never:** The realign shortcut/hint (deferred to 8.8 by human decision), realign use-case or CLI (8.7), new settings, an `others` table in the TUI, live polling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Member aligned | member branch `feat/x`, on `feat/x` | `expectedBranch: 'feat/x'`, `drift: 'aligned'`, no line | N/A |
| Member drifted | expected `feat/x`, on `main` | `drifted`; line `svc · on main, expected feat/x (EDT member)` | N/A |
| Detached HEAD | member or other on detached HEAD | `drifted`, `branch: null`; line `on detached HEAD, expected …`; no "divergence unknown" line for it | N/A |
| Other drifted | non-member, `sharedBranch: develop`, on `hotfix` | in `others`, `drifted`; line `… (other service)` | N/A |
| Probe failure | `currentBranch` errors (not detached) | `drift: 'unknown'` + `detail`; no drift line | other services unaffected |
| No active EDT | `no-active-edt` | `others: []`, no drift lines | N/A |
| `a` cycling | attention lines include "other" items | cycling skips items with no services-table row | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driven/git/index.ts:213-226` -- `currentBranch`: the literal `HEAD` (detached) currently fails as `git-current-branch-error`, same as a rev-parse failure; give the detached case its own code `git-detached-head` (no core code compares the old code; update `index.test.ts:427-437` and the comment at `:978`).
- `src/core/edt/list.ts:134-182` -- `readServiceDivergence` (read-only reuse): branch `null` + `detail.code` tells detached from failure.
- `src/core/dashboard/snapshot.ts` -- add `DriftState`, `expectedBranch`/`drift` on `DashboardService`, `DashboardOtherService {service, path, branch, expectedBranch, drift, detail?}`, `others` on `DashboardSnapshot` and `DashboardServicesSection`; `buildDashboardServices` gains `registry` in its params and builds `others` (resolve-path compare against members).
- `src/adapters/driving/tui/store/slices/dashboard-slice.ts:249` -- deps already carry `registry`; no logic change expected beyond types.
- `src/adapters/driving/cli/subcommands.ts:186-200` -- `dashboard` entry: unchanged call, gets `others` for free; extend the dispatch test.
- `src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts:131-195` -- `AttentionReason` + `'drift'`; `buildAttentionItems(services, others)` ranks drift right after protected-branch; `AttentionItem` gains `focusable`; `nextAttentionIndex` skips non-focusable items.
- `src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx:76,136` -- pass `others`; `a` uses the skipping index. `dashboard-body.tsx:229` -- drift lines use the `awaiting` badge like other non-protected items.
- Fixtures to extend: `snapshot.test.ts`, `dashboard.logic.test.ts`, `dashboard-zone{,.interaction,.bounds}.test.tsx`, `dashboard-slice.test.ts`, `dispatch.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driven/git/index.ts` (+ test) -- `git-detached-head` code for detached HEAD -- lets drift tell detached from probe failure
- [x] `src/core/dashboard/snapshot.ts` (+ test) -- drift fields, `others`, member/other/unknown/detached/no-active cases from the matrix -- the drift model
- [x] `src/adapters/driving/cli/dispatch.test.ts` -- assert `others` and drift in the `dashboard` envelope -- CLI contract (AD-3)
- [x] `dashboard.logic.ts` (+ test) -- drift items, ordering, text, detached suppressing "unknown (offline)", skipping cycle -- Attention rules
- [x] `dashboard-zone.tsx`, `dashboard-body.tsx`, store slice + their tests/fixtures -- wire `others`, count in header -- rendering
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 8-2…8-5 to `done` (stale), 8-6 to `in-progress` -- tracking

**Acceptance Criteria:**
- Given drift lines and a protected-branch line, when Attention renders, then order is protected, drift, then the existing items, and the header count includes drift lines.
- Given `tui-back dashboard`, when it runs, then `services[].expectedBranch/drift` and `others[]` are in the JSON envelope.
- Given `npm test`, `npm run typecheck`, `npm run depcheck`, then all pass.

## Spec Change Log

## Design Notes

Drift rank (right after protected) satisfies "after protected, before behind shared branch" while keeping the existing order intact. Others re-read `registry.exists`/`manifest.load` independently of the registry-health section so both sections still load and fail on their own; the duplicated reads are filesystem-only, not git.

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no violations

## Suggested Review Order

**Drift model (core)**

- Entry point: the closed drift state and how a branch read maps onto it.
  [`snapshot.ts:198`](../../src/core/dashboard/snapshot.ts#L198)

- Members reuse the divergence branch read — no extra git call.
  [`snapshot.ts:250`](../../src/core/dashboard/snapshot.ts#L250)

- Others: registered, managed, non-member repos; a throwing probe drops only its row.
  [`snapshot.ts:170`](../../src/core/dashboard/snapshot.ts#L170)

- Member paths resolved once, compared against resolved registry paths.
  [`snapshot.ts:104`](../../src/core/dashboard/snapshot.ts#L104)

- New additive shapes: `DriftState`, `DashboardOtherService`.
  [`snapshot.ts:34`](../../src/core/dashboard/snapshot.ts#L34)

**Detached HEAD contract**

- Port-level constant so core and adapter cannot diverge.
  [`git.ts:9`](../../src/core/ports/git.ts#L9)

- Adapter returns it for the literal `HEAD`, distinct from probe failures.
  [`index.ts:223`](../../src/adapters/driven/git/index.ts#L223)

**Attention block**

- Drift ranked right after protected branch; detached suppresses the offline line.
  [`dashboard.logic.ts:152`](../../src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts#L152)

- Line wording: current vs expected branch, member or other.
  [`dashboard.logic.ts:145`](../../src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts#L145)

- Cycling skips lines without a services-table row.
  [`dashboard.logic.ts:205`](../../src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts#L205)

- Zone wiring of `others` and the skipping cycle.
  [`dashboard-zone.tsx:81`](../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx#L81)

**Tests**

- Drift matrix: member, detached, unknown, others, throwing probes.
  [`snapshot.test.ts:203`](../../src/core/dashboard/snapshot.test.ts#L203)

- Cycling proven at zone level with a focusable line after an other line.
  [`dashboard-zone.interaction.test.tsx:92`](../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.interaction.test.tsx#L92)

- CLI envelope carries `others` and drift.
  [`dispatch.test.ts:316`](../../src/adapters/driving/cli/dispatch.test.ts#L316)
