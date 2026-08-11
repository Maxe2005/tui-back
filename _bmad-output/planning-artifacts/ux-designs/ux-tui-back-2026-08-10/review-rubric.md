# Spine Pair Review — tui-back

## Overall verdict

This is a strong, largely buildable spine pair: flow coverage, token resolution, visual-reference citation, and section-shape discipline are all clean, and every gap the three prior reconciliation passes (`reconcile-prd.md`, `reconcile-brief.md`, `reconcile-research.md`) flagged is now visibly closed in both files — cross-checked directly against `.memlog.md`'s "reconciliation gaps applied" entry. The remaining issues are mechanical rather than substantive: one of the two `sources` frontmatter paths doesn't actually resolve from either file's real location, two named, real UI surfaces (the launch banner, the keybinding-help screen) fall through the Components/State-Patterns net, and a handful of border-width tokens are specified in px inside a spacing system that otherwise deliberately went all-`ch` to fit the terminal grid. None of these block a competent implementer, but all are worth a short fix pass before downstream consumption by `bmad-architecture` or `bmad-create-epics-and-stories`.

## 1. Flow coverage — strong

Checked every UJ named in the PRD (§2.3, UJ-1–UJ-4) against `EXPERIENCE.md`'s `## Key Flows`. All four titles are verbatim matches to the PRD. Each has a named protagonist (Max), numbered steps, a bolded `**Climax:**` beat, a `**Resolution:**`, and an explicit failure/edge-case path — several of which go beyond what the PRD's own UJ entries specify (PRD UJ-2/UJ-3/UJ-4 have no "Edge case" field at all; the spine adds one to each anyway).

### Findings
None.

## 2. Token completeness — strong

Extracted every frontmatter token in `DESIGN.md` and every `{path.to.token}` reference across both files (10 unique paths in `DESIGN.md`, 9 in `EXPERIENCE.md`). All resolve against the frontmatter's `colors`/`typography`/`rounded`/`spacing`/`components` trees. All 11 color tokens carry hex values — no critical color gaps.

### Findings
None. (See Finding 6.1 for a related but distinct unit-consistency issue in the underlying token *values*, not their resolution.)

## 3. Component coverage — adequate

Extracted every component named anywhere in either file. The 10 components in `DESIGN.md`'s `## Components` (`zone-tab`, `status-badge`, `list-row`, `detail-pane`, `footer-hint`, `modal-dialog`, `checkbox-list-item`, `splitter`, `spinner`, `dim-annotation`) match the 10 rows of `EXPERIENCE.md`'s `## Component Patterns` table name-for-name. `OptionList` (bmad-loop) is explicitly folded into `list-row` in `Inspiration & Anti-patterns` rather than left as an orphan reference — good discipline.

### Findings
- **medium** The launch banner is cross-referenced as living in `DESIGN.md.Components` but is actually specified under `DESIGN.md`'s `## Layout & Spacing` (EXPERIENCE.md line 38: "see `DESIGN.md.Components` for its visual spec"; actual spec at DESIGN.md lines 130–136, "**Launch banner.**" paragraph). `DESIGN.md` itself says the banner is deliberately "not a new component system" (line 136), so the omission from `## Components` is intentional — but the pointer text in `EXPERIENCE.md` is simply wrong about where to find it. *Fix:* change the citation to "see `DESIGN.md`'s Layout & Spacing" (or give the banner its own `### launch-banner` entry if it should be a first-class component after all).
- **medium** The keybinding-palette/help screen (opened via `?`) is named three times in `EXPERIENCE.md` (Information Architecture line 38, Interaction Primitives line 170, Inspiration & Anti-patterns line 194) but has zero visual spec in `DESIGN.md` and zero behavioral spec in `EXPERIENCE.md`'s Component Patterns table — not even an assignment to the existing `modal-dialog` pattern it most resembles. An implementer has no confirmed answer for what it looks like, whether `Esc` closes it (per the `modal-dialog` rule, or independently), or whether it's scrollable/searchable. *Fix:* either declare it an instance of `modal-dialog` (visually and behaviorally) or give it its own minimal component entry in both files.

