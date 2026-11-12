---
title: 'Read-Focused Display Components'
type: 'feature'
created: '2026-08-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: [1-8-atelier-design-tokens-theme-module]
baseline_commit: '83e7758'
warnings: []
deferred: []
---

<intent-contract>

## Story

As a developer,
I want the status-badge, list-row, and detail-pane components built against the Atelier theme,
so that every zone can display state consistently without re-implementing these primitives.

## Acceptance Criteria

From `_bmad-output/planning-artifacts/epics.md#Story-1.9` (lines 390-414), verbatim:

- **AC1** — Given `status-badge`, When rendered for any state (up/down, done/failed, in-progress, selection/action marker), Then it always renders glyph and paired color together — never color alone.
- **AC2** — Given `list-row` unselected, When rendered, Then it shows base text on surface with a transparent accent-bar column; And When selected, Then it shows surface-selected fill, a solid accent bar, and the `›` marker ahead of the label.
- **AC3** — Given a nested `list-row`, When rendered, Then it is indented by the theme's indent token.
- **AC4** — Given a `list-row` with trailing metadata, When rendered, Then the metadata renders in text-dim, visually distinct from the label.
- **AC5** — Given `detail-pane` with a title, When rendered, Then the title is uppercase in label style; And When summarizing a run outcome, Then a `summary-line` top-rule colors to match the outcome.

## Intent

**Problem:** The Atelier theme module (Story 1.8) provides the token vocabulary but nothing renders it. Every zone in Epics 2–6 will need a consistent way to show state (status glyphs, selectable rows, run-outcome panes). Without these three primitives, each zone would re-implement them ad hoc, drifting from DESIGN.md's component specs and re-introducing the exact "never color alone" / selection-treatment mistakes the design exists to prevent. `epic-1-context.md:60` names Story 1.8 (theme) as the prerequisite for 1.9–1.12; this story is the **first to render** against that theme.

