---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-tui-back-2026-08-10/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md
  - _bmad-output/planning-artifacts/epics.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-11
**Project:** tui-back

## Document Inventory

### PRD

**Whole document:**
- `prds/prd-tui-back-2026-08-10/prd.md` (status: final, updated 2026-08-10)

### Architecture

**Whole document:**
- `architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md` (status: final, updated 2026-08-11)

### Epics & Stories

**Whole document:**
- `epics.md` (stepsCompleted: [1,2,3,4], 6 epics, 35 stories — just produced by `bmad-create-epics-and-stories`)

### UX Design

**bmad-ux spine pair:**
- `ux-designs/ux-tui-back-2026-08-10/DESIGN.md` (visual identity — Atelier, status: final)
- `ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md` (behavior/IA, status: final, inherits DESIGN.md)

## Issues Found

- **Duplicates:** none — each document type exists in exactly one whole-document form; no sharded/whole conflicts.
- **Missing documents:** none — PRD, Architecture, Epics & Stories, and UX are all present.

## PRD Analysis

### Functional Requirements

FR-1: Script/CLI parity for every action. A developer can invoke any Must-scope action (repo update, migration, propagation, health check) either through the TUI or as a standalone script from a shell, with identical effect. Consequences: running an action's underlying script directly reproduces exactly what triggering it from the TUI does — no TUI-only side effect exists; each script emits a structured, machine-parsable result (exit code + structured output); running any script twice in a row with no intervening state change produces no additional side effects (idempotency).

FR-2: Per-repo manifest declares identity and active modules. The tool only acts on a repo that carries a manifest; the manifest declares that repo's service identity and which modules are active for it. Consequences: a repo with no manifest is invisible to every tool action (excludes `micro-bookings` with no special-case code); adding a new managed repo, or changing which modules are active on an existing one, requires only a manifest change, no core code change. `[NOTE FOR PM]` manifest schema deferred to Architecture (now resolved: `.tui-back.yaml` + zod, AD-4).

FR-3: Create an EDT. A developer can create a new EDT by giving it a topic and manually selecting its member services from the set of managed repos. `[ASSUMPTION: manual selection at creation time — no auto-detection mechanism]`. Consequences: EDT persists across restarts; each member service's working branch is recorded once first touched; topic must be unique among existing EDTs; at least one member service required at creation; a service can be a member of more than one EDT, each tracking its own branch independently.

FR-4: Create dev branches for EDT member services. At EDT creation, a developer can have the tool create a working branch in each selected member service, based on `development` by default or another chosen base branch, named either as one shared name across all selected services or individually per service. Consequences: branch creation is optional at EDT-creation time; one base-branch choice and one naming mode apply to the whole creation action; a branch the tool creates becomes that service's registered branch for the EDT; a per-service branch-creation failure is reported per service and does not abort creation for the others.

FR-5: Modify an EDT after creation. A developer can add or remove member services from an existing EDT, and change a member service's working branch, after the EDT has been created. Consequences: adding a service does not require recreating the EDT or disturbing other members' state; changing a service's branch follows the same protected-switch rule as FR-6; removing an EDT's last remaining member service is allowed (EDT can exist with zero members); a branch change to a protected branch is rejected per FR-7's rule.

FR-6: Switch the active EDT without data loss. A developer can switch the active EDT at any time; the tool auto-preserves any uncommitted work in every affected repo of the outgoing EDT before switching. Consequences: no uncommitted change in any EDT-member repo is ever lost by a switch; exactly one EDT is active at a time; on switch, every managed service is evaluated against the newly active EDT's membership — a member service is checked out to its registered branch, a non-member service is switched to `development` per FR-8, regardless of that service's membership in a different, currently inactive EDT; if a group update (FR-10) is running on the outgoing EDT, the switch is blocked by default with a prompt to stop the running update; returning later to that EDT shows it was interrupted and offers to re-run it.

FR-7: An EDT never claims a shared branch. Assigning a shared/protected branch (`development`, preprod, prod) as an EDT's "own" branch for a service is rejected. Consequences: attempting to register a protected branch fails with a clear explanation, before any git write happens.

