# Architecture Spine Review — tui-back (2026-08-11)

**Reviewer pass:** rubric-walker (checklist-driven review against PRD, DESIGN, technical research, and .memlog.md)
**Target:** `ARCHITECTURE-SPINE.md` (14 ADs numbered 1–15, no AD-numbered-4-is-4... actually 15 ADs, AD-1..AD-15)

## Overall Verdict

**Solid coverage of the six PRD features and most cross-cutting dimensions, but the spine ships at least one direct internal self-contradiction (AD-1 vs. AD-15/tree, on how the `shared-types` TUI zone reaches its logic) and one seriously under-specified interaction (the literal "TUI spawns the subcommand" mechanism vs. AD-1's layering rule vs. AD-9's single-instance enforcement) that a builder cannot resolve without guessing.** These are exactly the kind of divergence points a spine exists to close, and both are fixable with a small amount of added text, not a redesign. Everything else — manifest/module system, storage topology, git-safety gate, testing-by-layer, TUI zone structure, XDG layout, stack versions — is well-formed, enforceable, and correctly grounded in the PRD/DESIGN/research trail. No pre-existing code exists in the repo to ratify (confirmed: no `src/`, no `package.json`), so the spine is free to invent, which it does consistently with the research report's TypeScript/Ink recommendation.

---

## Findings

### Finding 1 — HIGH: AD-1's blanket layering rule is directly contradicted by AD-15 and the directory tree for the `shared-types` zone

**Evidence:**
- AD-1's Rule: *"`adapters/driving/*` (`tui`, `cli`) call `core/` use-cases only — never a driven adapter directly."* The AD-1 mermaid diagram shows `TUI --> UC (core)` and `CLI --> UC (core)` only; there is no edge from either driving adapter to any `driven/*` box.
- The directory tree lists `core/` with exactly four capability folders: `edt/`, `scripts/`, `logs/`, `routes/` (plus `ports/`). **There is no `core/shared-types/`.**
- AD-15's Rule explicitly maps `shared-types/` → `adapters/driven/modules/shared-types` (not to any core module), the one named exception among six zones — every other zone maps to a `core/*` folder.
- The Capability → Architecture Map row for §4.4 lists "Lives in: `adapters/driven/modules/shared-types`, `tui/shared-types/`" — again, no `core/` entry at all.

**Why it's load-bearing:** This isn't an inference — it's the document contradicting itself in plain text. A builder implementing the `shared-types` zone has two authoritative-looking instructions that can't both be followed: AD-1 says every driving adapter must go through a core use-case; AD-15 and the capability map say this one zone talks straight to a driven adapter because no core use-case for it exists. Whichever a builder picks, the other rule reads as violated, and the epics/stories derived from this spine will inherit the ambiguity — one story might invent a thin `core/shared-types` pass-through to satisfy AD-1, another might just wire the zone straight to the adapter per AD-15, and now the codebase has an inconsistent pattern for "how a driving adapter reaches a capability with no dedicated core module."

**Note on root cause:** The PRD glossary actually supports treating `shared-types` propagation as *entirely* a module (unlike the route-explorer, where "route exploration itself is core; [scanner+auth] pairing is what's pluggable" — PRD §4.6). So the *decision* to skip a `core/shared-types` layer may well be correct and intentional. The defect is that AD-1 never states the exception, so the two ADs read as flatly incompatible rather than as "AD-1, with one named exception, AD-15."

**Fix (either is sufficient):**
- (a) Add an explicit carve-out clause to AD-1: *"...except `shared-types`, which the PRD glossary defines as a module in full (no core-owned mechanics) — `tui/shared-types/` is permitted to call `adapters/driven/modules/shared-types` directly, the one deliberate exception to this rule."* — plus update the AD-1 mermaid diagram to show that one edge, or
- (b) Introduce a minimal `core/shared-types` use-case layer (even a thin pass-through) so AD-1 has zero exceptions and AD-15's mapping table changes its `shared-types` row to point at it, matching the other five zones.

---

### Finding 2 — HIGH: The literal "TUI spawns the subcommand" mechanism (AD-2/AD-3) is ambiguous against AD-1's layering rule and creates a plausible self-deadlock against AD-9's single-instance enforcement

