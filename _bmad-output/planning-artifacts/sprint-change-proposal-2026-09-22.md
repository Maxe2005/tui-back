---
date: 2026-09-22
trigger: 'Real-usage report from Max: switching EDT produced a wall of per-repo failures ("No .tui-back.yaml found", "Unknown module id") for repos unrelated to the switch, traced to `registry.yaml` accumulating stale entries with no way to remove them.'
mode: batch
epic_impact: 'Epic 2 (in-progress) — one new story appended (2.33). No epic redefinition, no PRD/FR change, no architecture rework.'
scope_classification: minor
---

# Sprint Change Proposal — 2026-09-22

## 1. Issue Summary

Max reported a wall of per-repo error lines while switching EDT (`edt switch`), including
`No .tui-back.yaml found in <path>` for several registered paths and `Unknown module id
"route-explorer"` for another — none of them related to the EDT actually being switched to.

Traced against the code (not just the symptom):

- `switchActiveEdt` (`src/core/edt/switch.ts:137-145`) iterates **every** path in
  `registry.list()`, not just the target EDT's members — every non-member managed repo is put
  back on its `sharedBranch` (FR-8), which requires loading its manifest. A registered path whose
  repo no longer exists, or whose `.tui-back.yaml` was deleted, fails that load and surfaces as a
  `failed` row on *every single switch*, forever, until the entry is somehow removed.
- `RegistryPort` (`src/core/ports/registry.ts`) exposes `list/add/exists/scan/reset` — no method
  to remove a single entry. `reset` only replaces the whole `registry.yaml` wholesale, for
  corrupt-file recovery (`adapters/driven/registry/index.ts:103-151`); it explicitly refuses to
  run against a *valid* file (`registry-not-corrupt`), so it cannot be used to prune one bad path
  out of an otherwise-healthy registry.
- The TUI's REPO REGISTRY screen (Story 2.11, `repo-registry-screen.tsx`) only supports
  scan+register — no deregister action exists anywhere in the app, CLI or TUI.

This is not a newly-discovered defect: it was named at Story 1.5's own code review
(`deferred-work.md`, "Deferred from: code review of 1-5-explicit-repo-registry.md") —
"`RegistryPort` has no unregister/remove: dead/replaced paths accumulate in `registry.yaml`
forever; nothing prunes them. **Track:** the story where registry editing (unregister) is in
scope" — and again by Story 2.25's own acceptance criteria (`epics.md`), which built an
extensible per-error-code assisted-resolution registry for the EDT zone's failure list and
explicitly called out "stale-registry re-registration" as a future entry, naming the exact two
stale-registry lines from Max's debug log as "environmental/registry-hygiene issues, explicitly
out of scope for this story." Both deferrals point at the same unbuilt capability; this proposal
is the story that closes it.

## 2. Impact Analysis

### Epic Impact

Epic 2 (`in-progress`) absorbs one new story, **2.33**, appended after 2.32 — same "branch still
open" precedent as 2.10/2.11/2.12/2.16/2.20/2.21/2.27-2.32. No other epic affected; no epic
redefinition.

### Story Impact

| Story | Change |
|---|---|
| 2.33 (new) | `RegistryPort` gains `remove(path)`; new core use-case `core/scripts/clean-registry.ts` classifies unreachable / manifest-not-found registry entries as stale candidates (explicitly excluding other manifest-load errors, e.g. `unknown-module`, which stay Story 2.28's territory); CLI `registry clean` and a new TUI action on the REPO REGISTRY screen list candidates and require explicit confirmation before removing any of them; a candidate still recorded as an EDT member is flagged but not blocked, and `edts.yaml` is never written by this story. |

No existing story is amended — `switchActiveEdt`'s per-repo failure surfacing (Story 2.4's review
patch) and its structured display (Story 2.25) are both correct as shipped; this story gives the
developer a way to make the underlying cause (a stale registry entry) go away, rather than
changing how the failure is reported.

### Artifact Conflicts

- **PRD:** no conflict, no new FR. The managed-repo registry (`register`/`scan`/`list-repos`) was
  never mapped to a numbered FR in the first place — Story 2.28 (registry validation, `backlog`)
  sets the precedent that registry-hygiene stories extend Epic 2's foundation without needing one;
  this story follows the same precedent. MVP scope (§6) unchanged.
- **Architecture:** additive only, no `core → adapters` boundary risk (AD-1):
  - `core/ports/registry.ts` gains `remove(path): Promise<Result<void>>`; `adapters/driven/
    registry/index.ts` gains `removeRegistry`, same read-modify-write shape as `addRegistry`.
  - `core/scripts/clean-registry.ts` — new read-then-act use-case, same two ports (`registry`,
    `manifest`) as `list-repos.ts`, plus a read of `edtRegistry` purely for the AC6 display note.
  - No new SQLite schema, no new XDG path, no new driving adapter.