FR-8: Non-member managed repos stay on `development`. While an EDT is active, every managed repo that is not one of its member services is kept on `development` (or its configured shared branch). Consequences: activating or switching to an EDT checks every non-member managed repo's current branch and switches it back if not already there; this switch follows the same no-data-loss guarantee as FR-6; the tool fetches a non-member repo's `development` before switching to it if not already present locally.

FR-9: Branch and divergence visibility. Every managed service is displayed with its current branch and how far that branch has diverged from its own origin/upstream, in both directions. Consequences: displayed divergence shows both ahead and behind counts without running `git status`/`git log` by hand; a branch with no configured upstream, or checked while offline, shows an explicit "no upstream" / "unknown (offline)" state rather than a numeric value; applies to every managed service, EDT member or not.

FR-10: Run a group update, EDT-scoped or all-repos. A developer can run a group update — pull `development`, run migrations, restart containers — against either the active EDT's member services (default) or explicitly against all managed repos regardless of EDT (maintenance mode). Consequences: all-repos mode is always explicitly invoked, never the default, and requires an explicit confirmation step; the end-of-run summary accounts for every targeted service by outcome (updated/skipped/failed); a group update on an EDT with zero member services is a no-op with an explicit message; a second group-update run is rejected while one is already in progress, in either scope.

FR-11: Assisted resolution of merge conflicts / dirty state. When a group update hits a repo that isn't cleanly updatable, the tool auto-resolves already-known-safe cases and otherwise guides the developer through a bounded menu, then re-verifies before continuing. Consequences: if only `package.json`/lockfile are dirty, resolved the same way as `update_repo.sh` today, without prompting; for any other dirty/conflicted state, a menu is presented (stash / open in editor / cancel this repo / cancel the whole run); after the developer acts, the tool re-checks the repo's state before resuming; a repo already mid-merge/mid-rebase is detected as its own distinct case, surfaced before the guided menu applies. Out of scope: the tool never resolves a real merge conflict's content automatically, and never commits or discards changes without explicit developer action.

FR-12: Per-service migration failure handling. When a migration fails during a group update, the tool surfaces which service, which migration, and the error output, and lets the developer re-trigger just that service's migration after a fix. Consequences: a migration failure on one service does not block or roll back updates that already succeeded on other services; re-running a fixed migration re-verifies success before that service is marked caught up; repeated failures on the same migration are surfaced the same way each time, no retry limit or escalation path enforced in v1.

FR-13: Publish a new `shared-types` version. A developer can publish a new `shared-types` version through the tool, which runs the `shared-types` repo's existing `npm run v` script (bump → build → publish → push). Consequences: a failure at any step is surfaced with which step failed; a re-trigger re-verifies before marking the version published; a re-trigger after a partial failure resumes from the failed step rather than restarting from bump, avoiding a duplicate version bump or a publish conflict.

FR-14: See propagation status without a manual check. The tool shows, for the active EDT's member services, which are on the latest published `shared-types` version and which aren't. Consequences: shown without running `npm ls`/checking `package.json` by hand; status reflects the latest published version, not a cached one, at the moment it's viewed; a member service that doesn't declare `shared-types-consumer` is omitted.

FR-15: Propagate to chosen services. A developer can propagate the new version to some or all of the active EDT's eligible member services in one action. Consequences: the tool stages the dependency bump (package.json/lockfile) and installs it per service; the tool never commits or pushes any staged change without explicit developer approval; a propagation failure on one service is independently retriable and doesn't block the others.

FR-16: Aggregated live log stream. A developer can view a single, live, aggregated log stream from every service in the active EDT, or a chosen subset. Consequences: log-stream re-renders are debounced/batched rather than triggering a full redraw per line, from day one; a service with no running container, or whose container stops/crashes mid-stream, is shown as such; the tool attempts to reconnect automatically when it returns.

FR-17: Filter the aggregated stream. The stream can be filtered by service, by free-text/regex search `[ASSUMPTION: regex support specifically]`, and by log level, without restarting it. Consequences: applying or changing a filter does not interrupt the live stream; a regex filter that doesn't compile is rejected with an inline error, not silently ignored or crashing the view.

