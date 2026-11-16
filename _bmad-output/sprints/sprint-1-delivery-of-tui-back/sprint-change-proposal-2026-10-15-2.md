# Sprint Change Proposal — 2026-10-15 (2): Branch drift detection & realignment (Epic 8)

## Trigger
Repos can silently leave the branch they should be on (manual checkout, tooling, a previous operation). Today nothing flags it and fixing it means switching EDT or checking out each repo by hand.

## Decisions
- **Detect:** EDT members whose current branch differs from the branch defined for the active EDT; non-member services whose branch differs from their `sharedBranch`. Surfaced in the Dashboard Attention block.
- **Realign command + shortcut** (`:realign`, plus a Dashboard shortcut), with a selection table like the Update configuration screen:
  - global presets: *none pre-selected*, *EDT services selected*, *all services selected*;
  - per-service selection to refine.
  - the table lists **drifted services only**; presets act on those rows (default preset: the drifted EDT members).
- **Effect:** selected members go to their EDT-defined branch; selected non-members go to their `sharedBranch`.
- **Reuse** the switch logic (safety gate, dirty-work handling) and the optional post-change restart (none / simple / clean, parallel, verified) of Story 2.44.
- **Settings:** defaults for the global parameters (`realign.defaultScope`, `realign.restartMode`).

## Changes
- `epics.md`: FR-38 added (inventory + mapping); Epic 8 summary/order amended; new Stories 8.6 (detection), 8.7 (use-case + CLI), 8.8 (dialog, shortcut, settings).
- `sprint-status.yaml`: 8-6, 8-7, 8-8 added as `backlog`.

## Impact
New FR-38. No code change in this proposal. 8-7 is blocked until Story 2.44 is merged into the shared base.
