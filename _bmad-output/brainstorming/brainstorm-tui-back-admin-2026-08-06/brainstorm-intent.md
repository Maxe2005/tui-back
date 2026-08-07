# Brainstorm Intent: TUI Admin Tool for NestJS Microservices Backend

Source: full traceability in `_bmad-output/brainstorming/brainstorm-tui-back-admin-2026-08-06/.memlog.md` (French, raw session log). This document is the distilled, English intent input for downstream product-brief/PRD work.

**Convergence has happened.** The session ran divergent exploration (Role Playing, Morphological Analysis, Disney Method, JTBD) followed by an explicit convergence phase (Affinity Clustering into 7 themes, then MoSCoW prioritization). The scoping outcome is captured below in "Convergence Outcome (MoSCoW)" — this is no longer an open-ended exploration; it is ready to feed a product brief / PRD.

## Core Problem / Opportunity

Developers on a NestJS microservices backend (multiple service repos + a gateway + a shared-types package, all Dockerized) currently manage everything *around* the code by hand or via a handful of ad-hoc personal scripts: repo updates, migrations, log inspection, switching between work contexts. There is no single tool for this. The opportunity is a **local TUI tool** that lets a developer administer this stack — locally, on their own machine, against their own Docker instances — without leaving the terminal.

Each developer runs their own local instance of the tool and their own Docker containers; the only possible collision between colleagues is at the git level (shared branches), never Docker, ports, or local resources.

## Primary Value Proposition — 3 Jobs To Be Done

These three jobs matter more than any individual feature and should anchor scoping:

1. **Log search & aggregation** — quickly view logs for a single isolated micro-service, *and* have a dashboard aggregating logs from multiple micro-services in one interface. Search/assemble log views across services, not just tail one at a time.
2. **Tedious repo lifecycle management** — the tool takes over the "boring" repo lifecycle work (updates, migrations, conflict handling) on the developer's behalf.
3. **Frictionless switching between work environments ("EDT")** — switch between multiple in-progress, multi-repo work contexts without friction.

Underlying motivation for all three: save time on repetitive, unrewarding chores (comfort/efficiency gain, not a survival need). The current competing "solution" is a mix of personal ad-hoc scripts plus manual work.

## Non-Negotiable Trust Deal-Breakers (hard acceptance criteria)

Any of these breaks user trust and causes tool abandonment — treat as constraints, not nice-to-haves. As confirmed in convergence, these apply as **cross-cutting quality bars to every Must-scope item** (see below), not as a separately-prioritized feature:

1. **No data loss on workspace switch.** Losing uncommitted changes when switching EDT is unacceptable — automatic stash/save per EDT is mandatory.
2. **No slowness.** If the tool is slow, developers fall back to bash scripts.
3. **No confusing navigation.** Difficult/confusing navigation causes outright rejection of the tool.
4. **Errors need an integrated resolution loop, not just a mirror.** Displaying an error is not enough if fixing it requires manually re-running logs by hand — the tool must close the loop (detect → fix → re-verify), not just surface the problem.
5. **No incomplete views.** If the tool ever forces the developer to check another source to get the full picture, it fails as a single source of truth.

## Git Security Boundaries (hard constraints)

1. The tool administers **only local developer copies** of repos — never a remote/deployed environment.
2. **No commit or push without explicit developer approval** — no silent git actions, ever.
3. The tool **never commits or pushes to `development`, preprod, or prod** — write access is limited to feature/fix/refactor branches owned by the current work. Shared branches (development/preprod/prod) may only be **read**, to sync/update dev branches from them. A workspace (EDT) must never register a shared branch as "its own" branch — only per-micro-service dev branches.

## Key Architectural Direction: "Each Action = a Standalone Script"

This is the load-bearing idea of the session, converging four separate concerns:

- **AI-executability**: an AI agent can invoke a well-defined script far more reliably than it can drive an interactive TUI.
- **External scriptability**: any action (repo update, multi-service migration, etc.) is a script with detailed/precise parameters, invoked and filled automatically by the TUI, but also directly runnable by hand for combinations the UI didn't anticipate (e.g., a colleague repurposing a script for a different need, or a future CI/automation chaining them).
- **Guided onboarding**: scripts are the natural building blocks for step-by-step guided installation/setup.
- **Auditable, scope-limited safety**: standalone scripts with explicit parameters are inherently easier to audit and constrain than free-form actions — this is the mechanism that would make future AI guardrails (rate-limiting, confirmation, limited scope) feasible.

Concrete pattern to replicate for every action (first instantiated for shared-types propagation): modify `package.json` → `npm install` → restart the service's Docker container → health check → on failure, surface that service's Docker logs directly. This is the reference implementation of deal-breaker #4 (integrated error-resolution loop).