FR-18: Inline service health. Service health (up/down/restarting) is visible inline with the log view. Consequences: a failing service's health status is visible in the same view as its logs, without a separate health check step; restarting a failing service is a developer-triggered action from this view, replacing `check_health.sh`'s silent auto-restart; a restart request on a service already restarting is a no-op — the control is disabled during restart.

FR-19: Route discovery via a pluggable scanner module. For any managed repo whose manifest activates a route-explorer module, the tool lists the routes that module's scanner discovers for that repo. Consequences: available on any repo with an active route-explorer module, not hardcoded to the gateway; adding route exploration to a new repo requires only activating the module in that repo's manifest and providing a scanner implementation, no core code change; a scan failure and a genuinely empty route list are surfaced as distinct states.

FR-20: Fire a request with automatic dev-mode auth. A developer can fire a request against any route discovered via FR-19, with authentication for protected routes handled automatically in dev mode. Consequences: no manual re-authentication needed within a session regardless of how many different repos' routes are tested; an expired dev-mode token is refreshed automatically; a permission mismatch surfaces as a distinct auth error rather than a generic request failure; on this backend the module realizing FR-19/FR-20 for `api-gateway` uses OpenAPI-based scanning and `jose`-based dev-JWT auth.

FR-21: Save, customize, and re-fire a request. A developer can save a request (method, path, body, headers), and when re-firing a saved request, can further customize it before sending — then either overwrite the original or save the customized version as a new one. Consequences: firing a saved request never requires saving first; overwrite and save-as-new are both available after a customized re-fire, chosen per fire; save-as-new is rejected on a name collision, prompting for a different name; a saved request whose route is no longer discovered after a rescan is flagged stale and can be deleted, never fired silently.

FR-22: See response and relevant logs together. Firing a request (saved or ad hoc) surfaces its response and the relevant aggregated logs for the affected services in the same place, immediately after. Which services count as "affected" is learned progressively: the first time a route is fired, the tool proposes a default candidate set (active EDT's members, logs windowed to the few seconds around the fire) and lets the developer adjust it; that choice is saved against the route and reused automatically. Consequences: no separate step needed to correlate a fired request with the logs it produced; the developer can add/remove services from the proposed set before or after firing, and the adjusted set is reused on every later fire of the same route; a route's learned affected-service set can be edited or reset later. `[NOTE FOR PM]` exact time-window size deferred to Architecture/UX.

FR-23: Manage the saved-request library across EDTs. A developer's saved requests form one global library, not siloed per EDT. Each EDT can independently hide individual saved requests from its own view and mark others as favorites; a request can also be marked a global favorite, surfaced by default in every EDT's quick-access list. Consequences: a saved request created in one EDT is visible and fireable from any other EDT, without re-saving; hiding a saved request in one EDT does not remove it from the global library or any other EDT's view; favoriting works at two independent scopes (per-EDT and global); hide and favorite are the only means of managing library clutter in v1.

**Total FRs: 23**

### Non-Functional Requirements

NFR-1: Performance — no perceptible slowness. Sluggishness is a non-negotiable deal-breaker. Confirmed target: UI interaction response under ~150ms; a log line visible within ~1s of container emission. Deciding factor behind the TypeScript/Ink recommendation, on the basis that the tool's workload (≤10 concurrent `docker logs -f` streams) is I/O-bound, not CPU-bound.

NFR-2: Reliability / blast radius. A crash or bug in one action must not corrupt another EDT's state or another service's data — the one-SQLite-file-per-EDT pattern makes each EDT's state trivially isolated and portable. The one deliberate exception is the small global store for cross-EDT data (FR-23's saved-request library), scoped narrowly by design so a bug there can't touch EDT-specific state.

NFR-3: Auditability. Because every action is a standalone script (FR-1), every run is independently inspectable and re-runnable outside the TUI — the trust mechanism that makes giving the tool any git authority acceptable at all.

NFR-4: Extensibility (structural, not validated in v1). The generic-core/module split (manifest-driven, FR-2) is enforced from day one — proven on `shared-types` propagation and the route explorer — so the tool can extend to a structurally different stack later. The second personal project persona is why this discipline exists, though v1 doesn't prove it against them.

