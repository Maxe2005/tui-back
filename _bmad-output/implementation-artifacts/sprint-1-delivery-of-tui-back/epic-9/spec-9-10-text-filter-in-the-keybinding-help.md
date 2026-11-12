---
title: 'Text Filter in the Keybinding Help'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '2bb96210146890d11ca9af370f8682f6794fa1f2'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The `?` help lists every keybinding plus every footer context, so finding one key means scrolling a long list.

**Approach:** While the help is open, printable keys build a filter that narrows the list to rows whose keys, description or section contain it (case-insensitive). The filter lives in the store so the app-shell's single help dispatch can decide whether `?`/Esc edit the filter or close the help.

## Boundaries & Constraints

**Always:**
- Pure `filterKeybindings(rows, query)` beside `withSectionHeadings`: empty query returns `rows` unchanged; otherwise case-insensitive substring on `keys`, `description` and `section`, order preserved. Headings stay derived by `withSectionHeadings` from the filtered rows, so a heading only shows when one of its rows matches.
- One pure key decision for the open help (in `app-shell.tsx`, used by `resolveHelpDispatch`). Help open: Esc → clear a non-empty filter, else close; `?` → close if filter empty, else append; Backspace/Delete → drop last char; other printable input (non-empty, no ctrl/meta, not return/tab/escape) → append. Help closed: unchanged (`?` opens).
- Filter state `helpFilter` in the navigation slice; `openHelp` and `closeHelp` both reset it to `''` (help always reopens empty).
- Scroll offset resets to 0 on every filter change; arrows, Home/End and PgUp/PgDn scroll the **filtered** rows.
- AD-19: the filter line is truncated to the dialog width; no unbounded `.map` (the list still goes through `resolveHelpWindow`).
- The help footer context (`FOOTER_CONTEXTS.help`) lists the filter keys; the help's generated context rows follow automatically.
- Existing guards stay: help opened by the Terminal during the same keypress is not closed by that `?`; help keeps owning every key while open (zones, dialogs, Terminal inert behind it).

**Ask First:** changing any canonical key's meaning outside the open help, or moving the help's key handling out of the app-shell.

**Never:** fuzzy matching or regex filters; persisting the filter across openings; a separate text-input component or focus mode inside the help.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Type | help open, filter `''`, `r` then `E` | filter `rE`; rows matching `re` case-insensitively | N/A |
| Backspace | filter `ab`, Backspace | filter `a`; Backspace on `''` stays `''` | N/A |
| `?` non-empty | filter `a`, `?` | filter `a?`, help open | N/A |
| `?` empty | filter `''`, `?` | help closes | N/A |
| Esc non-empty | filter `abc`, Esc | filter `''`, help open, offset 0 | N/A |
| Esc empty | filter `''`, Esc | help closes | N/A |
| No match | filter `zzzz` | one dim line `no keybinding matches "zzzz"`; dialog height unchanged | N/A |
| Ctrl combo | Ctrl+W | filter unchanged | N/A |
| Reopen | close with filter `x`, reopen | filter `''`, offset 0 | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/keybinding-help.tsx` -- `KeybindingHelp`, `withSectionHeadings` (l.46), `resolveHelpScroll` (l.22, hard-wired to `KEYBINDINGS`; Arrows/Home/End only). Local `scrollOffset` state reset on `helpOpen`.
- `src/adapters/driving/tui/app-shell.tsx` -- `shouldOpenHelp`/`shouldCloseHelp`/`resolveHelpDispatch` (l.37–64); called at l.303 (help-open branch, guarded by the rendered `helpOpen`) and l.362.
- `src/adapters/driving/tui/store/slices/navigation-slice.ts` -- `helpOpen`/`openHelp`/`closeHelp` (l.52–54, l.209–211).
- `src/adapters/driving/tui/keybindings/footer-contexts.ts:139` -- `help` context hints; `keybindings.ts:289` turns every footer context into a help row (section `CONTEXT_SECTION`).
- `src/adapters/driving/tui/shared/command-bar.tsx:50` -- `typeCommandQueryChar`/`backspaceCommandQuery`: reference pattern for char typing (Ink 7: Backspace may arrive as `key.delete`).
- `src/adapters/driving/tui/shared/components/truncated-text.tsx` -- `TruncatedText` for the filter line.
- `src/adapters/driving/tui/shared/components/modal-dialog.tsx` -- body scroll on PgUp/PgDn only when its body overflows; leave it as is.
- `src/adapters/driving/tui/shared/keys/navigation-key.ts` -- `NavigationKey` has no page flags; widen locally, don't change the shared type.
- Tests: `keybinding-help.test.tsx`, `app-shell.test.tsx` (`shouldCloseHelp` cases l.31–34), `keybindings/keybindings.test.ts` (context rows mirror `FOOTER_CONTEXTS`).

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/store/slices/navigation-slice.ts` -- add `helpFilter: string` and `setHelpFilter(text)`; `openHelp`/`closeHelp` reset it -- shared state for dispatch and render.
- [x] `src/adapters/driving/tui/shared/components/keybinding-help.tsx` -- add `filterKeybindings`; `resolveHelpScroll(key, offset, visibleLines, rows)` paging by `visibleLines` on PgUp/PgDn; render the filter line (`filter: <text>` or dim `type to filter`), the filtered window, the no-match line; list area keeps `minHeight={visibleLines}`; reset offset on `helpFilter` change -- the visible feature.
- [x] `src/adapters/driving/tui/app-shell.tsx` -- pure `resolveHelpKey(input, key, helpOpen, filter)` returning `open | close | set-filter | none`; `resolveHelpDispatch` applies it through `openHelp`/`closeHelp`/`setHelpFilter`; update both call sites -- single owner of the `?`/Esc decision.
- [x] `src/adapters/driving/tui/keybindings/footer-contexts.ts` -- `help` hints: scroll, `PgUp/PgDn` page, `type` filter, `Backspace` erase, `Esc` clear/close, `?` close -- footer and help rows from declarations.
- [x] Tests -- unit-test `filterKeybindings` (keys/description/section hits, case, empty query, headings only for matched sections), `resolveHelpKey` (every matrix row), `resolveHelpScroll` over a filtered list incl. paging; render tests: filter line, placeholder, no-match line, truncated long filter, reopen empty; update `app-shell.test.tsx` and any footer/keybinding expectations.

