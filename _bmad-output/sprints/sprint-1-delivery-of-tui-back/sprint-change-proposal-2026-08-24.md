---
date: 2026-08-24
trigger: User-reported friction — "Another TUI instance is already running" blocks relaunch with no easy recovery
mode: incremental
status: approved
---

# Sprint Change Proposal — Recover From an Already-Running TUI Instance

## 1. Issue Summary

Max reported: when the TUI is already running and he tries to launch another instance (`node src/bin/tui-back-tui.mjs`), the tool refuses with "Another TUI instance is already running" — and there's no easy way to kill the current instance to unblock a relaunch.

Investigation against the current codebase (branch `story-2-9-edts-zone-create-switch-modify`, on top of `epic-2-edt-workspace-management`) found this is more than a UX gap:

`src/adapters/driving/tui/single-instance.ts` implements AD-9 mechanism 1 (single-TUI enforcement, NFR-6) via an exclusive-create lock file at `XDG_STATE_HOME/tui-back/locks/tui.lock`. Its stale-lock handling has a **documented v1 limitation**: when the lock file records a pid that is no longer alive (a prior TUI session crashed or was killed without releasing the lock), `acquireTuiLock` still returns `null` — i.e. it is treated identically to a genuinely-held lock:

```
if (existingLock && isPidAlive(existingLock.pid)) {
  return null;
}
return null;  // <- dead pid falls through here too
```

This is pinned by the adapter's own test: `'returns null for stale lock (dead PID) - v1 treats as held'` (`single-instance.test.ts:65`). In practice this means **a crashed TUI session permanently blocks every future launch** until someone manually deletes the lock file — no in-tool recovery exists today. This is very likely what Max hit, and it's strictly worse than the "kill the running instance" case he described, because there's no running instance to kill at all — just an inert file.

The second, narrower case is the one Max named explicitly: a *genuinely* running TUI instance blocks a second launch with no in-tool way to replace it, forcing a manual `kill <pid>` in another terminal.

**Discovery:** user-reported friction during day-to-day EDT workspace management, investigated and confirmed against the source before scoping.

## 2. Impact Analysis

**Epic impact.** Epic 1 (owner of NFR-6 / Story 1.7's per-resource lock primitive) is closed and merged into `devlopment` — reopening it would violate the one-branch-per-epic convention (`CLAUDE.md`). Epic 2 (`epic-2-edt-workspace-management`) is the still-open branch (story 2.9 currently `review`, not yet merged into `devlopment`) — the same situation the 2026-08-19 Sprint Change Proposal used to justify appending stories 2.7/2.8/2.9 to Epic 2 rather than reopening Epic 1 or spinning up a new epic. The same reasoning applies here.

→ Scoped as **one new story appended to the still-open Epic 2** (Story 2.10), even though the affected code (`single-instance.ts`, owned by Story 1.11/AD-9 mechanism 1) sits functionally under NFR-6/Epic 1. No FR is added; this refines an existing NFR's implementation.

**Story impact.** No existing `done` story is rolled back or reopened. `single-instance.ts`'s current behavior (refuse silently, no reclaim) is corrected, not reverted — its non-TTY / CLI-never-blocked guarantees are preserved unchanged (see AC5/AC7 below).

**Artifact conflicts.**
- PRD: none directly — NFR-6 ("A second running instance ... is detected and blocked") is satisfied as-is; this story adds *recovery*, it doesn't relax the block.
- Architecture (`ARCHITECTURE-SPINE.md`): no AD text changes. AD-9 mechanism 1's scope ("applies to the interactive TUI process only ... a CLI subcommand invocation is never blocked by an open TUI") is the standing rule this story must keep honoring — restated as AC7.
- UX (`DESIGN.md`/`EXPERIENCE.md`): no existing pattern covers "confirm before killing another process" — this story introduces a small interactive `y/N` confirmation on the TUI's own startup path (before the app shell mounts, so no `modal-dialog` component is needed — it's a plain stdin prompt at the process level, consistent with how the existing refusal message is already a raw `stderr` write, not a rendered Ink screen).
- `epics.md`: new Story 2.10 appended after 2.9, no existing story text changes.
- No impact on deployment, IaC, CI/CD, or test strategy beyond the new story's own test coverage (`single-instance.test.ts` gains the reclaim + kill-prompt cases).

## 3. Recommended Approach

**Selected approach: Option 1 — Direct Adjustment.** One new story appended to the open Epic 2 branch; no rollback, no PRD/MVP scope change.