NFR-5: Local state layout. Config, per-EDT SQLite data, transient state (e.g. last-used EDT, log-view scroll position), and cache follow XDG Base Directory conventions (`XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME`) rather than a bespoke directory layout.

NFR-6: Single-instance enforcement. A second running instance of the tool on the same machine is detected and blocked, since concurrent writers to the same EDT's SQLite file or the same repo's git working tree are unsafe and unhandled otherwise.

**Total NFRs: 6**

### Additional Requirements

- **Constraints and Guardrails (Trust — Usability):** navigation must never be confusing enough to cause outright rejection of the tool — a non-negotiable bar.
- **Constraints and Guardrails (Trust — Single Source of Truth):** the tool must never force a developer to check another source to get the full picture — a blanket bar, not per-feature (instances today: FR-9, FR-18, FR-22).
- **Constraints and Guardrails (Safety — Git Access):** only local repo copies are ever touched, never remote/deployed; no commit or push without explicit developer approval at the moment it happens; git write access limited to the developer's own feature/fix branches; `development`/preprod/prod are read-only to the tool; an EDT must never register a shared branch as its own (FR-7).
- **Constraints and Guardrails (Safety — Data Loss):** uncommitted work is always auto-preserved on any tool-triggered branch switch, checked not assumed, before it proceeds.
- **Non-Goals (§5):** no AI-copilot layer automating error resolution or the git workflow beyond FR-11/FR-12's semi-automated resolution; no validation of the generic-core architecture against a second, structurally different personal project; no guided onboarding/installation wizard in this version; no touching of remote or deployed environments, ever.
- **MVP Out of Scope (§6.2):** guided step-by-step installation/onboarding wizard (deferred to teammate-sharing); AI-assisted per-repo manifest bootstrapping (Could-scope, deferred until manifest schema fixed); validating the generic-core/module split against the second project (deferred past v1); any AI-copilot layer automating error resolution or the git workflow (ruled out, not just deferred).
- **Open Questions (§8):** manifest exact schema — now resolved in Architecture (AD-4); UI/UX approach (navigation model, screen structure, keybindings) — now resolved in the UX design contract; Ink's FPS/memory ceiling is a monitored risk (SM-8), OpenTUI is the pre-identified fallback, no action needed unless observed in practice.

### PRD Completeness Assessment

