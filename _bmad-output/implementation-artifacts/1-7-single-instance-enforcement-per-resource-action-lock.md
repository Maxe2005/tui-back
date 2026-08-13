---
title: 'Single-Instance Enforcement & Per-Resource Action Lock'
type: 'feature'
created: '2026-08-13'
status: 'review'
review_loop_iteration: 0
followup_review_recommended: true
context: [1-6-static-module-registry, 1-5-explicit-repo-registry]
warnings: []
deferred: []
baseline_revision: 'e411032'
baseline_commit: 'e411032'
---

<intent-contract>

## Intent

**Problem:** Today every state-mutating write races. `src/adapters/driven/registry/index.ts:75` `addRegistry` is a read-modify-write (`listRegistry` → check → `writeFile`) with **no atomicity and no lock** — two concurrent `register` invocations (or a `register` racing a `reset`) can each read the pre-write list and the second `writeFile` **silently drops the first's registration**. That TOCTOU is explicitly assigned to Story 1.7 by `_bmad-output/implementation-artifacts/deferred-work.md` ("Story 1.7 owns locking/atomicity; spec 'Never' list excludes locking here"). The PRD's `single-instance enforcement` Cross-Cutting NFR (PRD §Cross-Cutting NFRs, line 360) says concurrent writers must be blocked — never allowed to race.

**Approach (two mechanisms per AD-9, `ARCHITECTURE-SPINE.md` §AD-9):**

1. **Per-resource advisory action lock (the deliverable of THIS story).** A reusable, **cross-process** advisory-lock mechanism. Core declares where it goes (`LockPort` + a `withActionLock` helper), a new driven adapter (`src/adapters/driven/lock/`) implements the actual cross-process file-based lock (the adapter owns fs — AD-1). Every **state-mutating core use-case** acquires a short-lived lock scoped to the resource it writes (for `register`/`reset`, that is the `registry.yaml` file) before its write and releases it afterwards — so two concurrent CLI invocations, or one CLI racing the TUI's in-flight action later, are **serialized or rejected** instead of corrupting state. This closes the `addRegistry` TOCTOU and is the groundwork Epic 2+ consumes for EDT/repo writes (AD-9).

2. **Single-TUI enforcement (mechanism 1 of AD-9).** The interactive TUI does not exist until Story 1.11 (Permanent App Shell). Enforcing a "second TUI refuses to start" lock against a process that cannot start yet is meaningless, so **this story defers mechanism 1 to Story 1.11** — but it records AD-9's hard scope invariant so it is never mis-built: the TUI lock applies to the **interactive TUI process only** and a CLI subcommand invocation is **never** blocked by an open TUI (see Boundaries & Constraints → Defer).

The lock mechanism ships reusable and correct now so that (a) the only genuinely reachable state-mutating paths today (`register`, `reset`) stop racing, and (b) later epics get the primitive without re-deriving it.

## Boundaries & Constraints

**Always:**
- **AD-1**: `core/` never imports from `adapters/` and contains no `fs`. Restated for this story: file locking is **adapter infrastructure**. Core declares the *contract* (a port + a helper function that takes the port and a callback), the driven `lock` adapter implements the filesystem mechanics. Core use-cases call `withActionLock(lockPort, resourceKey, work)` — they never touch `fs` themselves. depcheck enforces the boundary; imports first (acorn landmine, deferred-work.md).
- **AD-9 scoping is the heart of this story.** The per-resource lock serializes writers to a *specific resource* and releases after the action. It is **short-lived and advisory**: it guards cooperating tool processes, it does not fence against non-tool actors. Do **not** build a whole-binary/global "single instance" lock this story (that is mechanism 1, deferred to Story 1.11) — a global lock would be self-defeating for the CLI's supported hand-run pattern (AD-2/AD-9).
- **AD-3**: every use-case returns `Result<T>` with kebab-case `error.code`. A lock acquisition failure that is a real contention/error must surface as a `Result` error (`...-lock-...` code), never throw (the `dispatch.ts` catch-all may only ever handle bugs, not expected lock contention).
- Reuse the existing envelopes/dispatch — do not reinvent `renderResult`/`internal-error`.
- NodeNext imports (`../foo.js`), imports first, functional style (no classes), zod 4.4.3 + yaml 2.9.0 pinned; kebab-case files/ids/error codes, `PascalCase` types, `camelCase` functions; ULIDs for generated ids, ISO 8601 dates.
- **`reset` is a degenerate case.** `resetRegistry` only mutates `registry.yaml` in two branches (missing-file initial write, or corrupt-file recovery). Wrap its writes in the same lock as `register` so a `register --reset` racing a `register` cannot interleave.

