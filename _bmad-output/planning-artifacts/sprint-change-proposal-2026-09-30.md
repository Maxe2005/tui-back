---
date: 2026-09-30
trigger: 'New capability requested by Max — rework the Routes zone detail pane: a reusable JSON tree component (indented, scrollable, line-by-line navigation, collapse, session-persistent show/hide filters), a mandatory request-editing step between selecting a route and firing it, and Request/Response sub-tabs in the right pane. The OpenAPI scanner is extended to feed request skeletons and parameters.'
mode: incremental
epic_impact: 'Epic 6 (in-progress) — 4 new stories appended (6.6–6.9), to be executed BEFORE 6.3. Story 6.3 re-scoped (its "customize body/headers" part moves into 6.8/6.9). Stories 6.1/6.2 not reopened (6.2''s fireRequest signature is extended, backwards-compatibly). No epic redefinition, no PRD change, no MVP change.'
scope_classification: moderate
---

# Sprint Change Proposal — 2026-09-30

## 1. Issue Summary

Story 6.2 (`review`) fires a route with the discovered method + path only: no body, no query,
no custom headers, and the response is a raw text dump in the detail pane. Max wants the Routes
tab to become a proper request workbench:

1. **A `JsonTree` shared component** — well-indented JSON, navigable line by line in a
   scrollable viewport (same feel as the routes list), collapsible sub-objects/sub-lists per
   line, and global show/hide filters. Used both to **edit the request body** before firing and
   to **browse the response**.
2. **A mandatory edit step** — `Enter` on a selected route moves the focus to the right pane to
   edit the request (params, query, headers, body) before firing. Firing straight from the list
   no longer exists.
3. **Sub-tabs in the right pane** — so request editing and response browsing each get the full
   pane (a third tab, Logs, is reserved for Story 6.4).

Decisions taken with Max during this session:

- **Filter persistence: session-only, per route.** Filters/collapse state live in the store (not
  on disk) and are keyed per route. They will later be saved together with favorite/saved
  requests (Story 6.3 territory) — out of scope here, but the state shape must be serializable.