**Evidence:**
- The architecture intro says TUI and CLI "both invok[e] the exact same use-cases" — read naturally, this describes two driving adapters each making an **in-process function call** into the same `core/` use-case, which is exactly what AD-1's diagram shows.
- But AD-2's Rule says, twice unambiguously: *"The TUI **spawns** the identical subcommand a developer would run by hand."* AD-3's Rule reinforces it: *"stdout is human-readable text when the process is attached to a TTY... The TUI always **spawns non-TTY**, so it always receives JSON..."* — "spawns" + TTY-detection-of-a-child-process is literal OS-level subprocess forking, not a function call. This reading is confirmed by `.memlog.md` line 10 ("Subprocess boundary (not in-process function call) is what delivers script/CLI parity") and by the technical-research doc's explicit discussion of "out-of-process subprocesses... versus in-process function calls," concluding the subprocess boundary is what delivers the "equally runnable by hand" guarantee.
- If the mechanism really is subprocess-spawning, then `driving/tui` reaching `driven/process` (`ProcessPort`) to do the spawning is a **driving adapter calling a driven adapter directly** — precisely what AD-1 forbids — unless that spawn call is itself wrapped inside a `core/` use-case (spine never says this, and it would be an odd design: the core spawning a copy of its own binary to call itself).
- Separately, and more concretely: AD-9's Rule is stated with no scoping — *"on startup **the tool** detects an already-running instance on the same machine and refuses to start a second one."* If "the tool" means any invocation of the umbrella binary (which AD-2 establishes as the single build target for both TUI and every subcommand), then the TUI's own AD-2/AD-3 mechanism — spawning `tui-back <subcommand>` as a child process while the parent TUI instance is already running — would trigger AD-9's own single-instance check on the child and get refused. Taken literally, **AD-9 would block AD-2/AD-3's own core mechanism from ever executing a single Must-scope action from inside the TUI.**

