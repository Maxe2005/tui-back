---
name: tui-back — Atelier
description: Visual identity spine for tui-back, a single-surface terminal TUI admin console for a 10-service NestJS microservices backend — the "Atelier" refined jewel-tone register, a premium craftsman's toolbench.
status: final
updated: 2026-08-11
sources:
  - ../../prds/prd-tui-back-2026-08-10/prd.md
  - .memlog.md
colors:
  background: '#1c1b1f'
  surface: '#232228'
  surface-selected: '#28262c'
  border: '#3a3844'
  text: '#eae7e1'
  text-dim: '#8f8b98'
  accent: '#c9a13b'
  success: '#3f9d6e'
  error: '#c1495e'
  warning: '#cf9a3e'
  info: '#4f80a8'
typography:
  base:
    note: 'system monospace stack: ui-monospace, Cascadia Code, SF Mono, Fira Code, Consolas, monospace — single fixed-width family for every character cell, as required by the terminal grid; no secondary/display typeface exists or is needed'
  label:
    fontWeight: '600'
    letterSpacing: '0.05em'
    note: 'uppercase pane-title / section-label treatment (e.g. "SERVICES (4)"), set in {colors.text-dim}'
  dim-wink:
    fontStyle: italic
    note: 'secondary/wink annotation line — always {colors.text-dim}, always optional to comprehension; see Components.dim-annotation. A real terminal cannot shrink font-size per cell, so this role is carried by italic + dim color + indent alone, never by a smaller size'
  active-tab:
    fontWeight: '700'
    note: 'zone-tab active state only — bold weight on a solid {colors.accent} fill'
rounded:
  sm: 0px
  md: 0px
  lg: 0px
  DEFAULT: 0px
  note: 'Atelier is square-cornered by deliberate choice — every in-app panel, modal, badge, and list row renders at 0px. See ## Shapes for why the mockup frame''s 3px corner doesn''t count as a token.'
spacing:
  '0': 0ch
  '1': 1ch
  '2': 2ch
  '3': 3ch
  glyph-gap: 1ch
  indent: 2ch
  pane-padding-x: 2ch
  row-gap: 0
  section-gap: 1 blank row
  chrome-row: 1 row
components:
  zone-tab:
    inactive: { color: '{colors.text-dim}', padding: '0 {spacing.1}' }
    active: { background: '{colors.accent}', color: '{colors.background}', fontWeight: '{typography.active-tab.fontWeight}', padding: '0 {spacing.1}' }
    background-event-badge: { text: '●{n}', color: 'the affected zone status color (e.g. {colors.error})', position: 'appended after the zone glyph+label, inside the same tab cell' }
  status-badge:
    up: { glyph: '●', color: '{colors.success}' }
    down: { glyph: '○', color: '{colors.error}' }
    done: { glyph: '✔', color: '{colors.success}' }
    failed: { glyph: '✖', color: '{colors.error}' }
    in-progress: { glyph: '⣾', color: '{colors.info}' }
    selection-marker: { glyph: '›', color: '{colors.accent}' }
    action-marker: { glyph: '▸', color: '{colors.accent}' }
    rule: 'glyph and color always ship together; color is never the sole carrier of meaning'
  list-row:
    base: { color: '{colors.text}', paddingLeft: '{spacing.2}', accentBar: '1ch transparent' }
    nested-member: { indent: '{spacing.indent}', note: 'e.g. a service row nested under its owning group' }
    selected: { background: '{colors.surface-selected}', accentBar: '1ch solid {colors.accent}', markerGlyph: '{components.status-badge.selection-marker.glyph}' }
    meta-suffix: { color: '{colors.text-dim}', note: 'trailing branch/divergence/timestamp fragment on the same row' }
    note: '"accentBar" is a one-character-wide colored glyph column (e.g. a solid block ▌) in the leftmost cell of the row, not an Ink `Box` border — Ink cannot render a border on only one side at sub-cell width, so the selection marker is content, not a border property.'
  detail-pane:
    title: { textTransform: 'uppercase', color: '{colors.text-dim}', typography: '{typography.label}' }
    body: { color: '{colors.text}', lineHeight: '1.7' }
    summary-line: { borderTop: '{colors.border}, single-weight (Ink borderStyle "single")', color: 'matches the run outcome status color ({colors.success} clean / {colors.warning} partial-failure / {colors.error} hard-fail)' }
  footer-hint:
    background: '{colors.background}'
    color: '{colors.text-dim}'
    format: '[key] action, space-separated, left to right by frequency of use'
  modal-dialog:
    background: '{colors.surface}'
    border: { borderStyle: 'bold', color: '{colors.border}' }
    corner: '{rounded.DEFAULT}'
    note: 'Ink borderStyle "bold" versus an ordinary panel''s "single" — both occupy exactly one character cell (Ink has no sub-cell border width to vary), the heavier box-drawing glyph is the terminal-native stand-in for elevation; see Elevation & Depth. Also the visual/behavioral basis for the keybinding-help screen (`?`) — see Components > modal-dialog below and EXPERIENCE.md Component Patterns.'
  checkbox-list-item:
    unchecked: { glyph: '[ ]', color: '{colors.text}' }
    checked: { glyph: '[x]', color: '{colors.accent}' }
    row: 'inherits list-row.base / list-row.selected for highlight state'
  splitter:
    divider: { color: '{colors.border}', width: '1 column/row' }
    resize-mode-active: { color: '{colors.accent}', note: 'boundary line recolors to accent while Ctrl+W resize-mode is engaged' }
  spinner:
    glyph: '⣾'
    color: '{colors.info}'
    motion: 'single-frame braille-cycle tick, functional only — see Elevation & Depth / motion note below'
  dim-annotation:
    color: '{colors.text-dim}'
    fontStyle: '{typography.dim-wink.fontStyle}'
    indent: '{spacing.indent}'
    position: 'directly below the factual line it comments on'
