---
date: 2026-09-28
trigger: 'While reviewing Story 2.37 (wizard Step 3), Max asked that (1) each service manifest, not a hardcoded list, define its own protected branches, and (2) the UI warn about branches already used by another EDT. Reusing such a branch — and above all renaming it — silently breaks the EDT that depends on it.'
mode: batch
epic_impact: 'Epic 2 (in-progress) — two new stories appended at the end (2.42, 2.43). PRD FR-7, Architecture AD-4 and AD-8, and EXPERIENCE.md are amended. No new epic, no story re-sequenced.'
scope_classification: moderate
---

# Sprint Change Proposal — 2026-09-28

## 1. Issue Summary

**Trigger.** The trigger came up during the Story 2.37 review, when the FR-7 check was moved into `src/core/edt/shared-branches.ts`. Two gaps surfaced.

**P1 — The protected-branch set is hardcoded.**
- Today FR-7 protects `development`/`preprod`/`prod` (the `SHARED_BRANCHES` constant) plus the manifest `sharedBranch`, the same way for every service.
- Services do not share one branching model, and the manifest is the tool's only per-repo configuration surface (AD-4).
- Max's decisions:
  - A new optional manifest field `protectedBranches: [development, preprod, prod]` **replaces** the fixed list.
  - `sharedBranch` is **always** protected.
  - When the field is **absent**, **only** `sharedBranch` is protected.

**P2 — Branches used by another EDT are invisible when choosing, and renaming one is not gated.**

| # | Where | What happens today | Consequence |
|---|---|---|---|
| G1 | Every branch chooser: wizard Step 3 box, `BranchPicker` in Modify / Add-to-EDT / service actions | The candidate list does not show which branches are already some other EDT's own branch | The developer only finds out at submit time, through a `branch-owned-by-other-edt` per-repo failure (Story 2.25), or not at all (G2). |
| G2 | `renameMemberBranch` (`src/core/edt/modify.ts`, Add-to-EDT picker rename pre-step) and the git adapter's `renameBranch` | The old name is checked only against the shared set, never against other EDTs' ownership | Renaming a branch that another EDT registered makes that EDT point at a branch that no longer exists. That EDT is broken (its switch and update fail) with no warning. |

Attaching an owned branch is already refused by core: `assertAllowedBranch(…, edtId)` in `create.ts` (existing plan) and in `modify.ts` (`setBranches`). The gap is **visibility before choosing (G1)** and the **ungated rename (G2)**.

## 2. Impact Analysis

- **Epic 2:** two stories appended.
  - **2.42** — manifest-defined protected branches.
  - **2.43** — cross-EDT branch-usage alerts and rename gate.
  - Both sequence after **2.37**, whose `shared-branches.ts` and Step 3 checks they build on. They are placed at the end of the epic, after 2.41, as Max asked.
  - Stories 2.38–2.41 are unchanged. 2.41's inline FR-7 check will call the core helper, so it picks up 2.42's rule automatically.
- **Other epics:**
  - Epic 3's group-update path goes through the same gate (`assertAllowedBranch`), so it inherits the new rule with no change.
  - Epics 4–6 are not impacted.
- **PRD:** FR-7 is amended with the new definition of "protected" and a cross-EDT consequence. The MVP is unaffected.
- **Architecture:** AD-4 (new optional manifest field) and AD-8 (gate rule text, rename gate) are amended.
- **UX:** in `EXPERIENCE.md`, the "Shared-branch rejection" row is amended, and a new "Branch used by another EDT" pattern is added for branch choosers.
- **Other artifacts:**
  - The `manifest-generator` skill should emit `protectedBranches: [development, preprod, prod]` by default. Otherwise existing and new manifests silently lose `preprod`/`prod` protection.
  - Existing managed repos need that line added by hand. This is listed as a rollout step for 2.42 below.
- **Technical:**
  - Manifest schema and `Manifest` type.
  - `core/edt/shared-branches.ts`, whose signature changes.
  - Git adapter gate and `renameBranch`, plus the `GitPort.renameBranch` signature (an optional owner EDT id).
  - `ServiceBranchDivergence` gains `protectedBranches`.
  - `BranchAutocompleteInput` gains an optional generic per-branch annotation.

