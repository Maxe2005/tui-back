# Brainstorm Intent: TUI Admin Tool for NestJS Microservices Backend

Source: full traceability in `_bmad-output/brainstorming/brainstorm-tui-back-admin-2026-08-06/.memlog.md` (French, raw session log). This document is the distilled, English intent input for downstream product-brief/PRD work. **No prioritization or MVP-scoping pass has happened yet** — see "Next Step" at the end.

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

Any of these breaks user trust and causes tool abandonment — treat as constraints, not nice-to-haves:

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

## Technical Directions — Morphological Analysis (5 Axes)

The session explored 5 axes. Some reached explicit decisions; most remain **open options** for a future convergence pass.

**Axis 1 — TUI language/tech: NOT DECIDED.** Options on the table, no preference locked in:
- Go + Bubbletea
- Python + Textual
- Node.js/TypeScript (matches backend stack, familiar to all devs)
- Minimalist TUI (gum/fzf/dialog) orchestrating independent standalone CLI scripts, each runnable alone
- Open question flagged for verification: is log streaming / OS signal interception meaningfully less smooth in TS vs Go/Rust, and how much would that affect daily use?

**Axis 2 — EDT config storage: DECIDED.**
- Stays local only, no network/cloud sync.
- Multiple files rather than one large file.
- Single storage mechanism: SQLite (no mixing text files + SQLite), since this data is not meant to be hand-edited.

**Axis 3 — UI/UX organization: NOT DECIDED**, one option explored:
- Multi-pane layout à la k9s/lazygit (EDT/repo sidebar + contextual central panel) plus a universal command palette (Ctrl+K) with fuzzy search to jump anywhere, including finding a gateway route.

**Axis 4 — External accessibility/scriptability of actions: DECIDED (converges with the core architectural direction).**
- Each action is a script with detailed/precise parameters, invoked/filled automatically by the TUI but also directly runnable by hand.

**Axis 5 — Long-term evolvability: DIRECTION PROPOSED, not fully decided.**
- Everything configurable/modular, to absorb a new micro-service or a process change (e.g., branch naming convention, shared-types workflow evolution) without core rework.
- Proposed direction: a per-repo manifest file (`repo.yaml`) describing that repo's own conventions (migration, branch naming, restart, health check) — the TUI stays generic; adding a micro-service means adding its manifest.

## AI-Integration Ambition (future consideration, not committed)

Aspirational direction raised in the session: connect the tool to an AI assistant (e.g., Claude) that anticipates/fixes errors, formalizes/automates the local git workflow, and surfaces context-appropriate views/actions without the developer building them manually. The "action = standalone script" architecture is explicitly what would make this realistic.

**Identified risk, not yet mitigated:** a poorly-bounded AI executor could loop-restart micro-services and saturate CPU, or destroy in-progress work if misconfigured. Strict guardrails (rate-limiting, confirmation prompts, limited scope) are required before any autonomous AI execution — this is a noted constraint on the *future* feature, not a specified solution.

There is also an open, unresolved concern (Critic pass): fully automated actions require the tool to silently resolve a large number of minor failure modes, or the whole action fails; new failure cases surface continuously, so "robustness" for automated actions is never fully finished. This is a standing risk to account for when scoping automation depth.

## Next Step (explicitly not done in this session)

This session was a **divergent exploration only** — no prioritization or MVP-scoping pass occurred. The memlog's closing synthesis names four directions as retained for a *future* convergence pass (architecture = standalone scripts as cornerstone; local multi-file SQLite EDT storage; per-repo manifest for evolvability; the 5 deal-breakers + 3 git security boundaries as non-negotiable acceptance criteria), but does not rank features, define an MVP, or resolve the open axes (1, 3, 5). A downstream convergence/prioritization session is required before this becomes a scoped plan.
