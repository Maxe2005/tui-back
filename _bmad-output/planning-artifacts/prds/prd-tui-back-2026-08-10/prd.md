---
title: TUI Admin Tool for NestJS Microservices Backend
status: final
created: 2026-08-10
updated: 2026-08-10
---

# PRD: TUI Admin Tool for a Microservices Backend

## 0. Document Purpose

This PRD is written for Max — the tool's sole author, its first user, and the person who will carry it into architecture and implementation. It builds directly on `brief-tui-back-2026-08-07` (problem, personas, non-negotiable constraints, MoSCoW scope) and its addendum (real-environment audit of `~/Documents/IANORD/Back`), and it closes the one technical decision the brief left open using `technical-typescript-vs-go-local-tui-admin-tool-research-2026-08-07.md`: **TypeScript (Node.js) + Ink**, with `better-sqlite3`, `dockerode`, `openapi-typescript`, and `jose`, structured as a hexagonal core with company-specific modules as adapters. This PRD does not re-argue that decision — it is carried forward as settled.

Structure: Glossary-anchored vocabulary (§3), Features grouped with Functional Requirements nested and globally numbered (§4), cross-cutting quality bars in their own section (§Cross-Cutting NFRs), inline `[ASSUMPTION: ...]` tags wherever this draft inferred without asking, indexed in §9 for review. Next in the chain: `bmad-architecture` (to fix the manifest schema, script/CLI contract, and hexagonal port boundaries this PRD deliberately leaves at the capability level) and `bmad-create-epics-and-stories`.

## 1. Vision

Today, everything *around* the code on this 10-service NestJS backend — pulling repos, running migrations, restarting containers, propagating a shared package, chasing logs across services, testing a gateway route — is done by hand or through a handful of incomplete bash scripts that were never built to survive a merge conflict or a failed migration gracefully. The TUI admin tool takes that entire "around the code" workflow over: a developer opens it, switches into (or creates) the workspace for what they're about to do, and is coding within one guided action — with a structural guarantee that no affected service is silently left out of date.

The tool is organized around three jobs — EDT (workspace) management, repo lifecycle automation, and aggregated observability — built on a single architectural bet: every action the tool performs is a standalone, parameterized, idempotent script, invocable identically from the TUI or by hand. That bet is what makes the tool auditable and trustworthy enough to be given real (if tightly scoped) git authority, and it is what keeps the door open to the tool's declared second act: a generic core with company- and stack-specific logic isolated into swappable modules, proven here against this NestJS backend and, later, against a structurally different stack. That discipline isn't confined to repo lifecycle — even a capability like the route explorer (§4.6) is built core-first, with only its route-scanning and auth mechanics pushed into a per-repo, per-language module. The long-run ambition sits beyond even the second project: not just personal reuse, but something solid enough to hand to someone else facing the same "everything around the code is manual" problem on their own backend.

This is also a craft project — part of its value is the experience of designing and building it well, not just the time it saves.

## 2. Target User

### 2.1 Jobs To Be Done

- As the primary developer, I want starting a coding session to be one guided action, so I stop losing time (and focus) to a manual multi-step setup sequence.
- As the primary developer, I want a structural guarantee that no affected service is silently left out of date, so a forgotten-service bug never blindsides me again.
- As the primary developer, I want a single, aggregated place to see logs and health across services, so I stop hopping between terminals to diagnose an issue.
- As the primary developer, I want to switch between concurrent work contexts without any risk of losing uncommitted work, and without services outside my current task drifting onto stray branches behind my back.
- As the primary developer, I want to fire a route without fighting Swagger or re-authenticating by hand, so testing mid-coding doesn't break my flow — and I want that to work the same way regardless of which repo the route lives on.
- *(Secondary, deferred — see Non-Users)* As a new teammate, I want my local environment to reach "ready to code" through guided setup, without hand-holding from the tool's author — the pitch that lands with this audience is a setup that "just works" out of the box, not an efficiency argument aimed at a developer already fluent in the manual way.

### 2.2 Non-Users (v1)

- **Teammates** — a real secondary persona, but proving the tool works solo comes first; sharing it is a later milestone, not part of this version's definition of done.
- **The second personal project** (a structurally different, gateway-less Java/Python backend) — the generic-core/company-module discipline is applied *for* this persona starting now, but not *validated against* them in v1 (see §5 Non-Goals).
- **Anyone needing to touch a remote or deployed environment** — out of scope entirely, not just deferred. The tool only ever touches local repo copies (see Constraints and Guardrails).

### 2.3 Key User Journeys

