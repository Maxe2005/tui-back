---
title: 'Story 3.18: Parallel Update Run & Incident Queue'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '942ea941cc48bda32a63ecaafba00ab6c3dd0cec'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A group update processes services one after another and a dirty/conflicted repo opens a single blocking modal that freezes the whole run, so a clean run is slow and one problem stops healthy services.

**Approach:** Replace the two sequential loops in core with a bounded pool (`update.concurrency`, default 3). A service needing the developer pauses, releases its slot and appends an incident to a queue; the TUI shows a multi-incident popup the developer works through in any order while other services keep running.

## Boundaries & Constraints

**Always:**
- `concurrency=1` behaves exactly like today's sequential run. Results stay in configuration order; every targeted service is accounted for.
- `runPool(targets, concurrency, worker)` is pure, never rejects; a throwing worker becomes that service's `failed` row (AD-3).
- Two targets with the same resolved repoPath never run concurrently. Keep `GROUP_UPDATE_LOCK_KEY` (+ edt lock); provide an `ordering`/stages hook so Story 4.4 can run `shared-types` alone first.
- Keep the `Promise<UpdateBlockerChoice>` seam, blocker kinds and choices unchanged. While a worker awaits the seam it releases its pool slot and re-acquires one before resuming. Re-verification stays Story 3.4's (failed → incident stays queued, marked "still blocked" with reason).
- Migration/restart failures: unchanged (`failed` row, no incident, nobody blocked or rolled back).
- `cancel-run`: no unstarted service starts; in-flight services finish their current step (no subprocess killed) and stop before the next; pending incidents close as cancelled; rows for them are `skipped`.
- Store: `incidents: UpdateIncident[]` + module-level `Map<incidentId, resolver>`; `resolveUpdateIncident(id, choice)`; `liveServiceIssues` keep working per service. A second launch during a run is rejected as today (3.16).
- UI: first incident auto-opens the popup only if the developer is in the Update zone; later ones never steal focus/input (toast + pending count on the Update tab and zone header). Popup lists every incident (service, kind, age) beside the selected one's guided menu; `↑/↓` select, `Enter` opens its menu, `Esc` closes without resolving; a key and a command-bar entry reopen it. Services with a pending incident show an "awaiting you" status (glyph + colour, extends the 3.6 closed set). `q` confirmation names pending and in-flight counts. Queue list goes through `BoundedList`; popup registered in `dialog-registry.tsx`.
- Setting `update.concurrency` (int, min 1, default 3) in the global settings screen (zod optional-with-default); the final commit flips the effective default from 1 to 3.

**Ask First:** Any change to `GroupUpdateRepoResult`/`UpdateBlocker` shapes beyond additive fields; where the setting lives if neither General nor a new Update tab fits.

**Never:** Kill subprocesses on cancel; per-service concurrency overrides; change CLI flags; add a bounded-rendering exemption.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean parallel | 5 services, N=3 | ≤3 in flight, rows in config order | N/A |
| Same repoPath | 2 targets, one path | Never concurrent | N/A |
| Incident | Service dirty mid-run | Pauses, slot freed, others continue, incident queued | Re-verify fails → "still blocked" |
| Late incident | Popup closed/other zone | Toast + count, focus untouched | N/A |
| Cancel run | Incident choice `cancel-run` | In-flight finish step, rest `skipped`, queue emptied | N/A |
| Worker throws | Port rejects | That service `failed`, pool continues | Never rejects |

</frozen-after-approval>

## Code Map

- `src/core/scripts/group-update.ts` -- `groupUpdateAll` (L292) / `groupUpdateEdt` (L459) sequential loops → pool; `updateWithLoadedManifest` (~L735) hosts blocker seam (`askSeam`, `resolveDirtyBlocker`, `settlePreexistingMidState`) and phase boundaries where cancel is checked; `GroupUpdateParams` gets `concurrency`.
- `src/core/scripts/run-pool.ts` (new) -- `runPool`, slot release/re-acquire helper, per-repoPath serialisation; `run-pool.test.ts` with fake ports.
- `src/adapters/driving/tui/store/slices/update-slice.ts` -- `updateBlocker` (L99), `pendingBlockerResolve` (L293), seam wiring (L674), `finally` cleanup (L776), `runGroupUpdate` (L607).
- `src/adapters/driving/tui/zones/update/update-zone.tsx` -- blocker modal (L1042), blocker keys (L591), `setZoneInputCaptured` (L494), footer context (L418), quit confirm.
- `zones/update/update-zone.logic.ts`, `update-service-box.logic.ts` -- status glyph set, incident formatting, footer input.
- `src/adapters/driving/tui/shared/dialog-registry.tsx`, `shared/bounds/` -- popup registration, `BoundedList`.
- `src/core/ports/settings.ts`, `adapters/driven/settings/schema.ts`, `shared/settings-screen.tsx`, `store/slices/settings-slice.ts` -- `update.concurrency`.
- `keybindings/keybindings.ts` (+ test `EXPECTED`), `footer-contexts.ts`, command registry -- reopen-incidents key/command.
- `app-shell.test.tsx` (L433) -- mock store fields to update.

