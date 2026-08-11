---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - _bmad-output/planning-artifacts/briefs/brief-tui-back-2026-08-07/brief.md
  - _bmad-output/brainstorming/brainstorm-tui-back-admin-2026-08-06/brainstorm-intent.md
workflowType: 'research'
lastStep: 1
research_type: 'technical'
research_topic: 'TypeScript (Node.js) vs Go pour un outil TUI admin local'
research_goals: >-
  Trancher le choix technologique pour le socle technique (Must-scope
  "technical foundations") de l'outil TUI décrit dans le brief, en résolvant
  le critère de sélection ouvert issu du brainstorming (fluidité du streaming
  de logs / interception de signaux OS en TypeScript vs Go, deal-breaker
  "pas de lenteur"). Recommandation argumentée, pondérée par la familiarité
  actuelle de l'utilisateur (TS/NestJS quotidien depuis 1 an, Go jamais
  pratiqué), sur 4 axes : streaming de logs & I/O concurrent, interception de
  signaux OS & gestion de process (Docker), écosystème de bibliothèques TUI
  (Ink/blessed vs Bubble Tea/tview), distribution & packaging (binaire
  standalone pour onboarding futur).
user_name: 'Max'
date: '2026-08-07'
web_research_enabled: true
source_verification: true
---

# Research Report: Technical Research

**Date:** 2026-08-07
**Author:** Max
**Research Type:** Technical

---

## Executive Summary

Ce rapport tranche la question ouverte issue du brainstorming : TypeScript
(Node.js) ou Go pour le socle de l'outil TUI admin décrit dans le brief. Sur
les six axes examinés — streaming de logs & concurrence I/O, signaux OS &
intégration Docker, écosystème TUI, distribution/packaging, patterns
architecturaux, et adoption/implémentation — cinq penchent en faveur de
TypeScript ou sont neutres ; seule la maturité des outils de test spécifiques
aux TUI penche pour Go/Bubble Tea, sans renverser la recommandation.

**Constats clés :**

- Le workload réel (≤10 flux `docker logs -f`, pas de charge CPU intensive)
  est un cas d'usage I/O-bound où le modèle event-loop de Node.js est adapté ;
  l'avantage de parallélisme de Go reste une marge inutilisée.
- L'écosystème TUI TypeScript (Ink) a une trace de production à grande
  échelle (Claude Code, Copilot CLI, Gemini CLI) et un risque connu et borné
  (plafond ~30 FPS, empreinte mémoire) avec une porte de sortie déjà
  identifiée (OpenTUI) si besoin.
- L'asymétrie la plus structurante concerne `shared-types` : TypeScript le
  réutilise nativement (zéro traduction), Go nécessiterait une génération de
  code ou une duplication manuelle — exactement le mode de défaillance
  ("dupliqué à la main, pas de registre partagé") que le brief cherche à
  éliminer.
- Le pattern hexagonal + plugin/microkernel formalise directement la
  discipline "noyau générique + modules spécifiques" déjà voulue par le
  brief, indépendamment du langage retenu.
- Le risque Go dominant (bugs de concurrence — goroutines/channels, cité
  comme le point le plus difficile pour les développeurs JS/TS) porte
  précisément sur la fonctionnalité cœur du projet (streaming de logs), sans
  filet de compétence préalable côté auteur.

**Recommandation :** TypeScript (Node.js) + Ink, avec `better-sqlite3`,
`dockerode`, `openapi-typescript`, et `jose` — détail complet en section
"Technical Research Recommendations".

---

## Research Overview

This report evaluates TypeScript (Node.js) vs Go as the implementation
language for the local TUI admin tool scoped in the product brief
(`brief-tui-back-2026-08-07`). It resolves the open selection criterion
flagged in the brainstorming session: whether log streaming and OS signal
interception are meaningfully less smooth in TypeScript than in Go, evaluated
against the tool's non-negotiable "no perceptible slowness" constraint. The
recommendation is weighted by the author's current TS/NestJS fluency versus
zero prior Go experience.

---

## Technical Research Scope Confirmation

**Research Topic:** TypeScript (Node.js) vs Go pour un outil TUI admin local

**Research Goals:** Trancher le choix technologique pour le socle technique
(Must-scope "technical foundations") de l'outil TUI décrit dans le brief, en
résolvant le critère de sélection ouvert issu du brainstorming (fluidité du
streaming de logs / interception de signaux OS en TypeScript vs Go,
deal-breaker "pas de lenteur"). Recommandation argumentée, pondérée par la
familiarité actuelle de l'utilisateur (TS/NestJS quotidien depuis 1 an, Go
jamais pratiqué), sur 4 axes : streaming de logs & I/O concurrent,
interception de signaux OS & gestion de process (Docker), écosystème de
bibliothèques TUI (Ink/blessed vs Bubble Tea/tview), distribution & packaging
(binaire standalone pour onboarding futur).

**Technical Research Scope:**

- Architecture Analysis - design patterns, frameworks, system architecture
- Implementation Approaches - development methodologies, coding patterns
- Technology Stack - languages, frameworks, tools, platforms
- Integration Patterns - APIs, protocols, interoperability
- Performance Considerations - scalability, optimization, patterns

**Research Methodology:**

- Current web data with rigorous source verification
- Multi-source validation for critical technical claims
- Confidence level framework for uncertain information
- Comprehensive technical coverage with architecture-specific insights

