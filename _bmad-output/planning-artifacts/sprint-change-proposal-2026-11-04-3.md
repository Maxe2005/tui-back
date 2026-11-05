# Sprint Change Proposal — 2026-11-04 (3): Help text filter & per-service health check toggle

Mode: Batch. Scope: **Minor** (2 new stories in Epic 9, one AD-23 extension, no manifest schema change, no rollback).

## 1. Issue Summary

Two requests raised during Epic 9:

1. **A text filter in the `?` help.** The `KEYBINDINGS` overlay (`tui/shared/components/keybinding-help.tsx`) lists every keybinding declaration in a 10-line scrolling window. The list has grown with every epic (294-line `keybindings.ts`), so finding one key means scrolling through sections. Wanted: type a few letters and see only the matching rows.
2. **Turning the health check on or off per service.** Since Story 9.7 every displayed status probes the manifest `healthUrl` first (AD-23). Some services declare a route that is slow, flaky or meaningless on a developer's machine, which makes them show `unhealthy` or `inconsistent` and adds a 2 s probe to every poll. Wanted: a per-service setting that turns the `healthUrl` check off (or back on) for chosen services, leaving the others unchanged.

Evidence from the code:
- `KeybindingHelp` has no input apart from scrolling (`resolveHelpScroll`: arrows, Home/End). `?` and Esc are routed by `app-shell.tsx` (`resolveHelpDispatch`).
- `core/service-status/index.ts` decides whether to probe with `healthProbe === undefined || !hasHealthUrl(manifest)`. That is the one place a "probe disabled" rule needs to go. `ServiceActions.verifyService`, the Dashboard snapshot, `logs-slice.ts`, `update-slice.ts` and heal (9.8) all depend on this rule.
- `Settings` (`core/ports/settings.ts`) has no per-service group. The precedent for "a list of opt-outs, empty by default" is `edts.hiddenActionHints`.

## 2. Impact Analysis

**Epics**: Epic 9 (in progress) gets 2 new stories: **9.10** (help text filter) and **9.11** (per-service health check toggle). No existing story changes its acceptance criteria. 9.11 builds on 9.7 (in review) and is automatically picked up by 9.8/9.9, since heal reads the resolver.

**PRD**: new **FR-44** (filterable keybinding help) and **FR-45** (per-service health check toggle). FR-42 gains one sentence: a service whose health check is disabled is resolved as if it declared no `healthUrl`. No NFR change.

**Architecture**: **AD-23 extension**. The resolver alone decides whether a declared `healthUrl` is probed, based on the new setting. No consumer checks the setting itself. New settings group `services.healthCheckDisabled`.

**UX**: the `?` help gets a filter line (type-to-filter). `:settings` gets a new **Services** tab. A disabled health check shows as a dim `health check off` reason on the Dashboard focused row.

**Manifest**: no schema change. `docs/tui-back-manifest.md` § `healthUrl` gets one line saying a developer can turn the probe off locally per service. The `manifest-generator` skill needs no change: it still writes `healthUrl` the same way, and the toggle is a local preference, not manifest content.

**Code impact (indicative)**
- 9.10: `keybinding-help.tsx` (filter state, `filterKeybindings` pure function, filter line, empty-result line), `app-shell.tsx` (`?`/Esc routing while the filter is non-empty), help tests + bounded-rendering test.
- 9.11: `core/ports/settings.ts` + `adapters/driven/settings/schema.ts` (`services.healthCheckDisabled: string[]`, default `[]`), `core/service-status` (one `isHealthCheckEnabled` dependency, `healthCheck: 'disabled'` marker on the status), wiring in the snapshot, slices, `verifyService` and CLI, a new settings-screen tab, dashboard reason line, docs.

## 3. Recommended Approach

**Direct Adjustment.** Both stories are added to Epic 9, one branch per story off `epic-9-service-terminals-unified-service-actions` (CLAUDE.md). Both fit existing seams: the help overlay already has a bounded window, and the resolver already has the single "should we probe?" branch. Effort: small for 9.10 and small-to-medium for 9.11 (most of the work is the settings tab). Risk: low. The main trap in 9.10 is the `?`/Esc routing, which app-shell owns. In 9.11 it is making sure no consumer bypasses the resolver. Timeline: Epic 9 grows by 2 stories. 9.10 is independent; 9.11 comes after 9.7.

### Decisions recorded