## Tasks & Acceptance

**Execution** (one commit each, this order, suite green after each):
- [x] `core/scripts/run-pool.ts` + `group-update.ts` -- pool at `concurrency=1` replacing both loops; results in config order; cancel flag -- no behaviour change
- [x] `run-pool.ts` -- per-repoPath serialisation, `ordering` stages hook, slot release during seam wait, step-boundary cancel checks -- parallel safety
- [x] `update-slice.ts` -- incident queue store, `resolveUpdateIncident`, awaiting status, toast, counts, cleanup in `finally` -- state
- [x] `update-zone.tsx` + new incident-queue popup component, registry, footer/keybinding/command, `q` confirmation -- UI
- [x] settings port/schema/screen/slice -- `update.concurrency` wired into `runGroupUpdate`
- [x] flip default to 3; update existing tests relying on sequential order; Ink smoke tests + bounded-rendering for popup

**Acceptance Criteria:**
- Given N=3 and 5 clean services, then ≤3 run at once and the summary lists all five in configuration order.
- Given a blocker on one service, then only it waits, its slot is reused, and other incidents may be resolved in any order.
- Given `Esc` on the popup, then incidents and paused services remain and a key reopens it.
- Given `cancel-run`, then unstarted services are skipped, in-flight ones stop after their current step, queue is empty at summary.

## Spec Change Log

- Implementation note: with a pool of one, a waiting blocker keeps its slot (strictly sequential and blocking, as before); slot release on pause applies only when `concurrency > 1`. At any concurrency a cancelled run now yields a `skipped` / `run-cancelled` row for every unstarted service (previously absent), so the summary accounts for all targets.

## Design Notes

Slot release: wrap `onUpdateBlocker` per worker — `release(); try { await seam(b) } finally { await acquire() }`. A resumed worker queues behind waiting ones, so re-verification and the continuing pipeline run only once it regains a slot.

## Verification

**Commands:**
- `npm test` -- expected: all green (incl. bounded-rendering guard, keybindings tests)
- `npx tsc --noEmit` -- expected: no errors
- `npm run lint` -- expected: no errors (if the script exists)

## Suggested Review Order

**Pool and core pipeline**

- Entry point: bounded pool with keys, stages, slot release and cancel.
  [`run-pool.ts:55`](../../../src/core/scripts/run-pool.ts#L55)

- Both sequential loops replaced; cancel and seam wrapping wired per worker.
  [`group-update.ts:358`](../../../src/core/scripts/group-update.ts#L358)

- Seam wrapper releases the slot only when the pool is wider than one.
  [`group-update.ts:455`](../../../src/core/scripts/group-update.ts#L455)

- Step-boundary cancel checks inside the per-service pipeline.
  [`group-update.ts:800`](../../../src/core/scripts/group-update.ts#L800)

**Incident queue state**

- Incident store: resolvers by id, still-blocked, cancel-run fan-out.
  [`update-slice.ts:640`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L640)

- Seam implementation raising incidents and toasts.
  [`update-slice.ts:725`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L725)

**Popup and zone wiring**

- Popup list beside the selected incident's guided menu.
  [`update-incidents-dialog.tsx:1`](../../../src/adapters/driving/tui/zones/update/update-incidents-dialog.tsx#L1)

- List/menu key handling, Esc semantics, `i` reopen.
  [`update-zone.tsx:640`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L640)

- Awaiting status precedence.
  [`update-zone.logic.ts:34`](../../../src/adapters/driving/tui/zones/update/update-zone.logic.ts#L34)

**Setting**

- `update.concurrency` model, schema and General-tab row.
  [`settings.ts:36`](../../../src/core/ports/settings.ts#L36)

**Tests**

- Pool unit tests.
  [`run-pool.test.ts`](../../../src/core/scripts/run-pool.test.ts)

- Parallel pool use-case tests.
  [`group-update.test.ts`](../../../src/core/scripts/group-update.test.ts)

- Incident queue store tests.
  [`update-slice.test.ts`](../../../src/adapters/driving/tui/store/slices/update-slice.test.ts)
