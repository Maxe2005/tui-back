---
title: '`edt-create-from` — Clone an EDT as a Creation Starting Point'
type: 'feature'
created: '2026-10-01'
status: 'in-progress'
review_loop_iteration: 0
context: []
baseline_commit: 'f47d56c9043423061f8e9c33429fcbc3bb9b332b'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** To continue in-progress work in a new EDT, the developer has to re-check every service by hand. They also have to retype, per service, the branch it was built on.

**Approach:** Add a new `edt-create-from [topic]` command. It resolves a root EDT, either directly or through Story 2.30's quick-pick, then opens the 4-step wizard seeded from that root. Step 2 is pre-checked with the root's members. In Step 3, each inherited member starts as `[Créer (Perso)]`, with its root-EDT branch as base. Everything stays editable.

## Boundaries & Constraints

**Always:**
- Story 2.31's ACs in `epics.md` (L1680-1708) are normative.
- The seed is TUI-only state. Core `createEdt`, `activateEdt` and the switch are untouched: the result is a normal `memberPlans` create.
- **Step 2:**
  - `selectedMembers` starts as the root members' `repoPath`s, in root order.
  - It stays a normal checklist.
  - On entering Step 3, the selection is pruned to paths present in the candidate pool. This applies only while the pool is non-empty.
  - Step 2 shows a dim note naming root members absent from the pool (`service` names).
- **Step 3 seeding:**
  - Seeding happens in `enterBranchStep`.
  - Each selected root member that has never been seeded gets the override `{kind:'create', base: <root member branch>, name: <globalName value after this entry>}`. Each path is seeded at most once (tracked by `seededPaths`), so a row the developer resets to global stays global.
  - A seeded override still equal to `{create, base, <previous globalName>}` is refreshed to the new global name. This mirrors the untouched-name convention.
  - Non-root members get no override, so they follow `[Créer (Global)]`.
- The topic always starts empty. It is never derived from the root, and the uniqueness check is unchanged.
- **Quick-pick `create-from` mode:**
  - The pool is every EDT, active included.
  - The title is `CREATE FROM EDT — SELECT`.
  - Enter opens the seeded wizard.
  - Esc closes with nothing opened.
- **Unknown topic:**
  - `edt-create-from <unknown>` opens the `create-from` quick-pick with an inline error line: `EDT not found: "<topic>"`.
  - The error clears on the first filter edit.
- The wizard shows `Depuis l'EDT : <root topic>` under the breadcrumb.
- The create log detail mentions the root: `Created EDT "x" from "root" with …`.

**Ask First:** changing `edt-switch`/`edt-modify`/`edt-delete`'s own silent not-found behavior; any core/CLI change.

**Never:** a CLI `edt create --from`; copying branches (we create new ones from the root branches); seeding the topic; Story 2.28/2.40/2.42/2.43 scope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No arg | `:edt-create-from` | quick-pick(create-from), every EDT listed | Esc → nothing opened |
| Known topic | `:edt-create-from feat-a` | wizard Step 1, empty topic, root line shown; Step 2 = feat-a's members checked | — |
| Unknown topic | `:edt-create-from nope` | quick-pick(create-from) + `EDT not found: "nope"` | error clears on typing |
| Inherited row | root member `api` on `feat/a` | Step 3 row `[Créer (Perso)]`, base `feat/a`, target = global slug | target protected/existing → normal row error |
| Added service | `web` checked, not in root | row `[Créer (Global)]` | — |
| Unchecked root member | `api` unchecked in Step 2 | no row for it | — |
| Topic changed after Step 3 | back to Step 1, rename, re-enter | untouched seeded rows follow the new slug; edited ones kept | — |
| Reset to global | row set back to Global, Step 2/3 round-trip | stays Global (not reseeded) | — |
| Root member gone | member path not in candidates | dim note in Step 2; pruned on entering Step 3 | — |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/commands/commands.ts` (+ `commands.test.ts`): add `edt-create-from` (`zoneId: 'edts'`) calling `openEdtCreateFromDialog(fullQuery)`. Tests at L63-175 show the pattern.
- `src/adapters/driving/tui/store/slices/edt-slice.ts`:
  - `EdtActionState.type` (L100) gains `'create-from'`.
  - Add `openEdtCreateFromDialog`, mirroring `openEdtDeleteDialog` (L517).
- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts`:
  - `CreateDialogState` (L630): add `seedFromEdt: EdtRegistryEntry | null`.
  - `BranchStepState` (L312): add `seededPaths: readonly string[]`.
  - `QuickPickMode` (L897): add `'create-from'`.
  - `QuickPickDialogState` (L902): add `notFound: string | null`.
  - `initialCreateDialog(seed?)` (L926) pre-fills `selectedMembers`. `initialQuickPickDialog(mode, notFound?)`.