**Approach:** Build three pure, presentational React components under `src/adapters/driving/tui/shared/components/` (AD-15: cross-zone Atelier UI lives in `tui/shared/`). Each component is a thin JSX wrapper over the theme tokens — no props beyond what the component renders, no state, no side effects. The design-critical mapping logic (state → glyph+color for `status-badge`; tone → color for `detail-pane`'s summary-line; row-layout resolution for `list-row`) is extracted as **exported pure constants/functions** so Vitest can lock it without rendering. Components are then smoke-tested via Ink's own `render()` (AD-13 — the sanctioned TUI test level; `ink-testing-library` is unmaintained). This story is **the first to install Ink/React** (deferred from Story 1.8, D-theme-1) and the first to add `.tsx` files to the repo.

## Boundaries & Constraints

**Always:**
- **AD-15 / AD-1 placement:** components live under `src/adapters/driving/tui/shared/components/` — the TUI driving adapter's shared area, a sibling of `theme/`. Never in `src/core/` (core stays fs/Ink/React-free — AD-1). Not a driven adapter. TUI-only — do **not** pull them into `dispatch.ts`/`envelope.ts` (AD-3; the `no-tui-leak-outside-driving-tui` depcruise rule enforces this).
- **Every visual value from the theme.** Never hardcode a color, glyph, spacing, radius, or typography role in a component — import from `theme/theme.js` (or the barrel `theme/index.js`). This is the whole point of Story 1.8; a hardcoded hex is a regression, not a shortcut.
- **Pure presentational, no `Result<T>`.** These are rendering-layer React components, not core use-cases: no `ok()/err()`, no kebab-case `error.code`, no `dispatch.ts`, no fs/process. (Same posture as the theme module.)
- **Glyph + color always ship together (AC1).** A `status-badge` for any state renders its glyph *and* its paired color. Color alone is never the carrier. Accent is only ever selection/action markers (`›`/`▸`) — never a status color (AC4 of 1.8 still binds; accent and warning sit close in hue).
- **Square corners (Story 1.8 AC3).** These components render no border radius anywhere; Ink has no radius property, so this is satisfied by simply never introducing rounded glyphs and by consuming `theme.rounded` where a radius would ever apply.
- **NodeNext imports (`../foo.js`), imports first, kebab-case files, `PascalCase` components, `camelCase` helpers, functional (no classes)** — same conventions as every prior story (AGENTS.md; `deferred-work.md` acorn landmine).
- Gates: `npm test && npm run typecheck && npm run depcheck`.

**Defer (design decision, D-components-1):**
- **Building the modal-dialog, checkbox-list-item, splitter, spinner, dim-annotation** → Story 1.10. Not here.
- **The app shell / top bar / zone tabs / footer / Zustand store / zone screens** → Stories 1.11+. Not here.
- **Launch banner and `?` help screen** → Story 1.12. **Keybinding wiring** → Story 1.13.
- **`Object.freeze` on the theme token groups + `Object.isFrozen` assertion** — a deferred item from Story 1.8's review ("when the first consumer lands (Story 1.9+)"). This story is the first consumer, so **pick it up now**: apply `Object.freeze` to each token group in `theme.ts` (or freeze at the aggregate) and add an `Object.isFrozen(theme)` assertion in `theme.test.ts`. Do this in a separate atomic commit from the component work so it is reviewable on its own.
- **Barrel `theme/index.ts` coverage** — another deferred item from 1.8 ("import from `./index.js` in at least one test once consumers exist"). This story's consumers are the first users of the barrel: **import from `theme/index.js` (the barrel) in at least one component test**, exercising the advertised public entrypoint.
- **Glyph vocabulary tokenization** — deferred item from 1.8 ("tokenize glyphs (or point to a glyph set) in the Story 1.9 status-badge"). The `STATUS_BADGES` map (Code Map) IS that tokenization; no separate theme change required.

**Block If:**
- A requirement surfaces to build a zone screen, the app shell, interactive/keybinding behavior, or any of Story 1.10's components in this story. HALT and defer — this story's deliverable is three read-focused primitives + their tests only.
- Ink/React installation "proves" the components in a way that requires interactive-mode rendering or a real TTY. Use the non-interactive `render()` helper in Code Map; no pty needed.

**Never:**
- No wiring into `dispatch.ts`, `envelope.ts`, `subcommands.ts`, `core/`, driven adapters, or `bin/`.
- No `ink-testing-library` (unmaintained, predates Ink 7/React 19 — AD-13). No `chalk`. No `@testing-library`.
- No mutation of the theme module's exported objects at runtime (this story's `Object.freeze` guard exists to prevent exactly that).
- No hardcoded hex colors, glyphs, spacing, or radius anywhere in the new components.
- No `React.FC`-style implicit children typing where a prop object is required; use plain function components with explicit prop types.
- No `"jsx": "preserve"` in tsconfig. The story needs `"jsx": "react-jsx"` (React 19 automatic runtime) for `tsc` to compile `.tsx`; depcruise only switches its JSX handling on `"jsx": "preserve"` (enum value 1), so `react-jsx` (enum 3) leaves the verified acorn-loose import extraction behavior unchanged.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Render `status-badge` for `up` | `<StatusBadge state="up" />` | `●` glyph rendered in `theme.colors.success` (green) | n/a — pure presentational |
| Render `status-badge` for `down` | `<StatusBadge state="down" />` | `○` in `colors.error` (red) | n/a |
| Render `status-badge` for `done` / `failed` | `<StatusBadge state="done" />` / `state="failed"` | `✔` in `success` / `✖` in `error` | n/a |
| Render `status-badge` for `in-progress` | `<StatusBadge state="in-progress" />` | `⣾` in `colors.info` | n/a |
| Render `status-badge` for `selection` / `action` | `<StatusBadge state="selection" />` / `state="action"` | `›` / `▸` in `colors.accent` (never a status color) | n/a |
| Any `status-badge` state | all 7 states | Each entry in `STATUS_BADGES` has BOTH a glyph and a color — the map unit test asserts no entry is color-only (AC1) | test failure |
| `list-row` unselected | `<ListRow label="api-gateway" />` | Label in `colors.text`, transparent 1ch accent-bar column (empty — no `▌`, no fill) (AC2) | n/a |
| `list-row` selected | `<ListRow label="api-gateway" selected />` | `surface-selected` background fill, solid accent `▌` in the accent-bar column, `›` marker ahead of the label in accent (AC2) | n/a |
| Nested `list-row` | `<ListRow label="micro-users" nested />` | Row shifted right by `theme.spacing.indent` (2ch) (AC3) | n/a |
| `list-row` with trailing metadata | `<ListRow label="api-gateway" meta="main ↑0 ↓0" />` | Metadata rendered in `colors['text-dim']`, visually distinct from the label (AC4) | n/a |
| `detail-pane` with title | `<DetailPane title="Update — checkout-flash-sale">…</DetailPane>` | Title displayed uppercase in label style — `colors['text-dim']`, not bold (AC5; label is explicitly NOT bold per DESIGN.md §Typography) | n/a |
| `detail-pane` with run outcome | `<DetailPane title="…" summary={{ tone: 'success', text: 'Résumé : 2/2' }}>…</DetailPane>` | A `summary-line` top rule renders above the summary text, colored by the tone (AC5) | n/a |
| Summary tone mapping | `tone: 'success' \| 'warning' \| 'error'` | `SUMMARY_LINE_COLORS` maps tone → `colors.success` / `colors.warning` / `colors.error` — exact, locked by unit test | n/a |
| A typo in a glyph/color pairing | dev changes `up: {glyph:'●', color: success}` → wrong color | Map unit test asserting the exact pairing **fails** | test failure |
| Render smoke test | component mounted via Ink `render()` with a captured stream | Output string contains the expected glyph/label/meta/title as substrings (ANSI codes wrap styled text — use `.includes()`, never exact-equality on styled output) | unmount always happens (no dangling process/stdin listeners) |

