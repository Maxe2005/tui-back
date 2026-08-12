# Deferred Work

## Deferred from: code review of story-1-1-project-scaffolding-hexagonal-skeleton (2026-08-11)

- `depcheck`'s AD-1 boundary rule (`.dependency-cruiser.cjs`) will silently stop being "structurally enforced" (AC5) the moment real TypeScript syntax (interface/type/generic/enum) lands in `src/core` or `src/adapters` — dependency-cruiser@18.2.0 (latest available) hard-gates its native TS support to `typescript <7.0.0`, and the project is pinned to `typescript@7.0.2`, so extraction falls back to acorn, which cannot parse TS-only syntax. Deferred: blocked by the tool, no compatible version available. **Track as soon as a future story adds real TS syntax to `core/` or `adapters/`** — verify `depcheck` still catches boundary violations in that file before merging.
- No `README.md` documenting the install → link → run → test → depcheck workflow. Not required by any AC as written; useful follow-up for onboarding.
- `src/bin/tui-back.mjs` has no `try/catch` around `await import('./main.ts')`, so a future throwing `main.ts` would surface a raw stack trace instead of a controlled error. `main.ts` cannot currently throw; revisit once real subcommand dispatch lands.
- `package.json` declares `"license": "ISC"` but no `LICENSE` file exists. Package is `private: true` and unpublished, so low priority; needs a licensing decision if that changes.
- `"engines": { "node": ">=24" }` is advisory only — no `.npmrc` `engine-strict` or CI check enforces it, so `npm install` on an older Node warns rather than fails. AC1 only requires the happy path on Node 24 to work, not enforcement.
- The AD-1 boundary rule (`.dependency-cruiser.cjs`) only covers `core → adapters`; nothing stops `src/bin` from importing `src/adapters/driven` directly, or `adapters/driven` ↔ `adapters/driving` from importing each other. Out of AC5's literal scope (core→adapters only); worth hardening once those edges have real code.
- No automated test exercises `src/bin/tui-back.mjs` end-to-end (`npm test` doesn't invoke the CLI binary). AC3 only requires manual `npm link` verification as written; a smoke test would catch future regressions (e.g. lost executable bit).
