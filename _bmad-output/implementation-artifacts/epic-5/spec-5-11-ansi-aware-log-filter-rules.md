---
title: 'Story 5.11 — ANSI-Aware Log Filter Rules'
type: 'bugfix'
created: '2026-11-09'
status: 'done'
baseline_commit: '0b239162fef34fb501b71ece95562a7e3f333af5'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5/spec-5-9-stackable-log-filter-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Colourised container logs (NestJS) carry ANSI SGR codes in `line.text` (`\x1b[32m[Nest] 32  - \x1b[39m11/09/2026, …`). Rules match that raw text, so `^\[Nest\]` and patterns spanning a colour change never match, and `\bDEBUG\b` can fail next to a code.

**Approach:** Match rules and detect levels on an ANSI-stripped copy of the text. For `match`-target rules, map visible-character ranges back onto the original text and rewrite it keeping every escape sequence, so remaining characters keep exactly their original colour.

## Boundaries & Constraints

**Always:**
- Pure render-time transform in `logs-zone.logic.ts`; stored `LogLine`s are never mutated.
- Only CSI sequences (`ESC [ … final byte`) are treated as ANSI; matching ranges are expressed in visible-character offsets.
- `hide`+`match`: drop matched visible chars, keep ALL escape sequences in order (SGR state of every kept char is then identical to the original; nothing bleeds).
- `show`+`match`: keep matched visible chars plus all escape sequences, joining non-adjacent ranges with one space (as today).
- `line` target: test the stripped text; return the original line (colours intact) or `null`.
- Result is `null` when its visible text is blank (`trim() === ''`), judged on stripped text.
- `detectLogLevel` runs on stripped text. Lines without ANSI behave exactly as before.

**Ask First:** Stripping ANSI at ingestion or in the ring buffer (would lose colours); handling non-CSI escapes (OSC, etc.).

**Never:** Changing rule semantics, the editor, persistence (5.10) or the `LogLine` type; making the rendering layer strip colours.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Prefix hidden | Nest line `\x1b[32m[Nest] 32  - \x1b[39m11/09/2026, 9:20:21 AM \x1b[32m    LOG\x1b[39m …` + regex hide/match `^\[[\w-]+\]\s+\d+\s+(?:-\s+)?\d{1,2}\/\d{1,2}\/\d{4},\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M\s*` | Visible text starts at `LOG …`; LOG/context keep their colours | N/A |
| Uncoloured format | `[api-gateway] 32 11/9/2026, 1:34:52 PM  LOG [FAST] GET /health` + same regex | Prefix removed | N/A |
| Span across colour | hide/match `Nest\] 32` on a coloured line | Visible chars removed, escapes kept | N/A |
| Whole line removed | hide/match matches every visible char | `null` | N/A |
| Level | `\x1b[32mDEBUG\x1b[39m` with level DEBUG | Detected | N/A |
| Plain text | line without ANSI | Same output as before | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts:524` -- `detectLogLevel`, switch to stripped text.
- `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts:539-565` -- `findMatchRanges`/`removeRanges`, currently on raw text.
- `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts:567-605` -- `compileLogFilter.apply`, the rewrite site.
- `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts:619` -- `applyLogRules` calls `detectLogLevel(original.text)`.
- `src/adapters/driving/tui/zones/logs/logs-zone.logic.test.ts` -- existing rule/pipeline tests (no-regression reference).
- `src/adapters/driving/tui/zones/update/update-zone.logic.ts:529` -- existing `ANSI_SEQUENCE` pattern, reference only.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts` -- add `splitAnsi(text)` (visible string + per-char original offsets / escape tokens); match on visible text; rebuild original keeping escapes for `match` rules; strip before `detectLogLevel` -- core fix
- [x] `src/adapters/driving/tui/zones/logs/logs-zone.logic.test.ts` -- cases of the I/O matrix with real Nest and api-gateway fixtures, colour-preservation assertions, plain-text regression, pipeline of two rules on coloured text -- covers the matrix

**Acceptance Criteria:**
- Given a coloured Nest line and the prefix regex as hide+match, when applied, then the visible text begins at `LOG` and the escape sequences of the remainder are unchanged.
- Given a rule or level on a line with no ANSI, when applied, then results equal the pre-change behaviour (existing tests stay green).

## Design Notes

Keeping every escape sequence (even those inside removed ranges) is the simplest correct colour rule: SGR state is cumulative, so a kept char sees the same prior escapes as in the original. Cost: harmless empty escape pairs, e.g. `\x1b[32m\x1b[39m`.

## Verification

**Commands:**
- `npx vitest run src/adapters/driving/tui/zones/logs` -- expected: all pass
- `npm run typecheck` (or the project's tsc/lint scripts) -- expected: no errors

## Suggested Review Order

**Visible-text matching**

- Entry point: rules match on the visible copy and rebuild the original with its escapes.
  [`logs-zone.logic.ts:627`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L627)

- Split a line into visible text plus escape sequences and their visible offsets.
  [`logs-zone.logic.ts:545`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L545)

- Re-emit every escape in order, so kept characters keep exactly their original colours.
  [`logs-zone.logic.ts:562`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L562)

**Level detection**

- Level is judged on the stripped text, so a code glued to `DEBUG` no longer hides it.
  [`logs-zone.logic.ts:524`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L524)

**Tests**

- Real Nest and api-gateway fixtures, exact-output assertions, multi-match show, trailing escapes.
  [`logs-zone.logic.test.ts:1192`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.test.ts#L1192)
