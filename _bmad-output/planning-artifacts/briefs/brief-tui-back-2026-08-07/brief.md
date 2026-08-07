---
title: TUI Admin Tool for NestJS Microservices Backend
status: final
created: 2026-08-07
updated: 2026-08-07
---

# Product Brief: TUI Admin Tool for a Microservices Backend

## Executive Summary

Developers on this NestJS microservices backend — a polyrepo of a gateway, nine active microservices, and a shared `shared-types` package, all Dockerized — currently manage everything *around* the code by hand: pulling and updating repos, running migrations, restarting containers, chasing logs across services, testing gateway routes, switching between concurrent work contexts. Today this is done through a handful of ad-hoc bash/Node scripts and a lot of manual checking; the scripts exist but are incomplete and were never built to handle the real edge cases (merge conflicts, migration failures, forgotten services).

This brief scopes a **local, terminal-based (TUI) admin tool** that takes over that entire "around the code" workflow — repo lifecycle, log observability, and workspace switching — so a developer opens the tool, starts coding within one guided action, and never gets blindsided by a service nobody remembered to update. It is built first against the author's real 10-service company backend (the gateway plus nine microservices), but with a deliberate architectural discipline — a generic core plus swappable, company-specific modules — so it can later extend to a structurally different personal project (no gateway, mixed Java/Python services). It is also a personal craft project: part of the point is the experience of designing and building the tool itself.

## Who This Serves

- **Primary (day one): the author**, working solo across this company's 10-service backend. Success is measured against their own daily workflow first.
- **Secondary (once usable): teammates**, especially new hires — the pitch most likely to land with them is a setup that "just works" out of the box, not an efficiency argument to convince existing devs.
- **Active tertiary persona, deliberately deferred: the author again, on a second personal project** — a different microservices backend with no gateway and services in Java and Python. This persona is real and shapes architecture decisions now, but proving the tool actually works for them is an explicit later milestone, not part of the first version's definition of done (see Scope).

## The Problem

The current workflow is entirely manual and self-assembled:

- **Repo lifecycle is tedious and error-prone.** Updating all repos to the latest `development`, running migrations, restarting containers, and propagating a new `shared-types` version across every affected service are separate manual steps today (`update-services.sh` is run by hand roughly every 2–3 days). Nothing enforces that every affected service actually gets updated — a forgotten service is a real, recurring failure mode, not a hypothetical one.
- **No single source of truth for logs or service health.** `check_health.sh` already has to auto-restart failing services because health isn't visible enough by default. Diagnosing an issue means jumping between multiple terminals/services with no aggregated view.
- **Switching between concurrent work contexts is manual and risky.** Multiple in-progress "workspaces" (a topic + its affected services + branches) exist at once, and nothing protects against losing uncommitted work when switching between them.
- **Testing gateway routes during development is clunky.** The generated Swagger UI is too cluttered for daily use; there is no quick way to re-run a previously-used request, and authenticating against protected routes has to be redone by hand every time.
- **The existing scripts don't hold up under real conditions.** They encode service names and container-naming conventions by hand (duplicated across scripts, no shared registry), skip cases they can't handle (e.g., a merge conflict just prompts "stash, open in VSCode, or cancel"), and were never designed to close the loop from error to resolution. A live signal of the cost of low visibility: an internal RPC-message audit found 31% of declared message patterns across services are orphaned/dead code — a problem invisible without dedicated tooling.

## The Solution

A local TUI, run per-developer against their own Docker containers, organized around three jobs: **aggregated log observability**, **automated repo lifecycle management**, and **frictionless switching between "EDT" (workspace) contexts**. Every action the tool performs — a repo update, a migration run, a shared-types propagation, a health check — is implemented as a standalone, parameterized script: invoked automatically by the TUI, but equally runnable by hand or chained by future automation/CI. This is what makes the tool trustworthy (auditable, scriptable, extensible) and is the architectural core the rest of the product builds on.

Concretely, in a normal day: open the tool, switch to (or create) the EDT for the current task, pull the latest `development` into every affected service with migrations run automatically and errors surfaced with assisted resolution (not just displayed) — then code. Mid-session, fire a gateway route with a reused, saved request body (auth handled automatically, not re-built by hand each time), see the resulting logs immediately, filtered to the services that matter, and get back to coding. Publish a new `shared-types` version and know — without checking repo by repo — that every service in the EDT is on it.

## What Makes This Different