The PRD (`prd-tui-back-2026-08-10/prd.md`, status: final) is complete and internally consistent: every FR carries testable consequences, every feature section maps to a Key User Journey, and both open questions left explicitly for downstream workflows (manifest schema → Architecture; UI/UX approach → UX) have since been resolved in the Architecture Spine and UX Design Contract respectively, both dated after the PRD and both marked final. Two `[ASSUMPTION]` tags (FR-3's manual EDT-member selection, FR-17's regex support) and two `[NOTE FOR PM]` tags (FR-22's time-window sizing, deferred to Architecture/UX) are explicitly flagged in the source document rather than silently inferred — all four are addressed by downstream documents (Architecture/UX) or intentionally left as implementation-level detail. No gaps identified at this stage.

## Epic Coverage Validation

### Epic FR Coverage Extracted (from `epics.md`'s FR Coverage Map)

FR-1: Epic 1 | FR-2: Epic 1 | FR-3: Epic 2 | FR-4: Epic 2 | FR-5: Epic 2 | FR-6: Epic 2 | FR-7: Epic 2 | FR-8: Epic 2 | FR-9: Epic 2 | FR-10: Epic 3 | FR-11: Epic 3 | FR-12: Epic 3 | FR-13: Epic 4 | FR-14: Epic 4 | FR-15: Epic 4 | FR-16: Epic 5 | FR-17: Epic 5 | FR-18: Epic 5 | FR-19: Epic 6 | FR-20: Epic 6 | FR-21: Epic 6 | FR-22: Epic 6 | FR-23: Epic 6

**Total FRs claimed covered: 23**

Cross-checked against the actual story bodies (not just the coverage map) — each FR's testable consequences are individually reflected in Given/When/Then acceptance criteria, not just referenced by number:

### FR Coverage Analysis

| FR Number | PRD Requirement (short) | Epic Coverage | Status |
| --- | --- | --- | --- |
| FR-1 | Script/CLI parity for every action | Epic 1, Story 1.2 (envelope/CLI contract), Story 1.4 (idempotent standalone action) | ✓ Covered |
| FR-2 | Per-repo manifest declares identity/modules | Epic 1, Story 1.3 (manifest schema/loader), Story 1.5 (module registry) | ✓ Covered |
| FR-3 | Create an EDT | Epic 2, Story 2.1 | ✓ Covered |
| FR-4 | Create dev branches at EDT creation | Epic 2, Story 2.2 | ✓ Covered |
| FR-5 | Modify an EDT after creation | Epic 2, Story 2.5 | ✓ Covered |
| FR-6 | Switch active EDT without data loss | Epic 2, Story 2.4 | ✓ Covered |
| FR-7 | EDT never claims a shared branch | Epic 2, Story 2.3 | ✓ Covered |
| FR-8 | Non-member repos stay on `development` | Epic 2, Story 2.4 | ✓ Covered |
| FR-9 | Branch and divergence visibility | Epic 2, Story 2.6 | ✓ Covered |
| FR-10 | Run a group update, EDT-scoped or all-repos | Epic 3, Stories 3.1, 3.2, 3.3 | ✓ Covered |
| FR-11 | Assisted resolution of merge conflicts/dirty state | Epic 3, Story 3.4 | ✓ Covered |
| FR-12 | Per-service migration failure handling | Epic 3, Story 3.5 | ✓ Covered |
| FR-13 | Publish a new `shared-types` version | Epic 4, Story 4.1 | ✓ Covered |
| FR-14 | See propagation status without manual check | Epic 4, Story 4.2 | ✓ Covered |
| FR-15 | Propagate to chosen services | Epic 4, Story 4.3 | ✓ Covered |
| FR-16 | Aggregated live log stream | Epic 5, Story 5.1 | ✓ Covered |
| FR-17 | Filter the aggregated stream | Epic 5, Story 5.2 | ✓ Covered |
| FR-18 | Inline service health | Epic 5, Story 5.3 | ✓ Covered |
| FR-19 | Route discovery via pluggable scanner module | Epic 6, Story 6.1 | ✓ Covered |
| FR-20 | Fire a request with automatic dev-mode auth | Epic 6, Story 6.2 | ✓ Covered |
| FR-21 | Save, customize, and re-fire a request | Epic 6, Story 6.3 | ✓ Covered |
| FR-22 | See response and relevant logs together | Epic 6, Story 6.4 | ✓ Covered |
| FR-23 | Manage saved-request library across EDTs | Epic 6, Story 6.5 | ✓ Covered |

### Missing Requirements

None. All 23 PRD FRs have a traceable story with acceptance criteria addressing their testable consequences. No FR appears in the epics document that doesn't trace back to a real PRD FR number (the one epics-only addition — EDT rename in Story 2.5 — is a scope addition the user explicitly requested during story creation, layered on top of FR-5's "modify an EDT" without contradicting or replacing any PRD FR; flagged here for visibility, not as a gap).

### Coverage Statistics

- Total PRD FRs: 23
- FRs covered in epics: 23
- Coverage percentage: 100%

## UX Alignment Assessment

### UX Document Status

**Found** — bmad-ux spine pair: `DESIGN.md` (visual identity, Atelier) + `EXPERIENCE.md` (behavior/IA), both status `final`, both dated 2026-08-11, both citing the PRD as source, `EXPERIENCE.md` explicitly `inherits: DESIGN.md`.

### A. UX ↔ PRD Alignment

