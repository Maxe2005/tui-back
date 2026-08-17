---
title: 'Atelier Design Tokens & Theme Module'
type: 'feature'
created: '2026-08-13'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: [1-7-single-instance-enforcement-per-resource-action-lock, 1-6-static-module-registry]
warnings: []
deferred: []
baseline_revision: 'ac80f4b'
baseline_commit: 'ac80f4b'
---

<intent-contract>

## Intent

**Problem:** Today there is no design-token/theme layer anywhere in the codebase — `src/` has no `theme`, `token`, or `Atelier` references, and no `adapters/driving/tui/` directory exists yet. The UX spine (`DESIGN.md`, status `final`) defines the "Atelier" visual register — exact hex colors, one monospace type family, a character-cell spacing scale, and 0px-square corners — that every future TUI component must read from. Unless those values are captured once as a single source of truth, every component in Stories 1.9–1.12 (and every zone in Epics 2–6) will hardcode colors/spacing inline, guaranteeing drift from the approved design and inconsistent rendering. `epic-1-context.md:60` names **Story 1.8 (theme module) as the prerequisite for 1.9–1.12**.

**Approach:** Create a **pure data / constants module** — the Atelier theme — as the single source of truth for color, typography, spacing, and radius tokens. It lives under the future TUI driving adapter at `src/adapters/driving/tui/shared/theme/` (per AD-15, cross-zone Atelier UI lives in `tui/shared/`; the tree at `ARCHITECTURE-SPINE.md:49-58` reserves `tui/shared/` for "cross-zone UI: list/detail split, modal-dialog, footer-hint (Atelier)"). It is a **plain TypeScript constants module** — no `Result<T>` envelope (it is not a core use-case), no fs, no Ink/React import needed to *define* the tokens (the token values are just hex strings / numbers that Ink consumes directly, e.g. `<Text color="#c9a13b">`). The components in Stories 1.9/1.10 will import these constants and bring in Ink/React; **this story does not install Ink/React** (no component renders yet). The theme exposes every token at the exact values from `DESIGN.md`, plus a documented usage convention for the accent token, all locked in by unit tests.

The accent-convention and 0px-corners ACs are captured as documentation + a code-level invariant (a `ROUNDED` scale whose every value is `0`, and a doc comment / README note on the accent token) so later epics can't accidentally violate them.

## Boundaries & Constraints

