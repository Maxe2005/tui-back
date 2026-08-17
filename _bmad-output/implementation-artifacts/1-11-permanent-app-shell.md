# Story 1.11: Permanent App Shell

**Story ID:** 1.11  
**Story Key:** 1-11-permanent-app-shell  
**Epic:** 1 - Foundation: Standalone-Script Core, Manifest & Navigation Shell  
**Status:** ready-for-dev  
**Last Updated:** 2026-08-14

---

## Epic Context

**Epic 1 Overview:** A developer can launch the tool, see the full navigation shell (top bar, six zone-tabs, footer, resizable list/detail split, modal-dialog, `?` help screen), register managed repos via a manifest, and run any action identically via the TUI or as a standalone CLI script.

**FRs Covered:** FR-1, FR-2

**Implementation Notes:** Lays the hexagonal foundation (AD-1–AD-6, AD-9, AD-13–AD-15), the Atelier design tokens and cross-cutting components (UX-DR1–UX-DR18, UX-DR25–UX-DR27), the script output envelope (AD-3), XDG state layout (NFR-5), single-instance enforcement (NFR-6), auditability (NFR-3).

---

## Story Foundation

As a developer, I want the top bar, zone-tab bar, footer, and a generic resizable list/detail layout always present, so that every zone is reachable from a consistent, always-visible navigation frame.

### Acceptance Criteria

**Given** the app is running  
**When** any zone is active  
**Then** the top bar, the six-zone tab bar, and the footer are all simultaneously visible on the background color

**Given** the zone-tab bar  
**When** a zone is active  
**Then** its tab shows accent fill + bold background-colored text  
**And** every other tab is text-dim on background

**Given** a zone with a pending background event  
**When** the developer is elsewhere  
**Then** that zone's tab shows a glyph+counter badge in its status color, clearing once visited

**Given** a zone's content area using the list/detail pattern  
**When** rendered  
**Then** it shows a list pane and a detail pane divided by `splitter`, ~2:3 by default

**Given** cross-zone state  
**When** any zone or CLI action updates it  
**Then** it is read/written through exactly one Zustand store (scaffolded here with placeholder fields) — no zone keeps a duplicate copy

**Given** the six zones  
**When** this story is complete  
**Then** each has a placeholder screen mounted at its tab — none is missing or unreachable

---

## Developer Context Section – MOST IMPORTANT PART

### Technical Requirements

- **AD-1 (Dependency direction):** `core/` must never import from `adapters/`. All zone components live in `adapters/driving/tui/` and call core use-cases only.
- **AD-2 (Script/CLI parity):** The app shell must be usable both from the TUI (in-process) and from CLI scripts. Shell-out to CLI subcommands is not permitted for TUI actions.
- **AD-3 (Script output envelope):** All core use-cases return `{ok: true, data}` or `{ok: false, error: {code, message, details}}`. The CLI serializes to human text (TTY) or a single final JSON line (non-TTY). Exit code is `0` or `1` only.
- **AD-4 (Manifest is only per-repo activation surface):** Repo activation depends on `.tui-back.yaml` manifest; zone components must reference manifest state through core ports.
- **AD-5 (Static module registry):** Module implementations are compiled-in; zone components must resolve modules through the compiled-in registry, never dynamic loading.
- **AD-6 (Explicit repo registry):** Repo paths are registered in `XDG_CONFIG_HOME/tui-back/registry.yaml`; zone components must use the registry, never path-convention-based discovery.
- **AD-7 (Storage topology):** One SQLite per EDT at `XDG_DATA_HOME/tui-back/edts/<ulid>.db`, global store at `XDG_DATA_HOME/tui-back/global.db`, transient state at `XDG_STATE_HOME/tui-back/state.json`. Zone components must follow XDG conventions.
- **AD-8 (Git-adapter branch-scope safety):** All git writes pass through `adapters/driven/git`, which rejects writes targeting `development`/preprod/prod or non-EDT branches.
- **AD-9 (Single-TUI + per-EDT/repo lock):** TUI detects second instance; state-mutating use-cases acquire short-lived advisory locks scoped to EDT id / repo path.
- **AD-10 (Central TUI store):** Cross-zone state (active EDT, per-service status, log buffers) lives in one Zustand store; zone-local UI state stays component-local.
- **AD-11 (Logs are ephemeral):** Docker streams raw lines in; bounded in-memory ring buffer per service owned by `core/logs`. Nothing written to disk.
- **AD-12 (Performance budget):** UI interaction response under ~150ms; log line visible within ~1s of container emission. Log-stream re-renders are debounced/batched, never full redraw per line. CPU-heavy work goes through CLI subprocess boundary.
- **AD-13 (Testing strategy):** `core/` unit-tested (Vitest) against fake port implementations. `adapters/driving/cli` tested black-box (child process, AD-3 envelope). TUI gets smoke-tests via Ink's `render()` only.
- **AD-14 (Packaging deferred):** v1 runs via `tsx`/`node` directly; no compiled binary.
- **AD-15 (TUI zone structure):** Each zone maps to exactly one core capability: `edts/`→`core/edt`, `update/`→`core/scripts`, `logs/`→`core/logs`, `routes/`→`core/routes`, `shared-types/`→`adapters/driven/modules/shared-types`. `dashboard/` reads across all zones but never writes. Shared components (list/detail split, modal-dialog, footer-hint) in `tui/shared/`.

### Stack (Fixed Versions)

