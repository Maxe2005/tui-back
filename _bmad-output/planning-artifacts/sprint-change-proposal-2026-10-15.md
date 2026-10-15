# Sprint Change Proposal — 2026-10-15: Dashboard rewrite (Epic 8)

## Trigger
Brainstorm on the Dashboard: only the banner (2.16) and the empty-registry prompt (2.11) exist; the populated state was never built, and the planned Stories 7.5/7.6 still carried scope the developer no longer wants.

## Decisions
- Role: a "should I worry about anything?" cockpit, with "enter last EDT" kept as the default action.
- Scope: the active EDT is the feature; the registry gets a summary block.
- **Dropped:** last group-update outcome (and its state persistence), background-event badges, operation-in-progress indicator.
- Read-only apart from the shared per-service actions (`Ctrl+O` open in IDE, `Ctrl+R` restart, `Ctrl+L` clean restart, Story 7.12); `Enter` opens the zone.
- Refresh on mount and `R`, with "updated Ns ago"; no live poll.
- The banner stays permanent and is never compacted; the layout adapts around it.
- Atelier language unchanged. Approved mockup: `ux-designs/ux-tui-back-2026-08-10/mockups/key-dashboard.html`.

## Changes
- `epics.md`: Stories 7.5 and 7.6 removed; Epic 7 summary/order amended; UX-DR19 rewritten; stray Dashboard-badge criterion removed from Story 7.8; references in 7.3, 7.9, 7.12 and FR-35 repointed; new Epic 8 (Stories 8.1–8.5).
- `sprint-status.yaml`: 7-5/7-6 removed; epic-8 and 8-1…8-5 added as `backlog`.
- `EXPERIENCE.md` / `DESIGN.md` / `key-dashboard.html`: Dashboard states and composition rewritten.

## Impact
No new FR. No code change in this proposal. Epic 7 loses two backlog stories; its remaining work is unaffected.