- **UJ-1. Max starts a coding session by switching EDTs.**
  - **Persona + context:** Max, sitting down to work on a new ticket that touches `micro-users` and `api-gateway`.
  - **Entry state:** Tool open, a different EDT (yesterday's task) currently active, with uncommitted work in one of its services.
  - **Path:** Max opens the EDT switcher, picks (or creates) today's EDT and its two member services — since this is new work, he has the tool create matching dev branches off `development` for both, named after the ticket (FR-4); the tool auto-preserves the uncommitted work in the outgoing EDT before switching, and puts every non-member service back on `development` (FR-8); Max triggers a group update on the new EDT (FR-10), which pulls `development`, runs migrations, and restarts containers for both member services.
  - **Climax:** The update summary accounts for both services explicitly — no ambiguity about whether either is caught up.
  - **Resolution:** Max starts coding, confident nothing was silently skipped, and can see at a glance that every other service is safely on `development` (FR-9).
  - **Edge case:** If `micro-users` hits a migration failure, the update still completes for `api-gateway`, and Max gets a clear, per-service failure report instead of a stalled run (FR-12).

- **UJ-2. Max traces a bug mid-session with a saved route request.**
  - **Persona + context:** Max, mid-coding on the EDT from UJ-1, needs to check whether a gateway endpoint is returning the right shape after a change.
  - **Entry state:** Tool running in the background, EDT active, dev-mode auth already handled by the tool.
  - **Path:** Max opens the route explorer, finds the request in the global saved-request library even though it was originally saved from a different EDT (FR-23), re-fires it, tweaks one field first, and lets the tool save it as a new variant rather than overwriting the original (FR-21).
  - **Climax:** The response and the relevant aggregated logs for the affected services appear together, in the same view (FR-22) — no separate terminal to open.
  - **Resolution:** Max spots the issue in the logs, fixes it, and resumes coding without having left the tool.

- **UJ-3. Max publishes and propagates a new `shared-types` version.**
  - **Persona + context:** Max just added a field to a shared DTO and needs every affected service on the new contract.
  - **Entry state:** EDT active with the services that consume the changed type.
  - **Path:** Max publishes the new version through the tool, which runs `shared-types`'s own `npm run v` (FR-13); the tool shows which EDT member services are already on it (FR-14); Max triggers propagation for the ones that aren't (FR-15).
  - **Climax:** Without checking a single `package.json` by hand, Max sees every relevant service now on the new version.
  - **Resolution:** Max reviews and commits the dependency bump per service himself — the tool staged it, but never committed on his behalf.

- **UJ-4. Max hits a merge conflict during a group update.**
  - **Persona + context:** Max runs a group update (UJ-1) and one service has diverged beyond a simple lockfile change.
  - **Entry state:** Mid group-update, one service now blocking.
  - **Path:** The tool detects the conflict is not a known-safe case, explains what's wrong in plain terms, and presents a menu: stash, open in editor, or cancel (FR-11). Max opens the file, resolves it by hand, and tells the tool to continue.
  - **Climax:** The tool re-verifies the repo's state before resuming the update — it doesn't just trust that Max is done.
  - **Resolution:** The update completes for that service; Max never had to drop to a separate terminal to figure out what was wrong.

## 3. Glossary

- **EDT** — A persistent workspace: a topic, a manually chosen set of affected services, and each member service's working branch (existing or newly created through the tool). A service can be a member of several EDTs at once, each tracking its own branch for it independently. Exactly one EDT is active at a time. Backed by one SQLite file per EDT.
- **Managed repo** — A repo that carries a manifest; the tool only ever acts on managed repos. `micro-bookings` (no `.git`, no compose file, already dead) is not managed.
- **Manifest** — A per-repo declaration, versioned inside that repo, of its identity (service name, container naming, migration command) and which modules are active for it.
- **Module** — Company- or stack-specific logic that plugs into the generic core via a repo's manifest — e.g. `shared-types` propagation (this company only), or a route-explorer's route-scanning-and-auth implementation (per repo/language). Distinct from the core, which never encodes company- or stack-specific knowledge itself.
- **Core** — The generic, company-agnostic engine: EDT lifecycle, script orchestration, log aggregation, and the route explorer's browse/fire/save mechanics. What makes the generic-core/module split real rather than aspirational.
- **Script** — A standalone, parameterized, idempotent unit of work (e.g., "update this repo," "run this service's migrations") invocable identically by the TUI or by hand.
- **Group update** — Pulling `development`, running migrations, and restarting containers across a scope of services: either the active EDT's members (default) or all managed repos (maintenance mode, behind a confirmation gate).
- **Propagation** — Bumping a service's `shared-types` dependency to a newer published version and installing it.
- **Assisted resolution** — The tool's detect → (auto-fix known-safe cases, else guided menu) → re-verify loop for merge conflicts and migration failures, as opposed to just surfacing a raw error.
- **Route-explorer module** — The pair of a route-scanning implementation and a dev-mode auth mechanism for a given repo/language, activated per repo via its manifest. Route exploration itself (§4.6) is core; this pairing is what's pluggable.
- **Gateway** — `api-gateway`. On this backend, the only managed repo with an active route-explorer module today, since it's currently the only repo exposing HTTP routes (per the addendum's audit).

## 4. Features

### 4.1 Standalone-Script Core & Manifest System

**Description:** The architectural foundation every other feature depends on. Every action the tool performs is a standalone script; every managed repo carries a manifest declaring its identity and active modules. Together these are what let the tool absorb the current bash scripts' hard-won conventions (branch fallback, migration commands, container naming) into one auditable, extensible place instead of duplicating them by hand across scripts, as happens today.

**Functional Requirements:**