**Why it's load-bearing:** This is the tool's central architectural bet (FR-1: script/CLI parity via a subprocess boundary), directly touching AD-1 (layering), AD-2/AD-3 (the mechanism itself), AD-9 (single-instance), and AD-12 (the ~150ms interaction budget — subprocess spawn latency is a real, non-trivial cost that a purely in-process call wouldn't pay, so which mechanism is chosen changes whether AD-12 is even achievable). A builder following AD-9's literal text would ship a global lock that makes the TUI unable to run any action at all — a defect that would surface immediately in testing but burns real time to diagnose, and different builders/stories could resolve the ambiguity in incompatible ways before that happens (e.g., one might make CLI subcommands skip the instance check entirely, silently reopening the "two concurrent writers" risk AD-9 exists to prevent).

**Fix:** State explicitly, in AD-9 or in a cross-reference from AD-2/AD-3:
- Whether single-instance detection is scoped to the **interactive TUI session only** (a subcommand invocation — whether spawned by the TUI or run by hand from a separate shell — is not itself "an instance" for AD-9's purposes), and
- What (if anything) actually enforces "no two concurrent writers to the same EDT file / git tree" for the CLI-subcommand-invoked-by-hand-while-TUI-is-running case that AD-9's Prevents clause names, if not the instance lock itself (e.g., a narrower per-EDT or per-repo lock).
Also resolve, in AD-1 or AD-2: does `driving/tui` call `core/` in-process and separately, elsewhere, expose the identical logic as a CLI subcommand (two driving adapters, one core call each — matching the diagram) — or does `driving/tui` literally fork `driving/cli`'s process (which needs a stated, AD-1-compliant path through a core-owned "script runner" that owns the `ProcessPort` call)?

---

### Finding 3 — MEDIUM: AD-13's testing strategy is silent on `adapters/driving/cli` — the layer that carries FR-1's entire parity guarantee

**Evidence:** AD-13 assigns a testing approach to `core/` (Vitest, fake ports), `adapters/driven/*` (integration tests), the Zustand store (direct tests), and `adapters/driving/tui` (Ink `render()` smoke tests only, with an explicit accepted-tradeoff rationale). **`adapters/driving/cli` is never mentioned.**

**Why it matters:** `driving/cli` is not a trivial pass-through in this architecture — it's the literal implementer of AD-3's output envelope (TTY-vs-non-TTY detection, the `{ok, data}` / `{ok:false, error:{code,message,details}}` JSON shape, the 0/1 exit-code contract) for every one of the ~15+ Must-scope subcommands. That envelope is the mechanism FR-1's "TUI and hand-invocation get identical, machine-parsable results" consequence depends on, and (per Finding 2) it may also be the literal transport the TUI itself depends on. Leaving its test strategy unstated is a real gap at this altitude, not a detail to defer — a wrong TTY-detection branch or a malformed JSON edge case in one subcommand would silently break both hand-invocation scripting *and* the TUI simultaneously, and nothing in AD-13 assigns anyone to test for that.

**Fix:** Add one clause to AD-13, e.g.: *"`adapters/driving/cli` gets contract tests against the AD-3 output envelope — TTY vs. non-TTY stdout shape, exit codes, JSON schema — run against each subcommand; these can run as `core/`-level tests with the CLI's thin arg-parsing/envelope-formatting layer exercised directly, no real subprocess spawn required."*

---

### Finding 4 — MEDIUM: FR-10's "second group-update run is rejected while one is already in progress" has no clearly assigned architectural owner

**Evidence:** FR-10's consequence: *"A second group-update run is rejected while one is already in progress, in either scope."* The only state-tracking mechanism named for "in-flight run status" is AD-10's Zustand store — explicitly TUI-only, in-memory. AD-9 (single-instance) is the only other candidate mechanism, but per Finding 2 its scope (TUI-only vs. every invocation) is itself unresolved.

**Why it matters:** If a developer triggers a group update via the TUI and then, independently, runs `tui-back run group-update` by hand from a second terminal (a scenario FR-1's whole premise explicitly invites — "equally runnable by hand"), what stops the second one from starting? The Zustand store can't see it (it's a separate process's in-memory state); AD-9 may or may not apply (Finding 2). No AD assigns a durable, cross-process "a group update is in flight for this scope" flag (e.g., a lock file or a row in `global.db`/the EDT's own `.db`). This is a real correctness gap in the one architectural dimension (concurrent script execution) the spine otherwise treats carefully everywhere else (AD-8's branch-scope gate, AD-9's instance lock).

**Fix:** Either fold this into the Finding 2 fix (state that CLI-subcommand concurrency is *not* exempted from AD-9's lock, so the instance lock genuinely covers it — accepting the tradeoff that a hand-run script can't overlap a TUI-triggered one of the same kind) or add a narrow, explicit rule: an in-flight group-update run is recorded in a durable, cross-process location (e.g., a lock row/file scoped to the run's target: the EDT's own `.db` for EDT-scoped runs, a tool-wide lock for all-repos maintenance mode) and checked by every entry point, not just the TUI's in-memory store.

---

### Finding 5 — LOW (observation, not a defect): No error-code taxonomy convention for AD-3's `error.code` field

**Evidence:** AD-3 fixes the *shape* of the failure envelope (`{"ok":false,"error":{"code":"...","message":"...","details":{...}}}`) but the spine never constrains what strings populate `code` (casing convention, a closed enum vs. free-form per-script strings, whether codes are namespaced by capability). The Consistency Conventions table covers file/type/function naming but not error-code naming.

**Why it's low severity:** Unlike Findings 1–4, divergent error-code naming across scripts doesn't break anything structurally — it's a cosmetic/DX inconsistency (e.g. one script emitting `GIT_CONFLICT`, another emitting `git-conflict-detected`), not a contradiction or a missing capability. Worth a one-line convention (e.g., `SCREAMING_SNAKE_CASE`, namespaced by domain: `GIT_BRANCH_PROTECTED`, `MIGRATION_FAILED`) if the spine author wants full coverage of the "naming/error conventions" dimension, but reasonable to leave to the first story that emits an error code, if the team prefers to keep the spine terse.

---

## Checklist Walkthrough (summary)

| Checklist item | Verdict |
| --- | --- |
| Fixes real divergence points for the level below, misses none | **Partial** — strong on manifest/storage/git-safety/testing-by-layer/TUI-structure; misses the subcommand-execution mechanism itself (Finding 2) and cross-process run-concurrency (Finding 4) |
| Every AD's Rule is enforceable and prevents its divergence | **Mostly yes** — AD-1 is contradicted elsewhere (Finding 1); AD-9's Rule text is enforceable as written but its scope is unstated, so it under- or over-prevents depending on reading (Finding 2) |
| Nothing in Deferred is secretly load-bearing | **Yes** — reviewed all 9 deferred items; none create cross-builder divergence risk on inspection. (The single-instance-*mechanism* deferral is fine; it's the single-instance *scope* — not deferred, stated in AD-9 itself — that's the actual problem, see Finding 2.) |
| Named tech is verified-current | **Reads as checked** — `.memlog.md` line 33 logs an explicit web-verification pass with per-package sources/dates and even a self-correction (research doc's "Ink 6" → verified "Ink 7.1.1"), which is exactly the kind of trail that indicates real verification rather than copied-forward guesses. Not re-verified here per instructions. |
| Ratifies rather than contradicts existing project reality | **Pass** — confirmed no `src/`, `package.json`, or any implementation code exists anywhere in the repo; this is genuinely greenfield, nothing to have ratified instead. |
| Covers all 6 PRD features / FRs | **Pass** — all FR-1..FR-23 appear in the frontmatter `binds` list and are traceable through the Capability → Architecture Map; spot-checked FR-9 (branch/divergence visibility) and FR-17 (regex filter) as the least-obviously-covered ones and both are adequately reachable via existing ports/ADs without needing a dedicated AD. |
| Every altitude-owned dimension is decided/deferred/open | **Mostly yes** — deployment/env (AD-14, AD-9), data architecture (AD-7), state management (AD-10), testing (AD-13, but see Finding 3), security/git-safety (AD-5, AD-6, AD-8), naming/error conventions (Consistency Conventions table, but see Finding 5 for the one sub-gap) |
| Stays terse, build-substrate not prose | **Pass** — 15 ADs, one table each for conventions/stack/capability-map, a 9-item Deferred list; no unnecessary narrative or seed detail found |

---

## Conclusion

Recommend the spine go back for one more reconciliation pass focused narrowly on Findings 1 and 2 (both concern the same underlying question: exactly how does a driving adapter reach a capability, and what governs concurrent execution of that mechanism) before epics/stories are derived from it — these are cheap to fix now and expensive to discover mid-implementation, since they sit at the foundation every other capability is built on. Findings 3 and 4 are worth folding into the same pass since they're symptoms of the same unresolved mechanism. Finding 5 is optional polish.
