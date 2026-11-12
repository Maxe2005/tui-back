---
title: 'EDT Commands in Command Bar & Action History in Detail Pane'
type: 'feature'
created: '2026-08-26'
status: 'done'
baseline_commit: 'ec0e4554de6cf8bef691dd9586abd4538d21842a'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-2/spec-2-9-edts-zone-create-switch-modify.md'
  - '_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.9 added EDT create/switch/modify via Enter-key dialogs in the EDTs zone, but the `:` command-entry bar (Story 2.14) only has the `registry` command. Developers expect consistent access to all EDT management actions through the command bar, and the EDT detail pane currently shows only static EDT info (topic, status, members) without any visibility into past/ongoing actions or what actions are available.

**Approach:** Register three new commands in the command bar (`edt-create`, `edt-switch`, `edt-modify`) that open the same dialogs Story 2.9 already built (coexisting with the Enter-key shortcuts). Extend the EDT detail pane to show an action feed: recent actions performed on the selected EDT (with outcome), any in-progress action, and the list of available actions the developer can take next.

## Boundaries & Constraints

**Always:**
- Register exactly three new commands in `src/adapters/driving/tui/commands/commands.ts`: `edt-create`, `edt-switch`, `edt-modify`.
- Each command opens the same dialog Story 2.9 already implements (`CreateDialogState`, `SwitchDialogState`, `ModifyDialogState`) via the store's existing `openEdtAction`-equivalent logic — no new dialog code, no new core/port changes.
- The `edt-switch` command requires a target EDT; implement it as a two-step flow: command opens a quick-pick list of switchable EDTs (excluding the active one), then confirmation — or reuse the existing switch-confirm dialog with a pre-selected target.
- The `edt-modify` command requires a target EDT; open the modify dialog pre-targeted.
- The EDT detail pane (when an EDT row is focused in the EDT selector list) gains a new section showing:
  - **In-progress action** (if any): e.g. "Switching to feature-xyz…" with spinner
  - **Recent actions** (last 3–5): timestamp, action type, outcome (success/failed), brief detail
  - **Available actions**: contextual hints like "[Enter] Switch  [c] Create new  [m] Modify" — mirroring the footer-hint pattern but in the detail pane
- Action history is stored per-EDT in the existing per-EDT SQLite (`XDG_DATA_HOME/tui-back/edts/<ulid>.db`) — add a simple `action_log` table (id, timestamp, action_type, outcome, detail_json). No new port; reuse the `EdtRegistryPort` or add a lightweight port if needed (decide at implementation).
- Follow the existing pure-interpreter + `useInput` pattern: command dispatch logic is a pure function, unit-tested directly; the `:` command bar already handles filtering/autocomplete/exact-match.
- Reuse `ModalDialog`, `DetailPane`, `DimAnnotation`, `Spinner` — no new components.

