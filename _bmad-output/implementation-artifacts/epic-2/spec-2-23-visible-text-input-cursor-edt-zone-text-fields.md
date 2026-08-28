---
title: 'Visible Text-Input Cursor (EDT Zone Text Fields)'
type: 'feature'
created: '2026-08-28'
status: 'in-progress'
review_loop_iteration: 0
context: []
baseline_commit: '5f2ef9ce6422eff874ec6f28f981b7a3e99d2b8c'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No dialog in the EDT zone renders a cursor/caret — every text-input field (topic in Create/Modify, branch in service-actions/Modify/Add-to-EDT) is a bare `<Text>{label}: {value}</Text>`, indistinguishable from a static readout until typed into blind. Same root cause as "Add to EDT doesn't visibly offer a branch choice": the field works, it just isn't perceivable as editable, and its dialog also lacks the `[Enter]/[Esc]` hint switch-confirm already has.

**Approach:** New shared `text-input-line.tsx` component (mirrors `checkbox-list-item.tsx`: pure `resolve*Layout` fn + component) that, when `focused`, renders an inverse-video cursor after the value plus a `[Enter] confirm  [Esc] cancel` hint below it — both disappear together when unfocused. Swap all 5 hardcoded text fields in `edts-zone.tsx` for it. `EXPERIENCE.md`'s `text-input` Component Patterns row is already committed — verify only.

## Boundaries & Constraints

**Always:**
- Cursor stays at the end of the string (append/backspace-at-end model) — no mid-string cursor tracking, `nextTextInputValue` is untouched.
- Cursor + hint are one visual unit, both gated on the same `focused` prop — never shown independently of each other.
- `TextInputLine` takes exactly `label`, `value`, `focused` — no new prop for the hint; it's baked into the focused branch.
- Unfocused color stays `colors.text`, focused stays `colors.accent` — matches current per-site behavior exactly (no visual regression when unfocused).

**Ask First:** None expected — shape follows `checkbox-list-item.tsx` precedent directly.

**Never:** Touching `AddToEdtDialogState`'s logic (already correct — display-only fix); arrow-key mid-string cursor movement (flagged follow-up, out of scope); changing `switch-confirm`'s own hardcoded hint (not a text-input); using this component outside the EDT zone (no other zone has text-input today).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Focused, empty value | `focused=true, value=''` | `Label: ` + inverse cursor + hint line | N/A |
| Focused, non-empty value | `focused=true, value='foo'` | `Label: foo` + cursor right after `foo` + hint line | N/A |
| Unfocused | `focused=false`/omitted | `Label: value`, `colors.text`, no cursor, no hint | N/A |
| Create/Modify, focus on `members` | `formFocus !== 'topic'` | Topic renders `focused=false` — hint hidden while topic isn't active | N/A |
| `branchEdit` open, or Add-to-EDT | always `focused={true}` | Cursor + hint always shown — closes the "Add to EDT" gap | N/A |

</frozen-after-approval>

## Code Map

- `checkbox-list-item.tsx` -- convention to mirror: pure `resolve*Layout` fn + component, same file-pair test structure.
- `text-input-line.tsx` (new, same dir) -- `TextInputLineProps { label: string; value: string; focused?: boolean }`; `resolveTextInputLineLayout` → `{ labelColor, showCursor }`; renders a `Box(column)`: `Text(label: value + inverse cursor)`, then — only when `showCursor` -- a second `Text` line `[Enter] confirm  [Esc] cancel` (`colors.text`, matches switch-confirm's wording at `edts-zone.tsx:1614`).
- `shared/components/index.ts` -- barrel-export `TextInputLine`, `TextInputLineProps`, `ResolvedTextInputLine`, `resolveTextInputLineLayout`, per existing pattern.
- `zones/edts/edts-zone.tsx` -- import `TextInputLine` (direct file import, like L24-30); replace 5 sites, `focused=true` except the 2 `topic` ones (`dialog.formFocus === 'topic'`): L1580 (Create topic), L1628 (Modify branchEdit, label `Branch for ${repoPath}`), L1633 (Modify topic), L1666 (service-actions branchEdit, label `Branch for ${serviceName}`), L1692 (Add-to-EDT, label `Branch`).
- `EXPERIENCE.md` (ux-designs) L80 -- `text-input` row already present (committed 2026-08-28) -- verify only, no edit expected.

## Tasks & Acceptance

**Execution:**
- [ ] `shared/components/text-input-line.tsx` -- new component + pure layout resolver -- reusable cursor+hint unit
- [ ] `shared/components/index.ts` -- barrel export -- so the test/zone imports below resolve
- [ ] `shared/components/text-input-line.test.tsx` -- unit-test `resolveTextInputLineLayout` (focused/unfocused) + `renderToString` checks (label, value, hint present/absent) -- mirrors `checkbox-list-item.test.tsx`
- [ ] `shared/components/text-input-line.styles.test.tsx` -- `FORCE_COLOR=1`-isolated: inverse ANSI code present when focused, absent when not (mirrors `splitter.styles.test.tsx`) -- proves the cursor glyph, not just its text
- [ ] `zones/edts/edts-zone.tsx` -- swap the 5 render sites in Code Map -- closes both debug-log findings
- [ ] `zones/edts/edts-zone.test.tsx` / `.interaction.test.tsx` -- confirm existing `toContain('Topic: my-topic')` / `toContain('Branch for svc-a')` assertions still pass; add one assertion that Add-to-EDT now shows `[Enter] confirm` -- regression + the closed gap

**Acceptance Criteria:**
- Given any focused text-input field in the EDT zone, when rendered, then an inverse-video cursor cell shows immediately after the value.
- Given the Add-to-EDT dialog, when rendered, then the branch field shows a cursor and a `[Enter] confirm  [Esc] cancel` hint, closing the affordance gap without any `AddToEdtDialogState` logic change.
- Given the EXPERIENCE.md Component Patterns table, when checked, then it already documents `text-input` (verify, no edit needed).
- `npm test`, `npm run typecheck`, `npm run depcheck` all pass.

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- new `text-input-line` suites + updated `edts-zone`/`edts-zone.interaction` suites all green
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations

**Manual checks:**
- TUI: Create EDT, focus topic — cursor + hint appear; Tab to members — both disappear. Modify → branch edit — cursor + hint appear. OTHER SERVICES → Enter ("Add to EDT") — branch field shows cursor + confirm/cancel hint.