**Always:**
- **AD-1 / AD-15 placement:** the theme is **rendering-layer** data for the future TUI driving adapter — it lives under `src/adapters/driving/tui/`, **never** in `src/core/` (core must stay fs/Ink/React-free — `ARCHITECTURE-SPINE.md:28`, AD-1). It is a sibling/substrate of `tui/shared/` cross-zone components (AD-15). It is **not** a driven adapter (driven adapters implement `core/ports`; a theme implements nothing core depends on).
- **Pure data module — no `Result<T>`.** This is NOT a core use-case; it does not return `{ok,error}` and has no kebab-case `error.code`. It is a plain module of typed constants (`const theme = { colors: {...}, ... }`). Do not wrap it in `ok()/err()` or route it through `dispatch.ts`.
- **Exact token values are non-negotiable.** Every hex must match `DESIGN.md` byte-for-byte (see Code Map for the full table). Tests assert the exact values so a typo can't pass.
- **0px corners everywhere (AC3):** the radius scale must have every value `0`. No rounding at any scale, ever. This is the visual half of Atelier's "precise and instantly scannable" register (`DESIGN.md` §Shapes, lines 150-152).
- **Accent usage convention (AC4):** `accent` is reserved exclusively for active-selection / primary-action affordances — **never** a status color (`DESIGN.md` §Colors, lines 116-118, and the Do/Don't table lines 190-191). This must be captured as documentation a later component can follow, because accent (`#c9a13b`) and warning (`#cf9a3e`) sit close in hue — the two must never be told apart by color alone, and a selected row should not itself be showing a warning state in the same glance without a glyph to disambiguate.
- **NodeNext imports (`../foo.js`), imports first, functional style (no classes), kebab-case file/dir names, `PascalCase` types, `camelCase` functions** — same conventions as every prior story (AGENTS.md; deferred-work.md acorn landmine).
- **TUI-only, not CLI (AD-3 scope):** the Atelier theme is for the **TUI**, not raw CLI text output. Do **not** pull these tokens into `dispatch.ts`/`envelope.ts` (CLI human text stays as-is; Story 1.3 deferred-work.md:149 makes this explicit).
- Gates: `npm test && npm run typecheck && npm run depcheck`.

**Defer (design decision, D-theme-1):**
- **Installing Ink/React** is deferred to Story 1.9 (status-badge/list-row/detail-pane) — the first story that renders components. The theme module itself needs no Ink/React dependency to define constants. Do NOT add `ink`/`react`/`zustand` to `package.json` in this story. The pinned versions for when they do arrive are recorded in Dev Notes (Ink 7.1.1, React 19.2.8 — `ARCHITECTURE-SPINE.md:181-182`).
- **The full `tui/` shell / zones** are deferred to Story 1.11 (Permanent App Shell). This story creates only `tui/shared/theme/` — it does not scaffold empty `dashboard/`, `edts/`, etc. directories.
- **Typography rendering roles** (label/dim-wink/active-tab) are *defined* as tokens here but *rendered* by Stories 1.9/1.10. Do not build any rendering in this story.

**Block If:**
- A requirement surfaces to consume the theme from a component (that's Stories 1.9/1.10/1.11) or to render anything. This story's deliverable is the module + tests + documentation only. If the dev agent believes Ink/React must be installed to "prove" the theme works, HALT — a pure-data module is testable without Ink (unit tests assert the constant values directly).

**Never:**
- No `Ink`/`React`/`zustand`/`chalk` import or dependency in this story (deferred, D-theme-1). No rendering, no `render()`, no JSX/`.tsx` file needed.
- No `Result<T>`/`ok()`/`err()` wrapping and no kebab-case `error.code` for this module (it is not a use-case; AD-3 applies to core use-cases/CLI subcommands, not token constants).
- No `fs`, no `process`, no side effects — the module must be importable and pure.
- No drift from `DESIGN.md`: if any value differs from the source, that's a bug, not a judgment call — `DESIGN.md` wins on conflict with any other file (`DESIGN.md:107`).
- No change to existing CLI code, `core/`, driven adapters, or `package.json`. This story is additive under `adapters/driving/tui/` only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Import the theme module | `import { theme } from './theme.js'` | Exposes `theme.colors`, `theme.spacing`, `theme.typography`, `theme.rounded` with all tokens | n/a — pure data, no throw path |
| Query every color token | `theme.colors.*` | Each hex value equals DESIGN.md exactly: `background #1c1b1f`, `surface #232228`, `surface-selected #28262c`, `border #3a3844`, `text #eae7e1`, `text-dim #8f8b98`, `accent #c9a13b`, `success #3f9d6e`, `error #c1495e`, `warning #cf9a3e`, `info #4f80a8` | n/a |
| Query spacing scale | `theme.spacing.*` | Named constants: `0/1/2/3ch`, `glyph-gap 1ch`, `indent 2ch`, `pane-padding-x 2ch`, `row-gap 0`, `section-gap 1 blank row`, `chrome-row 1 row` | n/a |
| Query radius scale | `theme.rounded.*` | Every value is `0` (square corners, AC3) | n/a |
| Read accent usage convention | docs / `theme.colors` doc comment | Accent reserved for active-selection/primary-action only, never a status color (AC4) | n/a |
| Consume a token in a later component | `color={theme.colors.accent}` (Ink, Story 1.9+) | Ink accepts hex strings directly (`<Text color="#c9a13b">`) | n/a |
| A typo in a hex value | developer changes `#1c1b1f` → `#1c1b1e` | Unit test asserting the exact value **fails** — drift is caught at CI | test failure |

## Code Map

(Target files. All `NEW` under the future TUI driving adapter; no `UPDATE` files — nothing existing is modified.)

- `src/adapters/driving/tui/shared/theme/theme.ts` -- **NEW**. The Atelier token module. Single source of truth. Structure:
  - `export const colors = { background: '#1c1b1f', surface: '#232228', 'surface-selected': '#28262c', border: '#3a3844', text: '#eae7e1', 'text-dim': '#8f8b98', accent: '#c9a13b', success: '#3f9d6e', error: '#c1495e', warning: '#cf9a3e', info: '#4f80a8' } as const;`
  - `export const spacing = { '0': 0, '1': 1, '2': 2, '3': 3, 'glyph-gap': 1, indent: 2, 'pane-padding-x': 2, 'row-gap': 0, 'section-gap': 1, 'chrome-row': 1 } as const;` (character-cell units; `section-gap`/`chrome-row` are row counts — document their meaning).
  - `export const typography = { base: { family: "ui-monospace, Cascadia Code, SF Mono, Fira Code, Consolas, monospace" }, label: { bold: false }, 'dim-wink': { italic: true }, 'active-tab': { bold: true } } as const;` *(`bold` booleans are Ink-consumable — Ink has no numeric weight or letter-spacing; deviation from the original `weight`/`letterSpacing` literals is a deliberate review resolution.)*
  - `export const rounded = { sm: 0, md: 0, lg: 0, DEFAULT: 0 } as const;` — **every value 0** (square corners); `DEFAULT` is the token DESIGN.md references for every surface. Add a doc comment: "Atelier is square-cornered by deliberate choice; every panel/modal/badge/row renders at 0px — never round."
  - `export const theme = { colors, spacing, typography, rounded } as const;`
  - On `colors.accent` (and/or a `README.md` note), document the convention: reserved for active-selection/primary-action only, never a status color (`DESIGN.md` §Colors).
  - Imports: none required (pure constants) — but if any are added, keep them first (acorn landmine). No `Result`, no fs, no Ink.
- `src/adapters/driving/tui/shared/theme/theme.test.ts` -- **NEW**. Vitest unit tests (AD-13): assert every color hex equals the exact DESIGN.md value; every spacing constant equals its value; every rounded value is `0`; `typography.base.family` includes `monospace`; and a documented invariant that `accent !== warning` and `accent` is not present in the status-color set. Pure value assertions — no Ink render needed.
- `src/adapters/driving/tui/shared/theme/index.ts` -- **NEW** (optional but recommended). Re-exports `theme` so components import from `./theme/index.js` or `./theme/theme.js` consistently; keep it a thin barrel. If it adds imports, imports-first.
- `src/adapters/driving/tui/shared/README.md` -- **NEW** (optional, recommended for AC4 documentation). One short section: the Atelier token source of truth (`theme.ts`), the accent usage convention, and the 0px-corners rule for future component stories (1.9–1.12) to follow.

> Placement note: `tui/shared/` is the AD-15-designated home for cross-zone Atelier UI. The theme is the shared visual substrate both zones and shared components read from. It is the **first** files under the not-yet-existing `src/adapters/driving/tui/` tree; do not scaffold the zone folders (D-theme-1).

## Tasks & Acceptance

**Execution:**
- `git` -- branch `story-1-8-atelier-design-tokens-theme-module` from `epic-1-foundation-navigation-shell`; all work + commits on it; `--no-ff` merge only after code review. Conventional commits with `(story 1.8)` in the subject. Epic-1 is already `in-progress` in sprint-status.yaml.
- `src/adapters/driving/tui/shared/theme/theme.ts` -- NEW pure token module (colors/spacing/typography/rounded), values byte-for-byte from DESIGN.md, imports-first if any, no fs/Ink/Result.
- `src/adapters/driving/tui/shared/theme/theme.test.ts` -- NEW unit tests asserting exact values + 0px + accent-not-a-status-color.
- `src/adapters/driving/tui/shared/theme/index.ts` -- NEW barrel re-export (optional).
- `src/adapters/driving/tui/shared/README.md` -- NEW one-section doc capturing accent convention + 0px rule (recommended for AC4).
- Gates -- `npm test && npm run typecheck && npm run depcheck`. Verify `depcheck` still runs cleanly (the new `adapters/driving/tui/` files use plain `const` objects — no generic-union shape, so the acorn landmine should not bite, but confirm the new files' imports are scanned).
- Commit -- atomic conventional commits, `(story 1.8)` in subject.

**Acceptance Criteria (from epics.md Story 1.8, verbatim):**
- AC1 — Given the theme module, When any component imports it, Then it exposes every color token at the exact hex values from DESIGN.md. *(Implemented: `colors` map with the 10 hex values, asserted in `theme.test.ts`.)*
- AC2 — Given the theme module, When queried for spacing, Then it exposes the character-cell scale (0/1/2/3ch, glyph-gap, indent, pane-padding-x, row-gap, section-gap) as named constants. *(Implemented: `spacing` map, including `chrome-row` per DESIGN.md even though AC2 omits it — it is in the authoritative source.)*
- AC3 — Given any component rendering a panel, modal, badge, or row, When it applies a corner radius, Then it renders at 0px — no rounding anywhere. *(Implemented: `rounded` scale all-0 + doc comment + test; component stories 1.9/1.10 must consume `theme.rounded`, never hardcode a nonzero radius.)*
- AC4 — Given the accent token, When documented, Then its usage convention (active-selection/primary-action only, never a status color) is captured for later epics to follow. *(Implemented: doc comment on `colors.accent` + README note + test asserting accent is not a status color.)*

### Review Findings

**patch (all resolved & applied):**

- [x] [Review][Decision→Patch] `rounded.DEFAULT` (0px) missing from the scale — DESIGN.md defines `rounded.sm/md/lg/DEFAULT` all 0px, and `modal-dialog.corner` (DESIGN.md:82), §Shapes (152) and the Do/Don't table (193) reference `{rounded.DEFAULT}`. **Resolved:** added `DEFAULT: 0` to `rounded` (option 1). [`theme.ts:43`]
- [x] [Review][Decision→Patch] Typography tokens not renderable as-is by Ink — `label.weight` 600 / `active-tab.weight` 700 and `letterSpacing: '0.05em'` have no Ink counterpart (`<Text>` exposes only boolean `bold`, no letter-spacing). **Resolved:** switched to boolean `bold` (`label.bold = false`, `active-tab.bold = true`), dropped `letterSpacing` (option 2 — deviates from the original Code Map literal, deliberate). [`theme.ts:35-37`]
- [x] [Review][Decision→Patch] DESIGN.md pairing rules not captured — active zone-tab text must be `colors.background` on the accent fill (DESIGN.md:129,157) and `surface-selected` is never used on its own without the accent border (DESIGN.md:112). **Resolved:** doc notes added in `theme.ts` + README rules 4 & 5 (option 1). [`theme.ts:4`]
- [x] [Review][Decision→Patch] No dependency-cruiser boundary keeps `tui/shared` TUI-only — nothing stops `driving/cli` (or any adapter) from importing `tui/shared`, so the AD-3 "TUI tokens must not leak into CLI output" rule is doc-level only. **Resolved:** added the `no-tui-leak-outside-driving-tui` rule, round-trip verified (option 1). [`.dependency-cruiser.cjs`]
- [x] [Review][Patch] `section-gap`/`chrome-row` row-count semantics undocumented — spec Code Map instructs "`section-gap`/`chrome-row` are row counts — document their meaning" (story:70). Fixed: spacing block comment + README note. [`theme.ts:26-27`]
- [x] [Review][Patch] Typography not exact-locked despite README "locks every token to its exact value" claim — `family` test asserted only `toContain('monospace')`. Fixed: exact `toBe` on the full family stack. [`theme.test.ts:59`]
- [x] [Review][Patch] AC3 enforced only on `sm/md/lg`, not the whole scale — a future radius token (e.g. `xl: 4`) passed current assertions. Fixed: `Object.values(rounded).every(v => v === 0)`. [`theme.test.ts:70-76`]

**defer:**

- [x] [Review][Defer] No runtime immutability — `as const` is compile-time only; a future component could mutate `theme.colors.accent` and no test would catch it. Add `Object.freeze` + `Object.isFrozen` test when the first consumer lands. [`theme.ts`] — deferred, pre-existing
- [x] [Review][Defer] Barrel `theme/index.ts` untested as public entrypoint — tests import deep `./theme.js`, so a broken barrel (wrong export name) ships undetected. [`theme/index.ts`] — deferred, pre-existing
- [x] [Review][Defer] Glyph vocabulary absent from the theme — status-badge glyphs (●○✔✖⣾›▸) are the non-color half of the "never color alone" rule but only colors are tokenized; out of the story's color/spacing/typography/rounded scope. [`theme.ts`] — deferred, pre-existing
- [x] [Review][Defer] `sprint-status.yaml` duplicates `generated`/`last_updated` in header comment and body — the two have already drifted once historically; this change keeps them in sync but the duplication is a live inconsistency risk. Pre-existing. [`sprint-status.yaml:1-2,43-44`] — deferred, pre-existing
- [x] [Review][Defer] Future-component guards are doc/test-level only — no lint/usage test rejects a nonzero hardcoded radius or accent-as-status in a Story 1.9+ component; enforcement lives in the README rules. [`shared/README.md`] — deferred, pre-existing

## Dev Notes

- **Read the source of truth before writing values:** `_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/DESIGN.md` — frontmatter `colors` (lines 9-20), `typography` (21-33), `rounded` (34-39), `spacing` (40-50); §Colors (108-119), §Typography (121-129), §Layout & Spacing (131-137), §Shapes (150-152), §Components (154-184), and the Do/Don't table (188-191). `DESIGN.md` wins on conflict with any other file. `epic-1-context.md:48` restates the token list as a distilled spec.
- **Why pure data and where (D-theme-1, AD-1/AD-15):** the theme is rendering-layer data for the TUI driving adapter. It is not a core use-case, so no `Result<T>`, no error codes, no `dispatch.ts` involvement. It lives in `tui/shared/` (AD-15) and is imported by components from Story 1.9 onward. Ink consumes hex color strings directly, so storing tokens as `'#c9a13b'` strings is sufficient — no color library, no conversion.
- **Do not install Ink/React yet.** The module is testable with pure Vitest value assertions (AD-13: "core and the store already carry the real logic coverage"; the TUI gets smoke-tests via Ink's `render()` only once a TUI exists). Deferring the dependency keeps this story dependency-free and reviewable. When Ink/React arrive (Story 1.9+), use the pinned versions: **Ink 7.1.1** (Node ≥22, React ≥19.2.0) and **React 19.2.8** (`ARCHITECTURE-SPINE.md:181-182`).
- **0px corners are a real AC, not decoration (AC3).** `ink-testing-library` is unmaintained (predates Ink 7/React 19 — `ARCHITECTURE-SPINE.md:153`), so corner-radius correctness will be carried by the token (all-0 `rounded` scale) plus the doc rule, not by a render test. Make the rule loud in the module so a later component story can't silently add a nonzero radius.
- **Accent vs warning disambiguation (AC4).** accent `#c9a13b` and warning `#cf9a3e` are deliberately close in hue/lightness. The convention — accent never a status color — exists precisely so the two are never confused when paired with a status glyph. Document this in the README so status-badge (Story 1.9) honors it.
- **Conventions recap:** NodeNext relative imports end in `.js`; imports are the first statements in a file (acorn landmine — `deferred-work.md:50`); kebab-case file/dir names; `PascalCase` types; `camelCase` functions; no classes. The theme module is `const` objects + `as const` — no classes.
- **Regression safety:** this story is purely additive under `adapters/driving/tui/` — nothing existing changes, so no prior test can break. The risk is the opposite: the theme must not accidentally get wired into CLI output (TUI-only, AD-3). Keep it out of `dispatch.ts`/`envelope.ts`.
- **depcheck note:** the new files are plain `const` data (no generic-union return type), so the acorn/imports-first landmine from `deferred-work.md:50` should not drop their imports — but run `npm run depcheck` and confirm the new files are scanned before merging (also verify the AD-1 rule still fires on a deliberate violation, per the Story 1.1/1.2 round-trip convention).

### Project Structure Notes

- New directory `src/adapters/driving/tui/` aligns with AD-1/AD-15 and the tree at `ARCHITECTURE-SPINE.md:49-58`. This story creates only `tui/shared/theme/`; zone subfolders (`dashboard/`, `edts/`, `update/`, `logs/`, `routes/`, `shared-types/`) are deferred to Story 1.11+ (D-theme-1).
- The theme sits in `shared/` (cross-zone Atelier UI) rather than under any zone, because every zone and shared component (list/detail split, modal-dialog, footer-hint) reads it — never duplicated per zone (AD-15).
- No change to `src/core/`, `src/adapters/driven/`, `src/adapters/driving/cli/`, or `src/bin/`; no change to `package.json`.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md#Story-1.8` (lines 360-383)] — user story + AC1-AC4 verbatim.
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/DESIGN.md`] — authoritative Atelier tokens: `colors` (lines 9-20), `typography` (21-33), `rounded` (34-39), `spacing` (40-50), §Colors (108-119), §Typography (121-129), §Layout & Spacing (131-137), §Shapes (150-152), §Components (154-184), Do/Don't (188-191). DESIGN.md wins on conflict (line 107).
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md`] — §AD-1 (lines 63-81, core fs/Ink/React-free, driving never touches driven), §AD-3 (89-93, envelope applies to use-cases/CLI not token modules), §AD-13 (151-157, testing by layer; ink-testing-library unmaintained), §AD-15 (161-165, `tui/shared/` for cross-zone Atelier UI), tree (49-58), stack table (181-182: Ink 7.1.1 / React 19.2.8).
- [Source: `_bmad-output/implementation-artifacts/epic-1-context.md` (lines 46-54, 60)] — distilled token list; "1.8 (theme module) is the prerequisite for 1.9–1.12".
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — acorn/imports-first landmine (line 50); AD-1 rule `to: {path: 'adapters(/|$)'}` (line 55); Story 1.3 note that Atelier is TUI-only, not CLI text (line 149 of 1-3 story file).
- [Source: `_bmad-output/implementation-artifacts/1-7-single-instance-enforcement-per-resource-action-lock.md`] — prior-story format/patterns; the pure-data-vs-use-case distinction; review triage log format.
- [Source (tech, web 2026): vadimdemedes/ink (github.com/vadimdemedes/ink)] — Ink 7.1.1 stable; `<Text color="#hex">` / `backgroundColor` accept hex strings directly; `ink-testing-library` unmaintained.

## Task / Acceptance Traceability

- AC1 (every color token at exact hex values from DESIGN.md) → Code Map `theme.ts` `colors` map + `theme.test.ts` exact-value assertions.
- AC2 (character-cell spacing scale as named constants: 0/1/2/3ch, glyph-gap, indent, pane-padding-x, row-gap, section-gap) → `theme.ts` `spacing` map (incl. `chrome-row` per DESIGN.md) + test.
- AC3 (0px corners, no rounding anywhere) → `theme.ts` `rounded` scale all-0 + doc comment + test; rule documented for component stories 1.9/1.10.
- AC4 (accent usage convention captured: active-selection/primary-action only, never a status color) → `theme.ts` `colors.accent` doc comment + `shared/README.md` + test asserting accent ∉ status set.

## Dev Agent Record

### Agent Model Used

opencode / deepseek-v4-flash-free (story implementation session, 2026-08-14).

### Debug Log References

- RED: `theme.test.ts` failed on import — module did not exist (expected).
- GREEN: 8/8 theme assertions pass after adding `theme.ts`.
- typecheck: one TS2345 on the status-set `.has()` guard due to `as const` literal narrowing — fixed by widening the set to `ReadonlySet<string>`.
- depcheck: 94 modules, 144 dependencies; AD-1 round-trip verified (a deliberate `src/core` → `adapters` import fires `no-core-to-adapters`).

### Completion Notes List

- Story 1.8 created by `bmad-create-story` (ultimate context engine) on 2026-08-13; status `ready-for-dev`.
- Story 1.8 confirmed as the first backlog story (1-1..1-7 done); epic-1 already `in-progress`.
- Implemented `src/adapters/driving/tui/shared/theme/theme.ts` — pure `as const` token module (`colors`/`spacing`/`typography`/`rounded` + `theme` aggregate), values byte-for-byte from `DESIGN.md` frontmatter, no fs/Ink/Result/`error.code`. `rounded` is all-0 with the square-corner doc comment; `colors.accent` carries the "never a status color" doc comment.
- Added thin barrel `theme/index.ts` and `shared/README.md` capturing the accent convention + 0px rule for stories 1.9–1.12.
- `theme.test.ts`: 8 tests lock every color hex, the full spacing scale (incl. `chrome-row`), typography roles (monospace family, label/dim-wink/active-tab), 0px corners (AC3), and accent ∉ status set (AC4).
- Gates: `npm test` 183 pass, `npm run typecheck` clean, `npm run depcheck` clean; AD-1 boundary rule confirmed still firing. No changes outside `src/adapters/driving/tui/`; no package.json change (Ink/React deferred to 1.9).

### File List

- `_bmad-output/implementation-artifacts/1-8-atelier-design-tokens-theme-module.md` (this file)
- `src/adapters/driving/tui/shared/theme/theme.ts` (new)
- `src/adapters/driving/tui/shared/theme/theme.test.ts` (new)
- `src/adapters/driving/tui/shared/theme/index.ts` (new)
- `src/adapters/driving/tui/shared/README.md` (new)

## Change Log

- 2026-08-14 — Implemented story 1.8: added the Atelier token module under `src/adapters/driving/tui/shared/theme/` with exact-value unit tests, the square-corners (0px) rule, and the accent-usage convention documentation. Status `ready-for-dev` → `in-progress` → `review`.
- 2026-08-14 — Code review iteration 1: AC1–AC4 met; 4 decisions resolved (added `rounded.DEFAULT`, Ink-consumable `bold` booleans replacing `weight`/`letterSpacing`, DESIGN.md pairing-rule docs, depcruise `no-tui-leak-outside-driving-tui` rule), 3 patches applied (row-count spacing doc, exact family lock, whole-scale 0px assertion), 5 items deferred to `deferred-work.md`, 4 dismissed. Status `review` → `done`.
