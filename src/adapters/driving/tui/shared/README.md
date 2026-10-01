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

## Rules for shared components

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
6. **Interactive/feedback components.** `modal-dialog`, `checkbox-list-item`, `splitter`, `spinner` and `dim-annotation` live in `components/` and take every visual value from `../theme/theme.js` — no hardcoded colors, spacing or radius. Modal-dialog: Escape cancels, Enter confirms. Checkbox-list-item: Space toggles, Enter confirms the selection. Spinner: cycles the ⣾ glyph in the info color while active. Dim-annotation: italic, text-dim, indented, never the sole carrier of required information.
7. **Permanent app shell.** The chrome (`top-bar`, `zone-tab-bar`, `footer`) renders on `theme.colors.background`; the zone content area on `theme.colors.surface`. The active zone tab is the one accent fill in the system — bold, `colors.background` text; all other tabs are `text-dim`. A pending background event appends a `●n` badge in the zone's status color, cleared when the zone is visited. Cross-zone state lives in exactly one Zustand store at `src/adapters/driving/tui/store/` (AD-10), never a per-zone copy. The generic resizable list/detail split (`list-detail-split`) defaults to ~2:3.
8. **Launch banner & keybinding help.** The canonical keybinding list is compiled in at `src/adapters/driving/tui/keybindings/` (EXPERIENCE.md Interaction Primitives order, locked by test) — the help modal reads it and no other module redefines a key string. The launch banner (`zones/dashboard/launch-banner`) is the only ASCII-art element: static monochrome `colors.text-dim` text on `colors.surface`. The keybinding-help screen is a read-only `modal-dialog`: opened with `?` from any zone, closed with `Esc` or `?`, scrolled with arrows/`Home`/`End` through pure window helpers.
9. **Global key dispatch.** `AppShell` (`src/adapters/driving/tui/app-shell.tsx`) dispatches global keys through pure, Ink-free helpers (`shouldSwitchZone`, `shouldOpenFilter`, `shouldOpenCommand`, `shouldQuit`); list navigation is a per-zone concern. A single TUI instance is enforced by an advisory lock at `XDG_STATE_HOME/tui-back/locks/tui.lock` (`single-instance.ts`); CLI invocations are never blocked.
10. **Navigation keys.** Arrows move and `Home`/`End` jump; there are no vim-style `j`/`k`/`g`/`G` bindings. Arrow/Home/End/Tab keys produce an empty `input` in Ink, so navigation reads the `key` flags only; the shared `NavigationKey` type (`keybindings/keybindings.ts`) pins that flag subset.
11. **Captured input.** A zone-owned dialog sets the store's `zoneInputCaptured` flag so `AppShell` suppresses every global shortcut (`?`, zone mnemonics, `/`, `:`, `q`) while it owns the keyboard. Zones call core use-cases in-process through store actions closing over the ports `src/bin/tui.ts` wires, never by shelling out to the CLI (AD-2).
