---
title: 'Routes Right Pane — Mandatory Request Step & Request/Response Sub-Tabs'
type: 'feature'
created: '2026-10-01'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: 'c89689184e96b6d01720be731342553df29bba7a'
context:
  - '/home/mchoisel/Documents/IANORD/tui-back-epic-6/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `Enter` on the routes list fires immediately with no params/query/headers/body, and the request body editor (6.8) and the response tree (6.7) fight for the same detail pane; one global fire triple loses each route's response when moving around.

**Approach:** Turn the right pane into a focusable pane with **Request** / **Response** sub-tabs: `Enter` opens the Request tab (Params, Query, Headers, Body sections, pre-filled from 6.6), `Ctrl+R` fires the draft through an extended `fireRequest` and switches to Response; drafts and responses are kept per route for the session.

## Boundaries & Constraints

**Always:**
- `core/` never imports `adapters/` (AD-1); imports first, relative imports end in `.js`; pure logic in `*.logic.ts`, unit-tested.
- `fireRequest(deps, repoPath, method, path, options?: { body?: unknown; query?: Record<string,string>; headers?: Record<string,string> })` — 6.2 tests stay green unmodified. `body` is JSON-serialized by core with `Content-Type: application/json` unless a `content-type` header is given (case-insensitive); a `body` on `GET`/`HEAD` → `invalid-argument`; any user `cookie` header is dropped — the auth port's `Cookie` always wins; `query` is appended URL-encoded.
- Route-exists check also accepts a **concrete** path against a templated route (`/users/42` ↔ `/users/{id}`: same segment count, `{x}` matches one non-empty segment); exact match wins; the concrete path is fired.
- CLI `fire-request <repoPath> <METHOD> <path>` unchanged without flags; new optional repeatable flags `--body <json>` (unparsable → `invalid-argument`), `--query name=value`, `--header 'Name: value'`; unknown flag/missing value → `invalid-argument`.
- `shared/keys/tab-navigation.ts` exports the generalized Ctrl+→/Ctrl+N (next) · Ctrl+←/Ctrl+P (back) resolver plus a no-wrap tab stepper; `wizard.logic.ts` re-exports `resolveWizardNavKey` from it — wizard tests unchanged.
- Slice: global `fireStatus/fireResult/fireError/firedRouteKey/treeFocused` replaced by `requestDrafts` (params/query/headers per route, seeded lazily from `parameters` examples), `responses` (per route: firing | fired+result | error), `routesPaneFocus: 'list'|'detail'`, `routesPaneTab: 'request'|'response'`. Both maps: same 50-entry LRU prune as `jsonTreeStates`. A concurrent fire of the same route is dropped. Same-repo reload keeps drafts/responses; a reload onto a **different** repo drops `requestDrafts`, `responses`, `bodyDrafts`, `bodyEditErrors` and resets focus to the list.
- Keys — list: `Enter` opens the pane on Request (never fires); `e` opens it on the Body section (6.8 gating). Pane: `Tab`/`Shift+Tab` cycle sections; `Ctrl+R` fires from either tab; Ctrl+→/N, Ctrl+←/P switch tabs without wrapping; `Esc` unwinds inline/raw editor → rules panel → (Response → Request tab) → list. While any inline input is open it owns every key (Ctrl+R/Tab/tab-nav inert).
- Params/Query/Headers: one row per entry (`name*` marks required), `↑↓` move, `Enter` edits the value inline (`TextInputLine`); Query/Headers also `a` add (name prompt, duplicate rejected) and `d` delete. Path params = scanner `in:'path'` params ∪ `{name}` segments of the path (all required), substituted URL-encoded before firing. Empty query/header values are not sent. Body = the 6.8 editor, its tree state keyed separately from the response tree.
- Fire blocked (nothing sent, reason on the Request status line) when required path params are empty (`Missing required: id, orgId`) or the body has validation errors (first error shown). No body sent for routes without `bodyExample`/`bodyContentType` or with an `undefined` draft.
- Response tab: `firing` spinner; fired → `status · duration · size` then the 6.7 JsonTree / raw / empty fallback; error → `formatFireError` (auth distinct); none yet → dim hint. Tab strip shows the active tab, accent when the pane is focused. Pane focus sets `zoneInputCaptured` (global mnemonics/arrows inert, fixing letters like `d` switching zones mid-edit). Hints are the pane's own bottom line.

**Ask First:** Persisting drafts/responses to disk; any change to the 64 KB body cap or the auth retry policy.