#### FR-1: Script/CLI parity for every action

A developer can invoke any Must-scope action (repo update, migration, propagation, health check) either through the TUI or as a standalone script from a shell, with identical effect.

**Consequences (testable):**
- Running an action's underlying script directly reproduces exactly what triggering it from the TUI does — no TUI-only side effect exists.
- Each script emits a structured, machine-parsable result (exit code + structured output) so the TUI and any future automation consume it the same way.
- Running any script twice in a row with no intervening state change produces no additional side effects (idempotency).

#### FR-2: Per-repo manifest declares identity and active modules

The tool only acts on a repo that carries a manifest; the manifest declares that repo's service identity and which modules are active for it (e.g. `shared-types-consumer`, `shared-types-source`, or a route-explorer module paired with a specific scanner/auth implementation).

**Consequences (testable):**
- A repo with no manifest is invisible to every tool action (this is how `micro-bookings` is excluded, with no special-case code).
- Adding a new managed repo, or changing which modules are active on an existing one — including activating route exploration on a repo that isn't the gateway — requires only a manifest change, no core code change.

**Notes:** `[NOTE FOR PM]` The exact manifest file format/schema is a technical-design decision, deliberately deferred to `bmad-architecture` — this PRD specifies the required declared capabilities, not the file's shape.

---

### 4.2 EDT Workspace Management

**Description:** Persistent, protected workspace switching, including keeping every managed repo — member or not — in a correct, visible branch state. Realizes UJ-1, UJ-3, UJ-4. Directly answers the brief's "switching contexts is manual and risky" problem and the "no data loss on EDT switch" non-negotiable constraint. A service can be a member of multiple EDTs at once — this is deliberate, not an edge case: a shared microservice used across several concurrent workstreams keeps its own registered branch per EDT it belongs to, and every switch evaluates each managed service against the newly active EDT's membership alone, never against a cross-EDT exclusivity rule.

**Functional Requirements:**

#### FR-3: Create an EDT

A developer can create a new EDT by giving it a topic and manually selecting its member services from the set of managed repos. `[ASSUMPTION: manual selection at creation time — no auto-detection mechanism (e.g. from a ticket ID or dependency graph) is described in the brief; extendable later.]`

**Consequences (testable):**
- An EDT persists across tool restarts.
- Each member service's working branch is recorded once that service is first touched within the EDT.
- Topic must be unique among existing EDTs; at least one member service is required at creation.
- A service can be selected as a member of more than one EDT; each EDT records and tracks its own branch for that service independently.

#### FR-4: Create dev branches for EDT member services

At EDT creation, a developer can have the tool create a working branch in each selected member service, based on `development` by default or another chosen base branch, named either as one shared name across all selected services or individually per service.

**Consequences (testable):**
- Branch creation is optional at EDT-creation time — an EDT can also be created against services' existing branches without creating new ones.
- One base-branch choice and one naming mode (grouped or individual) apply to the whole creation action.
- A branch the tool creates this way becomes that service's registered branch for the EDT (see FR-9).
- A per-service branch-creation failure (e.g. base branch missing, name collision) is reported per service and does not abort creation for the others.

> Amended 2026-08-28 (Sprint Change Proposal, Story 2.22): "optional at creation" narrows to the
> TUI's mandatory flow — branch creation is no longer a developer choice in the TUI (always
> happens when ≥1 member is selected), only the base branch and naming mode remain choices.
> `core` still exposes the no-branch-creation shape for non-TUI driving adapters.

#### FR-5: Modify an EDT after creation

A developer can add or remove member services from an existing EDT, and change a member service's working branch, after the EDT has been created.

**Consequences (testable):**
- Adding a service to an EDT does not require recreating the EDT or disturbing its other members' state.
- Changing a service's branch within an EDT follows the same protected-switch rule as FR-6 (no uncommitted work lost).
- Removing an EDT's last remaining member service is allowed — an EDT can exist with zero members.
- A branch change to a protected branch is rejected, per the same rule as FR-7.

#### FR-6: Switch the active EDT without data loss

A developer can switch the active EDT at any time; the tool auto-preserves any uncommitted work in every affected repo of the outgoing EDT before switching.

**Consequences (testable):**
- No uncommitted change in any EDT-member repo is ever lost by a switch.
- Exactly one EDT is active at a time; all EDT-scoped actions (default group update, propagation status) operate against it.
- On switch, every managed service is evaluated against the newly active EDT's membership: a member service is checked out to that EDT's own registered branch for it; a non-member service is switched to `development` (or its configured shared branch) per FR-8 — regardless of whether that service also belongs to a different, currently inactive EDT.
- If a group update (FR-10) is running on the outgoing EDT, the switch is blocked by default; a prompt offers to stop the running update immediately so the switch can proceed. Returning later to the EDT whose update was stopped shows that it was interrupted and offers to re-run it.

#### FR-7: An EDT never claims a shared branch

Assigning a shared/protected branch (`development`, preprod, prod) as an EDT's "own" branch for a service is rejected.

**Consequences (testable):**
- Attempting to register a protected branch to an EDT fails with a clear explanation, before any git write happens.

