---
title: 'Stale Lock Recovery (Story 2.10)'
type: 'feature'
created: '2026-08-24'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: 'pending'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-24.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When the TUI lock file records a PID that is no longer alive (crashed/killed session), the tool treats it as still-held, permanently blocking every future launch until manual lock file deletion. Conversely, when a genuinely running TUI instance exists, there is no automated way to replace it — the developer must manually `kill` and `rm` the lock file.

**Approach:** Extend NFR-6/AD-9 mechanism 1 (single-TUI enforcement) with two auto-recovery flows:
1. **Stale-pid auto-reclaim** — dead PID lock is silently removed so the TUI starts normally
2. **Live-PID takeover prompt** — developer is prompted to kill and replace an existing instance

This closes the v1 gap where a dead-pid lock blocks every future launch forever, while preserving the existing live-PID guard and non-TTY script/CI behavior.

</frozen-after-approval>

## Boundaries & Constraints

**Always:**
- Lock file at `XDG_STATE_HOME/tui-back/locks/tui.lock` contains `{pid, timestamp}`
- `isPidAlive(pid)` uses `process.kill(pid, 0)` — if it throws, PID is dead
- Non-TTY (script/CI) path is completely unchanged: immediate refusal, exit 1, no prompt
- CLI subcommands are never affected — AD-9 mechanism 1 is scoped to TUI launch only
- Lock release on successful acquisition replaces the old lock file atomically

**Never:**
- Delete the lock file out from under a process whose PID is still alive
- Fall through to lock acquisition after a failed signal (permission denied → exit 1)
- Show the takeover prompt on non-TTY stdin/stdout

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stale lock (dead PID) | Lock file has `pid: 999999` (process gone) | Stale lock auto-reclaimed, TUI starts normally, new lock created | N/A |
| Live PID detected | Lock file has `pid: <real-pid>` (process running) | Prompt shown: "Another TUI instance is already running (PID X, started at Y). Would you like to kill the existing process and take over? (y/n)" | If no input or decline → exit 1, nothing killed/deleted |
| Developer confirms takeover | User enters `y` or `yes` | SIGTERM sent to existing PID, wait 3s, force SIGKILL if still alive, then acquire lock, TUI starts | If signal fails (permission denied) → report failure, exit 1, never delete lock under process |
| Developer declines | User enters `n` or `no` (or timeout) | Exit 1 with "Another TUI instance is already running", nothing killed, nothing deleted | N/A |
| Non-TTY (script/CI) | stdin not a TTY | Immediate refusal, "tui-back-tui requires an interactive terminal", exit 1, no prompt | N/A |
| Cannot signal PID | Permission denied killing existing PID | Failure reported to stderr, exit 1, lock file preserved (not deleted out from under process) | Never delete lock after failed signal |

## Code Map

- `src/adapters/driving/tui/single-instance.ts:12-58` — `acquireTuiLock()`: EEXIST handler now auto-reclaims dead PID, recursively retries; returns `null` only for live PID
- `src/adapters/driving/tui/single-instance.ts:52-59` — `readLockFile()`: exported for use by `tui.ts`
- `src/adapters/driving/tui/single-instance.ts:61-67` — `isPidAlive()`: unchanged
- `src/bin/tui.ts:1-129` — TUI entry point: prompts for live-PID takeover; non-TTY guard preserved; prompt flow for AC2-AC4

**Tasks & Acceptance**

**Execution:**
- [x] `single-instance.ts` — stale-pid auto-reclaim added (auto-remove dead-lock, recursive retry) — closes AC1
- [x] `single-instance.test.ts` — stale-dead-PID test updated to expect valid lock return — verifies AC1
- [x] `tui.ts` — live-PID prompt flow added (AC2-AC4): prompt, confirm, signal, force-terminate, exit handling
- [x] `tui.ts` — non-TTY guard preserved at top of entry point (AC5)
- [x] `single-instance.test.ts` — live-PID test still expects `null` when PID alive

**Acceptance Criteria:**
- AC1: Given stale lock (dead PID), when TUI launches, then stale lock auto-reclaimed and TUI starts normally — no prompt, no manual deletion
- AC2: Given live PID detected, when TUI launches in interactive terminal, then prompt shown naming PID and start time, offering to kill and take over
- AC3: Given prompt shown and developer confirms, then existing process signaled (SIGTERM), waited briefly, force-terminated if needed, then lock acquired and TUI starts normally
- AC4: Given prompt shown and developer declines, then exit 1 with "Another TUI instance is already running", nothing killed, nothing deleted
- AC5: Given stdin not a TTY (script/CI), when lock held by live PID, then immediate refusal, exit 1, no prompt shown
- AC6: Given developer confirms but cannot signal PID (permission denied), then failure clearly reported, exit 1, never delete lock under process
- AC7: Given CLI subcommand invoked while TUI holds lock, then never affected by this story — stays scoped to TUI launch path only

**Verification**

**Commands:**
- `npm test` — expected: all suites green, single-instance tests include the new stale-dead-PID auto-reclaim test
- `npm run typecheck` — expected: `tsc --noEmit` clean
- `npm run depcheck` — expected: no boundary violations (stories touch `adapters/driving/tui` only)

**Manual checks (if no CLI):**
- `tui-back-tui` in a real TTY with stale lock file (dead PID): TUI starts normally, lock auto-reclaimed
- `tui-back-tui` in a real TTY with live PID: prompt appears offering takeover
- `tui-back-tui` in a script (non-TTY) with any lock: immediate refusal, exit 1

**Suggested Review Order**

**Stale-lock auto-reclaim flow**
- `single-instance.ts:41-47` — EEXIST handler: dead PID → unlink lock → recursive acquire — [`source`](single-instance.ts#L41)

**Live-PID prompt flow**
- `tui.ts:57-95` — top-level non-TTY guard, then `acquireTuiLock()`, on `null` → read lock file → prompt — [`source`](tui.ts#L57)
- `tui.ts:45-54` — `promptTakeover()`: reads stdin for `y/n` answer — [`source`](tui.ts#L45)
- `tui.ts:17-43` — `killProcess()`: SIGTERM → wait 3s → SIGKILL fallback — [`source`](tui.ts#L17)

**Component wiring**
- `single-instance.ts:20-29` — lock file creation with `O_CREAT | O_EXCL | O_WRONLY` — [`source`](single-instance.ts#L20)
- `single-instance.ts:61-67` — `isPidAlive()` using `process.kill(pid, 0)` — [`source`](single-instance.ts#L61)

</frozen-after-approval>