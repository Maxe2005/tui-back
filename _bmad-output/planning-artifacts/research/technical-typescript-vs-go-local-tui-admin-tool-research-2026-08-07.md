---
stepsCompleted: [1, 2, 3]
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

<!-- Content will be appended sequentially through research workflow steps -->