#### FR-8: Non-member managed repos stay on `development`

While an EDT is active, every managed repo that is not one of its member services is kept on `development` (or its configured shared branch) — so a service that's called by an EDT-member service but isn't itself part of the EDT still behaves correctly, instead of being stuck on a stray branch left over from a previous session.

**Consequences (testable):**
- Activating or switching to an EDT checks every non-member managed repo's current branch and switches it back to `development` if it isn't already there.
- This switch follows the same no-data-loss guarantee as FR-6 — uncommitted work in a non-member repo is preserved, not discarded.
- The tool fetches a non-member repo's `development` (or configured shared branch) before switching to it, if it isn't already present locally.

#### FR-9: Branch and divergence visibility

Every managed service is displayed with its current branch and how far that branch has diverged from its own origin/upstream, in both directions — ahead and behind.

**Consequences (testable):**
- The displayed divergence shows both the ahead and behind commit counts relative to the branch's origin, without the developer running `git status`/`git log` by hand.
- A branch with no configured upstream, or checked while offline, shows an explicit "no upstream" / "unknown (offline)" state rather than a numeric value.
- This applies to every managed service, EDT member or not — including the ones FR-8 keeps on `development`.

#### FR-24: Delete an EDT

> Added 2026-09-16 (Sprint Change Proposal, Story 2.29). No FR before this one covered removing
> an EDT record itself — FR-5 only covers modifying an existing one. Numbered FR-24 (next
> available, following FR-23) though it belongs functionally to §4.2 alongside FR-3–FR-9.

A developer can delete an EDT they no longer need, choosing per member service whether to leave
its git branch alone or delete it too — informed by that branch's merge status (into the repo's
configured shared branch) and whether it carries uncommitted work.

**Consequences (testable):**
- Deleting an EDT while it is the active one is rejected with a clear message to switch away
  first — the tool never auto-switches on the developer's behalf to make room for a deletion.
- The per-service branch-disposition choice ("leave as-is" / "delete, including any uncommitted
  work") is independent per member service, defaulting to "leave as-is" except for a branch that
  is both fully merged into its shared branch and has no uncommitted work, which defaults to
  "delete" — every default stays developer-overridable, never forced.
- A branch chosen for deletion that is also registered as a *different* EDT's own branch for that
  same repo is not deleted — reported per-service as a distinct failure — while the EDT record
  itself is still deleted and every other selected service's branch deletion proceeds
  independently.
- Deleting an EDT removes its persisted record entirely; no undo/soft-delete is offered, matching
  the same "developer's explicit action in the moment, no automated recovery" bar every other
  destructive git action in this tool already meets (Constraints and Guardrails).

---

### 4.3 Repo Lifecycle: Group Update & Migrations

**Description:** Absorbs and hardens `update_repo.sh` / `update-services.sh` / `run_migrations.sh`. Realizes UJ-1, UJ-4.

**Functional Requirements:**

#### FR-10: Run a group update, EDT-scoped or all-repos

A developer can run a group update — pull `development`, run migrations, restart containers — against either the active EDT's member services (default) or explicitly against all managed repos regardless of EDT (maintenance mode, preserving today's `update-services.sh` usage pattern, roughly every 2–3 days).

**Consequences (testable):**
- The all-repos mode is always explicitly invoked, never the default, and requires an explicit confirmation step before running, since its blast radius extends beyond the active EDT's scope.
- The end-of-run summary accounts for every targeted service by outcome (updated / skipped / failed) — no service is silently absent from the summary.
- A group update triggered on an EDT with zero member services is a no-op, with an explicit message rather than silent success.
- A second group-update run is rejected while one is already in progress, in either scope.

#### FR-11: Assisted resolution of merge conflicts / dirty state

When a group update hits a repo that isn't cleanly updatable, the tool auto-resolves already-known-safe cases and otherwise guides the developer through a bounded menu, then re-verifies before continuing.

**Consequences (testable):**
- If only `package.json`/lockfile are dirty, the tool resolves it the same way `update_repo.sh` does today, without prompting.
- For any other dirty/conflicted state, the tool presents a menu (stash / open in editor / cancel this repo / cancel the whole run) and does not proceed on that repo until the developer acts — canceling this repo alone lets the run continue with the rest; canceling the whole run stops it entirely.
- After the developer acts, the tool re-checks the repo's state before resuming — it does not assume success.
- A repo already mid-merge/mid-rebase from a previous interrupted or crashed run is detected as its own case, distinct from a lockfile-only dirty state, and surfaced to the developer explicitly before the guided menu applies.

**Out of Scope:** The tool never resolves a real merge conflict's content automatically, and never commits or discards a developer's changes without that developer's explicit action in the moment (see Constraints and Guardrails).

#### FR-12: Per-service migration failure handling

When a migration fails during a group update, the tool surfaces which service, which migration, and the error output, and lets the developer re-trigger just that service's migration after a fix.

**Consequences (testable):**
- A migration failure on one service does not block or roll back updates that already succeeded on other services in the same run.
- Re-running a fixed migration re-verifies success before that service is marked caught up.
- Repeated failures on the same migration are surfaced the same way each time; no retry limit or escalation path is enforced in v1.