**Defer (design decision, D-defer-1):**
- **Single-TUI enforcement (AD-9 mechanism 1)** — buildable only once a TUI process exists (Story 1.11). Record the invariant for 1.11: TUI acquires/releases a TUI-scoped lock on startup; the check fires only for a second **interactive TUI**; CLI subcommand invocations are never gated on it. If the dev agent for THIS story believes mechanism 1 must ship now, HALT and ask — it is not buildable against a process that does not exist.

**Block If:**
- A need surfaces to lock resources that do not exist yet (EDT SQLite files, git working trees, per-service state) — those are Epic 2+ resources. This story locks the **registry.yaml file** (the only real writer today) via the reusable mechanism, and *demonstrates* the mechanism generic-shaped (`lock on an arbitrary resource key`) so later epics reuse it without rework. Do not fabricate EDT/git lock targets just to have more call sites.

**Never:**
- No whole-binary/global/process-wide lock (that is mechanism 1 = TUI, not per-resource).
- No lock that blocks a CLI hand-invocation because a TUI (or another CLI run) is alive for a *different* resource — the lock is keyed to the specific resource only.
- No new runtime dependency. `mkdir`-based exclusive-file locking is atomic and dependency-free (reliable POSIX+network tolerances); do not add `proper-lockfile`/`write-file-atomic`/`fs-safe` unless a review proves `mkdir` insufficient (it is sufficient here).
- No change to `RegistryPort`'s public method signatures (`list/add/exists/scan/reset`) in a way that breaks existing callers/tests — the lock is acquired by the **core use-case** (`registerRepo`/`resetRepo`), not buried inside the adapter, so core owns the action lifecycle per AD-9's wording ("a state-mutating use-case ... acquires").
- Do NOT silently drop a lost update: `addRegistry` already returns clean `Result` errors — the lock must never turn a race into silent data loss, but contention that is a genuine concurrent-writer collision should surface (`action-in-progress` / lock error), not corrupt.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| `register` happy path (no concurrent writer) | `register /m/a` on a writable registry | Acquires lock on registry resource, adds path idempotently, releases; `{ok, data:{path}}` | lock errors surface as `Result` not throw |
| Two concurrent `register` on the same resource | two processes call `register` for the same registry simultaneously | After both settle, **both** paths are present in `registry.yaml` — serialized, never a lost update | If a second writer is refused (rather than queued), it returns a lock contention `Result` error; never corruption |
| `register` races `register --reset` | one adds `/m/b`, another resets the registry file concurrently | Both writes are serialized; the file is never half-written / torn; final content is one of the two coherent outcomes, not garbage | lock error if contended-and-rejected |
| Register while another action holds the lock (reject mode tested) | lock already held on the registry resource | Serialized* or rejected with an `...-lock-...` "action in progress" error — never a race, never corruption | `Result` error, exit 1, no throw |
| Deterministic order under lock | N writers serialized | Registry preserves the same FR-1 byte-idempotent order rules (no intervening change → identical output) | n/a |
| Acquire fails (e.g. lock dir create error) | registry config dir unwritable | Clear kebab-case error naming the resource and reason | `Result` error |
| `reset` on missing file (initial write path) | `register --reset /m/a`, no registry file | Takes the lock, writes the initial `{repos:[path]}`, releases | lock error on write failure |
| `reset` on corrupt file (recovery path) | `register --reset /m/b`, corrupt registry | Takes the lock, backs up `registry.yaml.bak-<ts>`, re-initializes, releases | lock error on write/backup failure |
| Lock released after success AND after failure | action throws/returns err after acquiring | Lock is released in a `finally`-equivalent — no leaked lock wedges future actions | release errors logged/absorbed, never surface as the action's error |
| Stale lock from a dead/crashed holder | holder killed while holding the lock | A waiter detects the dead holder (recorded pid no longer alive) and reclaims; future actions are not permanently wedged | reclaim is serialized so two waiters cannot both reclaim and both proceed |

