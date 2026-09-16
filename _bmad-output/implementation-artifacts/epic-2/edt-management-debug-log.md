# EDT Management — Debug Log

Running intake of issues found while exercising the EDT management features in real conditions
(create/switch/modify/remove, branch changes, per-service actions, etc. — never really tested
end-to-end before). Opened by Sprint Change Proposal 2026-08-27, §"Debug-log process".

Not `deferred-work.md`: that file is for known, accepted debt. This file is for unsorted,
freshly-reported issues, filled in as Max reports them from real usage — one entry per report,
in the order raised. Entries are triaged together once a batch has accumulated; a `story ouverte`
entry should link to the story/spec it produced.

Status values: `à trier` (not yet looked at) / `story ouverte (2.xx)` / `pas un bug` / `corrigé`.

<!-- Entries below, newest first. -->

## 2026-09-16 — Create and Modify both dead-end when setting branches; impossible to complete

**Status:** story ouverte (2.26 amendment, 2.27) — see `sprint-change-proposal-2026-09-16.md`

**Reported:** Functional pass over Stories 2.22-2.26 (2.22/2.24/2.25/2.26 `review`, 2.23
`in-progress`) alongside a list of new capability requests. Two of the eight points turned out to
be this same underlying blocker, tested on both Create and Modify.

**Tested — Create:** Creating an EDT, selecting services, reaching the branch-setup step.

**Observed:** An error appears because the default base branch `development` was chosen but
doesn't exist in the target repo(s) — there is no way to search/pick a real branch, only a free
-text field seeded with a hardcoded default.

**Code trace (confirms this is the root cause, not a one-off):** `DEFAULT_BASE_BRANCH =
'development'` (`edt-slice.ts:27`) is sent to `createEdtAction` unchecked — `create-dialog.tsx`'s
branch-setup step never adopted Story 2.26's `BranchPicker`, and no base-branch default anywhere
in the EDT zone reads a repo's manifest `sharedBranch`.

**Tested — Modify:** Opening Modify, checking member services, picking a branch for one, then
trying to finish.

**Observed:** After selecting services, it's unclear *which* service's branch is being edited when
the branch-picker opens (no service name shown), and there's no way to set the same branch for
several newly-added members at once. Once a branch is confirmed, the dialog returns to the member
-selection screen — and this repeats indefinitely; the dialog can never be completed from there.

**Code trace:** `BranchPicker`/`ModifyDialogView` never render which `repoPath`/service the open
session is for. `resolveModifyEnterAction` (`edts-zone.logic.ts:604`) routes `Enter` on the
members list to "open the branch picker" for *any* currently-checked row — since existing members
start checked, the cursor almost never lands on a row where `Enter` submits; the only way out is
the undocumented "Tab to Topic, then Enter" path.

**Resolution:** Story 2.26 amended in place (2 new ACs: branch-picker session names its target
service in the modal title; members-list `Enter` only opens the branch-picker for a newly-checked,
not-yet-member row — an already-a-member row submits the form instead). Story 2.27 (new) gives
Create the same `BranchPicker` plus a manifest-`sharedBranch`-aware base-branch default, closing
the Create-side blocker. See `sprint-change-proposal-2026-09-16.md` for the full analysis.

## 2026-08-27 — Branch editing needs 3 explicit modes (pick existing w/ search, create new, rename current)

**Status:** story ouverte (2.26) — see `sprint-change-proposal-2026-08-28-2.md`

