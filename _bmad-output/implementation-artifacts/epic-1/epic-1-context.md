# Epic 1 Context: Foundation — Standalone-Script Core, Manifest & Navigation Shell

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Lays the substrate every later epic builds on: the hexagonal project skeleton and toolchain (run via `tsx`/`node`, no compiled build), the standalone-script core that makes every Must-scope action invocable identically from the TUI or a shell (FR-1), the per-repo manifest plus explicit repo registry that keep unmanaged repos invisible to every action (FR-2), the XDG state layout, single-instance and per-resource locking, and the complete Atelier navigation shell — top bar, six zone tabs, footer, resizable list/detail split, modal-dialog, `?` help screen, and the canonical keybinding contract — with all six zones reachable.

## Stories

- Story 1.1: Project Scaffolding & Hexagonal Skeleton
- Story 1.2: XDG State Layout Resolution
- Story 1.3: Script Output Envelope & CLI Entrypoint Contract
- Story 1.4: Manifest Schema, Loader & Validation
- Story 1.5: Explicit Repo Registry
- Story 1.6: Static Module Registry
- Story 1.7: Single-Instance Enforcement & Per-Resource Action Lock
- Story 1.8: Atelier Design Tokens & Theme Module
- Story 1.9: Read-Focused Display Components
- Story 1.10: Interactive & Feedback Components
- Story 1.11: Permanent App Shell
- Story 1.12: Launch Banner & Keybinding-Help Screen
- Story 1.13: Canonical Keybinding Contract & Zone Navigation

## Requirements & Constraints

- Every Must-scope action is a standalone, parameterized, idempotent script: running it twice with no intervening state change produces no additional side effect, and triggering it from the TUI or by hand is provably identical — the auditability that justifies git authority (FR-1, NFR-3).
- A repo is managed iff it carries a root `.tui-back.yaml`; a repo without one is invisible to every tool action, with no special-case code (FR-2). An unreachable registry entry is reported as such rather than crashing the listing.
- Output contract (AD-3): every core use-case returns `{ok,data}` / `{ok,error:{code,message,details}}`; the CLI renders human text on a TTY and exactly one final JSON line otherwise; exit code is only `0`/`1`; unknown subcommands print usage and exit 1 without crashing. Error codes are kebab-case.
- Local state follows XDG (`$XDG_CONFIG_HOME|DATA|STATE|CACHE_HOME/tui-back/`), falling back to XDG defaults (`~/.config`, `~/.local/share`, `~/.local/state`), with missing namespaced directories auto-created on first write; the cache path is resolved but unused in v1 (NFR-5).
- A second interactive TUI instance on the same machine is detected and refused; a CLI invocation is never blocked by an open TUI. State-mutating use-cases acquire a short-lived advisory lock scoped to the EDT id / repo path(s) they touch — concurrent writers are serialized or rejected, never allowed to race (NFR-6, AD-9).
- No compiled binary: v1 runs via `tsx`/`node` (a `package.json` bin, `npm link`) (AD-14). Fixed stack: TypeScript 7.0.2, Node.js 24, Ink 7.1.1, React 19.2.8, Zustand 5.0.14, zod 4.4.3, yaml 2.9.0, ulid 3.0.2, vitest 4.1.10, tsx 4.23.12.
- Performance: UI interaction response under ~150ms; re-renders are debounced/batched, never a full redraw per event (NFR-1). The discipline applies from the shell even though the heaviest consumer (Logs) lands in Epic 5.

## Technical Decisions

- Hexagonal skeleton exactly `src/core/`, `src/adapters/driven/`, `src/adapters/driving/`, `src/bin/` (composition root). `core/` never imports from `adapters/` and contains no Ink/React/dockerode/child_process/better-sqlite3/fs (AD-1); driven adapters implement interfaces declared in `core/ports`; driving adapters (`tui`, `cli`) call core use-cases only. dependency-cruiser enforces the boundary.
- One umbrella binary `tui-back <subcommand>`, each subcommand a thin CLI wrapper around exactly one core use-case; the TUI calls that same use-case in-process, never spawning the CLI (AD-2). Parity comes from shared core code.
- Manifest (AD-4): root `.tui-back.yaml`, zod-validated on load, declaring `service`, `container`, `migrationCommand`, optional `sharedBranch` (default `development`), and `modules` (module-id → per-module config). Validation failures name the offending field — never a generic crash.
- Static module registry (AD-5): a compiled-in map of module id → implementation; a manifest only selects a key. Unknown module ids fail with a clear error; dynamic loading of externally supplied paths exists nowhere.
- Explicit repo registry (AD-6): the scanned path set lives in `XDG_CONFIG_HOME/tui-back/registry.yaml`; `register <path>` adds to it, `scan <root>` proposes candidates but never auto-registers.
- TUI cross-zone state lives in exactly one Zustand store (scaffolded here with placeholder fields); no zone keeps a duplicate copy (AD-10). TUI zones map 1:1 to core capability areas, and shared components (list/detail split, modal-dialog, footer-hint) live in `tui/shared/`, never duplicated per zone (AD-15).
- Testing by layer (AD-13): `core/` unit-tested against fake ports; driven adapters integration-tested against real systems (temp files/repos); CLI tested black-box by spawning subcommands and asserting the AD-3 envelope and exit code; the TUI smoke-tested via Ink's `render()`.
- Conventions: NodeNext imports (relative paths end `.js`), imports first in file; kebab-case files/dirs/error codes, `PascalCase` types, `camelCase` functions; generated ids are ULIDs; dates ISO 8601.

