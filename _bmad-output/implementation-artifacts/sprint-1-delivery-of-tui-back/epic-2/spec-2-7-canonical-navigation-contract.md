---
title: 'Canonical Navigation Contract (Arrows/Home/End/Tab)'
type: 'refactor'
created: '2026-08-19'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'bb4dff509927efdc2bf86b5b28c10d13277119ee'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md'
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-19.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The canonical keybinding contract used `j`/`k`/`g`/`G` (vim-style) for list navigation — the only place this is actually wired today is `edts-zone.tsx`'s row selection and the keybinding-help modal's scroll. Max has judged vim-style bindings impractical and wants them retired entirely, replaced by arrow keys and `Home`/`End`.

**Approach:** Swap `j`/`k`/`g`/`G` for `↑`/`↓`/`Home`/`End` everywhere they currently appear (2 real call sites) and everywhere they are only documented (footer, help modal data). `Tab` is untouched — it has no current wiring (Ctrl+W resize-mode was already descoped in Story 1.11) and is not repurposed as a list-movement key by this story.

## Boundaries & Constraints

**Always:**
- Ink's `useInput` `key` object natively exposes `upArrow`/`downArrow`/`home`/`end` booleans (verified: `node_modules/ink/build/hooks/use-input.js`) — no raw ANSI parsing needed, no new dependency.
- Pure-function extraction stays intact: `resolveSelectionDirection`/`resolveHelpScroll` remain directly unit-testable without rendering Ink (AD-13) — their signature changes from `(input: string)` to accept the relevant `key` boolean flags, since arrow/Home/End keys produce an empty `input` string in Ink, only `key` flags are set.
- NodeNext `.js` relative imports; imports first in file (depcruise acorn-fallback landmine).

**Ask First:**
- None — scope and target keys were fixed by the approved sprint-change-proposal.

