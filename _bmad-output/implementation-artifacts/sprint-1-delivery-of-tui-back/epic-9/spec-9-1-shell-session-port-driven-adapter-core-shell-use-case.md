---
title: 'Shell Session Port, Driven Adapter & core/shell Use-Case'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '72dc5611d92c226768b90cb403b65e934f924b5c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The upcoming terminal view (Story 9.4) needs to run commands in a service's repo dir or inside its container, but no command-execution seam exists, and `child_process` must stay confined to driven adapters.

**Approach:** Add a line-oriented `ShellSessionPort` (AD-22), a driven adapter running each command through `sh -c` (service) or `docker exec` without `-t` (container), and a `core/shell` session use-case that tracks cwd, enforces one run at a time, retains bounded output and returns `Result` without ever rejecting. No TUI wiring in this story.

## Boundaries & Constraints

**Always:** use-cases return `Result` from `src/core/result.ts` and never reject or throw; error codes are kebab-case; adapter executables (`sh`, `docker`) are injectable factory params, like `createRestartPort(shell)` / `createContainerPort(executable)`; children run with stdin `ignore` (never a TTY) and env `TERM=dumb PAGER=cat GIT_PAGER=cat`; result-union files keep imports as their first statements.

**Ask First:** adding any dependency (e.g. a PTY lib); changing an existing port or `process.ts` behaviour used by other adapters.

