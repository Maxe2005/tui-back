# Addendum: TUI Admin Tool for a Microservices Backend

Supporting depth for `brief.md` — context for downstream PRD/architecture work that doesn't belong in a 1-2 page brief. Not an audit/override log; see `.memlog.md` for that. Full brainstorming trace (convergence, MoSCoW scoping): `_bmad-output/brainstorming/brainstorm-tui-back-admin-2026-08-06/.memlog.md`.

## Real-Environment Audit (`~/Documents/IANORD/Back`, as of 2026-08-07)

### Repo inventory

Polyrepo, 13 folders. `api-gateway` (gateway), 9 active microservices (`micro-access-controls`, `micro-external`, `micro-finances`, `micro-mails`, `micro-organizations`, `micro-registrations`, `micro-schedules`, `micro-users`, `micro-utilities`), `shared-types` (published as `@ianord/shared-types` on a private registry, `npm.ianord.fr`). `micro-bookings` is a **zombie**: no `.git`, no docker-compose, explicitly skipped by existing scripts, already removed from the gateway — left in the tree as cruft.

### Tech stack

100% Node/NestJS 11.x (one service still on NestJS CLI 10.x), TypeORM + Postgres 16 per service (each with its own container). Gateway↔service RPC over `@nestjs/microservices` TCP (not a broker). RabbitMQ hosted centrally in the gateway's compose file for inter-service events. `kafkajs` is a dependency in ~6 services with no Kafka broker anywhere — likely vestigial, worth flagging as tech debt if the tool ever surfaces dependency health. No root-level docker-compose; every repo has its own, joined on a shared external Docker network (`web`). Redis (gateway cache), ClamAV (opt-in upload scanning).

### Existing ad-hoc scripts

Inspiration only — explicitly not to be treated as a spec; the brief's author was clear that these are incomplete and must be pushed much further:
- `update_repo.sh` — per-repo branch checkout with fallback list, interactive handling of uncommitted changes (auto-reset if only `package.json`/lockfile dirty, else prompt stash/VSCode/cancel), `git pull` + `npm i` + `docker compose down/up --build`.
- `update-services.sh` — orchestrates `update_repo.sh` + `run_migrations.sh` across all/subset of services, writes timestamped per-session logs to `logs_updates/`. This is today's main "update everything" entrypoint, run roughly every 2–3 days per log-folder evidence (~11 sessions, July–Aug 2026).
- `run_migrations.sh` — derives container name by convention (`micro-` stripped, `-back` suffix), `docker exec`s `npm run migration:run`.
- `check_health.sh` — polls the gateway's `/health/all`, restarts any service reporting failure via a hardcoded `SERVICE_MAP`.
- `relative-imports.sh` — codemod fixing `src/`-rooted imports to relative paths.
- `conteneurs_clean.sh` — Docker/npm cache pruning one-liner.
- `audit-messages-pattern.js` — standalone static-analysis script cross-referencing declared vs. used `@MessagePattern` RPC handlers across all services + `shared-types`. Latest run: 544 declared, 364 active, **170 orphaned (31%)** — a concrete, ready-made data point for why cross-service visibility matters.

**No manifest or service registry exists anywhere** — every script hand-encodes the service list and container-naming convention, duplicated between scripts. This directly validates the `repo.yaml`-per-repo-manifest direction from the brainstorming session.

### Conventions observed

Branch naming mixes a shared long-lived fleet-wide branch (`development-nestmsg`, suggesting an in-progress cross-service refactor as of Aug 2026) and ticket-scoped feature branches (`feat/IWR-####/kebab-case-description`, Jira-style). Migrations standardized via TypeORM CLI scripts in every `package.json`. Only the gateway exposes health endpoints (`/health/:name`, `/health/all`); no per-service health endpoints. Container naming (`<short-name>-back`) is convention-only, not registry-backed — brittle, and the exact kind of thing a manifest should replace. `shared-types` already has its own one-command "release everything" script (bump via `jq`, pull → build → publish → push) — useful reference for what a good propagation UX could look like.

### Architecture maturity

Uneven across services — e.g. `micro-users` is mid-migration to a clean-architecture layering ("others will follow"), `micro-registrations`'s README flags missing tests and data-integrity constraints. Worth keeping in mind: the tool will be operating against a fleet that is itself mid-evolution, not a stable target.

## Open Technical Question

Whether log streaming / OS signal interception is meaningfully less smooth in TypeScript/Node than in Go or Rust is unresolved, and was reframed during brainstorming convergence as a **direct selection criterion** for the TUI's own language/tech choice (Must-scope, technical foundations) — via the "no slowness" deal-breaker, not a side curiosity. Worth resolving early, likely with a small spike, before committing to the language/tech axis — Go+Bubbletea, Python+Textual, Node+TS, and a minimal TUI orchestrating standalone scripts were the options on the table.