- **User journeys:** `EXPERIENCE.md`'s Key Flows section reproduces PRD's UJ-1 through UJ-4 by the same labels, in the same order, with the same climax/resolution beats and the same FR references inline (e.g. UJ-1 step 6 cites FR-10, step 7 cites the summary-line consequence). No drift found.
- **Information architecture:** The six permanent zones (Dashboard, EDTs, Update, Logs, Routes, shared-types) map 1:1 to the PRD's six feature sections (§4.1–4.6) via `EXPERIENCE.md`'s own "FR range" column. Consistent with the epics' 1-epic-per-zone structure validated in Epic Coverage above.
- **Open Question resolution:** PRD §8 Open Question 2 ("UI/UX approach... navigation model, screen structure, keybinding conventions undecided") is exactly what this UX contract resolves — Navigation model, Interaction Primitives, and the six-zone IA all directly answer it. No orphaned PRD question left unaddressed by the UX.
- **UX requirements not in PRD:** none found that contradict the PRD — the UX contract adds concrete design decisions (Atelier token values, ASCII banner, exact keybinding scheme, voice/tone mechanic) the PRD deliberately left open for it, per the intended handoff chain. This is elaboration, not scope drift.

### B. UX ↔ Architecture Alignment

- **Zone structure:** Architecture's AD-15 ("TUI zone structure mirrors core capability boundaries 1:1") names the exact same six zone folders (`edts/`, `update/`, `logs/`, `routes/`, `shared-types/`, `dashboard/`) that `EXPERIENCE.md`'s Information Architecture table defines. Aligned.
- **Performance:** NFR-1's ~150ms/~1s targets are stated identically in `DESIGN.md` (Elevation & Depth motion note) and Architecture's AD-12. Aligned, single source of truth for the number.
- **Cross-zone state:** AD-10's one-Zustand-store rule (cross-zone state central, zone-local UI state local) supports `EXPERIENCE.md`'s state needs (active EDT, background-event badges, log buffers) directly.
- ✅ **RESOLVED — mouse support mechanism now named in Architecture's Deferred list.** Added an entry naming the mouse-input capture mechanism as an open technical choice, to be implemented/validated during Story 1.10, falling back to `Ctrl+W`-only if none proves reliable — mirrors the UX contract's own framing of this as a named risk.
- ✅ **RESOLVED — splitter pane-size persistence now named explicitly in AD-7.** `state.json`'s field-example list now names "per-zone splitter pane sizes" alongside last-used EDT and log-view scroll position, with a pointer to `EXPERIENCE.md`'s requirement that they persist per zone independently.

### Warnings

- The mouse-support gap above is the only alignment item worth resolving before or during Epic 1; everything else checked (journeys, IA, performance targets, state ownership) is consistent across PRD, UX, and Architecture with no contradictions found.

## Epic Quality Review

Applied rigorously against `bmad-create-epics-and-stories`' own standards: user-value focus, epic independence, no forward dependencies, proper story sizing, DB-creation timing.

### A. User Value Focus Check

