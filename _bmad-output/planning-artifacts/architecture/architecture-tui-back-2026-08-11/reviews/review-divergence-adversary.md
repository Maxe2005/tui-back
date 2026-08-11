---
title: Adversarial Divergence Review — ARCHITECTURE-SPINE.md (tui-back)
type: architecture-review
target: ../ARCHITECTURE-SPINE.md
reviewer-lens: two-units-one-level-down divergence
created: 2026-08-11
---

# Adversarial Divergence Review — tui-back Architecture Spine

## Method

For each AD, I constructed at least one pair of concrete, independently plausible "one level down" units (two future stories, or a core module vs. its adapter, or a driving-adapter zone vs. the process lifecycle) and checked whether the spine's own wording lets both units be built to the letter of every AD they touch, yet still integrate incompatibly — clashing shapes, dual ownership of the same fact, ambiguous port contracts, or races on shared state. Only findings where a competent builder reading only the spine (not this review) could genuinely land on either side are kept; trivially-avoidable misreadings are dropped.

Severity: **CRITICAL** (breaks the system, not an edge case), **HIGH** (silent data/behavior divergence in normal use), **MEDIUM** (divergence surfaces under a specific but realistic condition), **LOW** (real but narrow / cosmetic-adjacent).

---

## Finding 1 — CRITICAL: AD-2's "TUI spawns the subcommand" and AD-9's "refuse a second instance" self-deadlock

**Units:**
- **Unit A** — the process-lifecycle module implementing AD-9 (`bin/` entrypoint / a shared startup guard used by every invocation of the `tui-back` binary).
- **Unit B** — the `tui/update/` zone's action handler implementing AD-2/AD-3 for, say, FR-10's group update.

**Unit A, to the letter:** AD-9 says "on startup the tool detects an already-running instance on the same machine and refuses to start a second one." Built literally and generically (the only implementation the spine license: "the concrete technique is an implementation detail with no cross-builder divergence risk worth fixing here" — Deferred section), Unit A puts the instance-check at the top of the binary's shared bootstrap, before dispatch to either the interactive TUI or a subcommand. This is the natural, arguably *only* literal reading of "the tool" refusing "to start" — the check has to run before the tool knows whether it's about to become the interactive TUI or a one-shot subcommand.

**Unit B, to the letter:** AD-2 says "the TUI spawns the identical subcommand a developer would run by hand — never a second, TUI-only implementation of the same action," and AD-3 confirms this is a real process spawn: "the TUI always spawns non-TTY, so it always receives JSON." Built literally, Unit B's group-update trigger does `spawn('tui-back', ['group-update', ...])` as a child process of the running interactive TUI.