**Never:** PTY/interactive programs; `child_process` imported from `src/core` or `src/adapters/driving`; wiring into `tui.ts`/`main.ts` or any UI (Stories 9.2/9.4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Run (service) | `echo a; echo b >&2` | lines `{stream:'stdout',text:'a'}`, `{stream:'stderr',text:'b'}` streamed; settles `{status:'exited', exitCode:0}` | N/A |
| Non-zero exit | `exit 3` / `false` | settles `exited`, exitCode 3 / 1; cwd unchanged | not an error |
| cd | `cd sub` then `pwd` | second run executes in `<repo>/sub` | N/A |
| Bad cd | `cd nope` | stderr line from sh, exitCode ≠ 0, cwd unchanged | N/A |
| Cancel | `sleep 30` then `cancel()` | process group killed (incl. grandchildren); settles `{status:'cancelled'}` | idempotent; no-op when idle |
| Container down | container target, health ≠ `up` | `err('container-not-running')`, nothing spawned | health `err` propagated as-is |
| Concurrent run | `run` while a run is active | `err('command-running')` | N/A |
| Long output | > `maxLines` lines | snapshot keeps last `maxLines`, `droppedCount` = N, marker `N lines dropped` | N/A |
| TTY program | `vim x`, `less f`, `top`, bare `ssh host`, bare `sh`/`bash` | `err('tty-required', hint)`, nothing spawned | N/A |
| Blank command | `''` / `'   '` | `ok({status:'noop'})`, nothing spawned | N/A |
| Blank repo path | session created with `''` | `err('invalid-repo-path')` | N/A |
| Spawn failure | executable missing | settles `{status:'failed', error:{code:'shell-unavailable'}}` | never rejects |

</frozen-after-approval>

## Code Map

- `src/core/result.ts` -- `Result<T>`, `ok()`, `err(code, message, details?)`; only discriminant is `ok`.
- `src/core/ports/docker.ts` -- style to mirror: `LogLine`/`LogStreamTag` (`'stdout'|'stderr'`), callback streaming + idempotent stop (L25-46); `getContainerHealth(c): Promise<Result<'up'|'down'|'restarting'>>` reused for the container-running check.
- `src/core/ports/restart.ts` -- small port shape example.
- `src/adapters/driven/restart/index.ts` -- `createRestartPort(shell='sh')`, runs `sh -c` in `repoPath`; model for the service half.
- `src/adapters/driven/container/index.ts` + `index.test.ts` -- injectable `docker` executable; `makeStubDocker` stub-script test seam (logs `"$@"` to `argv.log`).
- `src/adapters/driven/docker/index.logic.ts:14` -- `createLineSplitter` (drops empty lines, no tail flush) — do not reuse; the new splitter must flush the tail on close.
- `src/adapters/driven/process.ts` -- `streamProcess` line splitting (`indexOf('\n')`, strip `\r`, flush tail); no process-group handling exists anywhere — read-only reference, do not modify.
- `src/core/logs/index.test.ts:12` -- inline-fake idiom (`vi.fn` capturing callbacks); no shared core test helpers.
- `src/core/service-actions/index.ts:127` -- `hasContainer` (container name comes from `Manifest.container`).
- `.dependency-cruiser.cjs` + `dependency-cruiser.config.test.ts` -- only two rules today; none forbids `child_process` in core.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/shell-session.ts` -- define `ShellTarget` (`{kind:'service', repoPath}` | `{kind:'container', container}`), `ShellLine {stream, text}`, `ShellRunOutcome` (`exited{exitCode, cwd?}` | `cancelled` | `failed{error}`), `ShellRunHandle {cancel(): void; done: Promise<ShellRunOutcome>}` (`done` never rejects), and `ShellSessionPort.run(target, cwd: string|undefined, command, onLine): ShellRunHandle` -- the AD-22 seam, PTY-replaceable.
- [x] `src/core/shell/line-buffer.ts` + test -- pure bounded ring buffer: `push`, `snapshot(): {lines, droppedCount}`, `markerText(n)` → `"N lines dropped"` -- output retention.
- [x] `src/core/shell/tty-guard.ts` + test -- pure `detectTtyCommand(command)` over the first word of each `;`/`&&`/`||`/`|` segment (denylist: vi, vim, nvim, nano, emacs, less, more, man, top, htop, watch; ssh/sh/bash/zsh/python/node/psql/mysql/redis-cli when given no further args) returning a hint string or null -- fail fast instead of hanging.
- [x] `src/core/shell/index.ts` + test -- `createShellSession({shell, docker}, target, {maxLines=5000})`: `Result<ShellSession>`; `ShellSession.run(command, onLine): Promise<Result<ShellRunOutcome|{status:'noop'}>>`, `cancel()`, `cwd()`, `isRunning()`, `output()` (buffer snapshot); validates per matrix, checks container health before spawning, updates cwd only from an `exited` outcome carrying `cwd`, tested against an inline fake port.
- [x] `src/adapters/driven/shell-session/index.ts` (+ `index.logic.ts` for pure parts) + tests -- `createShellSessionPort({shell='sh', docker='docker'})`: wraps the command as `<cmd>\n__rc=$?; printf '\n%s%s\n' '<nonce-sentinel>' "$PWD"; exit $__rc`; service → `spawn(shell, ['-c', wrapped], {cwd, detached:true})`; container → `spawn(docker, ['exec', ...(cwd ? ['-w', cwd] : []), container, 'sh', '-c', wrapped], {detached:true})`; splits stdout/stderr into lines (strip `\r`, flush tail), strips the sentinel line and reports its path as `cwd`; `cancel()` → `process.kill(-pid,'SIGTERM')`, SIGKILL after 2 s, settles `cancelled`; spawn error → `failed{shell-unavailable}`. Tests: real `sh` in a mkdtemp dir (stream tags, exit code, cd/bad cd, cancel kills a grandchild, tail flush, sentinel hidden) and the stub `docker` script (argv incl. `-w`, no `-t`/`-i`).
- [x] `.dependency-cruiser.cjs` + `dependency-cruiser.config.test.ts` -- add `no-child-process-outside-driven-adapters` forbidding `^(node:)?child_process$` from `^src/(core|adapters/driving)(/|$)`, with a test case -- makes the AD-22 confinement enforced rather than conventional.

**Acceptance Criteria:**
- Given any matrix scenario, when run through `ShellSession`, then the returned `Result`/outcome matches the matrix and no promise rejects.
- Given a cancelled run, when `done` settles, then no process from that run is still alive.
- Given `npm test && npm run typecheck && npm run depcheck`, then all pass.

## Design Notes

The cwd sentinel is printed on stdout with a per-session random nonce so user output cannot spoof it. It is emitted from an EXIT trap installed before the command (survives `exit`, `set -e`, a trailing backslash); only a fatal signal skips it, in which case cwd is kept. Container cancel kills the local `docker exec` client; without `-t`, the in-container process may outlive it — accepted limitation of the no-PTY decision, documented in the adapter header.

## Verification

**Commands:**
- `npm test` -- expected: all green, new shell tests included
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no violations

## Suggested Review Order

**Port contract (AD-22)**

- Entry point: line-oriented, PTY-replaceable seam; `done` never rejects.
  [`shell-session.ts:38`](../../src/core/ports/shell-session.ts#L38)

- Outcome union the core and future view branch on.
  [`shell-session.ts:19`](../../src/core/ports/shell-session.ts#L19)

**Session use-case (core/shell)**

- Validation, container health gate, one-run-at-a-time, cwd tracking.
  [`index.ts:39`](../../src/core/shell/index.ts#L39)

- Deleted cwd resets to repo path instead of bricking the session.
  [`index.ts:83`](../../src/core/shell/index.ts#L83)

- Cancel also covers the pending health check.
  [`index.ts:116`](../../src/core/shell/index.ts#L116)

- Heuristic fail-fast for TTY programs (wrappers, redirections, flags).
  [`tty-guard.ts:196`](../../src/core/shell/tty-guard.ts#L196)

- Bounded retention with dropped counter; capacity clamped.
  [`line-buffer.ts:24`](../../src/core/shell/line-buffer.ts#L24)

**Driven adapter (process lifetime — highest risk)**

- EXIT-trap sentinel reports cwd even after `exit`, `set -e`, trailing `\`.
  [`index.logic.ts:11`](../../src/adapters/driven/shell-session/index.logic.ts#L11)

- `sh -c` vs `docker exec -e … -w`, never `-t`/`-i`.
  [`index.ts:100`](../../src/adapters/driven/shell-session/index.ts#L100)

- Detached spawn puts each run in its own process group.
  [`index.ts:201`](../../src/adapters/driven/shell-session/index.ts#L201)

- Pipe-drain grace settles runs whose background jobs hold the pipes.
  [`index.ts:274`](../../src/adapters/driven/shell-session/index.ts#L274)

- Cancel: SIGTERM group, SIGKILL after 2 s; no-op once exited.
  [`index.ts:279`](../../src/adapters/driven/shell-session/index.ts#L279)

- App-exit hook kills every tracked group.
  [`index.ts:66`](../../src/adapters/driven/shell-session/index.ts#L66)

- Line splitter: tail flush, 8192-char cap.
  [`index.logic.ts:28`](../../src/adapters/driven/shell-session/index.logic.ts#L28)

- Sentinel filter hides the trailer and keeps stdout/stderr order.
  [`index.logic.ts:76`](../../src/adapters/driven/shell-session/index.logic.ts#L76)

**Peripherals**

- New depcruise rule makes `child_process` confinement enforced.
  [`.dependency-cruiser.cjs:32`](../../.dependency-cruiser.cjs#L32)

- Rule test asserts the rule exists and the driven fixture was cruised.
  [`dependency-cruiser.config.test.ts:182`](../../dependency-cruiser.config.test.ts#L182)

- Real-`sh` adapter tests: cancel kills grandchildren, signals, pipe drain.
  [`index.test.ts:1`](../../src/adapters/driven/shell-session/index.test.ts#L1)

- Core tests against an inline fake port, covering the whole I/O matrix.
  [`index.test.ts:1`](../../src/core/shell/index.test.ts#L1)