**Never:**
- Don't wire `Tab` to list movement or to any new behavior — it stays a no-op, exactly as it is today, until a future story implements its cycle role.
- Don't reintroduce `j`/`k`/`g`/`G` anywhere, including as a silent fallback.
- Don't touch `app-shell.tsx`'s zone-mnemonic dispatch (`d/e/u/l/r/s`) — out of scope, unaffected by this change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List row navigation | `↓` pressed in EDTs zone | selection moves to next row, clamped at the end | N/A |
| List row navigation | `↑` pressed in EDTs zone | selection moves to previous row, clamped at 0 | N/A |
| Jump to bottom | `End` pressed in EDTs zone | selection jumps to the last row | N/A |
| Jump to top | `Home` pressed in EDTs zone | selection jumps to the first row | N/A |
| Retired keys | `j`/`k`/`g`/`G` pressed anywhere | no selection change, no scroll, no zone switch | N/A |
| Help modal scroll | `↓`/`↑` pressed while `?` modal open | scroll offset moves, clamped to [0, maxOffset] | N/A |
| Help modal jump | `Home`/`End` pressed while `?` modal open | scroll offset jumps to 0 / max | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/edts/edts-zone.tsx:101-109` — `resolveSelectionDirection(input: string)`: change to `resolveSelectionDirection(key: { upArrow: boolean; downArrow: boolean })`, drop the `input==='j'/'k'` checks.
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` — `useState<number>` selection state + `useInput` callback: add `Home`/`End` handling via a new pure `resolveSelectionJump(key)`/`jumpSelection(jump, length)` pair (mirroring `resolveSelectionDirection`/`moveSelection` — inline `key.home`/`key.end` branching in the `useInput` callback is untestable, since the shared test harness never invokes that callback), update the call to `resolveSelectionDirection` to pass `key` instead of `input`.
- `src/adapters/driving/tui/shared/components/keybinding-help.tsx:34-46` — `resolveHelpScroll(input, offset, visibleLines)`: same signature swap to read `key.upArrow`/`key.downArrow`; add `key.home`/`key.end` → jump to `0` / `maxOffset` (reuse `resolveHelpWindow`'s existing clamping).
- `src/adapters/driving/tui/shared/components/keybinding-help.tsx:65-68` — `useInput((input, key) => ...)`: already receives `key`, currently ignored (`_key`) — start passing it to `resolveHelpScroll`.
- `src/adapters/driving/tui/shared/components/footer.tsx:5-6` — `DEFAULT_FOOTER_HINTS`: `'[j/k] move'` → `'[↑↓] move'`, `'[g/G] top/bottom'` → `'[Home/End] top/bottom'`.
- `src/adapters/driving/tui/keybindings/keybindings.ts:7-14` — `KEYBINDINGS` data: update the two entries' `keys`/`description` fields to the new bindings (used by the `?` help modal).

## Tasks & Acceptance

**Execution:**
- [x] `edts-zone.tsx` -- swap `resolveSelectionDirection` + its `useInput` call to arrow/Home/End -- closes the list-nav gap for the app's one real interactive list
- [x] `keybinding-help.tsx` -- swap `resolveHelpScroll` + wire the already-received `key` param -- same contract applied to the help modal's own scrollable list
- [x] `footer.tsx` -- update `DEFAULT_FOOTER_HINTS` -- footer must never show a stale hint (EXPERIENCE.md footer-hint rule)
- [x] `keybindings.ts` -- update `KEYBINDINGS` entries -- `?` modal must document the actual contract
- [x] `edts-zone.test.tsx` -- rewrite `resolveSelectionDirection` tests for arrow/Home/End input, add a `j`/`k`/`g`/`G`-is-inert case -- covers the I/O matrix
- [x] `keybinding-help.test.tsx` -- rewrite `resolveHelpScroll`/rendered-output assertions for arrow/Home/End, update the `'[j / k]'`/`'[g / G]'` string expectations to the new labels -- covers the I/O matrix
- [x] `keybindings.test.ts` -- update `EXPECTED` fixture to the new `keys`/`description` values -- keeps the canonical-contract test meaningful

**Acceptance Criteria:**
- Given any list pane (EDTs zone, keybinding-help modal), when arrow keys are pressed, then the highlight/scroll moves; when `Home`/`End` are pressed, then it jumps to top/bottom.
- Given the app in any state, when `j`, `k`, `g`, or `G` are pressed, then nothing happens.
- Given `Tab`, when pressed anywhere, then behavior is unchanged from before this story (no-op today).

## Verification

**Commands:**
- `npm test` -- expected: all suites green, including the three rewritten test files.
- `npm run typecheck` -- expected: `tsc --noEmit` clean.
- `npm run depcheck` -- expected: no boundary violations (this story touches `adapters/driving/tui` only).

**Manual checks (if no CLI):**
- `tui-back-tui` in a real TTY: in the EDTs zone, `↑`/`↓` move the row highlight, `Home`/`End` jump to first/last row, `j`/`k`/`g`/`G` do nothing. Open `?`: `↑`/`↓`/`Home`/`End` scroll/jump the keybinding list, and its printed labels show the new bindings.

## Suggested Review Order

**Navigation-contract logic (entry point)**

- Arrow-key direction, extracted as a pure function so the untestable `useInput` callback stays thin.
  [`edts-zone.tsx:104`](../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L104)

- Home/End jump logic, added during review to close an untested matrix gap (inline `key.home`/`key.end` branching was unreachable by any test).
  [`edts-zone.tsx:128`](../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L128)

- Same contract applied to the help modal's own scrollable list — arrows/Home/End replace `input==='j'/'k'`.
  [`keybinding-help.tsx:36`](../../src/adapters/driving/tui/shared/components/keybinding-help.tsx#L36)

- Shared `NavigationKey` type pinning the flag subset every pure function above reads, so the shape can't drift across call sites (review patch).
  [`keybindings.ts:10`](../../src/adapters/driving/tui/keybindings/keybindings.ts#L10)

**Component wiring**

- `useInput` callback now reads `key` instead of `input`, dispatching jump before direction.
  [`edts-zone.tsx:174`](../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L174)

- `useInput` callback passes the previously-discarded `key` param through to `resolveHelpScroll`.
  [`keybinding-help.tsx:73`](../../src/adapters/driving/tui/shared/components/keybinding-help.tsx#L73)

**Documentation & UI surface**

- Canonical keybinding data driving the `?` modal — labels swapped, description order fixed to match (review patch).
  [`keybindings.ts:19`](../../src/adapters/driving/tui/keybindings/keybindings.ts#L19)

- Footer hints must never show a stale binding.
  [`footer.tsx:4`](../../src/adapters/driving/tui/shared/components/footer.tsx#L4)

- Living architecture doc updated to stop contradicting the actual contract (review patch — two reviewers independently flagged this as stale).
  [`README.md:41`](../../src/adapters/driving/tui/shared/README.md#L41)

**Tests (peripherals)**

- Pure-function coverage for the new arrow/Home/End contract, including the retired-keys-are-inert case.
  [`edts-zone.test.tsx:122`](../../src/adapters/driving/tui/zones/edts/edts-zone.test.tsx#L122)

- Home/End jump coverage, added during review alongside the extraction above.
  [`edts-zone.test.tsx:164`](../../src/adapters/driving/tui/zones/edts/edts-zone.test.tsx#L164)

- `resolveHelpScroll`'s own arrow/Home/End coverage, mirroring the EDTs-zone test shape.
  [`keybinding-help.test.tsx:52`](../../src/adapters/driving/tui/shared/components/keybinding-help.test.tsx#L52)

- Canonical-contract fixture updated to the new `keys`/`description` values.
  [`keybindings.test.ts:4`](../../src/adapters/driving/tui/keybindings/keybindings.test.ts#L4)