**Rationale:** this is a bounded, low-risk completion of an already-shipped mechanism (AD-9 mechanism 1) — not a strategic pivot. The stale-lock reclaim closes a real correctness gap (permanent lockout); the kill-prompt is the explicit UX ask. Effort: low. Risk: low — the change is isolated to `single-instance.ts` + `src/bin/tui.ts`'s startup sequence, with no impact on any other zone, port, or use-case.

## 4. Detailed Change Proposal

### 4.1 Story 2.10 — Recover From an Already-Running TUI Instance

**New story 2.10 (sketch — expanded to full dev-ready spec at build time, per the 2.7/2.8/2.9 precedent):**

As a developer,
I want the TUI to help me resolve a blocked launch instead of only refusing it,
So that a stale lock from a crashed session never locks me out permanently, and killing a genuinely running instance to replace it takes one keystroke instead of a manual `kill`/`rm` of the lock file.

**Acceptance Criteria:**

**Given** the TUI lock file records a pid that is no longer alive (a prior session crashed or was killed without releasing the lock)
**When** a developer launches the TUI
**Then** the stale lock is detected and automatically reclaimed, and the TUI starts normally — no prompt, no manual deletion of the lock file (closes the v1 gap where a dead-pid lock blocks every future launch forever)

**Given** the TUI lock file records a pid that is still alive (a genuinely running TUI instance)
**When** a developer launches a second TUI instance in an interactive terminal
**Then** the tool prompts, naming the existing instance's pid and start time, offering to kill it and take over

**Given** that prompt
**When** the developer confirms
**Then** the tool signals the existing process to terminate, waits briefly for it to release the lock, force-terminates it if it hasn't exited in time, then acquires the lock and starts normally

**Given** that prompt
**When** the developer declines (or gives no input)
**Then** the tool exits 1 with today's "Another TUI instance is already running" message, unchanged — nothing is killed, nothing is deleted

**Given** stdin/stdout is not an interactive TTY (a script or CI invocation)
**When** the lock is held by a live pid
**Then** no prompt is ever shown — it refuses immediately with today's message and exit code 1, exactly as now

**Given** the developer confirms killing the existing instance
**When** the tool lacks permission to signal that pid (e.g. it's owned by another user)
**Then** the failure is clearly reported and the tool exits 1 — it never falls through to deleting the lock file out from under a process it failed to actually stop

**Given** a CLI subcommand (non-TUI)
**When** invoked while a TUI holds the lock
**Then** it is never affected by this story — AD-9 mechanism 1 (single-TUI enforcement) stays scoped to the interactive TUI's own launch path only

**Implementation notes:** touches `src/adapters/driving/tui/single-instance.ts` (stale-pid reclaim; expose enough of the lock-conflict state — pid, timestamp, live/dead — for the caller to decide) and `src/bin/tui.ts` (the `y/N` prompt + kill/wait/retry sequence, gated on `process.stdin.isTTY`, already checked one line above the existing lock-acquire call). No new port/adapter family, no Zustand store change — this is composition-root-level, before the app shell mounts. Extends NFR-6 / AD-9 mechanism 1; no new FR.

## 5. Sprint Status / Backlog Update

- Add `2-10-recover-from-an-already-running-tui-instance: backlog` under `epic-2` in `sprint-status.yaml`, after `2-9-edts-zone-create-switch-modify`.
- `epics.md`: insert Story 2.10 (full text above) after Story 2.9, before the `## Epic 3` heading.

## 6. Implementation Handoff

**Scope classification: Minor.** Bounded, single-file-pair change with no cross-cutting or architectural impact.

**Route to: Developer agent (`bmad-build` / `bmad-agent-dev`)**, on a new branch `story-2-10-recover-from-an-already-running-tui-instance` cut from `epic-2-edt-workspace-management`, per `CLAUDE.md`'s one-branch-per-story convention. Story 2.9 is currently `review` and unmerged — Story 2.10 branches from the epic branch, same as 2.7/2.8/2.9 did, and is free to proceed independently (no dependency on 2.9's review outcome; it touches disjoint files).

**Success criteria:** all 7 ACs above hold; `npm test && npm run typecheck && npm run depcheck` green; existing `single-instance.test.ts` case `'returns null for stale lock (dead PID) - v1 treats as held'` is updated to assert reclaim instead (the v1 limitation it pins is exactly what this story closes) — do not leave it green-but-contradicting the new behavior.