1. **Help filter input: type-to-filter.** As soon as the help is open, any printable key adds to the filter (Backspace removes). Matching is a case-insensitive substring on keys, description and section. `?` closes the help only when the filter is empty; otherwise it is typed into the filter. Esc first clears a non-empty filter, then closes. Arrows/Home/End/PgUp/PgDn keep scrolling the filtered list.
2. **Toggle scope: everything.** A disabled health check makes the service behave everywhere as if it declared no `healthUrl`: displayed status (Dashboard, Logs, Update, CLI `dashboard`), heal targets (9.8) and post-restart verification (`verifyService`, so a started container is `up-unverified`). One rule, applied in the resolver.
3. **Storage: local `settings.yaml`.** It is a per-developer preference, not shared in the repo. The setting is `services.healthCheckDisabled: string[]` (manifest `service` names), default `[]` = every declared `healthUrl` is probed (today's behaviour). Stored as an opt-out list so that a newly added service is checked by default. Unknown names are kept and ignored (a service temporarily unregistered keeps its preference).
4. **Visibility.** A status resolved with a disabled check carries `healthCheck: 'disabled'`. The Dashboard focused-row reason line shows `health check off`, and the CLI JSON exposes the marker, so an unverified `up` is never mistaken for a missing `healthUrl`.

## 4. Detailed Change Proposals

### 4.1 Epics (`epics.md`, Epic 9)

**Epic 9 header note**: append:

```
Extended again (`sprint-change-proposal-2026-11-04-3.md`): FR-44, FR-45, AD-23 extension, Stories 9.10–9.11.
```

**NEW — Story 9.10: Text Filter in the Keybinding Help**

```
### Story 9.10: Text Filter in the Keybinding Help

As a developer, I want to type a few letters in the `?` help and see only the matching keybindings, so that I find a key without scrolling the whole list.

**Acceptance Criteria:**

**Given** the help overlay open **When** a printable key is typed **Then** it is appended to a filter shown on a line under the title (`filter: <text>`, dim placeholder `type to filter` when empty); Backspace removes the last character.

**Given** a non-empty filter **When** the list renders **Then** only the rows whose keys, description or section contain the filter (case-insensitive substring) are listed; a section heading shows only when at least one of its rows matches; the scroll offset resets to the top on every filter change.

**Given** a filter matching nothing **Then** one dim line says `no keybinding matches "<text>"`; the overlay keeps its size.

**Given** a non-empty filter **When** `?` is pressed **Then** it is typed into the filter; **When** Esc is pressed **Then** the filter is cleared and the help stays open. **Given** an empty filter **Then** `?` and Esc close the help as today.

**Given** the arrows, Home/End and PgUp/PgDn **Then** they scroll the filtered list; the help reopens with an empty filter.

**Given** any size **Then** the filter line and the filtered list respect bounded rendering (AD-19): a long filter is truncated, no unbounded `.map`; the help's own footer context lists the filter keys from the keybinding declarations.

**Implementation notes:** a pure `filterKeybindings(rows, query)` next to `withSectionHeadings`, unit-tested. The `?`/Esc decision moves into `resolveHelpDispatch` (app-shell), which needs the filter state from the store or the help component. Applies wherever the help opens (zones, dialogs, terminal view output focus). Independent of other stories.
```

**NEW — Story 9.11: Per-Service Health Check Toggle**

```
### Story 9.11: Per-Service Health Check Toggle

As a developer, I want to turn the `healthUrl` check off or on for chosen services, so that a slow or meaningless health route on my machine does not make a service look unhealthy or slow every poll down.

**Acceptance Criteria:**

**Given** the settings **Then** a new `services.healthCheckDisabled` list (manifest `service` names) exists, default empty; a missing, empty or corrupt value falls back to the default with the usual field-naming warning; unknown names are kept and ignored.

**Given** a service whose name is in the list and whose manifest declares `healthUrl` **When** its status is resolved **Then** no probe is sent and the result equals the "no `healthUrl`" rows of AD-23 (container state, `up` unverified; container-less → `no-container`), marked `healthCheck: 'disabled'`.

**Given** a service not in the list **Then** its resolution is unchanged (Story 9.7).

**Given** a disabled service **When** it is restarted (switch/realign restart, Logs `R`, Dashboard restart, heal) **Then** `verifyService` does not probe either: a started container is reported `up-unverified`; heal (9.8) never targets it as `unhealthy`.

**Given** the `:settings` screen **Then** a new **Services** tab lists every registered service, one checkbox per service ("health check"), checked = enabled; a service without `healthUrl` is listed disabled with the dim reason `no healthUrl`; a service whose manifest fails to load is listed disabled with `manifest unavailable`; toggling persists immediately and applies on the next resolution (next poll / refresh) without restart. The list is bounded (AD-19) and its keys come from the keybinding declarations.

**Given** the Dashboard focused row of a disabled service **Then** the reason line shows a dim `health check off`; the CLI `dashboard` JSON carries `healthCheck: "disabled"` on that service's status.

**Given** the resolver **Then** it is the only reader of the setting: no consumer (snapshot, slices, `verifyService`, CLI, heal) checks the list itself.

**Implementation notes:** `ServiceStatusDeps` gets `isHealthCheckEnabled?: (manifest) => boolean` (absent = enabled), wired from the live settings so a change applies at the next call. Settings port, zod schema, defaults and `SETTINGS_TABS` (new `services` tab, last) updated with tests. `docs/tui-back-manifest.md` § `healthUrl` and the CLI `dashboard` envelope doc mention the toggle. AD-23 extension.

**Prerequisites:** 9.7.
```

### 4.2 PRD (`prds/prd-tui-back-2026-08-10/prd.md`)

**FR-42**: append to its paragraph:

```
A service whose health check the developer disabled (FR-45) is resolved as if it declared no `healthUrl`.
```

**NEW — after FR-43:**

```
#### FR-44: Filterable keybinding help (added 2026-11-04, Sprint Change Proposal 3)

The `?` help can be narrowed by typing: only the keybindings whose keys, description or section contain the typed text are listed, with a visible "no match" line when none does. Clearing the filter restores the full list; the keys that close the help keep working once the filter is empty.

#### FR-45: Per-service health check toggle (added 2026-11-04, Sprint Change Proposal 3)

From the settings screen, a developer turns the `healthUrl` check off or on per service. The preference is local (not in the manifest), enabled by default, and applies everywhere a status is resolved or verified (views, CLI, heal, post-restart verification). A disabled check is visibly marked so an unverified state is not mistaken for a missing route.
```

### 4.3 Architecture (`ARCHITECTURE-SPINE.md`, AD-23)

**Binds**: `FR-42, FR-43, FR-29, Stories 9.7, 9.8, 9.9` → `FR-42, FR-43, FR-45, FR-29, Stories 9.7, 9.8, 9.9, 9.11`

**Append after the Rule:**

```
- **Extension (2026-11-04, SCP 3, FR-45, Story 9.11):** whether a declared `healthUrl` is probed is decided inside the resolver from the local setting `services.healthCheckDisabled` (manifest service names, default empty = probe). A disabled check takes the "no `healthUrl`" rows of the table and marks the status `healthCheck: 'disabled'`. `verifyService` uses the same decision. No consumer reads the setting.
```

### 4.4 UX (`ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md`)

**Settings screen row** (component catalog): append:

```
A **Services** tab (Story 9.11) lists every registered service with a "health check" checkbox (checked = the `healthUrl` is probed); a service without `healthUrl` or with an unloadable manifest is listed disabled with its dim reason.
```

**Interaction consistency contract, "Footer and `?` help" row**: append:

```
The `?` help is type-to-filter (Story 9.10): printable keys narrow the list (keys, description, section; case-insensitive), Backspace edits, Esc clears a non-empty filter before closing, and `?` closes only when the filter is empty.
```

### 4.5 Docs (`docs/tui-back-manifest.md` § `healthUrl`, French like the rest of the doc)

Append to **Rôle**:

```
  Un développeur peut désactiver localement la sonde pour un service
  (`:settings` → onglet Services, `services.healthCheckDisabled` dans
  `settings.yaml`) : le service est alors traité partout comme sans
  `healthUrl` (statut, heal, vérification après redémarrage), et son statut
  porte `healthCheck: "disabled"`.
```

### 4.6 Sprint status (`implementation-artifacts/sprint-status.yaml`)

Epic 9 comment: append `+ help filter & per-service health check toggle (2026-11-04, sprint-change-proposal-2026-11-04-3.md): 9-10 independent; 9-7 -> 9-11.`

Add after `9-9-dashboard-heal-action: backlog`:

```
  9-10-text-filter-in-the-keybinding-help: backlog
  9-11-per-service-health-check-toggle: backlog
```

## 5. Implementation Handoff

**Scope: Minor.** Direct implementation by the Developer agent (`bmad-build`), one story branch each off the Epic 9 branch.

- **9.10**: can start now.
- **9.11**: start once 9.7 is merged (it already is on the epic branch, status `review`). Implementing it before 9.8 is fine: heal then inherits the toggle for free.

**Success criteria**
- 9.10: typing in `?` narrows the list; `?`/Esc behave as specified with and without a filter; bounded-rendering and help tests pass.
- 9.11: a disabled service never triggers an HTTP probe (asserted on a fake `HealthProbePort`); its status, verification and heal behaviour match the "no `healthUrl`" rows; the Services tab persists and applies live; no consumer outside `core/service-status` reads `services.healthCheckDisabled` (grep-able).