## 3. Recommended Approach

**Direct Adjustment:** two new stories in the current epic.
- No rollback is needed. No MVP change.
- **Effort:** 2.42 is Low–Medium; 2.43 is Medium (touches three choosers plus a core gate).
- **Risk:** Low. Core stays authoritative, and the UI checks mirror it.
- **Timeline:** adds two stories to the epic 2 tail.

**Rationale.**
- P1 extends AD-4's principle, "the manifest is the only per-repo activation surface".
- P2 closes a real data-integrity hole (G2) and turns a late failure into an upfront signal (G1).

**Behavior choice (confirmed by Max 2026-09-28: block).** A branch owned by another EDT stays **refused**, not merely warned about, both for attaching and for renaming. This is consistent with AD-8's existing cross-EDT rule. The "alert" is the annotation shown **before** choosing, plus an inline refusal that explains which EDT would break.

## 4. Detailed Change Proposals

### 4.1 PRD — FR-7 (`prds/prd-tui-back-2026-08-10/prd.md`)

OLD:
> Assigning a shared/protected branch (`development`, preprod, prod) as an EDT's "own" branch for a service is rejected.
>
> **Consequences (testable):**
> - Attempting to register a protected branch to an EDT fails with a clear explanation, before any git write happens.

NEW:
> Assigning a protected branch as an EDT's "own" branch for a service is rejected. A service's protected branches are the ones its manifest lists in `protectedBranches`, plus its `sharedBranch`, which is always protected. Without `protectedBranches`, only `sharedBranch` is protected.
>
> **Consequences (testable):**
> - Attempting to register a protected branch to an EDT fails with a clear explanation, before any git write happens.
> - Renaming a protected branch, in either direction, is refused.
> - A branch registered as another EDT's own branch for that service can be neither attached nor renamed. Every branch chooser shows which EDT uses it before the developer picks it.
>
> > Amended 2026-09-28 (Sprint Change Proposal, Stories 2.42–2.43): the fixed `development`/preprod/prod set is replaced by the per-service manifest list, and the cross-EDT consequence is added.

The `(development, preprod, prod)` mentions elsewhere in the PRD (the §4.2 summary and the constraint "An EDT must never register a shared branch as its own (FR-7)") stay valid by reference to FR-7. No edit is needed there.

### 4.2 Architecture (`architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md`)

**AD-4 rule.** Insert after "optional `sharedBranch` (default `development` — FR-8),":
> optional `protectedBranches` (a list of branch names the tool must never claim for an EDT — FR-7; absent means only `sharedBranch` is protected),

**AD-8 rule.**

OLD:
> rejects — before any `git` invocation — a write targeting `development`/preprod/prod or any branch not the current EDT's own registered branch for that service.

NEW:
> rejects — before any `git` invocation — a write targeting a protected branch of that service (its manifest `protectedBranches` ∪ `sharedBranch`, resolved from the manifest at write time), any branch not the current EDT's own registered branch for that service, or a rename whose old or new name is registered as another EDT's own branch.

Plus the note: `> Amended 2026-09-28 (Sprint Change Proposal, Stories 2.42–2.43).`

### 4.3 UX (`ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md`)

**State row "Shared-branch rejection"**: replace "(`development`, preprod, prod)" with "(the service manifest's `protectedBranches`, plus its `sharedBranch`; Story 2.42)".

**New state row after "Branch already claimed by another EDT":**
> | Branch used by another EDT (chooser) | In every branch chooser (wizard Step 3 table and "Configurer" box, BranchPicker pick-existing / rename-current), a branch that is another EDT's own branch for that service is annotated `⚠ EDT « <topic> »` (glyph + warning color, never color alone). Choosing it to attach, or renaming it, is refused inline: "utilisée par l'EDT « <topic> » — la reprendre ou la renommer casserait cet EDT". Core refuses it too, so the inline check only surfaces the rule earlier (Story 2.43). |

### 4.4 Epics (`epics.md`)