---

### 4.4 `shared-types` Propagation Module *(company-specific)*

**Description:** Absorbs `shared-types`'s existing one-command release script and closes the "no repo-by-repo manual check" gap. Realizes UJ-3. Publish (FR-13) is active only on the repo whose manifest declares it `shared-types-source`; propagation status/action (FR-14/FR-15) is active only on repos whose manifest declares them a `shared-types-consumer`.

**Functional Requirements:**

#### FR-13: Publish a new `shared-types` version

A developer can publish a new `shared-types` version through the tool, which runs the `shared-types` repo's existing `npm run v` script — a sequential bump → build → publish → push.

**Consequences (testable):**
- A failure at any step of `npm run v` is surfaced with which step failed, not just a generic error, instead of leaving the developer to re-read raw script output.
- After a fix, the developer can re-trigger the publish without the tool treating the prior failed attempt as success; the tool re-verifies before marking the version published — the same detect → fix → re-verify guarantee as FR-11/FR-12, applied here too.
- A re-trigger after a partial failure (e.g. publish/push failed after bump and build already succeeded) resumes from the failed step rather than restarting from bump, avoiding a duplicate version bump or a publish conflict on an already-published version.
- On success, the tool immediately offers propagation to the active EDT's eligible consumer members (one, several, or all) in the same flow, chaining into FR-15 — no separate manual step to go find the propagate action. Propagation remains independently triggerable later too (e.g. a newly added consumer catching up).
- Publish is offered only when the active EDT includes the `shared-types` repo itself as a member, identified via a `shared-types-source` manifest module (distinct from `shared-types-consumer`).

#### FR-14: See propagation status without a manual check

The tool shows, for the active EDT's member services that declare themselves a `shared-types` consumer, whether they're on the version most recently published from the active EDT's own `shared-types` branch — without the developer checking any repo by hand.

**Consequences (testable):**
- Propagation status for every EDT-member service that declares itself a `shared-types` consumer is shown without the developer running `npm ls`/checking `package.json` by hand.
- The "latest" version is resolved by walking the active EDT's `shared-types` branch's git ancestry (tags/commits reachable from its tip) — **never** by comparing against the single highest version number across all branches. Version numbers are globally unique but published independently per branch, so the global maximum can be functionally unrelated to the active branch's own lineage (e.g. global latest = 660, but the version actually relevant to this branch = 613, because 614–660 were published from unrelated branches).
- Status reflects the branch-relevant latest version, resolved live via git ancestry at view time — never cached.
- A member service that doesn't declare `shared-types-consumer` in its manifest is omitted from this view.
- Unavailable when the active EDT doesn't include the `shared-types` repo itself as a member (see FR-13's `shared-types-source` gating).

#### FR-15: Propagate to chosen services

A developer can propagate the new version to some or all of the active EDT's eligible member services in one action.

**Consequences (testable):**
- The tool stages the dependency bump (package.json/lockfile) and installs it per service.
- The tool never commits or pushes any staged change without that developer's explicit approval, per the git constraints — propagation prepares the change, it does not finalize it.
- A propagation failure on one service (e.g., install error) is independently retriable and doesn't block the others.

---

### 4.5 Aggregated Log Observability

**Description:** Absorbs and replaces `check_health.sh`'s blind auto-restart with visibility. Realizes UJ-2. The cost of low visibility today isn't hypothetical: an internal audit of declared versus used RPC message patterns across services found 31% orphaned/dead code — invisible without dedicated cross-service tooling.

**Functional Requirements:**

#### FR-16: Aggregated live log stream

A developer can view a single, live, aggregated log stream from every service in the active EDT, or a chosen subset.

**Consequences (testable):**
- Log-stream re-renders are debounced/batched rather than triggering a full redraw per line, so the view stays responsive under multiple concurrent `docker logs -f` streams — a from-day-one requirement, not a later optimization, given Ink's rendering ceiling (see Cross-Cutting NFRs).
- A service with no running container, or whose container stops/crashes mid-stream, is shown as such in the view; the tool attempts to reconnect automatically when it returns.

#### FR-17: Filter the aggregated stream

The stream can be filtered by service, by free-text/regex search `[ASSUMPTION: regex support specifically, not just free-text — a stronger capability commitment than the brief states outright]`, and by log level, without restarting it.

**Consequences (testable):**
- Applying or changing a filter does not interrupt the live stream.
- A regex filter that doesn't compile is rejected with an inline error, not silently ignored or crashing the view.

#### FR-18: Inline service health

Service health (up / down / restarting) is visible inline with the log view, so a developer never needs another source for the full picture.

**Consequences (testable):**
- A failing service's health status is visible in the same view as its logs, without a separate health check step.
- Restarting a failing service is a developer-triggered action from this view, replacing `check_health.sh`'s current silent auto-restart.
- A restart request on a service that's already restarting is a no-op — the control is disabled during restart, never triggering a second concurrent restart.

---

### 4.6 Route Explorer *(core capability, pluggable per-repo scanner & auth modules)*