---

## Brand & Style

tui-back is a solo developer's daily instrument, not a dashboard shipped to a stakeholder. The brief names this outright: part of the point is the experience of building and living inside the tool, not just the utility it delivers. The Atelier register answers that framing directly — a premium craftsman's toolbench. Deep charcoal surfaces, one confident amber-gold accent, and crisp square joinery, the same trusted-daily-tool register as k9s or lazygit rather than a generic admin panel or the cluttered generated Swagger UI it explicitly replaces for route testing.

The posture is "beautiful but not fussy," in Max's own words — deliberately drawn against a bare-utilitarian `htop`-style look, but earning its polish through restraint rather than decoration. One jewel tone, disciplined status colors, square corners, dim-italic asides that reward a close look without demanding one. See `mockups/design-directions.html` ("Atelier" section, Direction 2) for the source mockups this spine was distilled from — full Dashboard and Update-run renders at the exact token values below. `mockups/key-dashboard.html`, `mockups/key-update-run.html`, `mockups/key-assisted-resolution-modal.html`, and `mockups/key-routes-response-logs.html` apply every token/component spec below at 1:1 fidelity across the tool's load-bearing surfaces. This spine wins on conflict with any of these files; the HTML is illustrative, not authoritative.

## Colors

- **Background (`#1c1b1f`)** is the outermost canvas — the chrome layer. It sits under the top bar, the zone-tab bar, and the footer, one shade darker than the content surface, so the frame reads as a stable shell around content that changes.
- **Surface (`#232228`)** is the content canvas — list panes, detail panes, modal bodies. Lighter than background by design, so the eye separates "chrome that's always there" from "content that's the current focus."
- **Surface-selected (`#28262c`)**, derived: the subtle fill behind the focused/selected row, paired with the accent left-border. It is the terminal's entire stand-in for a hover or focus ring — never used on its own without the accent border, never used for anything but the current selection.
- **Border (`#3a3844`)** draws every hairline: pane dividers, panel edges, the line under the top bar, the splitter. One Ink border style ("single") everywhere except the modal, which uses the heavier "bold" style for emphasis — both exactly one character cell wide; there's no sub-cell weight to vary (see Elevation & Depth).
- **Text (`#eae7e1`)** is primary content — the warm off-white carries hours-long daily reading without the clinical glare of pure white.
- **Text-dim (`#8f8b98`)** is every secondary read: pane-title labels, footer hints, trailing row metadata (branch/divergence/timestamps), and the dim-wink annotation line. Never used for anything the developer must read to understand what happened.
- **Accent (`#c9a13b`, amber-gold)** is reserved exclusively for active-selection and primary-action affordances: the active zone-tab fill, the selected list-row's left border and `›`/`▸` marker, checked checkbox glyphs. It is never a status color — a service being "up" is never accent-colored, only success/error/warning/info are.
- **Success (`#3f9d6e`)**, **error (`#c1495e`)**, **warning (`#cf9a3e`)**, **info (`#4f80a8`)** are the closed set of semantic status colors, always paired with a glyph (see `status-badge`), never with color alone. Note: accent (`#c9a13b`) and warning (`#cf9a3e`) sit close in hue and lightness by construction (both amber-family) — this is exactly why the glyph-pairing rule is non-negotiable rather than a nicety; the two must never be told apart by color alone, and a selected row should not itself be showing a warning state in the same glance without a glyph to disambiguate.

Avoid: any status meaning carried by accent; any surface tone outside this five-tone stack (background/surface/surface-selected/border + the four status hues); gradients or tints — Atelier is flat fields and hairlines, not blends.