- **UX (`epics.md`/`EXPERIENCE.md`):** the EDTs zone's State Patterns table (`EXPERIENCE.md`) gains
  one descriptive row once this story is implemented — "Stale registry entry" — naming a
  `manifest-not-found`/unreachable failure during switch/create/modify as a distinct, expected
  state (Story 2.25's structured display already renders it; this row just names it, mirroring the
  "Branch already claimed by another EDT" row Story 2.25 itself added), pointing at `:registry` →
  "Clean stale entries" as the resolution. Left for the implementing story to apply, same as Story
  2.27-2.32's UX-DR20/UX-DR27 impact was described but not literally edited by their own proposal.
- **Tests:** new unit tests for `clean-registry.ts`'s classification (unreachable vs.
  manifest-not-found vs. "neither, leave alone" for other manifest errors); adapter test for
  `removeRegistry` (present/absent path, concurrent-write shape mirroring `addRegistry`'s existing
  TOCTOU caveat — already tracked, not newly introduced); CLI black-box test for `registry clean`
  (AD-3 envelope); TUI interaction test for the new registry-screen phase.
- **`deferred-work.md`:** the Story 1.5 review entry ("`RegistryPort` has no unregister/remove")
  gets a `tracked_by: Story 2.33` annotation (applied below), not yet `resolved_by` — that lands
  once 2.33 actually ships.

### Technical Impact