## Workspace ("EDT") Concept

An EDT (environnement de travail / work environment) bundles the micro-services affected by a given topic plus their respective dev branches, and is designed to be switched without losing uncommitted work (see deal-breaker #1). Capabilities:

- Tool remembers the current EDT at startup; context persists across sessions.
- Micro-services belonging to the EDT launch automatically when it's opened.
- Group update of all repos in an EDT to the latest shared `development` state, with automatic migration execution; errors surface directly in the tool.
- Optional selective propagation of an update to other active EDTs.
- Two-level status view: per-repo (individual) and a global dashboard.
- Switching EDT resumes the in-progress coding session immediately (branch + context).
- New shared-types versions can be propagated to all micro-services in the EDT via a single action (see script pattern above).
- Supports "favorite routes" scoped to that workspace on the home-grown Swagger explorer (see below).

## Home-Grown "Swagger" Requirement

The existing generated Swagger UI is too cluttered to be useful day-to-day. Needed instead:

- A searchable/findable route explorer for the gateway.
- Routes are directly executable from the tool.
- The tool remembers routes already used within an EDT (contextual history per workspace), including the body/params used per request, reusable in one click.
- After sending a request, immediate visibility into logs (individual or global dashboard view) — closing the loop between "call a route" and "see what happened."

## Architecture Principle: Generic Core vs. Company-Specific Modules

**This is a late but critical precision from the session — it governs how every feature above must be implemented, not just what gets built.**

The tool is being built for the author's company backend, but must stay easily extensible to any other microservices backend. Anything specific to the company's own architecture (e.g., the gateway routing logic, the shared-types propagation logic) must be a configurable/pluggable module — never baked into the generic core.

**Decision heuristic**, to be applied to every candidate feature: *"Is this intrinsic to microservices architecture in general, or specific to my company's architecture?"*
- Generic → belongs in the core.
- Company-specific → belongs in a module.

**Connection insight**: the per-repo `repo.yaml` manifest (from the technical-foundations axis, see below) is the natural place to declare which company-specific modules are active for a given repo. This is not a new mechanism — it's the "action = standalone script" pattern applied to portability: the manifest just declares which pluggable, script-based modules apply.

## Convergence Outcome (MoSCoW)

The memlog's raw ideas were grouped via Affinity Clustering into 7 themes, then prioritized via MoSCoW with explicit user verdicts. This is the scoping result:

### Must (first real buildable version)

- **Theme 1 — "Action = standalone script"** as the architectural cornerstone (core).
- **Theme 2 — EDT** (context/switch/persistence).
- **Theme 3 — Repo lifecycle management**: the generic parts (group update, migration execution) live in the core; shared-types propagation is a company-specific module.
- **Theme 4 — Observability**: generic log aggregation lives in the core (required mechanically by deal-breaker #5, complete-view); the gateway route explorer is a company-specific module.
- **Theme 6 — Technical foundations**: TUI language/tech choice; EDT storage in local multi-file SQLite (already decided); UI/UX organization; and the `repo.yaml` manifest format — including declaring which company-specific modules are active per repo.

All Must items are constrained non-negotiably by the 5 trust deal-breakers and the 3 git security boundaries, applied as cross-cutting quality bars — not as a separately-prioritized theme.

### Could

- **Theme 5 — Onboarding & guided installation only** (step-by-step wizard, known-error solution base). Explicitly: the 5 deal-breakers themselves are NOT part of this "Could" — they stay non-negotiable regardless of feature priority.

### Won't (this time)

- **Theme 7 — AI copilot ambition**: an AI assistant (e.g., Claude) anticipating/fixing errors and automating the local git workflow. Deferred, but note:
  - The Must-scope (standalone scripts + strict git security boundaries) is already the groundwork that would make this safe to build later.
  - Standing constraint carried forward from the Critic pass: a poorly-bounded AI executor could loop-restart services (CPU saturation) or destroy in-progress work if misconfigured — this risk is not yet mitigated and must be addressed before any future autonomous AI execution.

### Open technical question, now a selection criterion

Whether log streaming / OS signal interception is meaningfully less smooth in TypeScript than in Go/Rust is no longer a side curiosity — it is a **direct selection criterion for the Must-have technical-foundations axis (language/tech choice)**, via deal-breaker #2 (no slowness). Worth resolving early.

## Ready for Next Step

This intent doc is now scoped (core problem, JTBD, deal-breakers, security boundaries, standalone-script architecture, generic-core/company-module split, and MoSCoW-prioritized Must/Could/Won't) and ready to feed directly into `bmad-product-brief` or `bmad-prd` for MVP definition.
