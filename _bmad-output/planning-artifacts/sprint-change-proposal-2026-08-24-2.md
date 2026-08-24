---
date: 2026-08-24
trigger: User request — TUI-native repo registry screen, tab-bar arrow navigation, manifest-gated Routes/shared-types tab visibility; a shared-types version-resolution flaw surfaced while scoping the last item
mode: incremental
status: approved
---

# Sprint Change Proposal — Repo Registry Screen, Tab-Bar Navigation, Manifest-Gated Zone Visibility & shared-types Version Resolution

## 1. Issue Summary

Max requested four TUI/UX additions:

1. A TUI screen to search for and register repos into the tool's registry, with static guidance on creating a manifest (manually or via the `/manifest-generator` skill) — meant to populate the registry on first use.
2. Dashboard/EDTs/etc. tabs navigable with `Left`/`Right` arrows when the zone-tab bar has keyboard focus, with `Tab` switching focus onto/off the bar.
3. The `Routes` and `shared-types` tabs to not be shown unless a service belonging to the active EDT needs the module associated with them.

Investigation against the current planning artifacts and codebase (branch `epic-2-edt-workspace-management`, all of Epic 1 `done`/merged, Epic 2 `in-progress`) found:

- Item 1, read literally ("populate on first startup"), brushes against two explicit PRD decisions: the "No guided onboarding/installation wizard" Non-Goal (§5) and the "AI-assisted per-repo manifest bootstrapping" Could-scope item deferred "until the manifest schema itself is fixed in architecture" (§6.2) — a condition now satisfied since Epic 1. Clarified with Max: the actual ask is a TUI front-end over the **already-decided** `scan`/`register` mechanism (AD-6, Story 1.5, `done`) plus a static help message — not the deferred guided wizard or AI-bootstrapping. This framing touches no PRD Non-Goal.
- Item 3 directly reverses a documented, deliberate UX decision: `EXPERIENCE.md` states verbatim, "Routes and shared-types are always-present core UI, not conditionally hidden zones... never the zone's own visibility." Confirmed with Max as an intentional reversal, refined during discussion into a two-tier rule (fully hidden only when *no registered repo anywhere* could ever use the module; disabled-with-explanation when the module exists in the registry but not in the active EDT) — closer to the original decision's spirit than a blunt hide.
- Clarifying item 3's `shared-types` gating surfaced a **separate, unrelated defect** in not-yet-built Epic 4: FR-14/Story 4.2 compare each consumer against "the latest published `shared-types` version" as a single global number. Per Max, `shared-types` version numbers are globally unique but published independently across branches — the global maximum can be functionally unrelated to the active EDT's own branch lineage (his example: global latest = 660, but the version actually relevant to the current branch = 613, because 614–660 were published from unrelated branches). As written, FR-14/FR-15 would constantly misreport "behind" status. Since Epic 4 is still `backlog` (zero code), this is corrected now rather than built wrong.

Item 2 (tab-bar arrow navigation) is a clean additive feature — no conflict with the existing canonical keybinding contract (Stories 1.13/2.7, `done`), since it's scoped to a new, distinct focus state that doesn't touch list-navigation or existing `Tab` roles inside forms/resize-mode.

## 2. Impact Analysis

**Epic impact.** Epic 1 is `done`/merged — per the precedent set by the 2026-08-19 and 2026-08-24 (Story 2.10) Sprint Change Proposals, changes are appended to the still-open Epic 2 rather than reopening Epic 1, even where the touched code (`zones.ts`, `zone-tab-bar.tsx`, `app-shell.tsx`, Stories 1.5/1.9/1.13) is architecturally Epic 1's. Epic 4 is `backlog`, not yet started — its FR/story text is corrected directly, with zero rollback risk since no code exists yet.

**Story impact.** No `done` story is rolled back. Story 1.9's AC (line ~485, "each has a placeholder screen mounted at its tab — none is missing or unreachable") needs a text correction — same pattern as the 2026-08-19 amendment to Story 1.13, a correction to match a superseding contract, not a reopening. Stories 4.1/4.2/4.3 (Epic 4, `backlog`) get AC amendments before any implementation exists.