**Acceptance Criteria:**
- Given the help opened from the Terminal output focus, when letters are typed, then they filter the help and never reach the Terminal prompt.
- Given any terminal size, when a 200-char filter is typed, then the filter line stays on one truncated line and the bounds tests pass.
- Given the help open, when the footer renders, then it shows the `help` context hints including the filter keys.

## Design Notes

Ink delivers the same keypress to every `useInput`; the app-shell decides from `state.helpFilter` read via `useStore.getState()` at keypress time, and `KeybindingHelp` only reacts to the store (scroll keys + offset reset). Keep the stale-render guard at l.302 (`if (helpOpen)`) so the Terminal's `?` cannot open-then-type.

## Verification

**Commands:**
- `npx vitest run src/adapters/driving/tui` -- expected: all green
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: full suite green

## Suggested Review Order

**Help key decision (single owner of `?`/Esc)**

- Pure decision: Esc clears then closes, `?` closes only on empty filter, printable appends.
  [`app-shell.tsx:65`](../../src/adapters/driving/tui/app-shell.tsx#L65)

- Dispatch applies the decision through store actions, reading the filter at keypress time.
  [`app-shell.tsx:88`](../../src/adapters/driving/tui/app-shell.tsx#L88)

- Help-open branch keeps the stale-render guard against the Terminal's same-keypress `?`.
  [`app-shell.tsx:339`](../../src/adapters/driving/tui/app-shell.tsx#L339)

**Filter state**

- `helpFilter` lives in the navigation slice; open/close reset it so help reopens empty.
  [`navigation-slice.ts:215`](../../src/adapters/driving/tui/store/slices/navigation-slice.ts#L215)

**Rendering & scrolling**

- Plain case-insensitive substring on keys, description, section; empty query is identity.
  [`keybinding-help.tsx:56`](../../src/adapters/driving/tui/shared/components/keybinding-help.tsx#L56)

- Scroll now takes the filtered rows and pages by `visibleLines` on PgUp/PgDn.
  [`keybinding-help.tsx:26`](../../src/adapters/driving/tui/shared/components/keybinding-help.tsx#L26)

- Offset resets on every filter change; filtered rows memoized on the filter.
  [`keybinding-help.tsx:99`](../../src/adapters/driving/tui/shared/components/keybinding-help.tsx#L99)

- `pageKeys={false}` stops the dialog body from also consuming PgUp/PgDn.
  [`keybinding-help.tsx:115`](../../src/adapters/driving/tui/shared/components/keybinding-help.tsx#L115)

**ModalDialog (out-of-spec fix, exposed by the longer footer)**

- Opt-out of dialog paging plus guard against the 0-row-body re-render loop at 40x12.
  [`modal-dialog.tsx:56`](../../src/adapters/driving/tui/shared/components/modal-dialog.tsx#L56)

**Footer declarations & tests**

- Help footer hints now list the filter keys; generated help rows follow.
  [`footer-contexts.ts:139`](../../src/adapters/driving/tui/keybindings/footer-contexts.ts#L139)

- Matrix rows, paste/emoji/modifier cases for `resolveHelpKey`.
  [`app-shell.test.tsx:32`](../../src/adapters/driving/tui/app-shell.test.tsx#L32)

- Keypress-driven scroll, reset and global-key isolation tests; bounds-matrix overlay cases.
  [`app-shell.interaction.test.tsx`](../../src/adapters/driving/tui/app-shell.interaction.test.tsx)
