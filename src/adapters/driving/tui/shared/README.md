# Atelier shared theme

Single source of truth for the Atelier visual register (`DESIGN.md`). Every
zone and shared component reads its tokens from here — never hardcode a color,
spacing, or radius in a component.

## Tokens

- `theme.ts` — the token module: `colors`, `spacing`, `typography`, `rounded`.
  Values are byte-for-byte from `DESIGN.md` frontmatter; `DESIGN.md` wins on
  conflict with any other file. In `spacing`, `section-gap` is one blank row
  between logical groups and `chrome-row` is one chrome row — row counts, not
  `ch` column units.
- `theme.test.ts` — locks every token to its exact value.

## Rules for component stories (1.9–1.12)

1. **Square corners everywhere.** `theme.rounded` is all `0` by deliberate
   choice — every panel, modal, badge, and list row renders at `0px`. Never
   round; never hardcode a nonzero radius.
2. **Accent is not a status color.** `theme.colors.accent` (`#c9a13b`) is
   reserved exclusively for active-selection and primary-action affordances
   (active zone-tab, selected-row accent bar, selection/action markers, checked
   checkbox glyph). Success/error/warning/info are the only status colors, and
   each is always paired with a glyph. Accent and warning sit deliberately close
   in hue — never tell them apart by color alone (DESIGN.md §Colors,
   Do/Don't table).
3. **TUI only.** These tokens drive the TUI driving adapter. Do not pull them
   into CLI text output (`dispatch.ts`/`envelope.ts`), which keeps its own
   rendering.
4. **Text on accent reads `colors.background`.** Any text set on an
   `theme.colors.accent` fill (the active zone-tab) uses `theme.colors.background`
   — near-black on amber, never `text` (DESIGN.md §Typography, active-tab).
5. **`surface-selected` only ever marks the current selection.** It never
   appears on its own — always paired with the accent selection bar, never for
   anything but the selected row (DESIGN.md §Colors).