**Artifact conflicts.**
- PRD: FR-13/FR-14/FR-15 (§4.4) revised — see §4.4 below. No Non-Goal/Out-of-Scope text changes (the registry-screen framing was deliberately kept inside AD-6's existing decision).
- Architecture (`ARCHITECTURE-SPINE.md`): no AD text changes. Two documentation-only additions: `shared-types-source` added to the module-id examples list (line 171, alongside `shared-types-consumer`/`route-explorer`); a flagged-but-undesigned technical requirement (git-ancestry version resolution) for `bmad-architecture` to specify when Epic 4 is actually built.
- UX (`EXPERIENCE.md`, `DESIGN.md`, UX Design Register inside `epics.md`): `EXPERIENCE.md:34` rewritten (two-tier hidden/disabled rule, not a blunt inversion); `UX-DR3` (4 permanent + 2 conditional tabs); `UX-DR16` (new `Left`/`Right`/`Tab`/`Esc` tab-bar keybindings); `DESIGN.md` gains a new disabled `zone-tab` visual state; `EXPERIENCE.md` line 67 (zone-tab interaction row) updated.
- `epics.md`: three new stories appended to Epic 2 (2.11, 2.12, 2.13); Story 1.9 AC text correction; Stories 4.1/4.2/4.3 AC amendments.
- No impact on deployment, IaC, or CI/CD.

## 3. Recommended Approach

**Selected approach: Option 1 — Direct Adjustment.** Three new stories appended to the open Epic 2 branch; direct FR/AC text corrections to not-yet-built Epic 4; no rollback, no PRD MVP/Non-Goal change.

**Rationale:** every item is either a UI completion of an already-decided mechanism (AD-6 registry, manifest-driven module gating), a purely additive interaction (tab-bar arrow nav), a deliberate and now-clarified UX refinement (two-tier visibility), or a pre-implementation correction to a not-yet-built epic (shared-types version resolution). None requires touching MVP scope, rolling back shipped work, or reopening a closed epic. Effort: medium (four distinct, independently-reviewable change items). Risk: low-to-medium — the disabled-tab state and the "any repo in the whole registry" check are the most delicate pieces (registry-wide manifest loading at shell level, not just active-EDT scope) and deserve explicit test coverage at build time.

## 4. Detailed Change Proposals

### 4.1 Story 2.11 — Repo Registry Screen & Manifest Onboarding Guidance

**As a** developer, **I want** a TUI screen to scan a root path for repos already carrying a manifest, register the ones I select, and see clear static guidance on creating a manifest for repos that don't have one yet, **so that** I can populate the tool's repo registry — on first use or any time later — without dropping to a separate CLI command.

**Placement:** not a 7th permanent zone. Exposed via the `:` command palette (already stubbed, Story 1.13, "wired per-zone in later epics") as a `register` command, and offered automatically from Dashboard's empty state when zero repos are registered — chaining *before* Story 2.1/UX-DR19's existing "no EDT yet" state, since EDT creation needs at least one registered+manifested repo to select from.

**Acceptance Criteria:**
- **Given** zero registered repos **When** the TUI launches **Then** Dashboard shows an explicit "no repos registered yet" prompt (never a bare empty EDT prompt), offering to open the registry screen.
- **Given** the registry screen **When** opened **Then** it always shows static manifest-creation guidance (manual `.tui-back.yaml` per the Story 1.4 schema, or run the manifest-generator skill in the target repo) alongside the scan/register controls — not just on first launch.
- **Given** a root path **When** the developer triggers a scan **Then** it lists every candidate manifest-carrying directory found (Story 1.5's `scan`, AD-6), via `checkbox-list-item` (UX-DR9) for multi-select.
- **Given** one or more candidates selected **When** confirmed **Then** each selected path is registered (Story 1.5's `register`) and the outcome is reported per-path (registered / already-registered / failed).
- **Given** a scan finds nothing **When** displayed **Then** it's a distinct "no manifest-carrying repos found here" state — never indistinguishable from a scan failure.
- **Given** this screen **When** exercised via keyboard only **Then** every action is reachable without a mouse (Story 1.9's standing rule).

**Implementation notes:** reuses Story 1.5's existing `scan`/`register` use-cases — no new port/adapter. The exact manifest-generator skill invocation text is to be verified at build time (not present in this repo's installed `.claude/skills/` at the time of this analysis).

### 4.2 Story 2.12 — Zone-Tab Bar Focus & Arrow Navigation

**As a** developer, **I want** to move keyboard focus onto the zone-tab bar with `Tab` and navigate it with the left/right arrows, **so that** I can switch zones without memorizing or reaching for the single-letter mnemonics.

**Acceptance Criteria:**
- **Given** content focus (default, no form/resize-mode active) **When** `Tab` is pressed **Then** focus moves to the zone-tab bar, highlighting the currently active zone's tab.
- **Given** the tab bar is focused **When** `Left`/`Right` is pressed **Then** the highlight moves to the previous/next *reachable* zone tab (wraps at the ends; skips fully-hidden tabs per Story 2.13, lands on disabled ones) — the active zone's content is not switched yet.
- **Given** the tab bar is focused, a different tab highlighted **When** `Enter` is pressed **Then** the app switches to that zone (same effect as its mnemonic) and focus returns to content.
- **Given** the tab bar is focused **When** `Esc` or `Tab` is pressed again **Then** focus returns to content, active zone unchanged.
- **Given** a form is open or resize-mode (`Ctrl+W`) is active **When** `Tab` is pressed **Then** it keeps its existing role (field/boundary cycling) — the tab bar never gains focus in this state; Story 2.7's AC stays true, unamended.
- **Given** any focus state **When** a zone mnemonic (`d/e/u/l/r/s`) is pressed **Then** it switches zones immediately as today — unaffected by this story.

**Artifacts to amend:** `UX-DR16` (keybinding contract), `EXPERIENCE.md` line 67 (`zone-tab` interaction row).

**Implementation notes:** new shell-level focus state (e.g. `shellFocus: 'content' | 'tab-bar'` + `highlightedZone`) in `app-store`/`AppShell`. No core/port change — `adapters/driving/tui` only.

### 4.3 Story 2.13 — Manifest-Gated Zone Tab Visibility & Disabled State (Routes & shared-types)

**As a** developer, **I want** `Routes` and `shared-types` to disappear only when no registered repo anywhere could ever use them, and otherwise show as disabled with a clear reason when my active EDT just doesn't need them right now, **so that** the tab bar never lies about what's possible, while still decluttering when a capability is genuinely absent from my machine's registry.

**Acceptance Criteria:**
- **Given** zero repos in the entire registry activate a route-explorer module **When** the tab bar renders **Then** `Routes` is fully omitted — mnemonic and arrow-navigation never land on it. Same rule for `shared-types` if zero registered repos declare `shared-types-source` or `shared-types-consumer`.
- **Given** at least one registered repo activates the module, but the active EDT has no qualifying member **When** the tab bar renders **Then** the tab is shown in a distinct disabled visual state (dimmed/strikethrough — new `ZoneTabState` variant, new `DESIGN.md` token).
- **Given** a disabled tab **When** reached (mnemonic, or `Left`/`Right`+`Enter` on a focused tab bar) **Then** it becomes the active zone and shows a single explanatory message instead of the normal zone screen — e.g. `Routes`: *"Aucun de vos services dans cet EDT ne contient de routes ! Les repos avec des routes sont : `api-gateway`, ..."*; `shared-types`: *"Le repo `shared-types` (qui importe le module `shared-types-source`) ne fait pas partie de votre EDT actif."*
- **Given** a fully-omitted tab **When** its mnemonic is pressed or the tab bar is arrow-navigated **Then** it is skipped entirely — never landed on, unlike the disabled case.
- **Given** the active EDT's membership changes **When** a tab's enabled/disabled state changes as a result **Then** the tab bar updates immediately; if the currently active zone becomes disabled, its content switches to the explanatory message in place — no forced navigation away.
- **Given** the repo registry changes (Story 2.11) **When** that changes whether any repo anywhere has the module **Then** a tab can newly appear or disappear entirely; if the active zone's tab disappears this way, the app falls back to Dashboard.

**Artifacts to amend:** `EXPERIENCE.md:34` (two-tier rule, not a blunt inversion), `UX-DR3` (4 permanent + 2 conditional), Story 1.9 AC (line ~485, text correction), `DESIGN.md` (disabled `zone-tab` state).

**Implementation notes:** the registry-wide check requires loading manifests for *all* registered repos (not just active-EDT members) at shell level — verify this doesn't complicate the cold-load spinner state (UX-DR19).

### 4.4 PRD §4.4 — FR-13/FR-14/FR-15 correction (Epic 4, `backlog`)

**FR-14 — OLD:**
> The tool shows, for the active EDT's member services, which are on the latest published `shared-types` version and which aren't — without the developer checking any repo by hand.
> - Status reflects the latest published version, not a cached one, at the moment it's viewed.

**FR-14 — NEW:**
> The tool shows, for the active EDT's member services that declare themselves a `shared-types` consumer, whether they're on the version most recently published from the **active EDT's own `shared-types` branch** — resolved by walking that branch's git ancestry (tags/commits reachable from its tip), **never** by comparing against the single highest version number across all branches, since version numbers are globally unique but branch-independent: a branch's own newest relevant version can sit far behind the global maximum.
> - Status reflects the branch-relevant latest version, resolved live via git ancestry at view time — never cached, never the global maximum across unrelated branches.
> - Unavailable when the active EDT doesn't include the `shared-types` repo itself as a member (ties to Story 2.13's disabled-tab rule).

**FR-13 — addition:**
> - On success, the tool immediately offers propagation to the active EDT's eligible consumer members (one, several, or all) in the same flow, chaining into FR-15 — no separate manual step to find the propagate action. Propagation remains independently triggerable later (e.g. a newly added consumer catching up).
> - Publish is offered only when the active EDT includes the `shared-types` repo itself as a member, identified via a new `shared-types-source` manifest module (distinct from `shared-types-consumer`).

**Rationale:** corrects a functionally-false premise (single global "latest version") before any code is written against it, per Max's domain clarification. New module id (`shared-types-source`) makes the source repo's identity manifest-driven, consistent with AD-4/AD-5, instead of implicit/hardcoded.

**epics.md Stories 4.1/4.2/4.3 — AC amendments (mirrors above):**
- Story 4.1: + *Given a publish completes successfully → propagation to the active EDT's consumer members is offered immediately, inline*; + *Given the active EDT doesn't include the `shared-types-source` repo as a member → publish isn't offered.*
- Story 4.2: AC "shows whether it's on the latest published version or behind" → "shows whether it's on the version most recently published from the active EDT's own `shared-types` branch (git-ancestry resolved), never the global-max version."
- Story 4.3: unchanged mechanism, reframed as startable either standalone or chained from 4.1.

**Architecture doc additions (non-AD, documentation only):** `shared-types-source` added to the module-id examples in `ARCHITECTURE-SPINE.md:171` and `prd.md:105`. The git-ancestry version-resolution mechanism itself is flagged as an open technical requirement for `bmad-architecture` to specify when Epic 4 is actually built — not designed in this proposal.

## 5. Sprint Status / Backlog Update

- Add under `epic-2` in `sprint-status.yaml`, after `2-10-recover-from-an-already-running-tui-instance`:
  - `2-11-repo-registry-screen-manifest-onboarding-guidance: backlog`
  - `2-12-zone-tab-bar-focus-arrow-navigation: backlog`
  - `2-13-manifest-gated-zone-tab-visibility-disabled-state: backlog`
- `epics.md`: insert Stories 2.11/2.12/2.13 (full text above) after Story 2.10, before the `## Epic 3` heading; amend Story 1.9's AC (line ~485); amend Stories 4.1/4.2/4.3 ACs in Epic 4; amend UX-DR3/UX-DR16.
- `prd.md`: amend FR-13/FR-14 text in §4.4; add `shared-types-source` to the module-id example at line 105.
- `ARCHITECTURE-SPINE.md`: add `shared-types-source` to the module-id example at line 171.
- `EXPERIENCE.md`/`DESIGN.md`: amend per §4.2/4.3 above.

## 6. Implementation Handoff

**Scope classification: Moderate.** Spans two epics' planning text (Epic 2 additions, Epic 4 corrections), three new stories, and several UX-document amendments — more than a single-file-pair Minor change, but no MVP/Non-Goal/epic-sequencing change requiring PM/Architect strategic replanning.

**Route to: Product Owner / Developer (`bmad-sprint-planning` for backlog wiring, `bmad-build` / `bmad-agent-dev` for implementation).** Stories 2.11–2.13 branch from `epic-2-edt-workspace-management` individually, per `CLAUDE.md`'s one-branch-per-story convention, each independently since they touch mostly-disjoint files (2.11: new registry screen + command palette; 2.12: `app-shell`/focus state; 2.13: `zone-tab-bar` + zone visibility derivation — 2.12 and 2.13 both touch `zone-tab-bar.tsx`/`app-shell.tsx` and should be sequenced, not parallelized, to avoid merge friction). The Epic 4 FR/story corrections need no immediate branch — they're planning-text-only until Epic 4 starts; when it does, `bmad-architecture` should specify the git-ancestry version-resolution mechanism before `bmad-build` implements Story 4.2.

**Success criteria:** all ACs above hold per story; `npm test && npm run typecheck && npm run depcheck` green on each; Story 1.9's existing AC test coverage updated to match the corrected text (not left green-but-contradicting, per the Story 2.10 precedent's own success-criteria pattern).