**Requirements inventory FR-7 (L26):** replace the parenthetical with "(the service manifest's `protectedBranches` ∪ its `sharedBranch` — amended 2026-09-28)".

**Story 2.3 (L646, L654):**
- Replace "`development`/preprod/prod" with "a protected branch of that service (Story 2.42: manifest `protectedBranches` ∪ `sharedBranch`)".
- Append the note `> Amended 2026-09-28 (Sprint Change Proposal): protected set now manifest-defined, see Story 2.42.`

**New stories appended after Story 2.41:**

---

### Story 2.42: Manifest-Defined Protected Branches per Service

> Added 2026-09-28 (Sprint Change Proposal): replaces FR-7's hardcoded `development`/preprod/prod set with a per-service manifest list. Sequenced after Story 2.37, which moved the rule into `src/core/edt/shared-branches.ts`.

As a developer onboarding services that follow different branching models, I want each service's `.tui-back.yaml` to declare which branches are protected, so that the tool guards exactly that service's release branches instead of a fixed list that fits no one exactly.

**Acceptance Criteria:**

**Prerequisite (blocking) — Given** the story starts **When** the developer begins **Then** confirm Story 2.37 is `done` and merged into the epic branch (`src/core/edt/shared-branches.ts` present); otherwise **HALT**.

**Given** a manifest **When** loaded **Then** it accepts an optional `protectedBranches: string[]` (each entry trimmed, non-empty; duplicates tolerated). A malformed value (not a list, an empty string) is a manifest validation error, reported like any other schema error (Story 1.4). The `Manifest` type gains `protectedBranches?: string[]`.

**Given** a service **When** its protected set is computed **Then** it is exactly `protectedBranches ∪ {sharedBranch}`. `development`/`preprod`/`prod` are no longer protected implicitly. Without `protectedBranches`, only `sharedBranch` is protected (and `sharedBranch` itself still defaults to `development`).

**Given** any git write, rename or registration **When** the gate runs (`assertAllowedBranch`, `createBranch`, `renameBranch` old and new names, `createTrackingBranch`) **Then** it uses that service's manifest-defined set, resolved from the manifest at write time (AD-8), through the single core helper `isProtectedBranch(name, manifest)` that replaces `SHARED_BRANCHES`/`isSharedBranch`. No hardcoded branch list remains in `src/`.

**Given** the create wizard (Step 3 rows and the "Configurer" box) and every other inline FR-7 check **When** they judge a name **Then** they use the same helper with that service's own manifest data. `ServiceBranchDivergence` (`core/edt/list.ts`) carries `protectedBranches` next to `sharedBranch`.