## Typography

Monospace, full stop — one system stack (`{typography.base.note}`) across every surface, because the terminal grid is fixed-width character cells; there is no display face, no secondary family, and no per-element font-size control the way a web spine would have.

Three roles carry all the emphasis this register needs:

- **Label** (`{typography.label}`) — uppercase, tracked-out, `{colors.text-dim}` — pane titles and section headers ("SERVICES (4)", "UPDATE — CHECKOUT-FLASH-SALE").
- **Dim-wink** (`{typography.dim-wink}`) — italic, `{colors.text-dim}`, indented under its parent line — the optional wink/complicity aside (see EXPERIENCE.md Voice and Tone for the mechanic). Because a real terminal cell can't shrink font size the way the HTML mockup's `.wink` rule does, italic + color + indent do the entire job of "this is secondary" — no size cue is available or needed.
- **Active-tab** (`{typography.active-tab}`) — bold, set in `{colors.background}` on an `{colors.accent}` fill — the *only* place bold weight is used for emphasis in the whole system. Body text is never bolded for emphasis; if something needs to stand out, it earns a status glyph or the selection treatment instead.

## Layout & Spacing

Three fixed chrome rows frame a resizable content split, top to bottom: the **top bar** (app name, active EDT name, `[/]` filter / `[:]` command hints — one row), the **zone-tab bar** (the six zones, glyph + label each — one row), then the **content area**, then the **footer** (contextual keybinding hints — one row). All three chrome rows sit on `{colors.background}`; the content area sits on `{colors.surface}`.

Inside the content area, most zones use a resizable list/detail split — a narrower left pane (selectable list) and a wider right pane (detail), roughly 2:3, divided by the `splitter` component. Spacing is character-cell based, not pixel-based: `{spacing.pane-padding-x}` (2ch) horizontal pane padding, `{spacing.indent}` (2ch) for nested rows (e.g. a service indented under its group) and for the dim-annotation line under its parent, `{spacing.glyph-gap}` (1ch) between a status glyph and its label, and one full blank row (`{spacing.section-gap}`) between logical groups within a pane. Rows themselves carry no extra vertical gap (`{spacing.row-gap}`) — density is the point in a tool scanned dozens of times a day.

**Launch banner.** A k9s-inspired ASCII-art banner appears once, on launch, sitting above/within the Dashboard zone's content area (on `{colors.surface}`, same as any other content). Kept light-touch, not a new component system: render it monochrome in `{colors.text-dim}` or, if it should read as a brand mark rather than chrome, in `{colors.accent}` — either reads correctly against Atelier's flat-field register. No motion, no gradient, consistent with Elevation & Depth's "minimal motion" rule.

## Elevation & Depth

A terminal has no shadows, blurs, or z-axis to speak of — Ink renders flat character cells. Depth is conveyed by exactly two devices instead:

1. **Background/surface contrast.** The chrome rows (top bar, zone-tabs, footer) sit on the darker `{colors.background}`; content panes sit on the lighter `{colors.surface}`. That one-step tonal shift is what tells the eye "frame" from "content," standing in for a drop shadow.
2. **Border weight.** Every ordinary panel divider uses Ink's "single" box-drawing border style in `{colors.border}`. A `modal-dialog` uses Ink's "bold" border style instead — the one deliberate exception — so a floating dialog reads as "on top of" the surface behind it purely through a heavier glyph, not a shadow. Both are exactly one character cell wide; Ink has no sub-cell border width, so "heavier" means a bolder box-drawing character, never a wider line.

The drop-shadow visible around the terminal window in `mockups/design-directions.html`'s mockups is a browser-chrome device simulating "a terminal floating on a desktop" for the purposes of that presentation page — it has no equivalent inside the actual Ink-rendered app and is not a token.

Motion is minimal by the same logic: the only animated element is the `spinner` glyph cycling during an in-progress action (e.g. a pull in flight). No decorative animation — no fades, no pulses — consistent with a ~150ms perceived-response bar and a tool that's scanned, not watched.

## Shapes

Square, deliberately. Every in-app panel, modal, list row, and badge renders at `{rounded.DEFAULT}` (0px) — no rounding at any scale. This is the visual half of "precise and instantly scannable": a jewel-tone palette with soft edges would read as consumer-app comfort rather than toolbench precision, and Atelier is explicitly the latter. The only near-exception anywhere in the source material is a barely-perceptible 3px corner on the outermost frame in the `mockups/design-directions.html` mockup's browser-window chrome — as noted under Elevation & Depth, that's a presentation artifact of the mockup page, not a token to carry into the real, terminal-rendered app.

## Components