One new `RegistryPort` method, one new core use-case, one new CLI subcommand, one new TUI screen
action. No Docker/process-control adapter touched, no lock/SQLite change. Same risk profile as
Story 2.28 (its sibling registry-hygiene story) — smaller, since removal has no external-service
check to perform (no `GitPort` call needed, unlike 2.28's `sharedBranch`-existence check).

## 3. Recommended Approach

**Direct Adjustment (Option 1) — viable, effort Low-Medium, risk Low.**

- Add Story 2.33 next in Epic 2's backlog — self-contained, depends on nothing else in-flight
  (2.27-2.32 are all independent of it), and nothing in 2.1-2.32's shipped work needs to change.
- No rollback considered — this closes a gap that predates every currently-open story.
- No PRD/MVP review needed — no FR, no scope change, a straightforward capability addition to the
  registry foundation Story 1.5/2.11/2.28 already established.

**Why Minor, not Moderate:** one new story, no new FR, no architecture rework, no cross-story
amendment — a standard next-in-sequence backlog append, unlike the 2026-09-16 proposal's six-story/
one-FR batch that genuinely needed backlog reorganization.

## 4. Detailed Change Proposals

### `epics.md` — new Story 2.33 (inserted after Story 2.32, before "## Epic 3")

### Story 2.33: Registry — Deregister Stale, Unreachable, or Unmanaged Repos

> Added 2026-09-22 (Sprint Change Proposal): closes a gap flagged since Story 1.5's own code
> review (`deferred-work.md`: "`RegistryPort` has no unregister/remove: dead/replaced paths
> accumulate in `registry.yaml` forever; nothing prunes them ... the story where registry editing
> (unregister) is in scope") and named again by Story 2.25's acceptance criteria, which explicitly
> listed "stale-registry re-registration" as a future assisted-resolution action out of that
> story's scope. Confirmed in real usage: `switchActiveEdt` (`core/edt/switch.ts`) walks every
> path in `registry.list()`, not just the target EDT's members — a registered path whose repo no
> longer exists, or whose `.tui-back.yaml` was removed, surfaces a `failed` row on every single
> `edt switch`, regardless of which EDT is being switched to.

As a developer, I want to review and remove stale entries from the managed-repo registry — a path
that no longer exists on disk, or one whose `.tui-back.yaml` is gone — so that a repo I deleted or
deliberately un-managed stops generating a `failed` row on every EDT switch, without me
hand-editing `registry.yaml`.

**Acceptance Criteria:**

**Given** `RegistryPort` **When** extended **Then** it gains `remove(path): Promise<Result<void>>`
(adapter: `removeRegistry` in `adapters/driven/registry/index.ts`, same read-modify-write shape as
`addRegistry`) — a targeted single-path removal, distinct from `reset` (whole-file replacement for
corrupt-registry recovery only); removing a path not currently registered is a no-op success, not
an error.

**Given** a new core use-case (`core/scripts/clean-registry.ts`, mirroring `list-repos.ts`'s
shape) **When** run **Then** it classifies every registered path into exactly the two "stale"
categories `list-repos`/`listEdtBranchesDivergence` already compute today: `unreachable`
(`registry.exists()` returns `false`) and `manifest-not-found` (`manifest.load()` fails with that
exact code) — never any other manifest-load error (invalid YAML, schema failure,
`unknown-module`), which stay a manifest-content problem (Story 2.28's territory), not a
registry-hygiene one.

**Given** the candidate list **When** presented, via CLI or TUI **Then** removal is never automatic
or silent — every candidate is shown with its path and reason (unreachable / no manifest) before
anything is removed, and an explicit confirmation (or explicit per-path selection) is required; a
run that finds zero candidates reports that explicitly, never silently exiting.

**Given** the CLI **When** a `registry clean` invocation lists candidates and confirms **Then**
each confirmed path is removed via `RegistryPort.remove`, one outcome row per path
(`removed`/`failed`), per-path failure isolation (one `remove` failure never blocks the others) —
same AD-2 script/CLI parity every other action provides.

**Given** the TUI's REPO REGISTRY screen (Story 2.11) **When** open **Then** it gains a "Clean
stale entries" action alongside scan/register(/validate, Story 2.28): running it lists candidates
as a `checkbox-list-item` list (pre-checked, same "detect → guided choice → act" convention Story
2.29's per-service disposition list already uses), and confirming removes the checked ones,
reported via the same structured per-repo outcome list Story 2.25/2.28 already use.

**Given** a stale path also recorded as a member of some EDT in `edts.yaml` **When** it is removed
from `registry.yaml` **Then** the EDT record itself is left untouched — `switch.ts`'s existing
`repo-not-registered` failed-row handling (review patch, Story 2.4) already covers a target member
no longer in the registry, so this story never writes to `edts.yaml`; the candidate list surfaces
this case with an extra note ("still a member of EDT <topic>") so the developer isn't surprised
later, but it doesn't block removal.

**Implementation notes:** `core/scripts/clean-registry.ts` takes `{registry, manifest, edtRegistry}`
and returns `{candidates: StaleRegistryEntry[]}` where `StaleRegistryEntry = {path, reason:
'unreachable' | 'manifest-not-found', memberOfEdts: string[]}` — `memberOfEdts` is populated purely
for the AC6 display note, never used to gate removal. A second exported function (or a `paths:
string[]` parameter on the same use-case) performs the confirmed removal, calling
`registry.remove(path)` per confirmed path with per-path isolation, mirroring `create.ts`'s/
`switch.ts`'s own per-repo isolation convention. CLI: `tui-back registry clean` (list-then-confirm
interactive on a TTY; `--yes` with repeated `--path <path>` flags for scripted use, consistent with
`update`'s `--all --yes` precedent). TUI: new `RegistryScreenPhase` states (`cleaning` →
`clean-results`), reusing `repo-registry-screen.tsx`'s existing candidate-list/checkbox/results
pattern (Story 1.9/2.11) rather than inventing a new component. Closes the `deferred-work.md`
"`RegistryPort` has no unregister/remove" entry (Story 1.5 review) once shipped.

### `deferred-work.md` — Story 1.5 review entry

**OLD:** `- **\`RegistryPort\` has no unregister/remove**: dead/replaced paths accumulate in
\`registry.yaml\` forever; nothing prunes them. **Track:** the story where registry editing
(unregister) is in scope.`

**NEW:** appends ` **tracked_by:** Story 2.33 (Sprint Change Proposal, 2026-09-22) — Registry:
Deregister Stale, Unreachable, or Unmanaged Repos. Item stays open until 2.33 actually lands.`

## 5. Implementation Handoff

**Scope classification: Minor.** One new story, no FR, no architecture rework — fits directly into
Epic 2's existing backlog sequencing.

**Routed to: Developer agent (`bmad-build`/`bmad-agent-dev`), direct implementation** — one branch
off `epic-2-edt-workspace-management`, per `CLAUDE.md`'s git workflow
(`story-2-33-registry-deregister-stale-unreachable-or-unmanaged-repos`).

**Suggested sequencing:** independent of every other open/backlog Epic 2 story (2.27-2.32); can be
picked up any time. Natural to sequence alongside or shortly after Story 2.28 (registry validation)
since both extend the same REPO REGISTRY screen, but neither blocks the other.

**Artifacts updated by this proposal** (checklist item 6.4):
- `sprint-status.yaml`: adds `2-33-registry-deregister-stale-unreachable-or-unmanaged-repos:
  backlog` under `epic-2`.
- `epics.md`: inserts Story 2.33 (text above) after Story 2.32, before "## Epic 3".
- `deferred-work.md`: Story 1.5 review entry annotated `tracked_by: Story 2.33` (above).

**Not updated by this proposal, left for implementation time** (same precedent as the 2026-09-16
proposal's own UX-doc handling):
- `EXPERIENCE.md`'s EDTs-zone State Patterns table — new "Stale registry entry" row, described in
  §2 above.

**Success criteria:** Story 2.33's ACs above all pass; `npm test`/`npm run typecheck`/`npm run
depcheck` stay green; no `core → adapters` boundary violation (AD-1); a repo with a genuinely
invalid (not missing) manifest is never offered for removal by this story's classification.

**Explicitly out of scope (by Max's decision during this session):**
- Wiring "deregister this repo" as an inline assisted-resolution action on a failed switch/create/
  modify row (Story 2.25's `resolveAssistedAction` registry) — a natural follow-up once 2.33 ships
  the underlying `remove` capability, but not required for 2.33 to stand on its own.
- Removing entries whose manifest fails to *load* for reasons other than `manifest-not-found`
  (invalid YAML, `unknown-module`, other schema errors) — that is manifest-content validation,
  Story 2.28's territory, not registry hygiene.