**Scope Confirmed:** 2026-08-07

---

## Technology Stack Analysis

### Programming Languages: Concurrency & Performance Model

Go's goroutines are managed lightweight threads that start at roughly 2 KB of
stack space, versus 1–8 MB for an OS thread — this is what lets Go handle
many concurrent I/O streams (e.g. tailing 10 containers' logs at once) with a
straightforward "one goroutine per stream" model and true parallelism across
cores. Node.js instead uses a single-threaded, event-driven, non-blocking I/O
model: it handles many concurrent connections/streams efficiently as long as
the work per event stays cheap, but any CPU-heavy step blocks the event loop
for everything else (all other log streams, UI redraws) until it completes.

_For this project's actual shape_ — a handful of `docker logs -f` streams (≤10
services) plus occasional CLI/API calls, not thousands of concurrent
connections — this is squarely an **I/O-bound workload**, the case where
Node's event-loop model "works extremely well" and where Go's parallelism
advantage is largely unused headroom rather than a decisive edge.
_Source: [Node.js vs Go in 2026: Performance, Concurrency, and When to Use Each](https://medium.com/@krunalkanojiya/node-js-vs-go-in-2026-performance-concurrency-and-when-to-use-each-96392afe7430), [Comparing Node.js concurrency models — nodejs.org](https://nodejs.org/learn/concurrency/comparing-nodejs-concurrency-models)_

**Child-process log streaming:** Node's `child_process.spawn()` streams
stdout/stderr as it's produced rather than buffering it — "the right choice
for anything long-running or with unpredictable output size," which is
exactly the `docker logs -f` case this tool needs. There's no evidence in
current sources that Node's streaming primitives are meaningfully less smooth
than Go's for this pattern; the difference shows up under CPU-bound
concurrent load, not under a handful of concurrent I/O streams.
_Source: [Node.js vs Go in 2026 — Krunal Kanojiya](https://medium.com/@krunalkanojiya/node-js-vs-go-in-2026-performance-concurrency-and-when-to-use-each-96392afe7430)_

### OS Signal Handling & Process/Docker Integration

Both languages have first-class, well-documented mechanisms for graceful
shutdown on `SIGINT`/`SIGTERM`: Go via `os/signal` (typically a channel fed
by `signal.Notify`, consumed with a `select`), Node.js via `process.on()`
event listeners for the same signals. Neither source set surfaces a
capability gap — Go's channel-based model is idiomatically cleaner for
composing multiple concurrent shutdown steps, but Node's event-listener model
covers the same cases for this tool's scope (stop log tailing, close DB
handles, leave running containers alone since git/Docker are not
force-killed per the brief's constraints).
_Source: [Graceful Shutdown in Go: Practical Patterns — VictoriaMetrics](https://victoriametrics.com/blog/go-graceful-shutdown/), [Graceful Shutdown in Node.js — DEV Community](https://dev.to/superiqbal7/graceful-shutdown-in-nodejs-handling-stranger-danger-29jo)_

**Docker integration:** Node's `dockerode` gives native stream support for
container log streaming (with optional demultiplexing of stdout/stderr) and
callback/promise interfaces over the Docker Remote API — directly usable for
this tool's aggregated-log-view requirement. Go has the official Docker SDK,
which is what `dockerode` itself models its API on. Both are actively
maintained, first-class clients against the same Docker Engine API; no
current source documents a meaningful capability or performance gap between
them for log streaming specifically — the comparison is a wash.
_Source: [dockerode — GitHub](https://github.com/apocas/dockerode), [Develop with Docker Engine SDKs — Docker Docs](https://docs.docker.com/reference/api/engine/sdk/)_

### TUI Framework Ecosystem

This is the axis with the sharpest, most consequential differences.

- **Ink (TypeScript/React)** — powers Claude Code, GitHub Copilot CLI, Gemini
  CLI, and the Gatsby CLI; Ink 6 + React 19 is the current stack. Its
  React/JSX component model (props, state, hooks) is a direct extension of
  the author's existing NestJS/TS fluency — near-zero ramp-up cost. The
  documented weakness: a **hardcoded ~30 FPS render cap** and a **memory
  footprint exceeding 50 MB even for basic apps**, both architectural
  limits of Ink's pure-JS rendering pipeline.
- **Bubble Tea (Go)** — Charm's Go port of The Elm Architecture; the
  foundation under `lazygit`, `gh`, `gum`, `soft-serve`. Bubble Tea v2
  (2026) replaced string-based rendering with a declarative `View` struct.
  Go/Rust TUI libraries "produce smaller binaries and have marginally
  better raw performance" than JS-based ones, but require learning both a
  new language and the Elm-style model/update/view paradigm from zero.
- **OpenTUI (TypeScript/React + Zig, via Bun)** — a 2026 entrant that
  removes Ink's FPS cap and cuts the memory footprint, by keeping the
  React/TS developer-facing API but moving rendering to a native Zig core
  reached through Bun's FFI. It directly targets Ink's two documented
  weaknesses while staying inside the TypeScript ecosystem — but it is
  new, tied to the Bun runtime specifically, and does not yet have Ink's
  track record in production tools.

Both 2026 sources agree on the practical decision rule: "if you're writing
Go, and many TUI tools are written in Go for single-binary distribution,
Bubble Tea is the obvious choice; if you live in JavaScript and think in
JSX, Ink is great." Given this project's constraint set (fast solo
iteration, TS fluency, no prior Go), this rule points at the TS side of the
tree — with OpenTUI as a credible answer to Ink's specific weaknesses if the
30 FPS cap or memory footprint become an observed problem in practice,
without requiring a language switch.
_Source: [The TUI Renaissance 2026 — youngju.dev](https://www.youngju.dev/blog/culture/2026-05-14-tui-development-ratatui-bubbletea-ink-textual-terminal-ui-renaissance-deep-dive-2026.en), [OpenTUI: React-Based Terminal UIs with a Zig Rendering Core — Better Stack](https://betterstack.com/community/guides/scaling-nodejs/opentui-react/), [The TUI library that's killing Ink — Stork.AI](https://www.stork.ai/blog/the-tui-library-thats-killing-ink)_

### Local Storage: SQLite Driver Ecosystem

The brief already decided on local multi-file SQLite for EDT state, so the
question is driver maturity, not the database choice itself.

- **Node.js — `better-sqlite3`**: "the fastest and simplest library for
  SQLite3 in Node.js," synchronous API, production-hardened for years,
  faster than `node-sqlite3` in most cases. This is the de facto standard
  choice and fits well with a local, single-process TUI (no need for
  async DB calls to avoid blocking a server request pool).
- **Go — two competing drivers with a real trade-off**: `mattn/go-sqlite3`
  wraps the official SQLite C library via CGO for full feature support and
  maximum performance, but CGO complicates cross-compilation (a relevant
  cost given this project also wants easy binary distribution for future
  teammates). `modernc.org/sqlite` is a pure-Go, CGO-free reimplementation
  that simplifies deployment but was observed to be roughly **twice as
  slow** as `mattn/go-sqlite3` in initial benchmarks.

For this project's scale (local EDT/workspace metadata, not high-throughput
transactional load), either ecosystem is comfortably fast enough — but
`better-sqlite3` avoids the CGO/pure-Go trade-off Go developers have to make
explicitly.
_Source: [better-sqlite3 — GitHub](https://github.com/WiseLibs/better-sqlite3), [sqlite-cgo-no-cgo benchmark — GitHub](https://github.com/multiprocessio/sqlite-cgo-no-cgo)_

### Distribution & Packaging (Single-Binary Onboarding)

Go's "compile to one dependency-free binary" has traditionally been its
strongest practical argument for CLI/TUI tools, and it remains simpler and
more mature: `go build` cross-compiles to any target OS/arch out of the box,
with no runtime to bundle.

Node.js has closed most of this gap by 2026 through several converging
options: **Node.js SEA** (Single Executable Applications, stable since Node
22, "significantly improved in Node 24") compiles an app into one native
binary with no Node/npm/`node_modules` required at runtime; **`vercel/pkg`**
remains widely used for the same purpose; **`bun --compile`** produces the
smallest/fastest JS-based binary but means adopting the Bun runtime instead
of Node. The current framing in the sources: "Go's advantage in CLI
distribution... is now achievable with Node.js through multiple modern
solutions" — the gap has narrowed to a maturity/track-record difference, not
a capability gap, though Go's tooling is more battle-tested for this
specific concern.
_Source: [Node.js SEA in 2026: Single Executable Apps Production Guide — HireNodeJS](https://www.hirenodejs.com/blog/nodejs-single-executable-applications-2026), [Notes on compiling/packaging a node.js project as a single binary — GitHub Gist](https://gist.github.com/jedi4ever/5569381)_

### Technology Adoption Trends

TypeScript adoption reached 78% among professional developers in 2026 (80%
at tech-forward companies), continuing to widen its lead over plain
JavaScript. Go remains a top "most desired language for future development,"
alongside Rust, cited for performance/safety/flexibility — but this reflects
interest in learning Go, not evidence that Go is required for a project of
this shape. Notably, several flagship 2026 terminal-based AI/dev tools
(Claude Code, GitHub Copilot CLI, Gemini CLI) ship on Ink/TypeScript, which
is direct evidence that TS-based TUI tooling is production-proven at scale
in exactly this application category (interactive dev-tool TUIs), not just
web backends.
_Source: [Developer Survey 2026: TypeScript 80%, AI Paradox — byteiota](https://byteiota.com/developer-survey-2026-typescript-80-ai-paradox/), [The TUI Renaissance 2026 — youngju.dev](https://www.youngju.dev/blog/culture/2026-05-14-tui-development-ratatui-bubbletea-ink-textual-terminal-ui-renaissance-deep-dive-2026.en)_

---

## Integration Patterns Analysis

*Adapted to this project's actual integration surface: a local TUI consuming
the company's NestJS gateway (route explorer module) and its `shared-types`
package, not a networked/distributed service — so REST/GraphQL/gRPC design,
service mesh, and message-broker patterns from the generic playbook are out
of scope. What matters here is how cleanly each language ecosystem consumes
an existing NestJS backend's contracts.*

### Consuming the Gateway's OpenAPI/Swagger Contract

Both ecosystems have mature OpenAPI tooling, but with different centers of
gravity. On the Go side, **`oapi-codegen`** generates Go client/server
boilerplate directly from OpenAPI 3 specs and is the actively-recommended
option (older **`go-swagger`** is still widely used but caps out at
OpenAPI 2.0). On the TypeScript side, **`openapi-typescript`** is the most
popular generator, producing types directly usable by the route explorer
module. Both tool families are mature and comparably capable; the deciding
factor is which side the *source of truth* naturally lives on.
_Source: [Comparison guide: OpenAPI/Swagger Go client generation — Speakeasy](https://www.speakeasy.com/docs/sdks/languages/golang/oss-comparison-go/), [oapi-codegen — GitHub](https://github.com/oapi-codegen/oapi-codegen), [How to Work with OpenAPI in Go — freeCodeCamp](https://www.freecodecamp.org/news/how-to-work-with-openapi-in-go/)_

### `shared-types` Reuse — the Most Consequential Integration Finding

This is the sharpest asymmetry found in this research, and it bears directly
on the brief's `shared-types` propagation module and the route explorer's
request/response typing:

- **TypeScript path**: the tool can add the company's `shared-types` package
  as a direct workspace/npm dependency and get the *exact same types* the
  gateway and services already use — zero translation layer, zero codegen
  step, structurally impossible to drift from what NestJS actually emits.
  This is the standard npm/pnpm workspace pattern already in use across the
  company's polyrepo.
- **Go path**: Go has no equivalent to importing a TypeScript package
  directly. The only viable routes are (a) generating Go structs from the
  gateway's OpenAPI spec via `oapi-codegen`/`go-swagger`, which only covers
  what's exposed over HTTP and must be regenerated and drift-checked on
  every gateway change, or (b) hand-maintaining a parallel Go type
  definition of `shared-types`, which reintroduces exactly the
  "duplicated-by-hand, no shared registry" failure mode the brief already
  names as a problem with the current bash scripts.
_Source: [Sharing Code in TypeScript is (Still) a Mess — Bruno Scheufler](https://brunoscheufler.com/blog/2022-08-28-sharing-code-in-typescript-is-still-a-mess), [Monorepo Explained — monorepo.tools](https://monorepo.tools/typescript)_

This asymmetry only cuts one way because the *rest of the stack* (gateway +
9 microservices) is TypeScript/NestJS today — it is a property of this
specific integration target, not of Go generally. It would disappear (or
reverse) if the stack itself were Go, which is worth flagging explicitly
since the brief's tertiary persona is a Java/Python backend with no gateway
— there, this particular argument for TS would not carry over.

### Dev-Mode Authentication for the Route Explorer

The brief requires automatic dev-mode authentication for the route explorer
(no manual re-auth per session). Both ecosystems have mature, current JWT
libraries: Node's ecosystem is mid-migration from the legacy `jsonwebtoken`
(Node-crypto-only, no edge-runtime support) toward **`jose`** — described as
"the definitive JWT library for the JavaScript ecosystem" — while Go's
**`golang-jwt/jwt`** is "the most popular package for implementing JWTs in
Go," supporting the same signing algorithm set (HMAC, RSA, RSA-PSS, ECDSA,
EdDSA). For this project's actual need — sign/attach a short-lived dev token
automatically, not build a full auth server — either library is more than
sufficient; there's no capability or maturity gap here.
_Source: [oslo vs arctic vs jose: JWT Auth for Node.js 2026 — PkgPulse](https://www.pkgpulse.com/guides/oslo-vs-arctic-vs-jose-jwt-auth-libraries-nodejs-2026), [golang-jwt/jwt — GitHub](https://github.com/golang-jwt/jwt)_

### Interoperability Summary

For the two integration points that actually exist in this project (gateway
OpenAPI contract, `shared-types` reuse), TypeScript has a structural
advantage specific to this codebase being TS/NestJS end-to-end: it can
consume `shared-types` natively with zero translation layer, while Go would
need an ongoing codegen or hand-sync step for the same guarantee. OpenAPI
tooling and JWT/auth libraries are a wash between the two ecosystems — both
mature enough that language choice doesn't move the needle there.

---

## Architectural Patterns and Design

### System Architecture Patterns

**The Elm Architecture (MVU) for the TUI layer.** Both TUI framework families evaluated in the technology-stack section converge on the same UI architecture: a `Model` holding all state, a `View` function that renders it, and an `Update` function that folds incoming messages (keypresses, log lines, script results) into a new model. Bubble Tea implements this directly and is described as MVU applied natively to Go; Ratatui's own docs frame TEA as the reference pattern for Rust/Go-style immediate-mode TUIs. Ink diverges structurally — it's React's component/hook model, not strict MVU — but a reducer-based state store (`useReducer`) reproduces the same unidirectional-flow discipline inside the JSX tree. For a tool juggling concurrent log streams, script-run status, and EDT-switch state, this pattern matters more than the language choice: it is what keeps "which of N concurrent things changed" tractable as the tool grows past a single screen.
_Source: [The Elm Architecture (MVU Pattern) — DeepWiki/bubbletea](https://deepwiki.com/charmbracelet/bubbletea/1.1-the-elm-architecture-(mvu-pattern)), [The Elm Architecture (TEA) — Ratatui](https://ratatui.rs/concepts/application-patterns/the-elm-architecture/)_

**Hexagonal architecture (ports & adapters) for the generic-core / company-module split.** This is a near-literal match for the brief's stated design discipline: "a generic core with company-specific logic isolated into swappable modules." In hexagonal terms, the domain core (EDT/workspace lifecycle, script orchestration, log aggregation) exposes **ports** — abstract contracts like "propagate a shared-package version across a service group" or "resolve a route-explorer request" — that the current NestJS/`shared-types`/gateway **adapter** implements today, and that a future Java/Python adapter (the deferred tertiary persona) would implement differently without touching the core. The CLI/TUI itself is a *driving* adapter into the same core use cases a hand-invoked script also drives — which is exactly the brief's requirement that every action be "equally runnable by hand or chained by future automation."
_Source: [Hexagonal Architecture in Practice — Java Code Geeks](https://www.javacodegeeks.com/2025/06/hexagonal-architecture-in-practice-ports-adapters-and-real-use-cases.html), [Hexagonal Architecture (Ports and Adapters) — generalistprogrammer.com](https://generalistprogrammer.com/tutorials/hexagonal-architecture-complete-guide)_

**Plugin/microkernel architecture as the concrete packaging of that split.** The generic pattern here — a minimal core system plus discoverable, independently-registered plugins, with the core owning plugin lifecycle (discovery, registration, execution) — maps directly onto the brief's own Must-scope item: "a per-repo manifest format that also declares which company-specific modules are active." The manifest *is* the plugin-registration mechanism; `shared-types` propagation and the gateway route explorer are the first two plugins built against it.
_Source: [Plugin Architecture Design Pattern — DevLeader](https://www.devleader.ca/2023/09/07/plugin-architecture-design-pattern-a-beginners-guide-to-modularity), [Plugin Extension Architecture — commons-os.github.io](https://commons-os.github.io/patterns/plugin-extension-architecture/)_

### Design Principles and Best Practices

**Command pattern as the formalization of "every action is a script."** The brief's core architectural bet — every repo update, migration, health check, or propagation is "a standalone, parameterized script: invoked automatically by the TUI, but equally runnable by hand" — is the Command design pattern applied at the process boundary instead of the object boundary: each script is a self-contained, parameterized command object with a uniform invocation contract (args in, structured result + exit code out), decoupling *what* the TUI asks for from *how* it's carried out. This is also squarely inside the Unix/CLI philosophy of small, composable programs with clean interfaces.
_Source: [Command Design Pattern — DigitalOcean](https://www.digitalocean.com/community/tutorials/command-design-pattern), [Command Line Interface Guidelines — clig.dev](https://clig.dev/)_

**Idempotency as a correctness requirement, not an optimization, for this tool specifically.** The brief's non-negotiable "detect → fix → re-verify loop" (not just surfacing a raw error) only works safely if the underlying scripts are idempotent: a repo-update or migration script must be able to re-run after a fix without duplicating side effects or drifting further from the intended state. The established design rule — "check before act," "every action conditional (create only if absent, set only if different)," and the single correctness test "run the script twice and diff the system state" — should be a hard requirement on every Must-scope script, not an aspiration.
_Source: [Idempotency in IT Automation — theworldbeast.com](https://www.theworldbeast.com/idempotency-it-automation-patterns-checklist.html), [Writing Idempotent Automation Scripts — DevOps AI Toolkit](https://devopsaitoolkit.com/blog/writing-idempotent-automation-scripts/)_

### Scalability and Performance Patterns

*Reframed for this project's actual shape: a single-user local process, not a system serving concurrent tenants — so the relevant "scalability" question is UI responsiveness under concurrent local I/O, not horizontal scaling.*

Both TUI stacks address this at the rendering layer rather than the concurrency-model layer already covered in the Technology Stack section: Bubble Tea v2 replaced string-based rendering with a structured `View` and added support for synchronized terminal output specifically to eliminate tearing/flicker under rapid updates (e.g., a fast-scrolling aggregated log view); Ink's React reconciler diffs the virtual output tree and writes only the changed terminal regions, which is the same "minimize redundant writes" goal reached through React's existing diffing machinery instead of a bespoke renderer. For this tool, the practical implication is the same regardless of language: log-stream re-renders should be debounced/batched rather than triggering a full redraw per line, especially once several `docker logs -f` streams are aggregated into one filterable view.
_Source: [The Elm Architecture (MVU Pattern) — DeepWiki/bubbletea](https://deepwiki.com/charmbracelet/bubbletea/1.1-the-elm-architecture-(mvu-pattern)), [The TUI Renaissance 2026 — youngju.dev](https://www.youngju.dev/blog/culture/2026-05-14-tui-development-ratatui-bubbletea-ink-textual-terminal-ui-renaissance-deep-dive-2026.en)_

### Integration and Communication Patterns

*This section covers the tool's internal integration boundary — TUI core ↔ standalone scripts — which is distinct from the external gateway/`shared-types` integration already analyzed in the previous section.*

The command-pattern framing above forces a concrete choice: scripts as **out-of-process subprocesses** (spawned, communicating via structured stdout — e.g. JSON lines — and exit codes) versus **in-process function calls** (only viable if every script is written in the TUI's own language and imported directly). The subprocess boundary is what actually delivers the brief's "equally runnable by hand" requirement — a script callable only as an in-process function can't also be a standalone CLI invocation — and it keeps the door open to a script written in a different language later without breaking the contract, at the cost of needing a small, disciplined stdout/exit-code protocol (already good practice per CLI design guidelines) rather than relying on native function signatures for correctness.
_Source: [Command Line Interface Guidelines — clig.dev](https://clig.dev/), [Shell Wrappers — Advanced Bash Scripting Guide](https://www.linuxtopia.org/online_books/advanced_bash_scripting_guide/wrapper.html)_

### Security Architecture Patterns

The brief's git-access constraints (write scoped to the developer's own feature/fix branches; `development`/preprod/prod read-only; no commit/push without explicit approval) are a direct, project-specific instance of the **principle of least privilege**: grant only the minimum access a task needs, prefer read over write unless write is essential, and compartmentalize so a bug or bad state in one code path can't escalate into a destructive git operation outside its intended scope. Concretely, this argues for the git-adapter layer (the "driven" side of the hexagonal boundary above) enforcing branch-scope checks *before* any write operation reaches the actual `git` invocation, rather than trusting each call site to remember the rule — the same "contain the blast radius" logic security literature applies to scoped tokens applies here to scoped local write paths.
_Source: [What is the Principle of Least Privilege? — JFrog](https://jfrog.com/learn/devsecops/principle-of-least-privilege/), [Git OAuth Scopes — hoop.dev](https://hoop.dev/blog/git-oauth-scopes-how-to-manage-permissions-without-losing-security)_

### Data Architecture Patterns

The brief has already decided the mechanism (local multi-file SQLite for EDT state); the relevant pattern research confirms *why* that decision is well-formed rather than just workable. **Database-per-tenant with SQLite** — one file per isolated unit — is an established pattern precisely for this shape of problem: no connection pool to manage, no shared-state contention, and each unit (here, each EDT/workspace) trivially portable as a single file for backup or inspection. Applied to this tool, each EDT's SQLite file *is* the tenant boundary — which also gives "no data loss on EDT switch" a natural implementation: switching EDTs is closing one file and opening another, not a filtered query against shared, contended state.
_Source: [Database-per-Tenant: Consider SQLite — Dmitry Mamonov, Medium](https://medium.com/@dmitry.s.mamonov/database-per-tenant-consider-sqlite-9239113c936c), [SQLite in 2026 — Java Code Geeks](https://www.javacodegeeks.com/2026/05/sqlite-in-2026-why-serious-apps-are-choosing-it-over-postgres.html)_

### Deployment and Operations Architecture

For a local, single-user dev tool, "deployment" collapses to the single-binary packaging question already covered in depth in the Technology Stack section (Go's native cross-compilation vs Node SEA/`pkg`/`bun --compile`) — not covered again here to avoid duplication. The operations-relevant addition from this step is the **manifest-as-plugin-registry** pattern above: the per-repo manifest that declares active company-specific modules doubles as the tool's only "ops" surface for a new environment (a teammate's onboarding, or the future Java/Python project) — no separate deployment config format is needed because module activation *is* the deployment configuration.

---

## Implementation Approaches and Technology Adoption

*Reframed for this project's actual shape: a solo, greenfield decision (no existing team or legacy codebase to migrate), and a local tool with no cloud infrastructure — so "adoption strategy," "team organization," and "cost optimization" are reinterpreted as time-cost and ramp-up questions, not organizational or budget ones.*

### Technology Adoption Strategies

For a greenfield solo project, the relevant adoption question isn't migration strategy (there's nothing to migrate) but **which stack lets real capability compound fastest from day one**. This is where the author's existing TS/NestJS fluency has direct adoption-speed weight: choosing TypeScript means the "adoption" is really zero — the author already has the mental models (async/await, npm ecosystem, module system) and can spend all early time on the TUI-specific unknowns (Ink's component model, `child_process` streaming). Choosing Go means paying two adoption costs simultaneously — learning the language *and* learning Bubble Tea's Elm-style model — before any TUI-specific work starts.
_Source: [A JavaScript Developer's Guide to Go — Prateek Surana](https://prateeksurana.me/blog/guide-to-go-for-javascript-developers/), [Golang or TypeScript? — dev.to](https://dev.to/henriqueleite42/golang-or-typescript-f63)_

### Development Workflows and Tooling

**Hot-reload iteration speed**, directly relevant to a "personal craft project" where iteration feel matters: Go's `air` gives full-binary-rebuild-and-restart on file change — simple and reliable, but every change pays a full Go compile. Node's `ts-node-dev` is more granular, recompiling and reloading only the changed module and its dependents rather than the whole process, which produces measurably tighter edit-run loops for TS. Both are mature, actively used defaults in their respective ecosystems — this isn't a capability gap, but it is a small, constant per-iteration tax that favors the TS path for a project the author expects to iterate on daily.
_Source: [Streamline Your Productivity in Go With "Air" — Medium](https://medium.com/the-godev-corner/streamline-your-productivity-with-air-77c882ba4187), [npm nodemon vs npm ts-node-dev — StackShare](https://stackshare.io/stackups/npm-nodemon-vs-npm-ts-node-dev)_

### Testing and Quality Assurance

**TUI testing tooling is more mature on the Go/Bubble Tea side today.** `teatest` (an official Charm package) and community libraries like `catwalk` provide purpose-built abstractions for asserting a Bubble Tea model's output and internal state as it processes messages — a real, current gap, since **no equivalent `ink-testing-library`-style package showed up in current sources** for Ink specifically. In practice, Ink apps are typically tested by rendering with Ink's own `render()` in a test harness and asserting on the captured output/frames, or by unit-testing the underlying state logic (hooks/reducers) directly and treating rendering as a thin, separately-verified layer — a viable but less turnkey path than Bubble Tea's. This is a genuine point in Go's favor if test coverage of the rendered TUI itself (not just business logic) is a priority; it's a smaller factor if most of the tool's logic (script orchestration, EDT state) sits below the render layer, where standard TS testing (Vitest/Jest) applies without any TUI-specific gap.
_Source: [Writing Bubble Tea Tests — Charm](https://charm.land/blog/teatest/), [catwalk — GitHub](https://github.com/knz/catwalk), [Testing Bubble Tea Applications — DeepWiki](https://deepwiki.com/charmbracelet/bubbletea/5.4-testing-bubble-tea-applications)_

### Deployment and Operations Practices

Binary packaging was already covered in depth (Technology Stack Analysis) and the module-manifest-as-ops-surface pattern in the previous step; the one addition here is **where local state lives**. The XDG Base Directory spec is the current, well-established convention for this: `XDG_CONFIG_HOME` (`~/.config`) for the manifest/settings, `XDG_DATA_HOME` (`~/.local/share`) for the per-EDT SQLite files, `XDG_STATE_HOME` for things like last-used-EDT or log-view scroll position, `XDG_CACHE_HOME` for anything safely regenerable. Both Node and Go have mature libraries implementing this spec (with sane fallbacks on macOS/Windows); adopting it now costs nothing and avoids inventing a bespoke, harder-to-discover directory layout.
_Source: [XDG Base Directory Specification — freedesktop.org](https://specifications.freedesktop.org/basedir/latest/), [XDG Base Directory :: IT'S FOSS](https://itsfoss.gitlab.io/blog/xdg-base-directory/)_

### Team Organization and Skills

*Reframed: no team exists yet — this is a skill-ramp question for one person, with a real future-teammate contribution cost as a secondary factor per the brief's "Secondary (once usable): teammates" persona.*

Sources agree Go's learning curve is shallow **in absolute terms** — developers with prior programming experience report writing useful Go within 2–4 weeks, and the language spec is famously small (~50 pages). But the specific sub-skill this project would lean on hardest — concurrent goroutines/channels for streaming N Docker log sources at once — is consistently flagged as the steepest part of that curve: deadlocks from unreceived sends, goroutine leaks from unmanaged lifecycles, and race conditions are named as the most common beginner failure modes, with one source citing roughly half of surveyed developers reporting real difficulty here. That is precisely the capability this project would be exercising from week one, not an edge case reached later — so the "2-4 weeks to useful Go" estimate likely understates the time to *safe, idiomatic* concurrent Go for this specific workload.
_Source: [How Long Does It Take to Learn Go? — HowLongFor.com](https://howlongfor.com/education/learn-go-programming), [9 Critical Go Channel Pitfalls — Medium](https://medium.com/@sanhdoan/9-critical-go-channel-pitfalls-and-how-to-avoid-them-c1d862af988e), [Common Pitfalls for Beginner Go Developers — MoldStud](https://moldstud.com/articles/p-common-go-developer-pitfalls-for-beginners-how-to-avoid-them)]_

For the deferred teammate persona, the skill trade-off flips less than expected: the company's engineers are already TS/NestJS-fluent (it's the stack of the backend this tool manages), so a TS-based tool asks nothing new of a future contributor, while a Go-based tool would ask every teammate to cross the same learning curve the author would cross alone today.

### Cost Optimization and Resource Management

*Reframed: no cloud infrastructure exists for a local tool, so "cost" here is exclusively developer time — the scarcest resource in a solo side project.*

The dominant cost in this decision is **time spent learning vs. time spent building the actual product** (EDT management, log aggregation, script orchestration) — the parts of the brief that constitute the actual value, independent of language. Every week spent on Go/goroutine fundamentals is a week not spent on those Must-scope features. This doesn't make Go "wrong," but it is a real, quantifiable opportunity cost that the pure "Go is fast to learn in the abstract" framing tends to understate for this project's specific concurrency-heavy first slice.

### Risk Assessment and Mitigation

The two paths carry different, well-documented risk profiles rather than one being simply riskier:

- **TypeScript/Ink path — risk: Ink's documented ceiling** (hardcoded ~30 FPS render cap, >50 MB baseline memory) could become a real problem if the aggregated multi-service log view pushes render frequency or dataset size hard. **Mitigation, already identified in Technology Stack Analysis**: OpenTUI is a credible same-ecosystem escape hatch (removes the FPS cap, cuts memory, keeps the React/TS API) if this ceiling is actually hit in practice — but it is newer and Bun-tied, so it's a fallback to validate later, not a default to start on.
- **Go/Bubble Tea path — risk: concurrency correctness bugs** (goroutine leaks, deadlocks, races) surfacing specifically in the log-streaming code that is this tool's core value, compounded by the author having zero prior Go experience to catch them early. **Mitigation**: strict use of `sync.WaitGroup`/worker-pool patterns and Go's `context` package for cancellation from the start, plus `teatest`'s testing utilities to catch state-management bugs before they reach daily use — but this mitigation itself requires the concurrency fluency the author doesn't yet have, so the mitigation and the risk share the same root cause.

Structurally, the TS/Ink risk is a **known, bounded architectural ceiling with a pre-identified fallback**; the Go risk is an **unbounded correctness risk gated by the author's own unproven skill in exactly the area the tool depends on most**. For a solo project where the non-negotiable constraint is "no perceptible slowness" (a performance ceiling, survivable) rather than "must never have a data race in log handling" (a correctness bug, harder to bound in advance), the TS path's risk is the more containable one of the two.

---

## Technical Research Recommendations

### Implementation Roadmap

1. **Start on TypeScript/Node.js with Ink** as the TUI layer — zero language-adoption cost, direct reuse of `shared-types` and existing NestJS/JWT tooling, and TUI-specific ecosystem precedent at scale (Claude Code, Copilot CLI, Gemini CLI).
2. **Architect the core per the hexagonal + plugin pattern from Step 4 from day one** — domain core (EDT lifecycle, script orchestration, log aggregation) behind ports, with the NestJS/`shared-types`/gateway logic as the first company-specific adapter/module. This is what actually protects the eventual Java/Python persona, independent of language — the generic-core discipline, not Go, is what makes that persona viable later.
3. **Build every Must-scope action as an idempotent, subprocess-invoked script from the start** (Step 4's Command-pattern finding) — this is a correctness requirement for the "detect → fix → re-verify" constraint, not a later refactor.
4. **Adopt XDG Base Directory conventions immediately** for the per-EDT SQLite files, manifest, and config — trivial to do now, awkward to retrofit later.
5. **Treat Ink's FPS/memory ceiling as a monitored risk, not a blocker**: build the aggregated log view with debounced/batched updates (Step 4 finding) from the start, and only evaluate OpenTUI if real usage shows the ceiling being hit.

### Technology Stack Recommendations

**TypeScript (Node.js) + Ink**, with `better-sqlite3` for local storage, `dockerode` for Docker log streaming, `openapi-typescript` against the gateway's OpenAPI spec, and `jose` for dev-mode JWT handling. This is the composite recommendation across all four originally-scoped axes (streaming/I/O, OS signals & Docker, TUI ecosystem, distribution) plus the two added in this research (`shared-types` reuse, testing maturity trade-off) — six of seven axes favor TS or are a wash; only TUI-specific test tooling maturity currently favors Go/Bubble Tea, and it's outweighed by the `shared-types` structural advantage and the zero-ramp-up argument.

### Skill Development Requirements

None beyond the TUI-specific unknowns already inside the TS ecosystem: Ink's component/hook model (small increment from React/NestJS fluency), `dockerode`'s stream API, and `better-sqlite3`'s synchronous query API. No new language, paradigm, or concurrency model needs to be learned before productive work starts — which is itself the central finding of this research relative to the brainstorming session's open question.

### Success Metrics and KPIs

Tie back to the brief's own Success Criteria and Non-Negotiable Constraints rather than inventing new ones:
- **No perceptible slowness** observed in the aggregated multi-service log view under real daily use (validates or falsifies the Ink FPS/memory ceiling risk from this research).
- **Zero data races or goroutine-leak-equivalent bugs** in log-stream handling — trivially satisfied by construction on the TS/event-loop path, which is itself evidence for this recommendation if it holds up in practice.
- Time-to-first-working-EDT-switch and time-to-first-working-log-stream, as a direct measure of the "zero adoption cost" claim above.

---

## Research Synthesis & Conclusion

### Research Goals — Achievement Check

- ✅ **Critère de sélection résolu** : le streaming de logs et l'interception
  de signaux OS ne sont pas meaningfully moins fluides en TypeScript qu'en Go
  pour ce workload — la différence de modèle de concurrence n'a d'effet
  mesurable que sous charge CPU-bound, absente ici.
- ✅ **Recommandation pondérée par la familiarité** : produite explicitement
  (Implementation Roadmap), avec le coût d'opportunité de l'apprentissage de
  Go chiffré qualitativement contre la vélocité immédiate en TS.
- ✅ **Quatre axes du brief couverts**, plus deux axes ajoutés en cours de
  recherche parce que structurants pour *ce* projet précis : la réutilisation
  de `shared-types` (asymétrie la plus nette de toute la recherche) et la
  maturité de l'outillage de test TUI.

### Scope Note

Les sections génériques habituelles d'un rapport de recherche technique —
conformité réglementaire, avantage compétitif de marché, impact business —
ne s'appliquent pas à un outil interne mono-utilisateur et ont été
délibérément omises plutôt que remplies de contenu générique hors sujet.

### Next Steps

1. Initialiser le projet en TypeScript/Node.js avec la stack recommandée.
2. Poser le noyau hexagonal (ports EDT-lifecycle, script-orchestration,
   log-aggregation) avant tout code spécifique NestJS/gateway.
3. Écrire le premier script Must-scope (ex. group-update) comme
   sous-processus idempotent, pour valider le pattern Command dès le départ.
4. Surveiller le plafond FPS/mémoire d'Ink en usage réel ; ne réévaluer
   OpenTUI que si le seuil est effectivement atteint.

---

**Technical Research Completion Date:** 2026-08-10
**Source Verification:** All technical facts cited with current sources
**Technical Confidence Level:** High — based on multiple authoritative,
current (2026) technical sources across all six research axes

_This technical research document resolves the TypeScript vs Go selection
criterion for the TUI admin tool's technical foundations and provides an
actionable implementation roadmap for the Must-scope "technical foundations"
item of the product brief._