### zone-tab
The permanent top-bar zone menu: six entries (Dashboard, EDTs, Update, Logs, Routes, shared-types), each glyph + label. Inactive tabs sit in `{colors.text-dim}` on `{colors.background}`; the active tab is the one place in the system with a solid fill — `{colors.accent}` background, `{colors.background}` text, bold. A zone with a pending background event (e.g. a crashed service detected while the developer is elsewhere) appends a small glyph+counter badge in that zone's semantic status color (e.g. `🩺 Logs ●1`), inside the same tab cell — no overlay, no separate notification surface.

### status-badge
The glyph+color vocabulary used anywhere a state is reported: `●`/`○` (up/down, success/error), `✔`/`✖` (done/failed, success/error), `⣾` (in-progress, info), `›`/`▸` (selection/action marker, accent). Every instance ships glyph and color together; color alone never carries the meaning.

### list-row
The selectable-list unit inside a list/detail split. Base row sits in `{colors.text}` on `{colors.surface}`, with a transparent one-character-wide accent-bar column reserved for the selection state (a colored glyph, e.g. `▌` — not an Ink border, since Ink can't render a border on only one side). A nested row (e.g. a member service indented under its EDT) shifts right by `{spacing.indent}`. Selected: `{colors.surface-selected}` fill, the accent bar filled in `{colors.accent}`, and the `›` marker glyph in accent ahead of the label. Trailing metadata (branch name, ahead/behind counts, timestamp) sits right-aligned or after the label in `{colors.text-dim}`.

### detail-pane
The right-hand content pane in a list/detail split. Carries a `{typography.label}` pane title, then body content in `{colors.text}`. Where the pane summarizes a run outcome (e.g. a group-update result), a `summary-line` divider (`{colors.border}` top rule) closes the pane, colored to match the outcome — success green for a clean run, warning amber for a partial failure, error red for a hard stop.

### footer-hint
The permanent bottom row: contextual `[key] action` pairs in `{colors.text-dim}` on `{colors.background}`, ordered left-to-right by expected frequency of use (e.g. `[↑↓] move  [enter] open  [space] select  [d] dashboard  [q] quit  ^W resize`). Content changes per zone/context; the row itself is always present.

### modal-dialog
A floating dialog over the current surface — used for confirmations, guided-resolution menus, similar interruptions, and the keybinding-help screen (`?`). `{colors.surface}` background, an Ink "bold"-style `{colors.border}` edge (see Elevation & Depth), square corners. No overlay dim/scrim beyond the border-weight contrast itself, since a terminal has no real transparency to dim through. The help-screen instance is the same visual spec, scrollable when its content exceeds the modal's `max-height`.

### checkbox-list-item
A multi-select list row (EDT member selection, log-view service filter, saved-request batch actions): `[ ]` unchecked in `{colors.text}`, `[x]` checked in `{colors.accent}`, modeled directly on the Claude Code / BMad-installer selection UI Max already favors. Otherwise inherits `list-row`'s base/selected treatment for keyboard-focus highlighting.

### splitter
The divider between a list pane and a detail pane (or any two resizable regions): a single-character-wide `{colors.border}` line (`{components.splitter.divider}`, "1 column/row"). While keyboard resize-mode (`Ctrl+W`) is engaged, the boundary recolors to `{colors.accent}` so the developer can see exactly which edge will move.

### spinner
A single functional in-progress indicator: the `⣾` braille glyph in `{colors.info}`, cycling while an action (pull, publish step, propagation) is running. The only animated element in the system — no other motion exists.

### dim-annotation
The optional "wink" line beneath a factual message (see EXPERIENCE.md Voice and Tone for when it appears): italic, `{colors.text-dim}`, indented `{spacing.indent}` under the message it comments on. Always skippable; never the only carrier of information.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Pair every status with a glyph (`●`/`○`/`✔`/`✖`/`⣾`) and a status color | Rely on color alone for success/error/warning/info — especially given how close accent and warning sit in hue |
| Reserve `{colors.accent}` for active-selection and primary-action only | Use accent to indicate a status (up/down/ok/failed) |
| Keep raw stderr/stack traces one action away, always reachable | Fully hide raw tool/script output — a human gloss replaces the *primary* read, never the underlying detail |
| Square corners everywhere in-app (`{rounded.DEFAULT}` = 0px) | Round any panel, modal, badge, or row — no pills, no soft cards |
| Use dim-italic exclusively for optional/secondary text (wink asides, meta) | Put anything required for comprehension in dim-italic |
| Bold only the active zone-tab | Bold body text for emphasis — use a status glyph or selection state instead |
| Convey depth via background/surface contrast + border-weight | Simulate a drop shadow, blur, or gradient — the terminal can't render them credibly |
| Keep motion to the single functional spinner | Add decorative animation (fades, pulses, transitions) anywhere |