**Description:** A core capability, not tied to any one company or stack — browsing and firing HTTP routes for any managed repo whose manifest activates a route-explorer module. What's company/stack-specific is the module itself: how routes are discovered (a scanning implementation, per repo/language) and how dev-mode auth is obtained. On this backend, only `api-gateway` activates it today, because it's currently the only repo exposing HTTP routes (per the addendum's audit) — a structurally different backend where every service exposes its own routes would activate the module on each of those services' manifests instead, using a scanner/auth implementation suited to their language. Replaces the cluttered generated Swagger UI for daily use. Realizes UJ-2.

**Functional Requirements:**

#### FR-19: Route discovery via a pluggable scanner module

For any managed repo whose manifest activates a route-explorer module, the tool lists the routes that module's scanner discovers for that repo.

**Consequences (testable):**
- Route exploration is available on any repo with an active route-explorer module — not hardcoded to the gateway.
- Adding route exploration to a new repo (a future service exposing its own routes, or a service in the second personal project) requires activating the module in that repo's manifest and providing a scanner implementation for its language/framework — no core code change.
- A scan failure and a genuinely empty route list are surfaced as distinct states — a scan failure is never displayed as an empty route list.

#### FR-20: Fire a request with automatic dev-mode auth

A developer can fire a request against any route discovered via FR-19, with authentication for protected routes handled automatically in dev mode — no manual token re-entry per session. The auth mechanism is provided by that repo's active route-explorer module.

**Consequences (testable):**
- No manual re-authentication is needed within a session, regardless of how many different repos' routes are being tested.
- An expired dev-mode token is refreshed automatically, without developer action; a permission mismatch on the target route still surfaces as a distinct auth error rather than a generic request failure.
- On this backend, the module realizing FR-19/FR-20 for `api-gateway` uses OpenAPI-based scanning and `jose`-based dev-JWT auth (per the technical research); a differently-stacked repo plugs in its own scanner and auth implementation without changing this FR's contract.

#### FR-21: Save, customize, and re-fire a request

A developer can save a request (method, path, body, headers), and when re-firing a saved request, can further customize it before sending — then either overwrite the original saved request or save the customized version as a new one.

**Consequences (testable):**
- Firing a saved request never requires saving first — ad hoc customize-then-fire is always possible without committing to a save.
- Overwrite and save-as-new are both available after a customized re-fire; the developer chooses per fire, not a fixed setting.
- Save-as-new is rejected on a name collision with an existing saved request; the developer is prompted to choose a different name.
- A saved request whose route is no longer discovered after a rescan is flagged stale and can be deleted — never fired silently.

#### FR-22: See response and relevant logs together

Firing a request (saved or ad hoc) surfaces its response and the relevant aggregated logs for the affected services in the same place, immediately after. Cross-references §4.5. Good-enough correlation, not precise tracing, is the v1 bar — no request-ID propagation through the backend's RPC calls is assumed or required. Which services count as "affected" for a given route is learned progressively rather than pre-configured: the first time a route is fired, the tool proposes a default candidate set (every service in the active EDT, logs windowed to the few seconds around the fire) and lets the developer add or remove services from it; that choice is then saved against the route and reused automatically on every later fire, without asking again. An unfamiliar route keeps falling back to the broad default until it has been fired and confirmed once — the same pattern as FR-21's saved-request bodies, which start as a bare shape and accumulate real example values through use.

**Consequences (testable):**
- No separate step is needed to correlate a fired request with the logs it produced.
- The first time a specific route is fired, the tool proposes a default affected-service set (active EDT's members, logs windowed around the fire time) rather than asking the developer to configure it upfront.
- The developer can add or remove services from the proposed set before or after firing; the adjusted set is saved against the route and reused automatically on every later fire of the same route — no per-fire reconfiguration.
- A route's learned affected-service set can be edited or reset later if the route's real dependencies change.

**Notes:** `[NOTE FOR PM]` Exact time-window size around a fire is a technical/UX detail, deferred to `bmad-architecture`/`bmad-ux`.

#### FR-23: Manage the saved-request library across EDTs

A developer's saved requests (FR-21) form one global library, not siloed per EDT — a request saved while working in one EDT is discoverable and fireable from any other EDT too. Each EDT can independently hide individual saved requests from its own view (too many, not relevant here) and mark others as favorites for quick access; a request can also be marked a global favorite, surfaced by default in every EDT's quick-access list, for examples reused often regardless of which EDT is active.

**Consequences (testable):**
- A saved request created in one EDT is visible and fireable from any other EDT, without re-saving it.
- Hiding a saved request in one EDT does not remove it from the global library or from any other EDT's view.
- Favoriting works at two independent scopes: per-EDT (quick-access in that EDT only) and global (quick-access in every EDT by default).
- Hide and favorite are the only means of managing library clutter in v1 — no folders or tagging system is implied.

**Notes:** `[NOTE FOR PM]` Whether hide/favorite need a dedicated management screen versus inline controls on the existing saved-request list is a UX-level decision, deferred to `bmad-ux`.

## Cross-Cutting NFRs

- **Performance — no perceptible slowness.** Sluggishness is a non-negotiable deal-breaker (the brief is explicit: it sends the developer back to bash). Confirmed target: UI interaction response under ~150ms; a log line visible within ~1s of container emission. This was the deciding factor behind the TypeScript/Ink recommendation (research report), on the basis that this tool's actual workload (≤10 concurrent `docker logs -f` streams) is I/O-bound, not CPU-bound.
- **Reliability / blast radius.** A crash or bug in one action must not corrupt another EDT's state or another service's data — the one-SQLite-file-per-EDT pattern (research report) makes each EDT's state trivially isolated and portable. The one deliberate exception is the small global store for cross-EDT data (FR-23's saved-request library), scoped narrowly by design so a bug there can't touch EDT-specific state.
- **Auditability.** Because every action is a standalone script (FR-1), every run is independently inspectable and re-runnable outside the TUI — this is the trust mechanism that makes giving the tool any git authority acceptable at all.
- **Extensibility (structural, not validated in v1).** The generic-core / module split (manifest-driven, FR-2) is enforced from day one — proven here on `shared-types` propagation and, per §4.6, on the route explorer too — so the tool can extend to a structurally different stack later. The second personal project persona is why this discipline exists, even though v1 doesn't prove it against them (see §5).
- **Local state layout.** Config, per-EDT SQLite data, transient state (e.g. last-used EDT, log-view scroll position), and cache follow XDG Base Directory conventions (`XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME`) rather than a bespoke directory layout — cheap to do from day one, awkward to retrofit (research report).
- **Single-instance enforcement.** A second running instance of the tool on the same machine is detected and blocked, since concurrent writers to the same EDT's SQLite file or the same repo's git working tree are unsafe and unhandled otherwise.
- **NFR-7 — Rendering correctness** *(added 2026-09-20, Sprint Change Proposal, Story 5.5)*. No panel or list may render content taller than the terminal's actual available rows — Ink has no true scroll/overlay mechanism, so overflow desyncs its diff-render from the real terminal cursor and corrupts already-painted lines. Any zone with a data-dependent or user-configurable list length must bound/scroll it rather than assume it fits.

## Constraints and Guardrails

### Trust — Usability

- Navigation must never be confusing enough to cause outright rejection of the tool — a non-negotiable bar carried from the brief, not a polish item to defer. Directly informs the still-open UI/UX approach decision (§8, Open Question 2).

### Trust — Single Source of Truth

- The tool must never force a developer to check another source to get the full picture. This is a blanket bar, not a per-feature one — FR-9 (branch/divergence), FR-18 (inline health), and FR-22 (response + logs together) are instances of it today, and any feature added later is expected to satisfy it too.

### Safety — Git Access

These are trust bars every Must-scope capability already has to satisfy, not features to prioritize (carried forward verbatim from the brief's Non-Negotiable Constraints):

- Only local repo copies are ever touched — never a remote or deployed environment.
- No commit or push happens without explicit developer approval, at the moment it happens (applies directly to FR-11's guided resolution and FR-15's propagation, both of which stage but never finalize a change).
- Git write access is limited to the developer's own feature/fix branches.
- `development`, preprod, and prod are read-only to the tool.
- An EDT must never register a shared branch as its own (FR-7).

### Safety — Data Loss

- Uncommitted work is always auto-preserved on any tool-triggered branch switch — an EDT switch (FR-6) or a non-member repo being kept on `development` (FR-8) — checked, not assumed, before either proceeds.

## 5. Non-Goals (Explicit)

- **No AI-copilot layer** that anticipates or auto-fixes errors, or automates the git workflow beyond what FR-11/FR-12's semi-automated, known-safe-cases-only resolution already does. The Must-scope groundwork (standalone scripts, strict git boundaries) deliberately makes this safer to add later — it is not being built now because an under-bounded automated executor risks runaway restarts or destroyed in-progress work. *(Distinct from the setup-time, developer-invoked manifest-bootstrapping idea in §6.2 — that's a one-shot scaffolding aid, not a runtime agent acting inside the tool.)*
- **No validation of the generic-core architecture against the second, structurally different personal project** (no gateway, Java/Python). The discipline (FR-2 manifests, FR-19 pluggable route-explorer modules) is applied now; proving it on a second stack is explicitly deferred past this version.
- **No guided onboarding/installation wizard** in this version (see §6.2) — valuable once shared with teammates, not needed while the author is the only user.
- **No touching of remote or deployed environments**, ever, regardless of scope changes later (see Constraints and Guardrails).

## 6. MVP Scope

This is a problem-solving MVP: scope is bounded by which manual workflows it eliminates for the primary developer, not by breadth of coverage.

### 6.1 In Scope

- Standalone-script core architecture + per-repo manifest/module system (§4.1).
- EDT workspace management: create (with optional branch creation), modify after creation, protected switch, non-member-repo branch enforcement, branch/divergence visibility, delete with per-service branch disposition (§4.2, FR-24 added 2026-09-16).
- Group update — EDT-scoped and all-repos modes, the latter behind a confirmation gate — with assisted conflict/migration-failure resolution (§4.3).
- `shared-types` propagation module, including its `npm run v` publish flow (§4.4).
- Aggregated log observability, filterable by service/text/level, with inline health (§4.5).
- Route Explorer as a core capability with pluggable per-repo scanner/auth modules — realized on this backend via the gateway's NestJS/OpenAPI module, including a global saved-request library shared across EDTs with per-EDT hide and favorite controls (§4.6).
- Technical foundations: TypeScript/Node.js + Ink, hexagonal core + module adapters, per-repo manifest format (decided; schema deferred to architecture).
- Local state: `better-sqlite3` (one file per EDT for EDT-scoped state, plus a separate global store for cross-EDT data such as FR-23's saved-request library — exact storage topology deferred to architecture), laid out per XDG Base Directory conventions.

### 6.2 Out of Scope for MVP

- Guided, step-by-step installation/onboarding wizard — deferred to when the tool is shared with teammates (brief's Could-scope item).
- **AI-assisted per-repo manifest bootstrapping (Could)** — an AI skill (e.g. a Claude Code skill) that scans an existing backend and drafts per-repo manifests to help initialize tool usage on it, including for onboarding the second, structurally different project later. Deferred until the manifest schema itself is fixed in architecture. `[NOTE FOR PM: Could-scope, not required for v1 — flag if this should be prioritized higher.]`
- Validating the generic-core/module split against the second, gateway-less Java/Python project — proof deferred past v1.
- Any AI-copilot layer automating error resolution or the git workflow — ruled out for now, not just deferred casually (see §5).

## 7. Success Metrics

*Each SM cross-references the FR(s) it validates. This is an internal tool for a team of one (for now) — metrics are observed through real daily use, not instrumented telemetry.*

**Primary**

- **SM-1**: Session start is one guided action (switch/create EDT → group update completes) instead of a manual multi-step sequence, every time. Validates FR-4, FR-6, FR-10.
- **SM-2**: Zero forgotten-service incidents — no service silently left out of date after a group update. Target: 0 per month, observed over real use. Validates FR-10.
- **SM-3**: Every merge/migration failure encountered during a group update is resolved through the tool's guided flow, without the developer dropping to a separate terminal. Validates FR-11, FR-12.
- **SM-4**: `shared-types` propagation status is answerable at a glance, without a manual repo-by-repo check, every time it's asked. Validates FR-14, FR-15.
- **SM-5**: The trace → fix → resume loop (fire a saved route request, see the relevant logs, get back to coding) stays fast enough not to break flow. Validates FR-20, FR-21, FR-22, FR-23.
- **SM-6**: Zero incidents of a non-member service breaking EDT work because it was left on a stray branch — branch state for every managed repo is always visible and correct. Validates FR-8, FR-9.

**Secondary**

- **SM-7**: *(Forward-looking, secondary persona)* Once shared with the team, a new developer reaches "ready to code" through the tool's guided setup, without hand-holding from the author. Not measured until §6.2's onboarding wizard is built.
- **SM-8**: *(Validates the tech bet, not a product feature)* Ink's documented rendering ceiling (~30 FPS cap, >50 MB baseline memory — research report) is not observed as a real problem in daily use of the aggregated log view. Falsifies or confirms the TypeScript/Ink recommendation itself; see Open Question 3 for the pre-identified fallback if it is hit.
- **SM-9**: *(Validates the tech bet)* Time-to-first-working EDT switch and time-to-first-working log stream during initial build, as a direct measure of the "near-zero language-adoption cost" claim behind the TypeScript/Ink choice (research report).

**Counter-metrics (do not optimize)**

- **SM-C1**: Auto-resolution of "known-safe" conflict cases (FR-11) never trades speed for safety — zero tolerance for silently discarded developer work, regardless of how safe a case looks. Counterbalances SM-1 and SM-3.
- **SM-C2**: Session-start speed (SM-1) is never achieved by skipping a migration or a health check — every service must genuinely reach the caught-up state, not just report a fast exit code. Counterbalances SM-1.

## 8. Open Questions

1. What is the manifest's exact schema (fields, file format, location convention), including how it declares a specific route-explorer scanner/auth implementation? Deferred to `bmad-architecture`.
2. The brief Must-scopes a "UI/UX approach" as a technical foundation alongside language/storage/manifest — this PRD resolves the other three but leaves navigation model, screen structure, and keybinding conventions undecided. Directly informs the Usability trust bar (Constraints and Guardrails). Recommend resolving via `bmad-ux`, before or alongside `bmad-architecture`.
3. Ink's documented ceiling (~30 FPS render cap, >50 MB baseline memory — research report) is a monitored risk, not yet observed in practice. OpenTUI (same React/TS API, Zig rendering core via Bun) is the pre-identified fallback if the aggregated log view's render frequency or dataset size hits it. No action needed now — revisit only if SM-8 shows it's actually a problem.

## 9. Assumptions Index

- §4.2 FR-3 — EDT member services are selected manually by the developer at creation time; no auto-detection mechanism exists.
- §4.5 FR-17 — Filtering supports regex specifically (not just free-text), a stronger capability commitment than explicitly stated in the brief.