**Reported:** Currently the only way to set a branch (in "Change branch for this EDT", "Add to
EDT", and the Modify member checklist once it gets a branch step) is one free-text field you type
a name into blind (see cursor-visibility entry below). Max wants three explicit, distinct ways to
land on a branch:
1. Pick an already-existing branch from a list, searchable/filterable as you type.
2. Create a brand-new branch (current behavior, minus the blind-typing problem).
3. Rename the branch currently active for that service in this EDT (or one picked via #1).

**Notes:** Larger in scope than the other entries here — likely its own story once triaged (new
list/search UI over `git`'s branch list, a mode switch in the dialog, a rename operation that
doesn't exist yet in `core/edt`). Depends on the cursor-visibility fix and probably folds in the
"no branch step at all" gaps from the two entries below (Modify checklist, EDT creation).

## 2026-08-27 — No visible cursor when editing a branch (or any) text-input field

**Status:** story ouverte (2.23) — see `sprint-change-proposal-2026-08-28-2.md`

**Tested:** Pressing `Enter` on a member row in the EDT SERVICES pane → "Change branch for this
EDT" → typing to edit the branch value.

**Observed:** The branch *is* editable — typing does change it — but there's no cursor/caret shown
anywhere, so it's impossible to tell where you are in the text or that the field is live at all
without typing blind and checking after the fact.

**Code trace, confirms this is universal, not just this one dialog:** `nextTextInputValue()`
(`edts-zone.tsx`) is a plain append-at-end/backspace-at-end string editor with no cursor-position
tracking (arrow keys are absorbed as no-ops, not used to move a cursor), and every text-input field
renders as bare `<Text>{label}: {value}</Text>` (topic in Create/Modify, branch in
service-actions/Modify/Add-to-EDT) — none of them append a cursor glyph. Same root cause as the
"Add to EDT doesn't visibly offer a branch choice" entry below — that one is this same bug, just
first noticed on a field that also lacked any hint text on top of it.

## 2026-08-27 — Modify EDT: checking a new member never offers a branch, silently defaults to whatever it's currently on → collision

**Status:** story ouverte (2.24) — see `sprint-change-proposal-2026-08-28-2.md`

**Tested:** Opening Modify on EDT "pronote2", checking `api-gateway` (previously unchecked) as a
new member alongside already-member `micro-external` (which already shows an explicit branch:
`feat/IWR-4055/Pronote-previsionel-presences`), then submitting.

**Expected:** Same as the "Add to EDT" entry below — a newly-added member should be offered a
branch to register for it, not silently inherit whatever branch happens to be checked out.

**Observed:** `api-gateway`'s checklist row shows no branch meta at all (no chooser was ever
presented for it), yet submitting fails with:
`api-gateway: Branch "feat/IWR-4055/Pronote-previsionel-presences" is already registered as a
different EDT's own branch (repo .../api-gateway)`. No resolution offered (same display/resolution
gap as the switch-EDT entry below).

**Root cause found in core (`core/edt/modify.ts`, "1. Add members" block, ~line 108-160):** when
`addMembers` includes a repo with no matching `setBranches` entry, the core reads
`git.currentBranch(resolved)` — whatever the repo happens to be checked out on right now — and
tries to register *that* as the EDT's own branch for it, gated only after the fact by
`assertAllowedBranch`. Since a repo is very often currently sitting on some other EDT's branch
(e.g. it's a member of another active/inactive EDT), this collision is not an edge case, it's the
expected outcome of checking a box without picking a branch.

**Confirms a real gap, not just a display bug:** the TUI's Modify checklist toggle (checkbox) is a
second, un-spec'd path to "add a member to an EDT" that — unlike the OTHER-SERVICES "Add to EDT"
flow (Story 2.18 AC) — never surfaces a branch step at all. Two inconsistent UI paths for the same
operation, only one of which even attempts to ask for a branch (and per the entry below, even that
one doesn't make the field's editability obvious).

## 2026-08-27 — "Add to EDT" (Enter on OTHER SERVICES) doesn't visibly offer a branch choice

**Status:** story ouverte (2.23) — same root cause as the cursor-visibility entry below; see `sprint-change-proposal-2026-08-28-2.md`

**Tested:** Focusing the OTHER SERVICES pane, pressing `Enter` on a non-member service to trigger
"Add to EDT".

**Expected:** Per Story 2.18's AC ("an 'Add to EDT' flow opens: a branch text-input pre-filled
with that service's current branch, which the developer can leave as-is or replace with an
existing or new branch name — confirming calls `modifyEdt` with both `addMembers` and
`setBranches`"), the developer should be offered a branch to associate the service with for this
EDT.

**Observed:** No branch choice is offered/perceived when going through the flow.

**Code trace (not yet run live to confirm):** the dialog state (`AddToEdtDialogState`,
`edts-zone.tsx`) does carry a `value` field pre-filled from `service.branch`, and
`handleAddToEdtInput` does let it be edited by typing before `Enter` submits — so a branch field
exists functionally. But the rendered dialog is just two static-looking lines:
```
Add {serviceName} to "{edt.topic}"
Branch: {value}
```
— no `[Enter] confirm [Esc] cancel` hint (unlike e.g. the switch-confirm dialog), no cursor/marker,
nothing distinguishing "Branch: master" from a plain label. So even if the field is technically
editable, there's no affordance telling the developer they can type over it — it reads as an
auto-added confirmation, not a choice.

**Confirmed 2026-08-27 (see "no visible cursor" entry above):** the field is editable, typing does
work — it's a pure affordance bug. No dialog in this zone renders a cursor/caret, so every
text-input field (this one included) looks like a static label until you type blind into it.

## 2026-08-27 — Switch-EDT partial failure: no resolution offered, errors dumped unreadably

**Status:** story ouverte (2.25) — see `sprint-change-proposal-2026-08-28-2.md`. The stale-registry
(`no .tui-back.yaml found`) and `micro-external` shared-branch-mismatch entries noted below stay
`à trier` as environmental/registry-hygiene, not covered by 2.25.

**Tested:** Switching active EDT (`test`) via the EDT selector's Switch dialog, in an environment
with several other managed repos in varying states.

**Expected:** Per Story 2.4 (switch without data loss) and UX-DR20 ("protected-switch-blocked
prompt", "interrupted-update recovery offer"), a partial-failure switch should tell the developer,
per repo, what went wrong and — where applicable — what to do about it (retry, force, edit the
branch, re-register the repo, etc.).

**Observed:** The dialog shows `Switched, but some repos had a problem — ` followed by every
failed repo's raw error message joined with `; ` on one wrapped line, e.g.:
- `/tmp/test-repo`: `No .tui-back.yaml found in /tmp/test-repo`
- `api-gateway`: `Branch "feat/IWR-4055/Pronote-previsionel-presences" is already registered as a
  different EDT's own branch`
- `micro-external`: `git fetch origin development failed ... impossible de trouver la référence
  distante development`
- a scratchpad temp path: `No .tui-back.yaml found in ...`

No structured breakdown, no distinction between error kinds, and no action offered for any of
them — the dialog just sits there with the error text (confirmed in code:
`summarizeFailedResults()` in `edts-zone.tsx` is a flat `map().join('; ')` over raw
`result.data.results`, fed straight into the dialog's single-line `error` string).

**Two things bundled here:**
1. **Display/UX (TUI):** the error presentation itself — one unreadable run-on line instead of a
   per-repo list, regardless of what the underlying errors are.
2. **Resolution flow (core or TUI, TBD at triage):** none of these failure kinds get any
   remediation path — spec (UX-DR20) calls out at least a "protected-switch-blocked" prompt and an
   "interrupted-update recovery offer"; neither appears here even though the branch-collision case
   (`api-gateway`) looks like exactly the protected-switch scenario.

**Notes for triage (per-repo, may not all be tui-back bugs):**
- The two `No .tui-back.yaml found` entries point at `/tmp/test-repo` and a session scratchpad
  path — look like stale/leftover registry entries from earlier manual or agent-driven testing,
  not necessarily a product bug; may just need de-registering.
- `micro-external`'s fetch of `development` failing suggests either its manifest `sharedBranch` is
  misconfigured or that repo's actual shared branch is named differently — worth checking its
  `.tui-back.yaml` before assuming a code bug.
- `api-gateway`'s "already registered as a different EDT's own branch" is the one that most looks
  like a real missing feature: the switch has no way to resolve a genuine branch collision between
  two EDTs.

## 2026-08-27 — No branch selection/creation UI at EDT creation

**Status:** story ouverte (2.22) — see `sprint-change-proposal-2026-08-28-2.md`

**Tested:** Creating an EDT via the `:` command bar (TUI create-EDT dialog).

**Expected:** Per FR-4 (epics.md) and Story 2.2 (`2-2-create-dev-branches-at-edt-creation`,
marked `done`), at EDT creation the developer should be able to have the tool create a working
branch in each selected member service, choosing a base branch (default `development`) and either
one shared branch name across all selected services or a name per service.

**Observed:** The create dialog (`edts-zone.tsx`, `CreateDialogState`) only has `topic` +
member-checklist fields. `submitCreate` calls `createEdtAction({ topic, members })` — no branch
name(s) and no base-branch are ever passed through, even though the core use case
(`core/edt/create.ts`) already exposes `CreateBranchOptions` for exactly this. So the feature
described by FR-4/Story 2.2 exists in core but has no TUI surface at all — functionality
completely missing in the TUI.

**Notes:** Story 2.2 is marked `done` in `sprint-status.yaml`; worth checking whether it was
scoped/verified against a non-TUI driving adapter (CLI) only, and TUI exposure was assumed to
come from a later story that never actually added it.
