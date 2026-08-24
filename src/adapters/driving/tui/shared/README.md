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
6. **Story 1.10 interactive/feedback components.** The modal-dialog, checkbox-list-item, splitter, spinner, and dim-annotation components live in `src/adapters/driving/tui/shared/components/`. They all import from `../theme/theme.js` for visual tokens. None hardcode colors, spacing, or radius — all values come from the Atelier theme. Square corners (0px) are enforced by `theme.rounded` being all `0`. Accent is reserved for selection/action markers, never a status color. Modal-dialog dismissal: Escape cancels, Enter confirms. Checkbox-list-item: Space toggles state, Enter confirms selection. Spinner: cycles ⣾ glyph in info color while active. Dim-annotation: italic, text-dim, indented, never the sole carrier of required information.
7. **Story 1.11 permanent app shell.** The chrome (`top-bar`, `zone-tab-bar`, `footer`) renders on `theme.colors.background`; the zone content area renders on `theme.colors.surface`. The six zone tabs use the mnemonic notation `[d] Dashboard [e] EDTs [u] Update [l] Logs [r] Routes [s] shared-types`; the active tab is the one accent fill in the system — bold, `colors.background` text, all other tabs `text-dim`. A pending background event appends a `●n` badge in the zone's status color, cleared when the zone is visited. Cross-zone state (active zone, pending event counts, per-zone splitter ratios, active EDT) lives in exactly one Zustand store at `src/adapters/driving/tui/store/` (AD-10); zone screens read it through the shared `zone-placeholder`/`app-shell`, never a per-zone copy. The generic resizable list/detail split (`list-detail-split`) defaults to ~2:3.
8. **Story 1.12 launch banner & keybinding-help screen.** The canonical keybinding list lives compiled-in at `src/adapters/driving/tui/keybindings/` (12 rows, EXPERIENCE.md Interaction Primitives order, locked by test) — the help modal reads it, the footer advertises `[?] help`, and no other module redefines a key string. The launch banner (`zones/dashboard/launch-banner`) is the only ASCII-art element: static `<Text>`, monochrome `colors.text-dim` on `colors.surface`, above the Dashboard placeholder, shown once per app launch (AppShell marks the in-memory store flag on mount; the flag is never persisted). The keybinding-help screen is a read-only `modal-dialog` instance: opened with `?` from any zone, closed with `Esc` or `?` again (no confirm action), scrollable with arrows/`Home`/`End` (scroll-window logic is pure `resolveHelpWindow`/`clampHelpOffset`/`resolveHelpScroll` — no measuring; `j`/`k`/`g`/`G` were retired by Story 2.7, see below). Only `?`/`Esc`/arrows/`Home`/`End` are wired here; the full behavioral contract (list movement, quit, filters, zone mnemonics) is Story 1.13.
9. **Story 1.13 canonical keybinding contract & zone navigation.** Global key dispatch lives in `AppShell` (`src/adapters/driving/tui/app-shell.tsx`) via pure helper functions: `shouldSwitchZone` (maps `d/e/u/l/r/s` to `ZoneId` from `ZONES`), `shouldOpenFilter` (`/`), `shouldOpenCommand` (`:`), `shouldQuit` (`q`). These are unit-tested without Ink. The app shell deliberately does NOT handle list-navigation keys — list navigation is a per-zone concern (see Story 2.7 below). Single-TUI instance enforcement (AD-9 mechanism 1) uses an advisory lock at `XDG_STATE_HOME/tui-back/locks/tui.lock` (`src/adapters/driving/tui/single-instance.ts`): second invocation prints "Another TUI instance is already running" and exits 1; CLI invocations are never blocked. The `q`-quit handler releases the lock and exits 0 (run-in-progress confirmation deferred to Epic 3/4). Footer renders the full canonical hint row: `[↑↓] move  [Home/End] top/bottom  [d/e/u/l/r/s] zone  [/] filter  [:] cmd  [?] help  [q] quit  [^W] resize` (ordered by expected frequency).
10. **Story 2.7 canonical navigation contract.** Retired the original `j`/`k`/`g`/`G` (vim-style) bindings as impractical, replacing them everywhere with arrows (move) and `Home`/`End` (jump to top/bottom); `Tab` was unaffected at the time — it had no wiring yet and stayed a no-op (superseded by Story 2.9, see below). `EdtsZone`'s row selection (`resolveSelectionDirection`/`moveSelection`, `resolveSelectionJump`/`jumpSelection`) and the keybinding-help modal's scroll (`resolveHelpScroll`) both read Ink's `key.upArrow`/`key.downArrow`/`key.home`/`key.end` flags exclusively — never the `input` string — since arrow/Home/End keys produce an empty `input` in Ink. The shared `NavigationKey` type (`src/adapters/driving/tui/keybindings/keybindings.ts`) pins that flag subset so it can't drift out of sync across call sites.
11. **Story 2.9 EDTs zone — create/switch/modify, and Tab's first real wiring.** `NavigationKey` gained `tab` (same empty-`input`-only-flags-set convention as arrows/Home/End). Tab now has exactly two consumers, both in `EdtsZone`: cycling a form's topic-input ↔ member-checklist while a create/switch/modify dialog is open, and cycling EDT-selector-list ↔ SERVICES-list focus in the base (no-dialog) view — never both at once, never list movement itself. `createEdt`/`switchActiveEdt`/`modifyEdt` (`src/core/edt/{create,switch,modify}.ts`) are called in-process from the zone via new `AppStore` actions that close over the same ports `src/bin/tui.ts` wires (mirroring `src/bin/main.ts`'s CLI composition), never by shelling out to the CLI (AD-2). A zone-owned dialog sets the store's `zoneInputCaptured` flag so `AppShell` suppresses every global shortcut (`?`, zone mnemonics, `/`, `:`, `q`) while it has focus, closing the gap where a filter/help keypress could leak through a captured text field.