## 4. State coverage — adequate

Walked every IA zone's state table in `EXPERIENCE.md`'s `## State Patterns` (Dashboard, EDTs, Update, Logs, Routes, shared-types, Cross-cutting) against the FR consequences and against the "zero-member EDT is a valid state" rule (FR-5). EDTs (`Zero-member EDT display`) and Update (`No-op`) each explicitly cover what happens when the active EDT has no members. Logs and shared-types don't.

### Findings
- **medium** Logs (`FR-16`: "every service in the active EDT") and shared-types (`FR-14`: "active EDT's member services") both scope their content to the active EDT's membership, exactly like Update and EDTs — but unlike those two, neither has a state-table row for what the zone shows when that membership is empty (`EXPERIENCE.md` "State Patterns > Logs", lines 120–128; "State Patterns > shared-types", lines 142–149). Given FR-5 makes a zero-member EDT an explicitly reachable, non-error state, and the spine's own Voice-and-Tone principle bans silent omission, this is a real gap rather than a hypothetical one. *Fix:* add a one-line "no members to stream/propagate" row to each table, mirroring EDTs' "Zero-member EDT display" wording.
- **low** The keybinding-help screen (see Finding 3, second item) also has no entry in `## State Patterns` — not walked as a surface at all. Same root cause as Finding 3; not re-detailed here.

## 5. Visual reference coverage — strong

The workspace has exactly one visual reference (`.working/design-directions.html`; `imports/` is empty). It's linked inline at the relevant section in both files: `DESIGN.md`'s `## Brand & Style` (line 105, names the "Atelier" / Direction 2 section and states what it shows — "full Dashboard and Update-run renders at the exact token values") and `EXPERIENCE.md`'s Navigation-model paragraph (line 42, "Composition reference"). Spines-win-on-conflict is stated once per file. Spot-checked the HTML directly: it does contain an "Atelier"/"Direction 2" section with Dashboard + Update-run mockups at the exact hex values quoted in `DESIGN.md`, and its footer hint literally shows the superseded `[g] dashboard` binding that `EXPERIENCE.md` explicitly calls out as corrected (lines 162, 172) — a good sign the spine was actually distilled from this file rather than asserted independently.

### Findings
None.

## 6. Bloat & overspecification — adequate

Both files are lean and mostly table-driven; `EXPERIENCE.md` prose stays factual (no editorial voice), `DESIGN.md` prose carries editorial voice appropriately per spec. No source restatement of personas/FRs/scope beyond what's needed to justify a design decision, no sections that read as filler.

### Findings
- **medium** `DESIGN.md`'s `## Layout & Spacing` states as a system-wide discipline that "Spacing is character-cell based, not pixel-based" — yet `list-row`'s `borderLeft` (frontmatter lines 66, 68: `'3px solid transparent'` / `'3px solid {colors.accent}'`) and `modal-dialog`'s `border` (line 80: `'2px solid {colors.border}'`) are specified in px, and the prose repeats this in `## Elevation & Depth` ("Every ordinary panel divider is a 1px `{colors.border}` hairline. A `modal-dialog` doubles that to 2px," line 143). Ink's `Box` has no sub-cell-width border control — a "3px" left border or a "2px vs 1px" edge has to become *something* concrete (an extra character of colored gutter, a bold vs. single box-drawing glyph, etc.), and unlike the 0px-corner token (which gets an explicit terminal-cell justification, lines 34–39) or the splitter's divider (already correctly specified as `'1 column/row'`, line 88), nothing here translates the px value into terminal-cell terms. *Fix:* either restate these two border values in cell/column terms like `splitter` already does, or add a short note explaining the intended Ink rendering (e.g., "2px" → double/bold box-drawing character).

## 7. Inheritance discipline — thin

Checked `sources` frontmatter resolution, UJ/requirement-name fidelity, glossary consistency, component-name identity, and `EXPERIENCE.md` → `DESIGN.md` token resolution.