## Code Map

(Target files. `CREATE` adapter is lock-provider infra; core changes are minimal and contract-shaped.)

- `src/core/ports/lock.ts` -- **NEW**. The lock contract core consumes. `interface LockPort { acquire(resourceKey: string): Promise<Result<LockHandle>> }` where `LockHandle` owns a `release(): Promise<Result<void>>`. `resourceKey` is a stable, caller-derived string (for register/reset: the absolute `registryFile` path). Core never sees a filename-mechanics concern beyond the opaque key. Keep it portable-shaped so Epic 2+ locks EDT ids / repo paths with the same call.
- `src/core/locking.ts` (or `src/core/scripts/with-action-lock.ts`) -- **NEW**. A pure helper `withActionLock<R>(lock: LockPort, resourceKey: string, work: () => Promise<Result<R>>): Promise<Result<R>>` that: `acquire` → on failure return that `Result`; run `work`; always `release` (even on `work` error — `finally`); if release fails, return the *work* result but do not mask it with a release error (release failure is a non-fatal diagnostic unless the work itself also failed). Zero fs, zero adapters imports (AD-1). Imports-first; beware the acorn generic-union landmine (deferred-work.md) — the `Result<R>` union return shape means imports MUST be the file's first statements.
- `src/adapters/driven/lock/index.ts` -- **NEW**. The cross-process advisory lock implementation (mkdir strategy, atomic, no deps). Public `createLockPort(lockDir: string): LockPort` plus (for testability/ determinism) a lower-level pure-ish `acquire/withLock` keyed on `join(lockDir, <sanitized key> + '.lock')`. Holds lock for the action's duration; records owner metadata (pid + timestamp) inside the lock dir so a **dead holder is reclaimable** and a live holder is waited/shorter-timed out. `release` removes the lock dir. **Must not import from `core/` types beyond the port's own shape is fine here because it implements the port — but it declares the lock key derivation itself (adapter owns fs/paths).** Imports first (acorn).
- `src/adapters/driven/lock/index.test.ts` -- **NEW**. Integration tests against real temp dirs (AD-13): acquire/release round-trip; a second `acquire` while held is contended; dead-holder (recorded pid not alive) is reclaimed; release-after-error; two sequential actions don't interfere; a stale lock does not permanently wedge a later acquire.
- `src/core/scripts/register.ts` -- **UPDATE**. `registerRepo(registry, lock, path)`: after arg validation and canonicalization, `withActionLock(lock, registryFileKey, () => registry.add(canonical))`. Core must receive the lock + the resource key from the caller — but AD-1/`LockPort` is a *core port* so this is fine. Resolution of the registry-file absolute path happens in the composition root (driving side) so core still holds no fs path. The **resource key** is passed in as a plain string by the caller (the driven registry adapter's resolved file path). No change to `RegistryPort`.
- `src/core/scripts/register.test.ts` -- **UPDATE**. Fake `LockPort` asserts: happy path acquires+locks around `add`, releases after; add-failure still releases, error propagates; acquire-failure returns the lock error and never calls `add`.
- `src/core/scripts/reset.ts` -- **UPDATE**. Mirror register: wrap `registry.reset(path)` in the same `withActionLock` on the same registry resource key.
- `src/core/scripts/reset.test.ts` -- **UPDATE**. Fake-lock assertions (wrap + release-on-error + acquire-fail short-circuit) for `resetRepo`.
- `src/adapters/driving/cli/subcommands.ts` -- **UPDATE (composition)**. `buildSubcommands` gains a `lock` dependency + a `registryResourceKey` (the resolved registry file). Pass both into `registerRepo`/`resetRepo`. This is wiring only; no behavior change.
- `src/bin/main.ts` -- **UPDATE (composition root)**. Construct `LockPort` (e.g. under `XDG_STATE_HOME/tui-back/locks/` or a sibling of `registry.yaml`) and pass it + `registryFile` key into `buildSubcommands`. This is where the registry-file path (already available via `resolveRegistryFile`) binds as the resource key.
- `src/adapters/driving/cli/subcommands.test.ts` / any driving tests -- **UPDATE** as needed for the new deps (assert the wrappers pass lock+key through).
- `src/adapters/driven/registry/index.ts` -- **REVIEW/UPDATE only for atomicity parity**. The lock is acquired by core, so `addRegistry` itself does not lock. *Do* review that `addRegistry`'s read-modify-write is internally consistent once serialized (it is — the lock makes the R-M-W atomic). Optionally introduce a temp-file + `rename` atomic write so a torn `writeFile` cannot leave a corrupt file even absent contention **— do this only if it does not break existing registry tests; it is a hardening add, not required by the ACs.** If added, keep the existing error codes (`registry-write-error`) and tests green.
- `src/bin/tui-back.e2e.test.ts` -- **REVIEW/UPDATE**. Black-box concurrency: spawn two `register` subprocesses racing the same `XDG_CONFIG_HOME`/registry and assert **both** paths survive (serialization, no lost update) — the strongest end-to-end proof of the ACs. Keep the JSON-envelope/exit-code assertions per AD-3.

## Tasks & Acceptance

**Execution:**
- `git` -- branch `story-1-7-single-instance-enforcement-per-resource-action-lock` from `epic-1-foundation-navigation-shell`; all work + commits on it; `--no-ff` merge only after code review. Conventional commits with `(story 1.7)` in the subject. Confirm `epic-1` is already `in-progress` in sprint-status.yaml (it is).
- `src/core/ports/lock.ts` -- NEW port + `LockHandle` type. Declared in `core/` (a port, AD-1-compliant). Functional shape, no classes.
- `src/core/locking.ts` (or `core/scripts/with-action-lock.ts`) -- NEW `withActionLock` helper. Imports first (acorn landmine — it returns `Result<R>`).
- `src/adapters/driven/lock/index.ts` -- NEW mkdir-based cross-process lock adapter. Owner metadata (pid, timestamp) in the lock dir; dead-holder reclaim; acquire timeout; release via `finally`-style cleanup by the core helper. Zero new dependencies.
- `src/core/scripts/register.ts` + `reset.ts` -- UPDATE: wrap the state-mutating `registry.add`/`registry.reset` call in `withActionLock`.
- Composition -- UPDATE `subcommands.ts` (register/reset wrappers receive lock + resource key from `buildSubcommands` deps) and `main.ts` (construct `LockPort`, pass `registryFile` as the resource key).
- Tests -- `driven/lock/index.test.ts` (adapter behavior), `core/scripts/register.test.ts` + `reset.test.ts` (fake lock: wrap/release-on-error/acquire-fail), `e2e.test.ts` (two racing `register` subprocesses → both paths persisted; rejected-contention path if a reject mode is implemented).
- Gates -- `npm test && npm run typecheck && npm run depcheck`; AD-1 round-trip (inject a `core → adapters` import in the new `core` files, confirm `no-core-to-adapters` fires, remove it).
- Commit -- atomic conventional commits, `(story 1.7)` in subject.

**Acceptance Criteria (from epics.md Story 1.7, verbatim):**
- AC1 — Given the TUI is already running, When a developer starts a second TUI instance, Then it detects the running instance and refuses to start with a clear message, And a CLI invocation is never blocked by this (AD-9). *(Mechanism 1 — buildable only with a TUI; see D-defer-1. Satisfied for THIS story by recording the AD-9 invariant + delivering mechanism 2; the literal TUI check is Story 1.11. State this explicitly in the story so the dev agent does not fake a TUI.)*
- AC2 — Given the TUI is closed, When a developer runs a CLI subcommand by hand, Then it starts normally regardless of prior TUI state. *(Trivially guaranteed today — there is no TUI; the per-resource lock never gates on any process-liveness, so a CLI run always starts. Covered by the adapter/e2e tests: two sequential CLI runs do not interfere.)*
- AC3 — Given a state-mutating use-case scoped to an EDT id or repo path, When it begins, Then it acquires a short-lived advisory lock on that resource before writing, releasing it once done. *(Implemented for the one real resource today — registry.yaml — via `register`/`reset`; mechanism is generic for EDT/repo keys later.)*
- AC4 — Given a second action targeting the same EDT/repo while the first holds its lock, When attempted, Then it is serialized or rejected with an "action already in progress" message — never allowed to race. *(Implemented: lock contention on the registry resource surfaces as a lock-conflict `Result` error or serializes; the e2e racing-register test proves no lost update.)*

## Dev Notes

- **Read the files being modified before changing them:** `src/adapters/driven/registry/index.ts` + `index.test.ts` (the TOCTOU + all existing registry tests), `src/core/scripts/register.ts`/`reset.ts` + tests, `src/adapters/driving/cli/subcommands.ts`, `src/bin/main.ts`, `src/bin/tui-back.e2e.test.ts`. Preserve every existing behavior those tests assert — this story adds serialization, it does not change what a successful register/reset produces.
- **The lock is a core-port + driven-adapter split (D-lock-1, AD-1).** Do NOT put `fs`/mkdir in `core/`. Core declares `LockPort` + `withActionLock`; the driven `lock` adapter implements acquisition. The composition root resolves the lock directory and the registry resource key. This mirrors the exact RegistryPort/manifest pattern from Stories 1.5/1.4.
- **Why mkdir-locking and no dependency (D-lock-2):** `mkdir` on the lock dir succeeds for exactly one process (EEXIST for everyone else) — atomic even on networked FS where `O_EXCL`/`open('wx')` can be flaky; no npm dependency to pin/audit; it releases by `rmdir`. Owner metadata (pid + timestamp) lets a waiter reclaim a lock whose recorded pid is no longer alive (a crashed/killed CLI would otherwise wedge every future action forever). This is the mechanism precedent from the research (see References) and matches AD-9's "short-lived adversarial advisory lock". Re-evaluate only if a review demonstrates a real gap.
- **Contention policy is a design decision to make consciously (D-lock-3):** choose and document one of (a) **serialize** (wait with a timeout, then proceed) or (b) **reject-fast** (if the lock is held and not stale, return immediately with `action-in-progress`). Prefer **serialize-with-timeout + reject-on-stale-wait** for the short CRUD writes here (register/reset are microseconds; waiting briefly is friendlier and preserves the lost-update guarantee), but a reject path must still exist so AC4's "rejected" wording is honor-able. Whichever is chosen, encode it in the adapter and assert it in tests. Default recommendation: `retryDelayMs≈50`, `timeoutMs≈5000`, stale-holder reclaim by dead pid — decode from the References' mkdir-lock pattern.
- **Release must be guaranteed (D-lock-4).** `withActionLock` must `release` in a `finally` after `work()`, whether work succeeded or errored. A leaked lock on the success path of a commit would wedge all future register/reset. Test the error-path release explicitly.
- **Error-code conventions:** new kebab-case codes belong in the I/O matrix and the Change Log, matching the Story 1.5/1.6 precedent. Suggested: `lock-acquire-error` (unexpected acquire failure), `action-in-progress` (contention rejected), `lock-release-error` (release failure — non-fatal diagnostic). Align exact codes with what the adapter returns and document them.
- **Determinism / FR-1:** serialized writers must preserve byte-idempotent registry output (no intervening change → identical). The lock only excludes a concurrent write; it never reorders a single writer's own list. Iterate/assert determinism in the registry tests.
- **CLI/TUI parity (AD-2):** the TUI will call the same `registerRepo`/`resetRepo` in-process later and therefore inherit the same lock. Do not special-case the CLI path.

### Project Structure Notes

- New driven folder `src/adapters/driven/lock/` aligns with AD-1's driven-adapter family (like `registry/`, `xdg/`, `manifest/`). A lock on `registry.yaml` naturally sits beside the files it guards; a future per-EDT/repo lock uses the same adapter keyed by EDT url/repo path.
- Lock directory placement: put lock dirs under `XDG_STATE_HOME/tui-back/locks/` (transient state, per AD-7's state tier) or beside the guarded file. Choose one, document it, and keep the adapter's `createLockPort(lockDir)` taking the dir as a parameter so tests use temp dirs. The composition root (main.ts) resolves it via `resolveXdgPaths()`.
- No `src/core/` change beyond the new `ports/lock.ts` + `withActionLock` helper and the register/reset wrap; the sink (registry) stays an adapter.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md#Story-1.7` (lines 335-358)] — user story + AC1-AC4 verbatim.
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md#AD-9` (lines 125-129)] — two mechanisms: TUI-only instance lock + per-EDT/repo advisory action lock; CLI never blocked; release semantics. Also `.memlog.md` lines 39-46 (rescoped AD-9 story).
- [Source: same spine §AD-1 (lines 63-81), §AD-2 (83-87), §AD-3 (89-93), §AD-7 (113-117)] — AD-1 boundary (core no fs/adapters), AD-2 parity (TUI in-process, no self-spawn), AD-3 envelope, AD-7 state tier (`XDG_STATE_HOME` for transient state).
- [Source: `_bmad-output/planning-artifacts/prds/prd-tui-back-2026-08-10/prd.md` line 360] — single-instance enforcement NFR (concurrent writers unsafe).
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — "addRegistry TOCTOU read-modify-write, no atomic write/locking ... Track: Story 1.7 owns locking/atomicity"; "no whole-binary/global lock" & acorn/imports-first landmines (story-1-3 section).
- [Source: `_bmad-output/implementation-artifacts/1-6-static-module-registry.md`, `1-5-explicit-repo-registry.md`] — prior-story patterns: driven-adapter-owns-filesystem, error-matrix conventions, AD-1 round-trip, Review Triage Log format.
- [Source (tech, web 2026): kamiazya/whiteboard `mkdir-lock.ts` (github.com/kamiazya/whiteboard/blob/main/packages/mcp-server/src/shared/mkdir-lock.ts)] — mkdir-atomic cross-process exclusion + dead-pid reclaim + `.break` serialization precedent; the exact pattern to adapt (drop the `.break` layer only if reclaim correctness is preserved — prefer keeping it). Node docs confirm promise-fs ops are "not synchronized or threadsafe", i.e. the R-M-W needs an external lock.

## Task / Acceptance Traceability

- AC1 (TUI refuses a second instance; CLI never blocked) → deferred to Story 1.11 (D-defer-1); this story records the invariant and is explicitly NOT faking a TUI. Reference ground truth: AD-9 + epics AC1.
- AC2 (CLI runs regardless of TUI state) → guaranteed by mechanism-2-only design; driven-lock adapter + two-sequential-CLI e2e assert a CLI always starts.
- AC3 (state-mutating use-case acquires a short-lived advisory lock before writing, releases after) → Code Map `ports/lock.ts` + `withActionLock` + `register.ts`/`reset.ts` wrap + `driven/lock` adapter + release-in-finally.
- AC4 (second action on same resource serialized/rejected, never raced) → driven-lock contention + `action-in-progress`/serialize policy (D-lock-3) + e2e racing-register (both paths survive).

## Dev Agent Record

### Agent Model Used

(opencode/deepseek-v4-flash-free — story-authored by create-story workflow, 2026-08-13)

### Debug Log References

- Implemented per `bmad-dev-story` (deprecated, invoked by name): red-green-refactor, AD-1 round-trip validated (injected `core → adapters` import fired `no-core-to-adapters`, reverted).
- D-lock-3 chose serialize-with-timeout + reject-on-stale-wait (retryDelayMs=50, timeoutMs=5000). D-lock-4: `withActionLock` releases in a `finally`, never masks the work result.

### Completion Notes List

- Created `src/core/ports/lock.ts` (LockPort + LockHandle contract, AD-1: core declares the port, no fs).
- Created `src/core/locking.ts` (`withActionLock` helper: acquire → run → release in finally; acquire failure short-circuits, release error absorbed, imports first for the acorn generic-union landmine).
- Created `src/adapters/driven/lock/` mkdir-based cross-process advisory lock (createLockPort/acquireLock/releaseLock + helpers): atomic mkdir claim, owner pid+timestamp metadata, dead-holder reclaim, serialize-with-timeout + action-in-progress reject. Zero new dependencies.
- Wrapped `registerRepo`/`resetRepo` (core/scripts) in `withActionLock` on the registry resource key.
- Wired composition: `subcommands.ts` (buildSubcommands gains lock + registryResourceKey deps) and `main.ts` (LockPort under `XDG_STATE_HOME/tui-back/locks`, registry file as resource key).
- Tests: driven/lock/index.test.ts (round-trip, contention→action-in-progress, reclaim of stale lock, no-wedge, per-resource isolation, createLockPort); register/reset.test.ts (fake lock: acquire→release around add/reset, release-on-error, acquire-fail short-circuit); e2e adds two racing `register` subprocesses asserting both paths survive (no lost update).
- Gates: `npm test` (159 pass), `npm run typecheck`, `npm run depcheck` all green; AD-1 round-trip confirmed the boundary rule fires.
- AC1 deferred to Story 1.11 as designed (D-defer-1); AC2/AC3/AC4 satisfied via mechanism 2 + e2e proof.

### File List

- `src/core/ports/lock.ts` (new)
- `src/core/locking.ts` (new)
- `src/adapters/driven/lock/index.ts` (new)
- `src/adapters/driven/lock/helpers.ts` (new)
- `src/adapters/driven/lock/index.test.ts` (new)
- `src/core/scripts/register.ts` (updated)
- `src/core/scripts/reset.ts` (updated)
- `src/core/scripts/register.test.ts` (updated)
- `src/core/scripts/reset.test.ts` (updated)
- `src/adapters/driving/cli/subcommands.ts` (updated)
- `src/adapters/driving/cli/dispatch.test.ts` (updated)
- `src/bin/main.ts` (updated)
- `src/bin/tui-back.e2e.test.ts` (updated)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (updated)
- `_bmad-output/implementation-artifacts/1-7-single-instance-enforcement-per-resource-action-lock.md` (updated)

### Change Log

- 2026-08-13 — Implemented closing the `addRegistry` TOCTOU via a reusable per-resource advisory lock (AD-9 mechanism 2): `LockPort` core port + `withActionLock` helper + mkdir-based driven `lock` adapter; `register`/`reset` now serialize writers on the registry resource instead of racing. New kebab-case error codes: `lock-acquire-error`, `action-in-progress`, `lock-release-error`. Single-TUI enforcement (AD-9 mechanism 1) intentionally deferred to Story 1.11 and recorded (D-defer-1). Status → review.
- 2026-08-13 — Story created by ultimate-context create-story workflow as the next backlog story (1-7) from sprint-status.yaml; intent, mechanisms, code map, and guardrails defined. Single-TUI mechanism deliberately deferred to Story 1.11; per-resource advisory action lock is the deliverable, closing the deferred `addRegistry` TOCTOU.