- `.../create-wizard/wizard.logic.ts` (+ test):
  - `enterBranchStep` (≈L470) gains a `seed` param that applies the seeding/refresh rules.
  - Add `missingSeedMembers(seed, candidates)` and `pruneToCandidates`.
  - `describeCreateForLog` gains an optional `rootTopic`.
- `.../create-wizard/create-wizard.tsx`:
  - `enterStep(3)` (L220) prunes, then calls `enterBranchStep(…, seedFromEdt)`.
  - Render the root line near L444.
  - Pass `rootTopic` to every `describeCreateForLog` call.
- `.../create-wizard/step-services.tsx`: dim missing-members note.
- `.../dialogs/quick-pick-dialog.tsx`:
  - `resolveQuickPickCandidates` uses every EDT for `create-from`.
  - Title entry; select → `initialCreateDialog(target)`.
  - Render `notFound` in `colors.error`.
  - Clear `notFound` on an `update` result whose filter changed.
- `.../edts/edts-zone.tsx` (L428-494 effect): add a `create-from` branch, using the found → seeded wizard / not-found → quick-pick with error rule above.
- `edts-zone.interaction.test.tsx`: new describe next to the 2.30 quick-pick suite (L3367).
- No doc lists the EDT commands (EXPERIENCE.md has none; the `:` bar's grid is generated from `COMMANDS`) — no doc task.

## Tasks & Acceptance

**Execution:**
- [ ] `commands.ts`, `edt-slice.ts` (+ tests) -- command + store opener -- entry point.
- [ ] `edts-zone.logic.ts`, `wizard.logic.ts` (+ tests) -- seed state, Step 3 seeding/refresh/prune helpers, log detail -- every matrix row unit-tested at the pure level.
- [ ] `quick-pick-dialog.tsx`, `edts-zone.tsx`, `create-wizard.tsx`, `step-services.tsx` -- create-from mode, not-found error, seeded wizard, root line, missing note.
- [ ] `edts-zone.interaction.test.tsx` -- no-arg pick → seeded wizard; known topic; unknown topic error; Step 3 Perso/Global rows; full create submits `memberPlans` with root bases.

**Acceptance Criteria:**
- Given a seeded wizard, when it is submitted, then `createEdt` receives `memberPlans` where each inherited member is `{kind:'create', base: <root branch>, name}` and each added member uses the global plan.
- Given `edt-create`, `edt-switch`, `edt-modify` and `edt-delete`, when they are run, then their behavior is unchanged.
- `npm run typecheck && npm test && npm run depcheck` pass.

## Design Notes

Seeding lives in `enterBranchStep`, not `initialCreateDialog`. The global name (slug) is only known at Step 3 entry, and rows must follow it the way an untouched global name does. `seededPaths` makes the seed one-shot per path, so the developer's later choices are never overwritten.

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run depcheck` -- expected: all green

**Manual checks:**
- Real terminal: `:edt-create-from` with no arg, with a known topic and with an unknown topic. Then a full create, checking that the new branches start from the root's branches.