### Findings
- **high** Both files' `sources` frontmatter lists `../.memlog.md` (`DESIGN.md` lines 6–8; `EXPERIENCE.md` lines 5–7). `.memlog.md` actually sits in the *same* directory as `DESIGN.md`/`EXPERIENCE.md` (`ux-tui-back-2026-08-10/.memlog.md`), so `../.memlog.md` resolves one level too high, to `ux-designs/.memlog.md` — confirmed not to exist. The `../../prds/.../prd.md` path in the same list resolves correctly. A consumer that programmatically walks `sources` (exactly the kind of source-extraction this review is checking for) will fail to load the canonical decision log. *Fix:* change to `.memlog.md` (or `./.memlog.md`) in both files.
- **low** `EXPERIENCE.md`'s frontmatter adds an `inherits: DESIGN.md` key (line 8) that appears in neither canonical example (`experience-example-mobile.md`, `experience-example-shadcn.md`) nor the design-md-spec reference. It's harmless and arguably clarifying, but it's an invented field outside the documented shape. Not a blocker — noted for consistency only.

No other issues found: UJ names are verbatim against the PRD; glossary terms (EDT, Managed repo, Manifest, Module, Core, Script, Group update, Propagation, Assisted resolution, Route-explorer module, Gateway) are used identically across the PRD and both spines, including the "Assisted resolution" labeling gap the prior reconciliation pass flagged and that is now visibly fixed (`EXPERIENCE.md` State Patterns rows "Migration failure (Assisted resolution)" and "Publish step failure (Assisted resolution)"); component names are identical across `DESIGN.md.Components`, `EXPERIENCE.md.Component Patterns`, and every inline reference; every `{components.*}`/`{colors.*}` reference in `EXPERIENCE.md` resolves to a real `DESIGN.md` token by name.

## 8. Shape fit — strong

`DESIGN.md`'s eight sections appear in the exact canonical locked order (Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts). `EXPERIENCE.md` carries all eight required defaults (Foundation, IA, Voice and Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows) plus both triggered-when-applicable sections that clearly apply here — Inspiration & Anti-patterns (named inspirations: bmad-loop, k9s; named rejects: Swagger UI, `update_repo.sh`, `check_health.sh`) and Responsive & Platform (mouse-optional / Ink FPS-ceiling constraints) — in the same relative order as the `experience-example-shadcn.md` reference shape. The one invented section, `## Open Questions`, is a single well-scoped, honestly-flagged deferred item (terminal min-width) and earns its place rather than padding the document.

### Findings
- **low** `DESIGN.md`'s `rounded` frontmatter block (lines 34–39) mixes the documented scale keys (`sm`/`md`/`lg`/`DEFAULT`) with a `note` key at the same nesting level — not itself wrong (the spec permits `note` fields for platform-inherited values elsewhere) but a minor deviation from the `rounded` shape as documented in `design-md-spec.md` ("Scale names → CSS dimensions"), where a rationale note would more typically live in the body prose (which this file also has, redundantly, in `## Shapes`). Cosmetic only.

## Mechanical notes

- **Broken cross-reference (repeat of Finding 7.1):** `sources: - ../.memlog.md` in both `DESIGN.md` (lines 6–8) and `EXPERIENCE.md` (lines 5–7) resolves to a nonexistent `ux-designs/.memlog.md`; the real file is `ux-tui-back-2026-08-10/.memlog.md` (same directory). One-line fix in both files.
- **Frontmatter completeness:** both files carry all spec-required keys (`name`, `updated`, `sources`) plus optional ones used correctly (`description` in `DESIGN.md`, `status` in both). No missing required frontmatter.
- **No Mermaid content** in either file — nothing to check there.
- **Name/citation consistency spot-checks all passed:** IA table's FR ranges per zone (EDTs FR-3–FR-9, Update FR-10–FR-12, Logs FR-16–FR-18, Routes FR-19–FR-23, shared-types FR-13–FR-15) match the PRD's feature groupings exactly; zone mnemonics (`d`/`e`/`u`/`l`/`r`/`s`) are used identically in Interaction Primitives, Inspiration & Anti-patterns, and the `.working/design-directions.html` mockup's now-corrected footer hint.