**Where they diverge:** the moment Unit B fires, the spawned child process runs Unit A's startup guard, detects the parent TUI's own already-running instance, and refuses to start. Every Must-scope action (FR-1's entire premise) becomes unreachable from inside the TUI the first time it's invoked — not a rare race, a guaranteed, immediate deadlock on the tool's core interaction loop. Both units are individually AD-compliant; nothing in AD-9 scopes "instance" to *interactive* invocations only, and nothing in AD-2 tells Unit A's builder that a spawned subcommand must be exempted from the instance check it's implementing.

**Fix direction:** AD-9 needs an explicit scope: single-instance enforcement applies to concurrent *interactive TUI* sessions (and/or concurrent writers to the same EDT file), not to subcommand processes spawned by an already-permitted running instance. Concretely: either (a) subcommands spawned by the TUI carry a marker/env var that exempts them from the instance guard, or (b) the guard is a per-EDT/per-repo write lock (matching AD-9's own stated *reason*: "two concurrent writers to the same EDT's SQLite file or the same repo's git working tree") rather than a whole-binary lock, which also cleanly resolves Finding 2 below at the same time.

---

## Finding 2 — HIGH: dual, unreconciled sources of truth for "active EDT" (AD-7 vs. AD-10) under AD-2's own CLI-parity guarantee

**Units:**
- **Unit A** — `core/edt`'s switch-EDT use-case (governs FR-6), which per AD-7 persists the active-EDT pointer to `XDG_STATE_HOME/tui-back/state.json`.
- **Unit B** — the interactive TUI's bootstrap/store hydration (governs AD-10), which per AD-10 keeps "active EDT" as part of the one Zustand store, "written to by core use-case results."

**Unit A, to the letter:** AD-7: "Active-EDT pointer and transient UI state ... live at `XDG_STATE_HOME/tui-back/state.json`, never inside a `.db`." Any EDT-switch invocation — critically, including a **CLI-invoked** switch, since AD-2 mandates the CLI and TUI trigger the exact same use-case — writes the new active EDT to `state.json` and exits (for the CLI case).

**Unit B, to the letter:** AD-10: cross-zone state including "active EDT" "lives in one Zustand store, written to by core use-case results." Read literally, the store is populated by the *return value* of use-case calls the TUI itself makes — not by re-reading `state.json` on some cadence.

**Where they diverge:** AD-2 explicitly wants a developer able to run any Must-scope action "as a standalone script from a shell" with the TUI open (that's the whole point of FR-1's parity claim, and Finding 1's fix direction requires this to actually be possible). Nothing in AD-9 (once scoped correctly) or anywhere else says a CLI-invoked EDT switch is disallowed while the TUI runs. So: developer runs `tui-back edt switch <other-edt>` in a second terminal while the TUI is open. Unit A dutifully updates `state.json` — fully AD-7 compliant. Unit B's already-running Zustand store has no mechanism specified anywhere in the spine to learn this happened (no file-watcher AD, no polling rule, no IPC channel) — it keeps showing the stale EDT as active, fully AD-10 compliant at the moment it was written. The TUI now silently diverges from the on-disk truth: a subsequent TUI-triggered action (e.g. a group update fired from the stale zone) could execute against the wrong EDT's branch/member set — precisely the "forgotten-service"/wrong-branch class of bug the PRD's SM-2 and SM-6 exist to prevent.

**Fix direction:** name the reconciliation mechanism explicitly — e.g. an AD stating the TUI process watches `state.json` (fs watch or poll-on-focus) and treats it, not its own last-known Zustand value, as authoritative for "active EDT" on every read; or state that a CLI-invoked EDT switch is disallowed while an interactive instance is running (tightening AD-9's scope the other direction). Either is fine; the spine currently picks neither.

---

## Finding 3 — HIGH: "log buffers" (and in-flight run status) are claimed as owned by two different components with no reconciliation for streaming data

**Units:**
- **Unit A** — `adapters/driven/docker`'s log-streaming implementation of AD-11 ("each `docker logs -f` stream feeds a bounded in-memory ring buffer per service").
- **Unit B** — the Zustand store implementation of AD-10 ("cross-zone state (active EDT, per-service status, log buffers, in-flight run status) lives in one Zustand store, written to by core use-case results").

**Unit A, to the letter:** builds one ring buffer per service inside/behind the docker adapter, sized per AD-11's fire-correlation + scroll-back rule, discarded on restart, never touching disk — satisfies AD-11 and AD-1 (core only sees `ContainerPort`, never `dockerode` directly).

**Unit B, to the letter:** builds "log buffers" as literal state inside the one Zustand store, "written to by core use-case results" — satisfies AD-10's own list, which names "log buffers" as one of the things the single store holds.

**Where they diverge:** AD-10's phrase "written to by core use-case results" describes a request/response pattern (call a use-case, get a result, write it to the store). A `docker logs -f` stream is not a use-case result — it's an unbounded, unsolicited, continuous emission with no natural "call". The spine gives no port/event mechanism for how AD-11's ring buffer (living at/behind the adapter boundary) becomes AD-10's "log buffers" (living inside the Zustand store) without either (a) violating AD-1 by having the store subscribe to the adapter directly, bypassing `core/logs`, or (b) maintaining two separately-bounded buffers — one behind the port, one inside Zustand — that can silently diverge in retention window, trim policy, or content (e.g. a line evicted from the adapter's ring buffer under memory pressure but still shown from the store's copy, or vice versa, breaking FR-22's log/response correlation and FR-16's live-view accuracy). A builder of Unit A and a builder of Unit B, working from the spine alone, have no shared answer for "is there one buffer or two, and who evicts." The identical problem recurs for "in-flight run status" (FR-10/FR-12's per-service progress), which is the same streaming-into-a-result-shaped-store mismatch.

**Fix direction:** add an AD (or extend AD-10/AD-11) naming the single buffer's ownership explicitly, e.g.: "`core/logs` owns the one ring buffer per service (behind `ContainerPort`); the Zustand store holds only a reference/view into it via a subscription core exposes, never a second copy" — and state the same rule for in-flight run status (core emits progress events per completed step; the store accumulates them, it does not "receive a result").

---

## Finding 4 — MEDIUM: AD-8's branch-scope gate doesn't fix who computes "the current EDT's registered branch"

**Units:**
- **Unit A** — `core/edt`'s branch-switch use-case, built on the assumption that it computes the allowed branch (from `EdtStorePort`) and passes it as an explicit parameter into every `GitPort` write call, since AD-1 forbids adapters from reaching into each other and the use-case is the one place that already knows EDT membership.
- **Unit B** — `adapters/driven/git`'s implementation of the same AD-8 gate, built on the assumption that "centrally enforces" means the git adapter itself is the single authoritative checkpoint and therefore queries `EdtStorePort` (or the persistence adapter) directly to look up the current EDT's branch before allowing a write, rather than trusting whatever branch string core happened to pass in.

**Where they diverge:** AD-8 says the enforcement "lives" in `adapters/driven/git` and rejects a write "not the current EDT's own registered branch for that service" — but never says whether that fact arrives *as an argument from core* or is *looked up by the adapter itself*. Both are defensible readings of "centrally enforces." If Unit A ships expecting to supply the allowed branch and Unit B ships expecting to look it up independently, the two either (a) fail to compile/integrate (signature mismatch, easy to catch), or worse (b) both get built with a compatible-looking signature but Unit B silently ignores the passed context and re-queries persistence itself — meaning a git write can be judged against a *different* snapshot of "current EDT" than the one core just used to decide to make the write at all (a TOCTOU-style gap opened by having two independent readers of the same fact at slightly different times), undermining AD-8's own stated purpose ("no call site forgetting the rule").

**Fix direction:** the spine should fix the collaboration shape, not just the enforcement point: e.g. "`GitPort` write methods take the allowed-branch context as a required parameter, computed once by the calling core use-case from `EdtStorePort`; `adapters/driven/git` never queries EDT state itself" (or the reverse, but pick one).

---

## Finding 5 — MEDIUM: AD-3's envelope fixes the outer shape but not the recurring "per-service outcome" inner shape

**Units:** any two of — `core/scripts`' group-update use-case (FR-10/FR-12), the `shared-types` publish use-case (FR-13), and the propagation use-case (FR-15) — each independently emitting `data`/`error.details` per AD-3's outer envelope.

**To the letter:** AD-3 fixes exactly `{"ok":true,"data":{...}}` / `{"ok":false,"error":{"code","message","details"}}` and nothing about the shape of `data` or `details`. Every one of FR-10 ("end-of-run summary accounts for every targeted service by outcome — updated/skipped/failed"), FR-12 (per-service migration failure surfacing), FR-14 (per-service propagation-status view), and FR-15 (per-service propagation outcome) independently needs a "which service, what happened" record. A builder of the group-update use-case can freely choose `data: {services: [{id, status: "updated"|"skipped"|"failed", error?}]}`; a builder of the propagation use-case, reading only AD-3 and FR-15, can just as validly choose `data: {results: {[serviceId]: {ok: boolean, message?: string}}}` — array-of-objects vs. map-keyed-by-id, `status` enum vs. `ok` boolean, `error` vs. `message`. Both are fully AD-3 compliant (the outer envelope matches exactly). Any future cross-cutting consumer — the one `dashboard/` zone AD-15 explicitly permits to read across all core modules for its aggregate view — now has to special-case each command's inner shape instead of rendering one uniform "per-service outcome" row type, and any shared TUI component for "show me a per-service outcome list" (the kind of thing `tui/shared/` is meant to hold per AD-15) can't be written once.

**Fix direction:** name a shared "per-service outcome" record shape (e.g. `{serviceId, status: "updated"|"skipped"|"failed", detail?}`) as part of the Consistency Conventions table, reused by every FR that reports outcomes across a set of services (FR-10, FR-12, FR-14, FR-15), the same way the ULID/ISO-8601/envelope rows already standardize other recurring shapes.

---

## Finding 6 — MEDIUM: manifest `modules` per-module config shape is unspecified for a module with no config

**Units:**
- **Unit A** — `adapters/driven/manifest`'s zod schema for the manifest (governs AD-4).
- **Unit B** — `adapters/driven/modules/shared-types`'s manifest-reading code, which needs to know only *whether* `shared-types-consumer` is active for a repo — it takes no scanner/auth-style parameters, unlike `route-explorer`.

**To the letter:** AD-4's rule gives exactly one worked example — `modules` as "a map of module-id → per-module config, e.g. `route-explorer: {scanner: nestjs-openapi, auth: jose-dev-jwt}`" — a module that genuinely needs structured config. Nothing in AD-4 or AD-5 says what a config-less module's entry looks like. Unit A, generalizing from the one example, can reasonably define the zod schema as `modules: Record<string, Record<string, unknown>>` (every module value is always an object, possibly empty: `shared-types-consumer: {}`). Unit B, reading FR-2's Glossary text ("modules — company- or stack-specific logic that plugs into the generic core via a repo's manifest") and PM's own Notes examples elsewhere in the corpus, could just as reasonably treat presence-as-boolean (`shared-types-consumer: true`) as the natural way to declare an on/off module with no parameters. If Unit A's schema requires an object and a hand-written manifest (or Unit B's own reader) supplies `true`, either the manifest fails zod validation for every repo that activates `shared-types-consumer` the "natural" way, or Unit B's reader silently mis-parses a `{}` as falsy/absent, invisibly deactivating the module — exactly the "onboarding a new repo requires no core code change" guarantee AD-4 exists to protect, undermined by an inconsistency between the schema and one module's own reader.

**Fix direction:** AD-4 should state the invariant generally — "every `modules` entry is a config object, `{}` when the module needs no parameters, never a bare boolean" — closing the ambiguity for every present and future module, not just the one worked example.

---

## Finding 7 — LOW/MEDIUM: `RouteScannerPort`'s route-identity shape is load-bearing in three FRs but fixed nowhere

**Units:**
- **Unit A** — `adapters/driven/modules/route-explorer/nestjs-openapi` (today's only `RouteScannerPort` implementation), which could naturally key each discovered route by the OpenAPI `operationId`.
- **Unit B** — `core/routes`' staleness-detection logic (FR-21: "a saved request whose route is no longer discovered after a rescan is flagged stale") and its affected-service-set learning (FR-22: "that choice is then saved against the route and reused automatically on every later fire").

**To the letter:** AD-5 fixes only that scanner implementations are statically registered by module id; nothing in AD-1's port list or AD-4/AD-5 fixes what a "route" *is* as a value flowing back across `RouteScannerPort` — specifically, its identity key for later comparison. Unit A, built first (and reasonably, since OpenAPI naturally provides one), keys on `operationId`. `core/routes`, built to be scanner-agnostic per AD-5's own stated purpose ("a scanner for a future Java service" should plug in with no core change), can just as reasonably assume the only identity a generic core is entitled to rely on is `{method, path}` — the one thing every HTTP scanner will always have, regardless of language. If `core/routes` is built against `{method, path}` while `nestjs-openapi` treats `operationId` as the real key internally, a rename of an OpenAPI operation with an unchanged `{method, path}` is invisible to core's staleness check (correct by core's contract) but could be treated as a *different* route by a scanner that internally diffs by `operationId` (e.g. for the "genuinely empty vs. scan failure" FR-19 distinction) — a mismatch between what core stores as a saved request's route reference and what a second scanner implementation later (Java/Python, explicitly anticipated by AD-5) considers its own comparison key.

**Fix direction:** fix the `RouteScannerPort` return contract explicitly in the spine (or a companion): canonical route identity is `{method, path}` only; anything scanner-specific (`operationId`, framework metadata) is opaque `details` core never compares on.

---

## Summary Table

| # | Finding | Severity | AD(s) involved |
| --- | --- | --- | --- |
| 1 | TUI-spawned subcommand trips its own single-instance guard | CRITICAL | AD-2, AD-9 |
| 2 | Active-EDT pointer: `state.json` (AD-7) vs. Zustand (AD-10) race under CLI/TUI concurrency | HIGH | AD-2, AD-7, AD-9, AD-10 |
| 3 | Log buffers (and in-flight run status) claimed by both the adapter ring buffer and the Zustand store, no streaming-into-store mechanism named | HIGH | AD-10, AD-11 |
| 4 | Branch-scope gate: allowed-branch context passed by core vs. looked up by the git adapter | MEDIUM | AD-1, AD-8 |
| 5 | No shared "per-service outcome" shape for FR-10/FR-12/FR-14/FR-15 inside AD-3's envelope | MEDIUM | AD-3, AD-15 |
| 6 | Manifest module config shape unspecified for a config-less module | MEDIUM | AD-4, AD-5 |
| 7 | Route identity/canonical key unspecified for `RouteScannerPort` | LOW/MEDIUM | AD-1, AD-4, AD-5 |