## Code Map

(Target files. `NEW` under the TUI driving adapter's shared area; the only `UPDATE` files are `package.json` and `tsconfig.json`.)

- `package.json` -- **UPDATE**. First Ink/React install (deferred from 1.8, D-theme-1). Add exact-pinned runtime deps (repo convention for `dependencies` is exact versions): `"ink": "7.1.1"`, `"react": "19.2.8"` (architecture stack table, `ARCHITECTURE-SPINE.md:181-182`). Add `"@types/react": "^19.2.18"` to `devDependencies` (caret matches the devDeps convention, e.g. `@types/node`). Do not add `ink-testing-library` or any other UI-test lib (AD-13).
- `tsconfig.json` -- **UPDATE**. Add `"jsx": "react-jsx"` to `compilerOptions`. Without it `tsc --noEmit` errors on every `.tsx`. (`skipLibCheck: true` already tolerates any DOM-lib references inside `@types/react`; the components render in Node, not the DOM, and vitest's esbuild handles `.tsx` natively using the same tsconfig `jsx` setting.)
- `src/adapters/driving/tui/shared/components/status-badge.tsx` -- **NEW**. Exports:
  - `export type StatusBadgeState = 'up' | 'down' | 'done' | 'failed' | 'in-progress' | 'selection' | 'action';`
  - `export const STATUS_BADGES = { up: { glyph: '●', color: colors.success }, down: { glyph: '○', color: colors.error }, done: { glyph: '✔', color: colors.success }, failed: { glyph: '✖', color: colors.error }, 'in-progress': { glyph: '⣾', color: colors.info }, selection: { glyph: '›', color: colors.accent }, action: { glyph: '▸', color: colors.accent } } as const;` — the glyph vocabulary tokenized (closes the 1.8 deferred item), every pairing exactly per `DESIGN.md` Components.status-badge (lines 159-160) and Colors (116-118).
  - `export function StatusBadge({ state }: { state: StatusBadgeState }) { const { glyph, color } = STATUS_BADGES[state]; return <Text color={color}>{glyph}</Text>; }` — imports `{ Text }` from `ink`, `{ colors }` from the theme (`../theme/theme.js` or the barrel). Glyph and color always ship together (AC1).
- `src/adapters/driving/tui/shared/components/status-badge.test.ts` -- **NEW**. Vitest. (1) Unit-test `STATUS_BADGES`: every state present; every entry has a truthy `glyph` and a color (AC1); the seven exact pairings (up→success/`●`, down→error/`○`, done→success/`✔`, failed→error/`✖`, in-progress→info/`⣾`, selection→accent/`›`, action→accent/`▸`); selection/action never use a status color. (2) Ink `render()` smoke: mount `<StatusBadge state="done" />` via the render-to-string helper, assert the output contains `✔`; unmount. Import from the **barrel** `theme/index.js` here so the public entrypoint is exercised (1.8 deferred item).
- `src/adapters/driving/tui/shared/components/list-row.tsx` -- **NEW**. Exports `ListRow` (props: `{ label: string; selected?: boolean; nested?: boolean; meta?: string }`) and a pure `resolveRowLayout`-style helper if useful for testability. Behavior:
  - **Accent-bar column is content, not an Ink border** — Ink cannot render a one-sided border at sub-cell width (`DESIGN.md` Components.list-row note, line 70). Reserve a 1ch cell in the leftmost column: selected renders `▌` in `colors.accent`, unselected renders a single space (transparent) (AC2).
  - Selected additionally renders the `›` marker (accent) ahead of the label, and the row's background is `colors['surface-selected']` (AC2).
  - Nested rows shift right by `theme.spacing.indent` (2ch) (AC3).
  - Trailing `meta` renders in `colors['text-dim']`, right-aligned or after the label on the same row (AC4).
  - Row/background colors come from `colors.text` on `colors.surface` for the base state.
- `src/adapters/driving/tui/shared/components/list-row.test.ts` -- **NEW**. Unit-test the pure layout/marker resolution (unselected vs selected vs nested) and a `render()` smoke asserting the label appears and that `›`+`▌` appear when `selected` (AC2/AC3/AC4). Keep render assertions to substrings; the exact selection treatment is carried by the pure-resolution tests + the map.
- `src/adapters/driving/tui/shared/components/detail-pane.tsx` -- **NEW**. Exports:
  - `export type SummaryTone = 'success' | 'warning' | 'error';`
  - `export const SUMMARY_LINE_COLORS = { success: colors.success, warning: colors.warning, error: colors.error } as const;`
  - `export function DetailPane({ title, children, summary }: { title: string; children: ReactNode; summary?: { tone: SummaryTone; text: string } })` — renders the title uppercase in `colors['text-dim']` in label style (not bold — the label role is explicitly `bold: false`, `theme.ts` lines 42-46), body content in `colors.text` (`lineHeight: '1.7'` from DESIGN.md has **no Ink counterpart** — Ink renders every cell at height 1; treat as a documented no-op deviation, exactly like Story 1.8 resolved `weight`/`letterSpacing` to boolean `bold`), and, when `summary` is present, a `summary-line` divider.
  - **summary-line implementation (verified):** Ink 7.1.1 `Box` supports per-side border visibility (`borderTop`/`borderBottom`/`borderLeft`/`borderRight` booleans) and per-side color (`borderTopColor`). Render `<Box borderStyle="single" borderLeft={false} borderRight={false} borderBottom={false} borderTopColor={SUMMARY_LINE_COLORS[tone]}><Text>{summary.text}</Text></Box>` — a single-weight top rule in `colors.border`, recolored to the outcome tone (success green / warning amber / error red). See `DESIGN.md` Components.detail-pane (line 74) and the verified `ink@7.1.1` `styles.d.ts` (borderTop/borderTopColor present).
- `src/adapters/driving/tui/shared/components/detail-pane.test.ts` -- **NEW**. Unit-test `SUMMARY_LINE_COLORS` (exact tone→color values from theme) and `render()` smokes: title appears uppercased; summary text appears when `summary` provided (AC5).
- `src/adapters/driving/tui/shared/components/index.ts` -- **NEW**. Thin barrel re-exporting `StatusBadge`, `ListRow`, `DetailPane` (and their types/maps). Imported by at least one test (barrel coverage).

> **Render-to-string helper (test-only, verified against ink@7.1.1's render API):**
> ```ts
> import { render } from 'ink';
> import { Writable } from 'node:stream';
> import type { ReactNode } from 'react';
>
> async function renderToString(node: ReactNode): Promise<string> {
>   let output = '';
>   const stdout = new Writable({
>     write(chunk, _encoding, callback) {
>       output += chunk.toString();
>       callback();
>     },
>   });
>   const instance = render(node, {
>     stdout,
>     interactive: false, // forces the final-frame-at-unmount path; no TTY needed
>     exitOnCtrlC: false,
>     patchConsole: false,
>   });
>   instance.unmount();
>   await instance.waitUntilExit(); // settles after unmount writes flush
>   return output;
> }
> ```
> Ink writes ANSI color codes around styled text even in non-interactive mode, so assert with `.includes('<glyph-or-text>')`, never exact-equality on the raw output. In non-interactive mode Ink writes only the final frame at unmount, which is exactly what this helper captures. Always `unmount()` (no leaked stdin listeners / no dangling render instance).

## Tasks & Acceptance

**Execution (git):**
- Branch `story-1-9-read-focused-display-components` from `epic-1-foundation-navigation-shell`; all work + commits on it; `--no-ff` merge only after code review. Conventional commits with `(story 1.9)` in the subject. Epic-1 is already `in-progress` in `sprint-status.yaml` — no epic status change needed.
- Order of commits: (1) `Object.freeze` on theme token groups + `Object.isFrozen` assertion (1.8 deferred item, isolated commit); (2) Ink/React/`@types/react` deps + tsconfig `jsx` + a `.tsx` smoke so the install is proven; (3) the three components + tests + barrel.

**Execution (code):**
- `package.json` + `tsconfig.json` -- UPDATE (see Code Map).
- `src/adapters/driving/tui/shared/components/{status-badge,list-row,detail-pane}.tsx` + `.test.ts` + `index.ts` -- NEW.
- Apply the two 1.8 deferred items: `Object.freeze` + `Object.isFrozen(theme)` in `theme.ts`/`theme.test.ts`; barrel import in at least one test.
- Gates -- `npm test && npm run typecheck && npm run depcheck`. Then **round-trip the boundary rules** per the prior-story convention: confirm `depcheck` still extracts the new `.tsx` imports (empirically verified for a realistic component in this story's Dev Notes) and that `no-tui-leak-outside-driving-tui` still fires on a deliberate violation (e.g. a throwaway `src/adapters/driving/cli/*.ts` importing `tui/shared`), then remove it. Confirm the acorn/imports-first landmine (`deferred-work.md`) doesn't bite: the new `.tsx` files keep their imports as the first statements.
- Commit -- atomic conventional commits, `(story 1.9)` in subject.

**Acceptance Criteria traceability:**
- AC1 (status-badge glyph+color together, never alone) → `STATUS_BADGES` map (every entry glyph+color) + unit test + render smoke. *(Epic 1 implementation note: this also honors Story 1.8 AC4 — selection/action markers are accent, never a status color.)*
- AC2 (list-row base vs selected: surface-selected fill + solid accent bar + `›` marker) → `ListRow` selection rendering + pure-resolution test + render smoke.
- AC3 (nested indent by theme's indent token) → `ListRow` `nested` prop consuming `theme.spacing.indent` + test.
- AC4 (trailing metadata in text-dim) → `ListRow` `meta` prop consuming `colors['text-dim']` + test.
- AC5 (detail-pane uppercase label title + outcome-colored summary-line) → `DetailPane` + `SUMMARY_LINE_COLORS` + tests.

### Review Findings

**patch:**

- [x] [Review][Decision→Patch] Selected `list-row` shifts the label right by 1ch — base rows reserve a 1ch transparent accent-bar column (`' '`), while selected rows add the `›` marker on top (bar + marker = 2ch before the label), so the label x-position moves on selection. **Resolved (user decision 2026-08-14):** reserve a fixed 2ch selection column — marker renders `' '` when unselected so labels stay aligned. [`src/adapters/driving/tui/shared/components/list-row.tsx:25-26,39-40`]

- [x] [Review][Patch] AC5 summary-line top-rule is not render-asserted — `detail-pane.test.tsx` asserts only the summary text (`toContain('Résumé : 2/2')`); the outcome-colored border rule (the AC5 headliner) could disappear and every DetailPane test stays green. Add a render assertion that the rule renders (e.g. Ink box-drawing char and/or tone ANSI color present). [`src/adapters/driving/tui/shared/components/detail-pane.test.tsx:31-41`]
- [x] [Review][Patch] Ink styling application layer is unpinned at the render boundary — selected surface-selected fill / accent `▌` bar (AC2), meta `text-dim` distinctness (AC4), per-state badge colors (AC1: only the `done` state is smoke-rendered), nested indent, and the `▌`-absence / `no-summary` inverse cases are never asserted in Ink output. The pure-maps layer is well covered; only the thin JSX application layer could regress silently. [`list-row.test.tsx`, `status-badge.test.tsx`, `detail-pane.test.tsx`]
- [x] [Review][Patch] "Deeply frozen" test pins only 2 of the 4 nested typography roles — `theme.ts` freezes `base`/`label`/`dim-wink`/`active-tab`, but `theme.test.ts` asserts only `base` and `label`; removing `Object.freeze` on `dim-wink`/`active-tab` passes the test despite the deep-freeze claim. Add the two missing `Object.isFrozen` assertions. [`src/adapters/driving/tui/shared/theme/theme.test.ts:85-93`]
- [x] [Review][Patch] `STATUS_BADGES` / `SUMMARY_LINE_COLORS` are runtime-mutable — `as const` is compile-time only; a consumer could mutate them, undercutting the story's own `Object.freeze` posture for the token vocabulary. Wrap both maps in `Object.freeze` (and mirror in the tests if asserted). [`src/adapters/driving/tui/shared/components/status-badge.tsx:13-21`, `src/adapters/driving/tui/shared/components/detail-pane.tsx:7-11`]
- [x] [Review][Patch] `theme.test.ts` ends without a trailing newline (cosmetic; every other file in the change has one). [`src/adapters/driving/tui/shared/theme/theme.test.ts:94`]
- [x] [Review][Patch] `renderToString` has no error/cleanup path — if `render()` throws, the Ink instance is never unmounted and Ink's process hooks (stdin/signal) leak; wrap the render/unmount in `try/finally` so `unmount()` always runs. [`src/adapters/driving/tui/shared/components/render-to-string.ts:13-20`]

## Dev Notes

- **First story to install Ink/React — do not skip the install.** `ink@7.1.1` requires Node ≥22 and React ≥19.2.0 (`ARCHITECTURE-SPINE.md:181`); the project runs Node ≥24 and pins React `19.2.8` — no conflict. `@types/react@^19.2.18` is the current stable types package (verified 2026-07-30); the repo's devDeps use caret ranges, runtime deps use exact pins — follow that split.
- **`.tsx` + depcruise landmine: VERIFIED, not speculative.** The project pins `typescript@7.0.2`, which is outside depcruise@18.2.0's supported transpiler range (`>=2.0.0 <7.0.0` — `meta.cjs`), so depcruise does **not** transpile `.tsx`; it feeds the raw TSX to acorn (which fails on JSX + type annotations) and falls back to **acorn-loose**. Empirically verified during story creation: a realistic `.tsx` component (`Text` from `ink`, `colors` from `./theme.js`, a `|`-union prop type, `as const` map, JSX return) was cruised with this repo's exact `.dependency-cruiser.cjs` — result "3 modules, 2 dependencies cruised", both imports (`./theme.js`, `ink`) extracted, no violations. **The boundary rules remain effective for `.tsx`.** Adding `"jsx": "react-jsx"` to tsconfig does **not** change this: depcruise only activates JSX-specific handling for `.tsx` when `jsx === "preserve"` (enum 1, `parse.mjs` `PRESERVE_JSX`); `react-jsx` is enum 3, so behavior is unchanged. Round-trip a deliberate violation before merging anyway (prior-story convention).
- **Imports-first is non-negotiable in the new files** — the acorn-loose extraction this all rides on is the same mechanism the 1.3 landmine documented: imports that aren't the first statements of a file can be silently dropped from the graph. Every `.tsx` keeps its imports at the top.
- **Why pure components + pure maps:** AD-13 restricts TUI testing to Ink `render()` smokes (no maintained testing-library for Ink 7). By extracting `STATUS_BADGES`, `SUMMARY_LINE_COLORS`, and list-row layout resolution as exported pure data/functions, the design-critical rules (AC1-AC5) get real unit coverage, and `render()` only proves mounting/output — exactly the sanctioned split.
- **Read the source of truth before writing values:** `DESIGN.md` Components — status-badge (159-160), list-row (162-163), detail-pane (165-166); Colors pairing rule (116-118); Typography label role (125-127: uppercase, tracked-out, text-dim, NOT bold); Shapes/0px (150-152); Do/Don't table (188-191). `EXPERIENCE.md` Component Patterns — status-badge passive (line 68), list-row keyboard behavior (69), detail-pane read-focused (70). Mockup `key-update-run.html` (State A, lines 164-177) renders a populated list (selected `api-gateway` with `›` + `● up` meta suffix in text-dim; nested `micro-users` indented) and a detail pane with an uppercase title `UPDATE — CHECKOUT-FLASH-SALE` and an outcome tally — the 1:1 fidelity reference. `DESIGN.md` wins on conflict (line 107).
- **Accent vs warning (Story 1.8 AC4 carries forward):** `selection`/`action` badges are accent `#c9a13b`; status is never accent. A `status-badge` for a status state must pair its status color with its glyph so accent/warning (hue-adjacent) are never told apart by color alone.
- **list-row accent bar ≠ Ink border.** Ink cannot render a border on only one side at sub-cell width; the accent bar is a rendered glyph column (a solid block `▌` in the leftmost cell when selected, a space otherwise). Do not try `borderLeft` on a `Box` for this.
- **summary-line = top-rule only.** Ink `Box` defaults all four borders on when `borderStyle` is set; the summary-line needs `borderStyle="single"` with `borderLeft={false} borderRight={false} borderBottom={false}` and `borderTopColor={tone color}` (verified props in ink@7.1.1 `styles.d.ts`). Recolor the top rule with the tone; leave the summary text itself in default `colors.text` (the rule, not the text, is what "colors to match the outcome" — DESIGN.md line 74).
- **detail-pane title is NOT bold.** The label role is `theme.typography.label = { bold: false }`; uppercase + `text-dim` is the entire treatment. Only the active zone-tab is ever bold (`theme.ts` 42-48, DESIGN.md 129). Use `title.toUpperCase()` (or Ink `Text` `transform` if preferred) — do not fake emphasis with bold.
- **`lineHeight: '1.7'` is a documented no-op.** DESIGN.md body carries `lineHeight: '1.7'`, but Ink has no line-height control — every terminal cell is height 1. Note this as a deliberate, documented deviation (same class as 1.8's `weight`/`letterSpacing` → boolean `bold` resolution). Do not attempt a layout hack to simulate it.
- **Deferred items being picked up (from 1-8 review, `deferred-work.md`):** (1) `Object.freeze` each token group + `Object.isFrozen(theme)` assertion — isolate in its own commit; (2) barrel `theme/index.js` import in at least one test; (3) glyph vocabulary → `STATUS_BADGES`. Items left deferred: runtime-immutability was the only "first consumer" item; the other four 1-8 deferred entries stay deferred as tracked.
- **Regression safety:** purely additive under `tui/shared/components/` + `package.json`/`tsconfig.json` changes. Nothing existing changes, so no prior test can break — but the `no-tui-leak-outside-driving-tui` rule must keep passing (the new components import `ink` and the theme, all inside the TUI adapter: compliant). Confirm the e2e (`src/bin/tui-back.e2e.test.ts`) and depcheck still run clean after the deps/tsconfig change.
- **Conventions recap:** NodeNext relative imports end in `.js`; imports first; kebab-case file/dir names; `PascalCase` components/types; `camelCase` functions/constants; no classes; functional components with explicit prop types.

### Project Structure Notes

- New directory `src/adapters/driving/tui/shared/components/` aligns with AD-15 (cross-zone Atelier UI in `tui/shared/`, never duplicated per zone) and with `ARCHITECTURE-SPINE.md:49-58`'s tree. It sits beside `theme/`; components import tokens from `theme/` (deep or barrel). Zone subfolders (`dashboard/`, `edts/`, …) remain deferred to Story 1.11 (D-theme-1).
- Only two files outside `tui/shared/components/` change: `package.json` (deps) and `tsconfig.json` (`"jsx": "react-jsx"`). No change to `src/core/`, driven adapters, `driving/cli/`, or `src/bin/`.
- The `no-tui-leak-outside-driving-tui` depcruise rule (`from: pathNot ^src/adapters/driving/tui, to: tui`) already protects the new directory — nothing outside the TUI may import these components (AD-3, TUI-only).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md#Story-1.9` (lines 384-414)] — user story + AC1-AC5 verbatim; Story 1.8 (360-383) for the theme it builds on; Epic 1 implementation notes (130-135).
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/DESIGN.md`] — Components status-badge (159-160), list-row (162-163), detail-pane (165-166); Colors pairing rule (116-118); Typography label role (125-129); Shapes/0px (150-152); Do/Don't (188-191); elevation/border-weights (139-148). DESIGN.md wins on conflict (107).
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md`] — Component Patterns table (66-76): status-badge passive, list-row keyboard behavior, detail-pane read-focused; State Patterns (80-158) for how the components are consumed zone-by-zone; keybinding contract (160-176) informs later stories only.
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/mockups/key-update-run.html` (lines 164-177)] — 1:1 fidelity reference for list-row (selected `›` + meta suffix in text-dim + nested indent) and detail-pane (uppercase label title + outcome tally). Illustrative, not authoritative (DESIGN.md wins).
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md`] — §AD-13 (151-157: TUI render() smokes only; ink-testing-library unmaintained), §AD-15 (161-165: `tui/shared/` for cross-zone Atelier UI), tree (49-58), stack (181-182: Ink 7.1.1 / React 19.2.8).
- [Source: `_bmad-output/implementation-artifacts/1-8-atelier-design-tokens-theme-module.md`] — the theme module contract, D-theme-1 (Ink/React deferred to 1.9), review findings incl. the three deferred items this story picks up.
- [Source: `_bmad-output/implementation-artifacts/epic-1-context.md` (line 60)] — "1.8 (theme module) is the prerequisite for 1.9–1.12".
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — acorn/imports-first landmine (line 50); 1-8 deferred items (lines 5-9).
- [Source (tech, web 2026)] — ink@7.1.1 latest stable (npm, 2026-07-16), `render()` RenderOptions incl. `interactive`, `waitUntilRenderFlush`, `waitUntilExit`, `unmount` (ink@7.1.1 `render.d.ts`); Box per-side border props `borderTop`/`borderBottom`/`borderLeft`/`borderRight` + `borderTopColor` (ink@7.1.1 `styles.d.ts`, verified); `@types/react` 19.2.18 current stable (npm, 2026-07-30).
- [Source (empirical, this story)] — depcruise acorn-loose import extraction verified on a realistic `.tsx` component with this repo's `.dependency-cruiser.cjs`; `typescript@7.0.2` outside depcruise's supported range (`meta.cjs`).

## Task / Acceptance Traceability

- AC1 → `status-badge.tsx` `STATUS_BADGES` (glyph+color pairs) + `status-badge.test.ts`.
- AC2 → `list-row.tsx` selection rendering (surface-selected fill + accent `▌` bar + `›` marker) + `list-row.test.ts`.
- AC3 → `list-row.tsx` `nested` prop (`theme.spacing.indent`) + `list-row.test.ts`.
- AC4 → `list-row.tsx` `meta` prop (`colors['text-dim']`) + `list-row.test.ts`.
- AC5 → `detail-pane.tsx` uppercase label title + `SUMMARY_LINE_COLORS` summary-line + `detail-pane.test.ts`.

## Dev Agent Record

### Agent Model Used

opencode / deepseek-v4-flash-free (story creation session, 2026-08-14).

### Debug Log References

- Empirically verified during creation: depcruise on a realistic `.tsx` scratch component (ink + `./theme.js` imports, union type, `as const` map, JSX) → "3 modules, 2 dependencies cruised", both imports extracted, no violations. This is the evidence the boundary rules survive `.tsx`.
- Verified ink@7.1.1 `render.d.ts` (RenderOptions `interactive`/`waitUntilRenderFlush`/`waitUntilExit`/`unmount`) and `styles.d.ts` (per-side `borderTop`… + `borderTopColor`). Verified `@types/react` 19.2.18 stable.
- Depcruise TS range check: `supportedTranspilers.typescript = ">=2.0.0 <7.0.0"` — project's TS 7.0.2 excluded, hence acorn-loose path for `.tsx`.
- Re-verified during implementation (commit `2d5ab29`): depcruise JSON output on the three `.tsx` components extracts `ink`, `../theme/theme.js`, and `react` — both imports per file present, no boundary violations (112 modules / 172 dependencies cruised). A throwaway `src/adapters/driving/cli/__leak_check__.ts` importing the components barrel correctly trips `no-tui-leak-outside-driving-tui` (1 error), then removed.

### Completion Notes List

- Story 1.9 created by `bmad-create-story` on 2026-08-14; status `ready-for-dev`.
- Confirmed as the first backlog story in epic-1 (1-1..1-8 done); epic-1 already `in-progress` — no sprint-status epic change needed.
- Story target: three read-focused presentational components (`status-badge`, `list-row`, `detail-pane`) under `tui/shared/components/`; first story to install Ink 7.1.1 / React 19.2.8 / `@types/react` and to add `.tsx` + `"jsx": "react-jsx"` to the repo.
- Picks up three 1-8 deferred items (Object.freeze + barrel test import + glyph-vocabulary tokenization).
- Key verified technical facts embedded: depcruise acorn-loose extracts `.tsx` imports; Ink 7.1.1 render() non-interactive helper; Ink per-side border props for the summary-line top-rule.
- **Implementation complete on 2026-08-14** on branch `story-1-9-read-focused-display-components` (3 commits, `(story 1.9)` subjects): theme token freeze (`ff72284`), Ink/React install + `"jsx": "react-jsx"` + render-to-string helper + ink smoke (`0951203`), three components + tests + barrels (`2d5ab29`).
- AC1 (status-badge): `STATUS_BADGES` covers all 7 states, every entry glyph+color, exact pairings locked, selection/action accent-only; render smoke proves mounting. Imported via the theme barrel `theme/index.js` (1.8 deferred barrel item).
- AC2/AC3/AC4 (list-row): pure `resolveRowLayout` locks unselected (transparent bar), selected (surface-selected + `▌` accent + `›` marker), nested (indent by `spacing.indent`), meta (`text-dim`); render smokes assert label/`›`/`▌` presence.
- AC5 (detail-pane): uppercase label title, body, outcome-colored summary-line top-rule via Ink per-side border props (`borderStyle="single"`, only `borderTopColor` set to tone); `SUMMARY_LINE_COLORS` locked to theme values.
- Object.freeze applied to `colors`/`spacing`/`typography`(+nested roles)/`rounded`/`theme` aggregate; `Object.isFrozen` assertions added (1.8 deferred freeze item).
- Components barrel `index.ts` added; imported by `status-badge.test.tsx` (barrel coverage).
- Gates green: `npm test` 201 passed (21 files), `npm run typecheck` clean, `npm run depcheck` clean (112 modules). Boundary round-trip done: `no-tui-leak-outside-driving-tui` fires on deliberate violation and is clean after removal.

### File List

- `_bmad-output/implementation-artifacts/1-9-read-focused-display-components.md` (this file)
- `src/adapters/driving/tui/shared/components/status-badge.tsx`
- `src/adapters/driving/tui/shared/components/status-badge.test.tsx`
- `src/adapters/driving/tui/shared/components/list-row.tsx`
- `src/adapters/driving/tui/shared/components/list-row.test.tsx`
- `src/adapters/driving/tui/shared/components/detail-pane.tsx`
- `src/adapters/driving/tui/shared/components/detail-pane.test.tsx`
- `src/adapters/driving/tui/shared/components/index.ts`
- `src/adapters/driving/tui/shared/components/render-to-string.ts` (test-only Ink render helper)
- `src/adapters/driving/tui/shared/components/ink-smoke.test.tsx` (install smoke)
- `package.json` (added `ink` 7.1.1, `react` 19.2.8, `@types/react` ^19.2.18)
- `package-lock.json`
- `tsconfig.json` (added `"jsx": "react-jsx"`)
- `src/adapters/driving/tui/shared/theme/theme.ts` (Object.freeze on token groups)
- `src/adapters/driving/tui/shared/theme/theme.test.ts` (Object.isFrozen assertions)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status → review)
</intent-contract>

## Change Log

- 2026-08-14 — Story created (status `ready-for-dev`).
- 2026-08-14 — Implementation complete, status → `review`. Three read-focused components built on branch `story-1-9-read-focused-display-components`; all ACs covered by tests; Ink 7.1.1 / React 19.2.8 installed; theme tokens frozen; boundary round-trip verified.
- 2026-08-14 — Code review iteration 1: AC1–AC5 met. 1 decision resolved (fixed 2ch selection column so labels stay aligned on selection), 7 patches applied (AC5 top-rule + Ink-styling render assertions, all-state badge smokes, `dim-wink`/`active-tab` freeze assertions, `Object.freeze` on `STATUS_BADGES`/`SUMMARY_LINE_COLORS`, trailing newline, `renderToString` cleanup), 8 dismissed. Gates: 211 tests / typecheck / depcheck clean. Status `review` → `done`.