**Given** a rejection **When** shown **Then** the message names the branch and says it is protected by that service's manifest (e.g. `Branch "preprod" is protected by svc-a's manifest`).

**Given** the `manifest-generator` skill **When** it writes a manifest **Then** it emits `protectedBranches: [development, preprod, prod]` by default (documented in its field table) so new manifests keep today's protection.

**Rollout note (not code):** existing managed repos keep working, but without the new line only their `sharedBranch` stays protected. Add `protectedBranches: [development, preprod, prod]` to each existing `.tui-back.yaml` to keep today's behavior.

**Implementation notes:**
- Schema change in `adapters/driven/manifest/schema.ts`.
- The gate in `adapters/driven/git/index.ts` reads `loaded.data`.
- Hardcoded `['development', 'preprod', 'prod']` fixtures in the git adapter and `create.test.ts` become manifest fixtures.

---

### Story 2.43: Cross-EDT Branch Usage — Alerts in Branch Choosers & Rename Gate

> Added 2026-09-28 (Sprint Change Proposal): makes another EDT's ownership of a branch visible before it is chosen, and closes the ungated rename of such a branch. Sequenced after Story 2.37 (Step 3 table and box). Independent of 2.42.

As a developer choosing or renaming a branch, I want to see which branches another EDT already relies on, and be stopped before I take or rename one, so that working in one EDT can never silently break another.

**Acceptance Criteria:**

**Prerequisite (blocking) — Given** the story starts **When** the developer begins **Then** confirm Story 2.37 is `done` and merged into the epic branch; otherwise **HALT**.

**Given** a rename of branch `old` → `new` in repo R **When** the git adapter's `renameBranch` runs **Then**, besides the FR-7 checks, it rejects with `branch-owned-by-other-edt` when `old` or `new` is registered as the own branch of an EDT other than the caller's. `GitPort.renameBranch` gains an optional `edtId`; with no `edtId`, any registered owner blocks. Callers pass their EDT:
- `modify.ts` rename → the target's ulid;
- `renameMemberBranch` (Add-to-EDT) → the target EDT's ulid;
- `create.ts` existing + rename → the new EDT's ulid;
- `create.ts` rollback → the new EDT's ulid.

This happens before any `git` invocation (AD-8).

**Given** a pure helper `branchOwners(edts, repoPath, branch, excludeUlid)` → the owning EDT topics (paths compared after `resolve()`, like the gate) **When** any branch chooser lists candidates **Then** every candidate owned by another EDT is annotated `⚠ EDT « <topic> »` (glyph + warning color). The candidates owned by the EDT being edited, or none when creating, are excluded. The choosers covered:
- the wizard Step 3 "Configurer" box (existing-branch and base fields);
- the `BranchPicker` pick-existing list (Modify, Add-to-EDT, service actions).

`BranchAutocompleteInput` gains an optional generic `annotations?: Record<branch, string>` prop and stays EDT-agnostic.

**Given** the wizard box, or `BranchPicker`, **When** the developer applies an owned branch as an existing branch, with or without rename, or renames a member's current branch that another EDT also owns **Then** it is refused inline with `utilisée par l'EDT « <topic> » — la reprendre ou la renommer casserait cet EDT`. A Step 3 row carrying such a plan shows the same error and blocks `Ctrl+N`.

**Given** a branch used only as a **base** (create a new branch from it) **When** it is owned by another EDT **Then** it is annotated but allowed, since creating from it never modifies it.

**Given** core **When** reached with an owned branch anyway (CLI, stale UI) **Then** the existing `branch-owned-by-other-edt` failure (Story 2.25 assisted resolution) is unchanged.

**Implementation notes:**
- The owners come from the store's loaded `edts` list: members carry `{repoPath, branch}`. No new port.
- Tests:
  - adapter `renameBranch` owner checks (old and new name, with and without `edtId`);
  - `branchOwners`;
  - the annotation rendering;
  - inline refusals in the wizard box and in `BranchPicker`.

---

### 4.5 Sprint status (`implementation-artifacts/sprint-status.yaml`)

Append under epic-2, after `2-41-…`:
```yaml
  2-42-manifest-defined-protected-branches-per-service: backlog
  2-43-cross-edt-branch-usage-alerts-branch-choosers-rename-gate: backlog
```
plus a dated comment line referencing this proposal.

### 4.6 Tooling (`.claude/skills/manifest-generator/SKILL.md`)

This is done by Story 2.42's AC, not in this proposal. The skill's field table and both examples gain `protectedBranches: [development, preprod, prod]`.

## 5. Implementation Handoff

- **Scope: Moderate.** Backlog addition plus PRD, architecture and UX amendments, all applied now by the Developer agent (this workflow). Implementation goes through `bmad-build` story by story.
- **Order:**
  1. Finish and merge 2.37.
  2. Build 2.42 and 2.43 at the end of the epic, after 2.41 (2.43 may go first — it does not depend on 2.42).
- **Epic context:** `epic-2-context.md` must be recompiled (planning docs change). `bmad-build` does this automatically, because the planning files will be newer.
- **Success criteria:**
  - No hardcoded protected list remains in `src/`, and the protected set follows the manifest.
  - No path can rename a branch owned by another EDT.
  - Every branch chooser shows another EDT's ownership before a choice is made.
  - Full test suite, typecheck and depcheck are green.

## 6. Approval

Approved by Max on 2026-09-28 (batch mode). Cross-EDT ownership is **blocked**, not merely warned about. The edits in §4.1–4.5 were applied on `epic-2-edt-workspace-management`.