## UX & Interaction Patterns

- Atelier tokens: colors `background #1c1b1f`, `surface #232228`, `surface-selected #28262c`, `border #3a3844`, `text #eae7e1`, `text-dim #8f8b98`, `accent #c9a13b`, `success #3f9d6e`, `error #c1495e`, `warning #cf9a3e`, `info #4f80a8`; one monospace family; character-cell spacing scale (0/1/2/3ch, glyph-gap 1ch, indent 2ch, pane-padding-x 2ch, row-gap 0, section-gap 1 blank row); 0px corners everywhere. Accent is reserved for active-selection/primary-action, never a status color.
- Chrome (all on background): top bar (app name, active EDT name, `[/]` filter and `[:]` command affordances) above six permanent zone-tabs (Dashboard, EDTs, Update, Logs, Routes, shared-types); active tab = accent fill + bold background-colored text, inactive = text-dim; a pending background event appends a glyph+counter badge that clears once the zone is visited; footer shows live contextual `[key] action` pairs ordered by expected frequency.
- Content: resizable list/detail split (~2:3) via `splitter` — mouse-drag resizes; `Ctrl+W` enters keyboard resize-mode (boundary recolors to accent, arrows resize, Tab cycles the active boundary, Enter/Esc exits); pane sizes persist per zone.
- Components: `status-badge` (glyph and color always shipped together — `●` up / `○` down / `✔` done / `✖` failed / `⣾` in-progress (info) / `›`·`▸` selection·action (accent) — never color alone); `list-row` (base text on surface with a transparent accent-bar column; selected = surface-selected fill + solid accent bar + `›` marker; nested rows indent by the indent token; trailing metadata in text-dim); `detail-pane` (uppercase label-style title; outcome-colored `summary-line`); `modal-dialog` (surface bg, bold border, square corners; `Esc` always cancels, `Enter` always confirms, regardless of mouse/keyboard trigger); `checkbox-list-item` (`[ ]`/`[x]`, Space toggles, Enter confirms the whole selection); `spinner` (`⣾` in info color, the only animated element); `dim-annotation` (italic/dim/indented, never the sole carrier of required information).
- Launch banner: k9s-inspired ASCII shown once on the Dashboard, monochrome (text-dim or accent), no motion/gradient. `?` from any zone opens the read-only keybinding-help modal (scrolls with `j`/`k`, closes with `Esc` or `?`).
- Canonical keybinding contract: `j`/`k` move, `g`/`G` list top/bottom (list-jump only, never zone-switching), `Space` toggle, `Enter` confirm, `Esc` cancel, `Tab` cycle, `Ctrl+W` resize-mode, `/` filter, `:` command entry, `?` help, `q` quit, and single-letter zone mnemonics `d`/`e`/`u`/`l`/`r`/`s`.
- Two-layer outcome voice: a dry, factual primary line sufficient on its own, with an optional dim-annotation wink below; raw stderr/stack traces stay one action away, never fully hidden. Every keyboard action has an equivalent mouse action but nothing is mouse-only; Ink's missing mouse support is a flagged risk with `Ctrl+W` as the confirmed-safe fallback.

## Cross-Story Dependencies

- 1.2 (XDG) underpins 1.5 (registry path) and all later persistence. 1.4 (manifest loader) is required by 1.5 (`list-repos` reads each repo's manifest) and 1.6 (module resolution/validation at load time); 1.6's unknown-id failure rides on 1.4's validation.
- 1.3 (envelope/exit codes) sets the contract every later CLI subcommand and core use-case follows, including the `internal-error` catch-all precedent.
- 1.8 (theme module) is the prerequisite for 1.9–1.12; 1.11 (app shell + Zustand store) consumes 1.9/1.10's components; 1.13 wires the canonical keybindings across the finished primitives.
- 1.7's per-resource lock is groundwork consumed by state-mutating use-cases from Epic 2 onward. FR-1's TUI-side parity is proven starting in Epic 2, when zones consume the same core use-cases; 1.5's idempotent `list-repos` is the first standalone demonstration of the pattern.