This isn't being built because existing tools (Tilt, Garden, Skaffold, DevSpace, Backstage, etc.) were evaluated and found lacking — they weren't compared. Two things justify a purpose-built tool over adopting one of those or simply extending the current bash scripts:

- **The current scripts are a real, working starting point, not a straw man** — they already encode this team's actual conventions (branch fallback logic, migration commands, container naming, health-check aggregation). But they were built iteratively and never pushed far enough: no shared service registry, thin error handling, no workspace concept at all. A purpose-built tool can absorb what they got right and go much further, instead of retrofitting generic tooling to this backend's specific shape.
- **A declared intent, not (yet) a proven one, to be reusable beyond this backend** — a generic core with company-specific logic isolated into swappable modules, applied to a stack that today is 100% Node/NestJS with a gateway. This is a design discipline applied from day one; it is explicitly *not* validated against a structurally different stack in the first version (see Scope).
- **Personal motivation is part of the value proposition** — the craft goal named in the Executive Summary is a legitimate driver here, not a gap to paper over.

## Success Criteria

Signals the author will look for after real use on the company backend (not abstract "it's faster"):

- Starting a coding session becomes one guided action — open the tool, switch or create the right EDT, pull the latest `development` across every affected service with migrations run — instead of a manual multi-step sequence.
- **Zero "forgotten service" incidents** — a service silently left out of date no longer causes surprise bugs.
- Merge and migration failures during an update are met with **assisted resolution**: the tool helps trace and fix the failure, not just surface a raw error the developer has to independently investigate.
- Publishing a new `shared-types` version comes with confidence — not a repo-by-repo manual check — that every service in the current EDT is on the new version.
- Mid-coding, firing a saved/reused route request and getting an aggregated, filterable log view back is fast enough that it doesn't break flow — trace, fix, and resume coding in one loop.
- Once shared with the team: a new developer's local environment reaches "ready to code" through the tool's guided setup, without hand-holding from the author.

## Non-Negotiable Constraints

These are trust and safety bars, not features to prioritize — every Must-scope capability below has to already satisfy them:

- No data loss on EDT switch (uncommitted work is always auto-preserved).
- No perceptible slowness — sluggishness sends the developer back to bash.
- Navigation must never be confusing enough to cause outright rejection.
- Errors surfaced by the tool must come with an integrated detect → fix → re-verify loop, not just a mirror of the failure.
- The tool must never force a developer to check another source to get the full picture (single source of truth).
- **Git access is strictly scoped:**
  - Only local repo copies are ever touched — never a remote/deployed environment.
  - No commit or push without explicit developer approval.
  - Write access is limited to the developer's own feature/fix branches.
  - `development`, preprod, and prod are read-only.
  - An EDT must never register a shared branch as "its own."

## Scope

**Must (first real, buildable version, built and validated against the company backend):**
- The standalone-script core architecture (every action = an auditable, parameterized script).
- EDT workspace management: persistent context, protected switching, auto-created/managed workspaces.
- Repo lifecycle: generic group-update and migration execution in the core; `shared-types` propagation as a company-specific module.
- Observability: generic, aggregated/filterable log viewing in the core; the gateway route explorer (with saved/reusable request bodies and automatic dev-mode authentication) as a company-specific module.
- Technical foundations: TUI language/tech choice, local multi-file SQLite storage for EDT state (decided), UI/UX approach, and a per-repo manifest format that also declares which company-specific modules are active.

**Could:**
- Guided, step-by-step installation/onboarding (wizard, known-error solution base) — valuable once the tool is shared with teammates, not needed while the author is the only user.

**Won't (this time):**
- An AI-copilot layer that anticipates/fixes errors or automates the git workflow. The Must-scope (standalone scripts + strict git boundaries) is deliberately laying groundwork that would make this safe later, but a poorly-bounded AI executor (runaway restarts, destroyed in-progress work) is an unmitigated risk that rules it out for now.
- Validating the generic-core architecture against the second, structurally different personal project (no gateway, Java/Python). The discipline is applied now; the proof comes once the company-backend version is solid.

## Vision

Two to three years out, if this works: the tool is the default way the author (and by then, their team) works against this backend day to day — the ad-hoc scripts it replaced are a distant memory, onboarding a new developer is a non-event, and nobody has lost work to an environment switch in a long time. Beyond the company, the generic-core/company-module split has been proven on at least one structurally different stack (the Java/Python, gateway-less personal project), turning what started as a very specific internal tool into something the author can credibly reuse — or hand to someone else facing the same "everything around the code is manual" problem on a different microservices backend.