**Ask First:**
- Should the action log be stored in the per-EDT SQLite (adds a table to each EDT's DB) or in the global SQLite (`global.db`)? Per-EDT aligns with NFR-2 isolation; global is simpler for cross-EDT queries. Recommendation: per-EDT SQLite (one table per EDT DB).
- Should `edt-switch` accept a topic argument (`:edt-switch my-topic`) to skip the quick-pick, or always use the quick-pick? Recommendation: support both — if exact topic match exists, switch directly with confirmation; else open quick-pick.

**Never:**
- Don't duplicate the dialog implementations — reuse the exact same dialog state machines from `edts-zone.tsx` (extract if needed, or call the same store actions).
- Don't add a new port for the action log unless the per-EDT SQLite path requires it; prefer extending `EdtRegistryPort` with optional `logAction`/`getActionLog` methods.
- Don't change the command bar's filtering/autocomplete logic — it already works for any registered command.
- Don't add scroll/windowing to the action history list in the detail pane — keep it bounded (last 5 entries) for v1.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Developer types `:edt-create` | command bar open, exact match | create dialog opens (same as Enter on empty EDT list or when no EDT selected) | N/A |
| Developer types `:edt-switch` | command bar open, exact match | quick-pick list of non-active EDTs opens; selecting one opens switch-confirm dialog | if only one EDT exists (the active one), show "No other EDT to switch to" |
| Developer types `:edt-switch my-topic` | command bar open, exact match with arg | if `my-topic` matches a non-active EDT, open switch-confirm pre-targeted; else "EDT not found" | N/A |
| Developer types `:edt-modify` | command bar open, exact match | quick-pick list of all EDTs opens; selecting one opens modify dialog pre-targeted | if no EDTs exist, "No EDT to modify" |
| Developer types `:edt-modify my-topic` | command bar open, exact match with arg | if `my-topic` matches an EDT, open modify dialog pre-targeted; else "EDT not found" | N/A |
| EDT detail pane viewed | an EDT row is focused in the EDT selector | detail pane shows EDT info + new "Actions" section with in-progress/recent/available | N/A |
| An EDT action is in progress | store has `currentEdtAction: { type: 'switch'|'modify'|'create', target, startedAt }` | detail pane shows spinner + "Switching to X…" in Actions section | N/A |
| An EDT action completes | store action resolves | action logged to EDT's action_log; detail pane updates recent actions list | failed actions logged with outcome='failed' and error detail |
| No actions yet for this EDT | action_log empty | "No actions yet" in recent actions; available actions still shown | N/A |

## Code Map

- `src/adapters/driving/tui/commands/commands.ts` — add three `Command` entries to `COMMANDS` array; each `run` calls the appropriate store action to open the corresponding dialog
- `src/adapters/driving/tui/commands/commands.test.ts` — extend tests for the three new commands
- `src/adapters/driving/tui/store/app-store.ts` — add `currentEdtAction` state (type + target + startedAt), `openEdtCreateDialog()`, `openEdtSwitchDialog(target?)`, `openEdtModifyDialog(target?)`, `logEdtAction()`; extend `loadEdts()` to also load action log for the focused EDT (or load on demand)
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` — refactor dialog opening logic into reusable functions the commands can call; add action log loading/display in detail pane; wire `currentEdtAction` to show in-progress state
- `src/adapters/driving/tui/zones/edts/edts-zone.test.tsx` — test new detail pane action section rendering; test command-triggered dialog opening
- `src/adapters/driving/tui/shared/components/detail-pane.tsx` — may need to support multiple children or a sections pattern (currently wraps children in single `<Text>`); verify compatibility
- `src/adapters/driven/edt-registry/index.ts` — add `actionLog` table to per-EDT SQLite schema; implement `logAction(ulid, entry)` and `getActionLog(ulid, limit?)`
- `src/adapters/driven/edt-registry/schema.ts` — extend schema for the new table (hand-rolled SQL migration via `schema_version` table)
- `src/core/ports/edt-registry.ts` — add `logAction`/`getActionLog` to `EdtRegistryPort` (optional, default no-op for tests)

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/commands/commands.ts` — add `edt-create`, `edt-switch`, `edt-modify` to `COMMANDS` with handlers calling store actions
- [x] `src/adapters/driving/tui/commands/commands.test.ts` — test the three new commands exist and dispatch correctly
- [x] `src/adapters/driving/tui/store/app-store.ts` — add `currentEdtAction` state, dialog-opening actions, `logEdtAction`, and action log loading (per-EDT, lazy or eager)
- [x] `src/adapters/driven/edt-registry/index.ts` — add `action_log` table (columns: `id` ULID, `timestamp` ISO8601, `action_type` TEXT, `outcome` TEXT, `detail` JSON), `logAction`, `getActionLog`; hand-rolled migration SQL
- [x] `src/adapters/driven/edt-registry/schema.ts` — bump `schema_version`, add migration
- [x] `src/core/ports/edt-registry.ts` — extend `EdtRegistryPort` with optional `logAction`/`getActionLog`
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` — extract dialog-opening logic to be callable from commands; enhance detail pane with Actions section (in-progress, recent, available); wire `currentEdtAction` display
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.test.tsx` — smoke tests for detail pane action section; interaction tests for command-triggered dialogs
- [x] `src/adapters/driving/tui/app-shell.tsx` — ensure `zoneInputCaptured` is set when command-triggered dialogs open (same as Enter-triggered)

**Acceptance Criteria:**
- Given the command bar is open, when the developer types `edt-create` and presses Enter, then the create EDT dialog opens (same as Story 2.9's zero-EDT auto-prompt).
- Given the command bar is open, when the developer types `edt-switch` and presses Enter, then a quick-pick of switchable EDTs appears; selecting one opens the switch-confirm dialog.
- Given the command bar is open, when the developer types `edt-switch my-topic` and presses Enter, then if `my-topic` exists and isn't active, the switch-confirm dialog opens pre-targeted; else an inline error "EDT not found" shows in the command bar.
- Given the command bar is open, when the developer types `edt-modify` and presses Enter, then a quick-pick of all EDTs appears; selecting one opens the modify dialog pre-targeted.
- Given an EDT row is focused in the EDT selector, when the detail pane renders, then it shows an "Actions" section with: any in-progress action (with spinner), the last 5 actions (timestamp, type, outcome, detail), and a line of available actions for this EDT.
- Given an EDT action (create/switch/modify) completes, when the detail pane is viewed for that EDT, then the action appears in the recent actions list with its outcome.
- Given a command-triggered dialog is open, when the developer types any character including `?`, then no AppShell global shortcut fires (zoneInputCaptured gate works identically to Enter-triggered dialogs).

## Design Notes

**Command argument parsing:** The command bar's `findExactCommand` does exact name match only. For `edt-switch my-topic`, the command bar would see the full string as the query. Two options:
1. Commands parse their own args: `run` receives the full query string, command splits off the name and parses the rest.
2. Command bar splits name/args before dispatch. Option 1 is simpler and keeps the command bar generic — each command's `run` receives `(useStore, fullQuery)` and handles its own arg parsing. This matches how CLI subcommands work.

**Action log storage:** Per-EDT SQLite is the natural place (NFR-2 blast-radius isolation). Each EDT DB gets an `action_log` table. The `EdtRegistryPort` already has per-EDT DB access via `openEdtDb(ulid)` — reuse that. Migration is a single `CREATE TABLE IF NOT EXISTS` per EDT on first log write (or via the schema_version mechanism).

**DetailPane limitation:** Currently `DetailPane` wraps children in a single `<Text>`, so only joined strings work. The action history needs multiple lines with different styles (spinner for in-progress, dim for timestamps, outcome colors). Options:
- Extend `DetailPane` to accept an array of renderable segments (breaks current contract)
- Format the whole Actions section as a single joined string with ANSI-style color codes (Ink `Text` supports nested color via children)
- Keep it simple: join with `\n`, use `DimAnnotation` for timestamps, `Spinner` component won't work inside `Text` — may need a custom approach or accept static "In progress…" text without live spinner in detail pane.
Recommendation: format as a single string with `DimAnnotation` for timestamps and color-coded outcome glyphs (`✔`/`✖` from status-badge vocabulary) — no live spinner in detail pane, just the text "Switching…" with `⣾` glyph.

## Verification

**Commands:**
- `npm test` — expected: all suites green, including new command tests and edts-zone detail pane tests
- `npm run typecheck` — expected: `tsc --noEmit` clean
- `npm run depcheck` — expected: no boundary violations (touches `src/adapters/driving/tui/**`, `src/adapters/driven/edt-registry/**`, `src/core/ports/edt-registry.ts` only)

**Manual checks:**
- `node src/bin/tui-back.mjs` (TUI): press `:` → type `edt-create` → Enter → create dialog opens; fill and submit → EDT created, action appears in detail pane
- Press `:` → type `edt-switch` → Enter → quick-pick opens; select target → switch-confirm opens; confirm → switch completes, action logged
- Press `:` → type `edt-modify` → Enter → quick-pick opens; select target → modify dialog opens; submit → action logged
- Select an EDT in the selector → verify detail pane shows Actions section with recent actions

## Suggested Review Order

1. Command registration & dispatch (commands.ts) — pure, testable in isolation
2. Store actions & action log state (app-store.ts) — pure state transitions
3. EDT registry action log persistence (edt-registry adapter) — integration test with real SQLite
4. EDTs zone detail pane enhancement (edts-zone.tsx) — visual, interaction tests
5. End-to-end: command bar → dialog → action log visible in detail pane

</frozen-after-approval>