- **Sub-tab switching: `Ctrl+→` / `Ctrl+←`, fallback `Ctrl+N` / `Ctrl+P`** (same convention and
  same key helper as the EDT create wizard's step navigation). No `1/2/3` and no `[` `]`.
- **The scanner is extended now** (not deferred): it exposes path/query/header parameters and a
  request-body example so the editor opens pre-filled instead of empty.
- Inside the request editor, hiding/collapsing is **purely visual: hidden lines are still
  sent**, and the editor says so ("N lines hidden — still sent"). Only a response is
  "filtered"; a request body is never silently altered by the view.

This is not a bug or technical blocker — a new requirement from the product owner.

**Evidence from the code:**

- `core/ports/route-scanner.ts` — `Route = {method, path, summary?}` only; the scanner
  (`nestjs-openapi.ts`) reads `paths.*.<method>` and discards `parameters`, `requestBody` and
  `components.schemas`. No request skeleton is possible without extending the port.
- `core/routes/fire-request.ts` — `fireRequest(deps, repoPath, method, path)`: no body / query /
  headers input; `fetch` is called with `Cookie` only; response body is a truncated text string
  (64 KB cap) rendered as one block by `formatFireResult`.
- `routes-zone.tsx:150` — `Enter` fires immediately (`resolveEnterFireTarget` → `fireRoute`); the
  zone's `useInput` has no notion of pane focus (only the `/` filter-editing mode).
- `routes-slice.ts` — a single `fireStatus/fireResult/fireError` triple: one response for the
  whole zone, dropped on every reload; no per-route request or response state.
- `zones/edts/dialogs/create-wizard/wizard.logic.ts:147` — a `Ctrl+→/Ctrl+N` & `Ctrl+←/Ctrl+P`
  resolver already exists and works with Ink's `key.ctrl` handling; it can be generalized
  rather than re-invented.
- `shared/components/bounded-list.tsx`, `text-input-line.tsx`, `detail-pane.tsx` — the scrolling
  viewport, inline text editing and pane frame the new components build on.

## 2. Impact Analysis

### Epic Impact

Epic 6 can still be completed as planned. Four stories are appended after 6.5 (numbered 6.6–6.9
to keep the existing story keys and their `sprint-status.yaml` entries stable — same precedent
as Epic 2's appended stories 2.33+), but their **intended execution order is before 6.3**:
6.6 → 6.7 → 6.8 → 6.9 → 6.3 → 6.4 → 6.5. Rationale: 6.3 (save/customize/re-fire) and 6.4
(response + logs) both build on a real request editor and a real response view; building them
on the current single text dump would mean rewriting them.

### Story Impact

- **Story 6.1 (review):** not reopened. Its scanner is *extended* by 6.6; `Route`'s new fields
  are all optional, so existing scanners/tests are unaffected.
- **Story 6.2 (review):** not reopened. `fireRequest` gains an optional trailing `options`
  argument (body/query/headers) in 6.9; the CLI `fire-request` keeps working unchanged.
- **Story 6.3 (backlog) — re-scoped:** its "customize (body, headers) before firing" part is
  now delivered by 6.8/6.9. 6.3 keeps: save a request, re-fire with overwrite/save-as-new choice,
  name-collision rejection, stale flagging, and persisting the JsonTree filters alongside saved
  requests. Its ACs are amended (Section 4.3).
- **Story 6.4 (backlog):** now lands its logs into the reserved third sub-tab; text amended.
- **Story 6.5 (backlog):** unaffected.
- **Epic 2 / Story 2.x wizard:** the Ctrl+→/N ↔ Ctrl+←/P resolver is generalized into a shared
  key helper (behavior-preserving; wizard tests are the regression net).

### Artifact Conflicts

- **PRD:** FR-20/FR-21 already cover firing and customizing a request; no new FR, no MVP change.
  FR-22 (response + logs together) is unchanged (6.4).
- **Architecture:** no new AD. AD-5 (scanner via port; scanner-specific metadata never crosses
  the port) is *respected*: the port gains only neutral, scanner-agnostic fields (see 6.6).
  AD-1 (core has no adapter imports) holds — the JSON skeleton generation from a schema stays in
  the driven adapter; the JsonTree is a driving-adapter component; `core/` only gains the
  optional fire options.
- **UI/UX (`epics.md` UX-DR list):** UX-DR23 (Routes zone states) is amended; a new UX-DR
  (UX-DR34, below) specifies the JsonTree and the Routes right-pane sub-tab model.
- **Other:** no CI/CD, deployment or IaC impact. New tests for the scanner extension, the
  JsonTree (pure model + rendering + interaction), the fire options, the slice and the zone.

## 3. Recommended Approach

**Selected: Option 1 — Direct Adjustment.** Four new stories in Epic 6, each on its own
`story-6-N-...` branch off `epic-6-route-explorer`, merged `--no-ff` per the CLAUDE.md git
workflow. No rollback, no MVP review.

- **Effort:** Medium–High overall (JsonTree edit mode and the focus/sub-tab model are the
  largest pieces); each story is individually Small–Medium.
- **Risk:** Medium.
  - *Terminal key support:* `Ctrl+→/←` is not delivered by every terminal; hence the mandatory
    `Ctrl+N/P` fallback, already proven in the wizard.
  - *Editing JSON in a terminal:* mitigated by scalar-only inline editing plus a raw-text
    fallback mode that validates on exit (6.8).
  - *Render cost:* large responses — mitigated by a flattened, windowed row model (only visible
    rows are rendered; AD-12 budget).
  - *Truncated responses:* the existing 64 KB cap yields invalid JSON; the Response tab must
    fall back to raw text and say "truncated" (6.7).
- **Rationale:** the JsonTree is needed by both the editor and the response view, so building
  it first (read-only, on a real response) de-risks the rest and lets each story be validated
  visually on its own.

## 4. Detailed Change Proposals

### 4.1 New Stories (Epic 6) — `epics.md`, after Story 6.5

#### Story 6.6: Scanner Extension — Parameters & Request-Body Skeletons

> Added 2026-09-30 (Sprint Change Proposal): feeds the request editor (6.8/6.9) so a route opens
> pre-filled instead of empty.

As a developer, I want the route scanner to expose each route's parameters and a request-body
example, So that the request editor opens with a realistic skeleton instead of a blank body.

**Acceptance Criteria:**

- **Given** an OpenAPI 3.x operation with `parameters` (path / query / header, at operation or
  path-item level) **When** scanned **Then** the route carries a neutral parameter list
  (`name`, `in`, `required`, optional `example`) — operation-level entries override path-item
  ones with the same `name`+`in`.
- **Given** an operation with a JSON `requestBody` **When** scanned **Then** the route carries
  `bodyExample` — the spec's `example`/`examples` value when present, else a skeleton generated
  from the schema (`string → ""`, `number/integer → 0`, `boolean → false`, `array → [one
  generated item]`, `object → all properties`, `enum → first value`, `default`/`example` on a
  property win) — plus the body `contentType`. `$ref`s into `components` are resolved.
- **Given** a recursive or self-referencing schema **When** the skeleton is generated **Then**
  generation is depth-bounded and cycle-safe (a cyclic branch renders `null`/`{}`) — it never
  loops or throws.
- **Given** a `requestBody` that is not JSON (multipart, form-urlencoded, binary) **When**
  scanned **Then** the route carries its `contentType` and **no** `bodyExample` — the editor
  (6.8) then starts empty; nothing is fabricated.
- **Given** a spec that has no parameters/requestBody info, or a scanner implementation for
  another language that never fills the new fields **When** used **Then** everything keeps
  working exactly as in Story 6.1/6.2 — every new field is optional (AD-5: no core change is
  needed to activate a scanner).
- **Given** a malformed `parameters`/`requestBody`/`$ref` **When** scanned **Then** that
  operation degrades to a route without the extra fields (the route is still listed); the scan
  as a whole only fails on the conditions Story 6.1 already defines.

**Implementation notes:** `Route` gains `parameters?: RouteParameter[]`, `bodyContentType?:
string`, `bodyExample?: unknown` — plain data, no OpenAPI vocabulary crossing the port.
Schema → example generation lives in a pure function inside the `nestjs-openapi` driven
adapter (`schema-example.ts`), never in `core/`. Route identity stays `method + path`.

#### Story 6.7: JsonTree Component — Read-Only Navigation, Collapse & Session Filters

> Added 2026-09-30 (Sprint Change Proposal): the shared component used to browse a response
> (this story) and to edit a request body (6.8).

As a developer, I want JSON shown as an indented, scrollable tree I can walk line by line, fold
and filter, So that I can read large API responses without a separate tool.

**Acceptance Criteria:**

- **Given** a JSON value **When** rendered **Then** it is shown as indented lines
  (`key: value`, containers with a `{n}` / `[n]` size hint), scalars colored by type (string,
  number, boolean, null), long strings truncated with `…`, inside a bounded viewport that
  scrolls with the selection (same behavior and `Home`/`End`/`PgUp`/`PgDn` as the routes list);
  only visible rows are rendered.
- **Given** the selection is on a container line **When** `→`/`Space` is pressed **Then** it
  unfolds; `←` folds it, or moves to the parent when it is already folded. `+`/`-` unfold/fold
  every node down to the next depth level.
- **Given** a line is selected **When** the developer hides its key (`h`) **Then** every line
  with that key name disappears from the tree, everywhere (a global key rule); `H` on a line
  keeps **only** rules-matching keys visible (allow-list). `f` opens the filter panel to list and
  remove active rules; a `null`-values toggle hides all nulls. The status line always shows the
  number of hidden lines and active rules.
- **Given** a response with hidden or folded content **When** the developer fires another
  request on the **same route** **Then** the same key rules and folded paths apply to the new
  response. Fold state is stored per **normalized path** (array indices become `[]`, e.g.
  `data.items[].tags`), so it survives responses with different array lengths.
- **Given** the developer selects a different route **When** it is opened **Then** it gets its
  **own** filter/fold state (filters are per route). Nothing is persisted to disk: state lives
  in the store for the session, is lost on quit, and has a serializable shape so Story 6.3 can
  save it with a saved request.
- **Given** a response that is not valid JSON (plain text, HTML, or a body truncated at the
  64 KB cap) **When** shown **Then** the Response view falls back to scrollable raw text with a
  visible reason ("not JSON" / "truncated at 64 KB") — it never renders a partial tree as if
  complete.
- **Given** an empty response body or an empty object/array **When** shown **Then** it is an
  explicit empty state, distinct from an error.

**Implementation notes:** `tui/shared/components/json-tree/` — pure model
(`flattenJson(value, foldState, rules) → Row[]`, `normalizePath`, rule/fold reducers) with
unit tests, plus a thin Ink view built on `bounded-list`. Filter/fold state lives in a new
`jsonTreeStates: Record<routeKey, JsonTreeState>` in the routes slice (AD-10: same single
store), `routeKey = METHOD + ' ' + path`. In this story the component is wired into the
existing Response pane (replacing the raw dump); the sub-tab layout arrives in 6.9.

#### Story 6.8: JsonTree Edit Mode — Request Body Editing

> Added 2026-09-30 (Sprint Change Proposal).

As a developer, I want to edit a JSON request body in the same tree, So that I can shape a
realistic payload before firing without leaving the terminal.

**Acceptance Criteria:**

- **Given** the tree in edit mode **When** `Enter` is pressed on a scalar **Then** an inline
  field (`TextInputLine`) opens with the current value; on confirm the value is validated by
  its type (number, boolean, `null`, string) and an invalid entry stays displayed in error
  color with its reason — it is never silently coerced.
- **Given** a container or key line **When** `a` (add key/item), `d` (delete) or `t` (change
  type) is pressed **Then** the tree is updated accordingly; adding a key to an object prompts
  for its name and rejects a duplicate.
- **Given** the developer wants to paste a whole payload **When** `r` is pressed **Then** a
  raw-text mode opens (multi-line editable buffer); leaving it validates the JSON — invalid
  JSON keeps the developer in raw mode with the parse error and line/column shown, and the
  previous valid body is preserved.
- **Given** hidden or folded lines in the editor **When** the request is later fired **Then**
  hidden content **is still sent** and the editor status shows "N lines hidden — still sent";
  hide/fold in edit mode is purely visual.
- **Given** the body still has an invalid value or unparsable raw buffer **When** the developer
  tries to leave the editor to fire **Then** the fire is blocked with the first error shown.
- **Given** the same route is edited twice in a session **When** the developer comes back
  **Then** its last edited body and its tree filters/folds are still there (per-route session
  state, as in 6.7).

**Implementation notes:** extends the 6.7 model with an immutable edit layer
(`setValue`, `addEntry`, `removeEntry`, `changeType`) — pure, fully unit-tested; the view adds
the inline editor and the raw mode. Reuses `text-edit.ts`/`TextInputLine`.

#### Story 6.9: Routes Right Pane — Mandatory Request Step & Request/Response Sub-Tabs

> Added 2026-09-30 (Sprint Change Proposal).

As a developer, I want selecting a route to open a request editor and firing to reveal the
response in its own tab, So that I always review what I send and can read what comes back
without the two fighting for the same space.

**Acceptance Criteria:**

- **Given** the routes list has the focus **When** `Enter` is pressed on a route **Then** the
  focus moves to the right pane on its **Request** tab (pane title/border highlighted, footer
  switches to the pane's keys); `Esc` returns the focus to the list. `Enter` on the list never
  fires directly — the request step is mandatory.
- **Given** the Request tab **When** opened **Then** it shows sections **Params** (path
  parameters, required ones marked and pre-filled from `example` when known), **Query**,
  **Headers** and **Body** (the 6.8 editor, pre-filled with the 6.6 `bodyExample`, empty when
  the route has none or no body). `Tab`/`Shift+Tab` move between sections. A route with no
  parameters and no body (e.g. a plain `GET`) shows the sections empty and can be fired in two
  keypresses (`Enter` to open, `Ctrl+R` to fire) — the step is mandatory to *pass through*, not
  to fill.
- **Given** required path parameters are unfilled **When** the developer fires **Then** the fire
  is blocked with the missing parameter names listed; nothing is sent.
- **Given** a valid request **When** `Ctrl+R` is pressed **Then** the request is fired through
  the same core use-case (in-process, AD-2), the pane switches automatically to the **Response**
  tab, and shows status, duration and size followed by the 6.7 JsonTree (or raw-text fallback).
  Auth errors keep their distinct rendering (6.2), now inside the Response tab.
- **Given** the right pane has the focus **When** `Ctrl+→` (fallback `Ctrl+N`) or `Ctrl+←`
  (fallback `Ctrl+P`) is pressed **Then** the sub-tab changes to the next/previous one, without
  wrapping. Number keys and `[` `]` are **not** used. The tab strip shows the active tab; a
  third **Logs** tab is displayed only once Story 6.4 provides it (the tab model supports it).
- **Given** the developer switches route or sub-tab **When** they come back **Then** each
  route's request draft and last response are kept for the session (a reload of the routes
  list for a different repo still drops them, as it does today).
- **Given** a route the developer edited **When** `Esc`/`Ctrl+←` returns to the Request tab
  after a fire **Then** the draft is intact and can be tweaked and re-fired without leaving the
  pane.
- **Given** `fire-request` is used from the CLI **When** run without the new options **Then** it
  behaves exactly as in Story 6.2; the new optional `body`/`query`/`headers` options are
  available on the use-case (and as optional CLI flags) with `Content-Type: application/json`
  inferred for a JSON body.

**Implementation notes:** `fireRequest(deps, repoPath, method, path, options?: {body?, query?,
headers?})` — the trailing optional argument keeps 6.2's tests green; the `Cookie` header is
still owned by the auth port and cannot be overridden by `headers`. The Ctrl+→/N / Ctrl+←/P
resolver in `create-wizard/wizard.logic.ts` is generalized to a shared
`shared/keys/tab-navigation.ts` consumed by both the wizard and the Routes pane (wizard tests
unchanged). The routes slice moves from one global `fireStatus/fireResult/fireError` triple to
per-route `requestDrafts` / `responses` maps plus a `routesPaneFocus: 'list' | 'detail'` and
`routesPaneTab: 'request' | 'response'`.

### 4.2 Amendments to Existing Text (superseding notes, not reopenings) — `epics.md`

**UX-DR23** — append:

> Amended 2026-09-30 (Sprint Change Proposal, Stories 6.6–6.9): the Routes zone's right pane is
> a focusable two-tab pane (Request / Response, Logs added by Story 6.4) reached with `Enter`
> from the list; request editing is a mandatory step before any fire; the response is browsed
> in a JsonTree with session-persistent, per-route filters (UX-DR34).

**New UX-DR34** — add after UX-DR33 (UX-DR33 is already the `bounded-list` component):

> UX-DR34: JsonTree and pane sub-tabs — a shared, windowed, line-by-line navigable JSON tree
> with per-node fold and global key show/hide rules (per route, session-only, stored by
> normalized path/key name), in read-only (response) and edit (request body) modes; hidden
> content is never removed from a request body, and a truncated/non-JSON response falls back
> to raw text with a visible reason. Pane sub-tabs switch with `Ctrl+→`/`Ctrl+←`, fallback
> `Ctrl+N`/`Ctrl+P` (the same convention as the EDT create wizard).

### 4.3 Re-scoping of Story 6.3 and note on 6.4 — `epics.md`

**Story 6.3** — append after its acceptance criteria:

> Amended 2026-09-30 (Sprint Change Proposal): the "customize before firing" mechanics — body,
> headers, query and params editing, and the mandatory request step — are delivered by
> Stories 6.8/6.9; 6.3 builds saving on top of them. "Ad hoc customize-then-fire always works
> without saving" is satisfied by 6.9's request step. Saving also persists the request's
> JsonTree filters/folds (per-route session state from 6.7), so a saved/favorite request
> reopens with the same view.

**Story 6.4** — append:

> Amended 2026-09-30 (Sprint Change Proposal): the correlated logs are shown in the third
> **Logs** sub-tab of the Routes right pane (Story 6.9's tab model), shown together with the
> response's summary line; the response and logs remain reachable without a separate step.

### 4.4 `sprint-status.yaml`

New entries after `6-5-…`:

```yaml
  6-6-scanner-extension-parameters-request-body-skeletons: backlog
  6-7-jsontree-component-read-only-navigation-collapse-session-filters: backlog
  6-8-jsontree-edit-mode-request-body-editing: backlog
  6-9-routes-right-pane-mandatory-request-step-request-response-sub-tabs: backlog
```

plus a dated header note (`# 2026-09-30: Sprint Change Proposal … appended 6-6…6-9, to run
before 6-3`) and `last_updated: 2026-09-30` (already that date).

## 5. Implementation Handoff

**Scope classification: Moderate** — backlog reorganization (four new stories, one re-scoped,
execution order changed) plus a new shared component.

- **Product Owner / Developer (this session, on approval):** apply the `epics.md` edits (new
  Stories 6.6–6.9, UX-DR23 amendment, UX-DR34, Story 6.3/6.4 notes) and the
  `sprint-status.yaml` entries.
- **Developer agent (future `bmad-build` sessions):** one `story-6-N-...` branch off
  `epic-6-route-explorer` per story, `spec-6-N-...md` first, atomic commits, `--no-ff` merge
  once reviewed. Suggested order and commit shape:
  - **6.6:** port fields → pure schema-example generator → parameter/requestBody extraction →
    scanner tests.
  - **6.7:** pure flatten/fold/rule model → view on `bounded-list` → Response pane wiring →
    per-route state in the slice.
  - **6.8:** pure edit layer → inline editor → raw mode → fire-blocking validation.
  - **6.9:** shared tab-navigation helper (wizard refactor) → `fireRequest` options → slice
    (drafts/responses/focus/tab) → pane focus + tab strip → Request sections → Response tab →
    footer/help updates.
  - Each commit keeps `npm test && npm run typecheck && npm run depcheck` green, with the story
    number in the subject line.

**Success criteria:** Stories 6.6–6.9 appear in `epics.md` under Epic 6 with the acceptance
criteria above; UX-DR23/34 and the 6.3/6.4 notes are in place; `sprint-status.yaml` carries the
four `backlog` entries; once implemented, `Enter` on a route opens a pre-filled request editor,
firing reveals a foldable/filterable response tree whose filters persist across requests of the
same route for the session, and sub-tabs switch with `Ctrl+→/←` (`Ctrl+N/P`).