| Name | Version |
| --- | --- |
| TypeScript | 7.0.2 |
| Node.js | 24 (active LTS) |
| Ink | 7.1.1 |
| React | 19.2.8 |
| Zustand | 5.0.14 |
| better-sqlite3 | 13.0.3 |
| dockerode | 5.0.1 |
| openapi-typescript | 7.13.0 |
| jose | 6.2.8 |
| zod | 4.4.3 |
| yaml (eemeli) | 2.9.0 |
| ulid | 3.0.2 |
| vitest | 4.1.10 |
| tsx | 4.23.12 |

### Naming/Data Conventions

- kebab-case files/directories; PascalCase types/classes; camelCase functions/variables
- Generated entity ids (EDT id, saved-request id) are ULIDs
- Dates/times are ISO 8601
- `error.code` values are kebab-case (e.g. `unknown-subcommand`, `internal-error`)
- Use-case reporting per-service outcome puts it in `data.results: {service, outcome, detail?}[]`, `outcome` from `{"updated"}/{"skipped"}/{"failed"}`
- Script output envelope per AD-3: TTY → human text; non-TTY → single JSON line

### XDG Base Directory Conventions

- Config: `$XDG_CONFIG_HOME/tui-back/` (default: `~/.config/tui-back`)
- Data: `$XDG_DATA_HOME/tui-back/` (default: `~/.local/share/tui-back`)
- State: `$XDG_STATE_HOME/tui-back/` (default: `~/.local/state/tui-back`)
- Cache: `$XDG_CACHE_HOME/tui-back/` (default: `~/.cache/tui-back`)

---

### Previous Story Intelligence (1-10: Interactive & Feedback Components)

**Learnings from Story 1.10:**

- `modal-dialog`: Confirmed `Escape` cancels, `Enter` confirms identically regardless of trigger method (mouse or keyboard)
- `checkbox-list-item`: `Space` toggles state (`[ ]`↔`[x]`), `Enter` confirms whole selection
- `splitter`: Mouse-drag resizes boundary; `Ctrl+W` engages keyboard resize-mode (boundary recolors to accent, arrows resize, `Enter`/`Esc` exits); `Tab` cycles active boundary
- `spinner`: Cycles `⣾` glyph in info color and stops instant action completes
- `dim-annotation`: Italic, text-dim, indented "wink" line beneath a factual message; never sole carrier of required information

**Code patterns established:**

- Components in `tui/shared/` are cross-zone and imported by zone components
- Atelier theme tokens (colors, typography, spacing) imported from `adapters/driving/tui/shared/`
- All components follow 0px corner radius (square, deliberate shape rule from UX-DR2)
- Accent token `#c9a13b` reserved exclusively for active-selection/primary-action, never a status color

**Files modified/created in Story 1.10:**

- `src/adapters/driving/tui/shared/modal-dialog.component.ts`
- `src/adapters/driving/tui/shared/checkbox-list-item.component.ts`
- `src/adapters/driving/tui/shared/splitter.component.ts`
- `src/adapters/driving/tui/shared/spinner.component.ts`
- `src/adapters/driving/tui/shared/dim-annotation.component.ts`

**Testing approaches that worked:**

- Vitest unit tests for core use-cases against fake ports
- Ink's `render()` for TUI component smoke tests
- AD-3 envelope assertion for CLI black-box tests

---

### Git Intelligence (last 5 commits)

The following insights were extracted from the git history relevant to this story:

- Recent commits established the hexagonal folder structure (`src/core/`, `src/adapters/driven/`, `src/adapters/driving/`, `src/bin/`)
- Core use-case output envelope shape (`{ok,data}`/`{ok,error}`) was finalized in Story 1.3
- AD-3 envelope serialization logic was implemented in `src/adapters/driving/cli/dispatch.ts`
- XDG state layout resolution was implemented following NFR-5
- Atelier design tokens were integrated into the theme module in Story 1.8

---

### Latest Technical Information

- **TypeScript 7.0.2** and **Node.js 24** are the fixed stack versions (per Architecture Spine)
- **Ink 7.1.1** requires Node ≥22, React ≥19.2.0 — confirmed compatible with stack
- **Zustand 5.0.14** is the state management library for cross-zone state
- **Atelier color tokens** from DESIGN.md: `background` #1c1b1f, `surface` #232228, `text` #eae7e1, `accent` #c9a13b
- **Character-cell spacing scale:** 0/1/2/3ch, glyph-gap, indent, pane-padding-x
- **better-sqlite3 13.0.3** for EDT and global SQLite stores
- **dockerode 5.0.1** for Docker log streaming (AD-11)
- **jose 6.2.8** for dev-mode JWT auth in route explorer
- **ulid 3.0.2** for EDT and saved-request database filenames

---

### Project Context Reference

- **Project:** tui-back
- **Project Key:** NOKEY
- **Communication Language:** English
- **Document Output Language:** English
- **User Skill Level:** (not specified)
- **Planning Artifacts:** `_bmad-output/planning-artifacts`
- **Implementation Artifacts:** `_bmad-output/implementation-artifacts`
- **Sprint Status:** `_bmad-output/implementation-artifacts/sprint-status.yaml`
- **Epic 1 Status:** in-progress (auto-updated when first story was created)
- **Story 1.11 Status:** ready-for-dev (this story file just created)

---

### Story Completion Status

**Status:** ready-for-dev  
**Completion Note:** Ultimate context engine analysis completed - comprehensive developer guide created

**Next Steps for Developer:**

1. Review this story file for all guardrails and requirements
2. Implement the permanent app shell with top bar, zone-tab bar, footer, and resizable list/detail layout
3. Ensure all AD-1 through AD-15 compliance checklist is satisfied
4. Run `npm test` to verify core unit tests pass
5. Run `npm run typecheck` to verify TypeScript correctness
6. Run `npm run depcheck` to verify AD-1 boundary (core → adapters only)
7. When implementation is complete, run `code-review` to auto-mark story as done