**Never:** No Logs tab (6.4) — only the tab model supports a third entry; no saving (6.3); no number keys or `[` `]` for tabs; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plain GET | `Enter`, `Ctrl+R` on `GET /health` | fired, pane on Response | N/A |
| Missing param | `/users/{id}`, id empty, `Ctrl+R` | `Missing required: id`, nothing sent | Stays on Request |
| Body error | invalid scalar in draft, `Ctrl+R` | first body error shown, nothing sent | Stays on Request |
| Tab bounds | Request + Ctrl+←; Response + Ctrl+→ | no change | No wrap |
| Revisit | fire A, move to B, back to A | A's draft + last response intact | N/A |
| Repo switch | reload onto another repo | drafts/responses dropped, focus list | N/A |
| Core body on GET | `fireRequest(..., 'GET', p, {body})` | `invalid-argument` | Nothing fired |
| Cookie override | `headers: {cookie: 'x'}` | auth cookie sent, `x` ignored | Never leaked |
| CLI bad JSON | `--body '{oops'` | `invalid-argument` envelope, exit 1 | N/A |

</frozen-after-approval>

## Code Map

- `src/core/routes/fire-request.ts:63` -- add `options`; matching at `:101` gains template fallback; fetch init `:136` gets method/headers/body; usage string `:37`.
- `src/adapters/driving/cli/subcommands.ts:254` -- `fire-request` wrapper: positional arity + hand-rolled flags (pattern: `runEdtCreate` below it).
- `src/adapters/driving/tui/zones/edts/dialogs/create-wizard/wizard.logic.ts:141` -- `WizardNavKey`/`resolveWizardNavKey` move to `shared/keys/tab-navigation.ts` (new dir), re-exported here; consumer `create-wizard.tsx:364`.
- `src/adapters/driving/tui/store/slices/routes-slice.ts:46` -- fire triple, `firedRouteKey`, `treeFocused`, `fireRoute:263`, reload reset `:236`; mirror `updateJsonTreeState` LRU + `touchBodyDraftEntries` for the new maps.
- `src/adapters/driving/tui/app-shell.tsx:370` -- `treeOwnsArrows` reads `treeFocused`; becomes redundant once pane focus captures input (remove, keep behavior).
- `src/adapters/driving/tui/zones/routes/routes-zone.tsx:739` -- the monolithic `useInput`; `:1045` list Enter-fire; `:1176` detail render. Extract the Request-tab view (`routes-request-tab.tsx`), Response-tab view (`routes-response-tab.tsx`) and pure request logic (`routes-request.logic.ts`: path-param extraction, seeding, missing-required check, fire-options build, size format) instead of growing this file.
- `src/adapters/driving/tui/zones/routes/routes-zone.logic.ts:88` -- `formatFireStatus` gains size; `resolveEnterFireTarget` reused as the cursor-route resolver.
- `src/adapters/driving/tui/shared/components/json-tree/model.ts:53` -- `routeKeyFor`; `canEditRouteBody:1048`, `seedBodyDraft:1068` reused; `text-edit.ts:46` already ignores ctrl keys.
- `src/core/ports/route-scanner.ts:17` -- `RouteParameter` (read-only seed).
- Tests to extend: `fire-request.test.ts`, CLI subcommand tests, `wizard.logic.test.ts` (unchanged), `routes-slice.test.ts`, `routes-zone*.test.tsx`, `app-shell.interaction.test.tsx:2578` (treeFocused fixture).

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/routes/fire-request.ts` + test -- options, template match, body/GET guard, cookie drop, query -- matrix core rows.
- [ ] `src/adapters/driving/cli/subcommands.ts` + test -- flags parsing -- CLI parity (AD-2).
- [ ] `src/adapters/driving/tui/shared/keys/tab-navigation.ts` + test; `wizard.logic.ts` re-export -- shared resolver + no-wrap stepper.
- [ ] `zones/routes/routes-request.logic.ts` + test -- pure request model -- missing/size/build rows.
- [ ] `store/slices/routes-slice.ts` + test -- per-route maps, pane focus/tab, `fireRoute(routeKey, method, path, options)` -- revisit/repo-switch/concurrency rows.
- [ ] `zones/routes/routes-request-tab.tsx`, `routes-response-tab.tsx`, `routes-zone.tsx`, `app-shell.tsx` + zone/app-shell tests -- focus, sections, tab nav, Esc unwind, capture, hints.

**Acceptance Criteria:**
- Given the list focused, when `Enter` is pressed on a route, then the pane takes focus on its Request tab and nothing is fired; `Esc` returns to the list.
- Given a valid request, when `Ctrl+R` is pressed, then it is fired in-process with the draft's params/query/headers/body and the pane shows Response with status, duration, size and the tree.
- Given a fire, when `Esc` or `Ctrl+←` is pressed on Response, then the Request tab shows the intact draft and can be re-fired.
- Given the CLI without flags, when `fire-request` runs, then behavior matches 6.2 exactly.

## Spec Change Log

## Design Notes

Template matching (not a `pathParams` option) keeps the 6.9 signature as planned and lets the CLI fire `/users/42` directly. The 6.8 body editor shared `jsonTreeStates[routeKey]` with the response tree; with both views alive per route they would trample each other's folds/selection, so the editor moves to its own key (e.g. `${routeKey} #body`).

## Verification

**Commands:**
- `npm test` -- expected: Vitest green (6.2 and wizard tests untouched).
- `npm run typecheck` -- expected: clean.
- `npm run depcheck` -- expected: no `core → adapters` violation.