- Epics 2–6 are unambiguously user-centric: each title and goal statement describes a concrete thing the developer (Max, the PRD's sole persona) can now do, traceable 1:1 to the PRD's own feature titles (§4.2–§4.6).
- **Epic 1 is borderline by design, not by oversight.** Its title inherits the PRD's own §4.1 feature name ("Standalone-Script Core & Manifest System") verbatim, and its goal statement does name real developer-facing capability (`register`/`list-repos` from a shell, full navigation shell). But at the *story* level, 7 of its 13 stories (1.1, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10) use "As a developer" to mean *the person building the tool* (consistent codebase, safe concurrency, a theme module to import) rather than *the person using the finished tool day-to-day* — the persona voice used everywhere else in the PRD's FR-1–FR-23 and in this document's other 5 epics. This was a deliberate, already-discussed tradeoff (approved by Max in-session): no starter template exists, and the Atelier component library + hexagonal skeleton are genuine one-time prerequisites shared by every other zone — building them once in Epic 1 avoids the worse alternative of duplicating design-system work six times across epics (a real file-churn risk the create-epics-and-stories workflow itself flags). **Classification: 🟡 Minor / accepted tradeoff — flagged for transparency, no rework recommended.**

### B. Epic Independence Validation

- Epic 1: stands alone completely. ✓
- Epic 2: needs only Epic 1's outputs (manifest, registry, module registry, lock). ✓
- Epic 3: needs Epic 1 + Epic 2 (reuses the git-safety gate built in Story 2.3, EDT membership scoping). ✓ No dependency on Epic 4/5/6.
- Epic 4: needs Epic 1 + Epic 2 (EDT membership). ✓ No dependency on Epic 3/5/6.
- Epic 5: needs Epic 1 + Epic 2 (EDT membership scoping for stream selection). ✓ No dependency on Epic 3/4/6 (confirmed after the Epic 6 buffer-sizing forward-reference was removed during story creation).
- Epic 6: needs Epic 1 + Epic 2 + **Epic 5** (Story 6.4 explicitly correlates fired requests with Epic 5's log stream — this is FR-22 itself cross-referencing PRD §4.5, not an invented coupling). This is a legitimate forward-flowing dependency correctly reflected in list order (5 before 6). ✓
- No circular dependencies found between any pair of epics.

### C. Story Quality Assessment

**Sizing:** all 35 stories are scoped to one cohesive capability each (matching the atomic-story instruction given during story creation) — none bundles unrelated concerns, none is epic-sized.

**Acceptance criteria:** consistently Given/When/Then, testable, and each ties back to a specific FR/AD/UX-DR. Three items worth noting:

- ✅ **RESOLVED — Story 3.1's branch-update mechanic.** Was deliberately non-specific about merge vs. rebase, mirroring a genuine PRD-level ambiguity (FR-10/UJ-1 say "pull `development`" without resolving how that applies to a member service already on its own feature branch). Max decided: **merge, never rebase** — safety-by-default (no rewriting of already-pushed commits) and cleanly idempotent (a merge already applied is a no-op on rerun, satisfying FR-1). Story 3.1's AC updated accordingly, with a new AC routing a real merge conflict to Story 3.4's assisted-resolution mechanic rather than leaving it unhandled.
- ✓ Story 6.4's "logs windowed to the few seconds around the fire" is intentionally vague — it matches Architecture's own Deferred section, which names the exact correlation-window duration as an explicit open tuning call. Correctly reflects the deferred status, not a gap.
- ✓ No vague/non-testable ACs otherwise found (spot-checked across all 6 epics).

### D. Dependency Analysis (Within-Epic)

- ✅ **RESOLVED — sequencing defect in Epic 1.** Story 1.7 (XDG State Layout Resolution) was resequenced to position **1.2** (immediately after Story 1.1), shifting the former 1.2–1.6 down to 1.3–1.7. All cross-references updated: the former Story 1.5 reference in Manifest (now 1.4) now correctly points to Story 1.6 (Static Module Registry); the registry story (now 1.5) references Story 1.2 for its XDG path instead of the reverse; Epic 2's Story 2.4 reference to the single-instance lock now correctly points to Story 1.7. Verified no remaining forward references in Epic 1 or in downstream epics' cross-references into it. Fixed directly in `epics.md` on 2026-08-11, same session.
- All other within-epic sequences (Epic 2 through Epic 6) checked story-by-story: each builds only on same-or-earlier stories within its own epic. No other forward dependencies found, confirming the two fixes already applied during story creation (Story 1.4's TUI-parity clause, Story 5.1's Epic-6 buffer reference) hold up under this independent re-check.

### E. Database/Entity Creation Timing

- ✓ Per-EDT SQLite file created exactly when first needed, in Story 2.1 (Create an EDT) — not upfront in Epic 1.
- ✓ `global.db` created exactly when first needed, in Story 6.3 (Save, Customize, and Re-Fire a Request) — not upfront.
- ✓ No epic front-loads schema/entities it doesn't itself use.

### Special Implementation Checks

- **Starter template:** Architecture confirms none exists (AD-14, v1 runs via `tsx`/`node`, no compiled binary). Story 1.1 is correctly a bare scaffold, not a "clone starter" story — consistent with this project's greenfield-no-starter status.
- **Greenfield indicators:** Epic 1 correctly includes initial project setup (1.1), and a dev-environment-equivalent (toolchain, test harness) — appropriate for a greenfield CLI/TUI project. No CI/CD pipeline story exists yet, but none is required by the PRD/Architecture for a single-developer local tool (packaging is explicitly deferred per AD-14) — not a gap.

### Best Practices Compliance Checklist

| Epic | Delivers user value | Functions independently | Stories sized well | No forward deps | DB created when needed | Clear AC | FR traceability |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 🟡 (borderline, justified) | ✓ | ✓ | ✅ (fixed: 1.4/1.7 ordering resolved) | n/a | ✓ | ✓ |
| 2 | ✓ | ✓ | ✓ | ✓ | ✓ (2.1) | ✓ | ✓ |
| 3 | ✓ | ✓ | ✓ | ✓ | n/a | 🟡 (3.1 merge/rebase) | ✓ |
| 4 | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | ✓ |
| 5 | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | ✓ |
| 6 | ✓ | ✓ (legit dep on Epic 5) | ✓ | ✓ | ✓ (6.3) | ✓ | ✓ |

### Quality Assessment Documentation

#### 🔴 Critical Violations

None found.

#### 🟠 Major Issues

None remaining — the one major issue found (Epic 1 sequencing defect: Story 1.4 depending on XDG path resolution that used to be defined only in a later Story 1.7) was fixed in this session by resequencing XDG State Layout Resolution to Story 1.2.

#### 🟡 Minor Concerns

1. Epic 1's infra-leaning stories (1.1, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10) use "As a developer" in the tool-builder sense rather than the tool-user sense used everywhere else — a deliberate, already-approved tradeoff given no starter template.
2. Story 3.1 leaves merge-vs-rebase unspecified for updating a member service's branch — inherited from a genuine PRD-level ambiguity, needs an explicit call before/during implementation.
3. ~~(Carried from UX Alignment) Mouse-input mechanism named as a risk in UX but not listed in Architecture's own Deferred section.~~ **RESOLVED** — added to Architecture's Deferred list.
4. ~~(Carried from UX Alignment) Splitter pane-size persistence-across-sessions implicitly, not explicitly, covered by AD-7's state.json field list.~~ **RESOLVED** — named explicitly in AD-7.

## Summary and Recommendations

### Overall Readiness Status

**READY.** All 4 actionable findings from this assessment were resolved in-session: the Epic 1 sequencing defect fixed (renumbered `epics.md`), the Story 3.1 merge-vs-rebase ambiguity decided by Max and reflected in its ACs, and both Architecture documentation gaps (mouse-input mechanism, splitter pane-size persistence) closed in `ARCHITECTURE-SPINE.md`. The one remaining item (Epic 1's infra-leaning persona voice) is a deliberate, already-approved tradeoff, not an open action. Zero critical violations throughout.

### Critical Issues Requiring Immediate Action

None.

### Issues Resolved This Session

1. **Epic 1 story sequencing defect** — Story "XDG State Layout Resolution" resequenced to position 1.2 (was 1.7); all cross-references updated across Epic 1 and Epic 2.
2. **Story 3.1 merge-vs-rebase ambiguity** — Decided: merge `development` into a member service's branch, never rebase (safety-by-default, idempotent per FR-1); Story 3.1's ACs updated, with conflicts routed to Story 3.4's assisted resolution.
3. **Mouse-input mechanism undocumented in Architecture** — added to `ARCHITECTURE-SPINE.md`'s Deferred section, to be resolved during Story 1.10 with `Ctrl+W` as the confirmed fallback.
4. **Splitter pane-size persistence implicit only** — AD-7 now names it explicitly among `state.json`'s fields.

### Recommended Next Steps

1. Proceed to `bmad-sprint-planning` — no blocking issues remain.
2. Epic 1's accepted tradeoff (infra-heavy foundation stories using tool-builder rather than tool-user persona voice) needs no action, just awareness during implementation.

### Final Note

This assessment identified 5 distinct findings (1 major, 4 minor) across FR coverage, UX↔Architecture alignment, and epic quality. 4 were resolved directly in this session (sequencing fix, product decision, 2 documentation additions); the 5th is a deliberate, already-approved tradeoff requiring no action. Zero critical violations at any point. The plan is ready for Phase 4 implementation.

---
**Assessed by:** bmad-check-implementation-readiness (Product Manager persona)
**Date:** 2026-08-11
