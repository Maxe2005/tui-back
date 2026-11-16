---
title: Sprint Change Proposal — `:` Command Entry Is a Bar, Not a Direct Bind to the Registry Screen
date: 2026-08-25
status: approved
trigger_story: 2-11-repo-registry-screen-manifest-onboarding-guidance
scope: moderate
---

# Sprint Change Proposal — 2026-08-25

## 1. Issue Summary

Story 2.11 (Repo Registry Screen & Manifest Onboarding Guidance, status `review`, branch `story-2-11-repo-registry-screen-manifest-onboarding-guidance`) wired the `:` key directly to `openRegistryScreen()` (`src/adapters/driving/tui/app-shell.tsx:111-114`). Every `:` keypress now opens the repo registry overlay unconditionally.

This contradicts the keybinding contract that has stood since Story 1.13 and is repeated in `EXPERIENCE.md`'s Interaction Primitives and `UX-DR16`: `:` opens **command entry** — a generic, extensible text-input affordance, stubbed in Story 1.13 ("both stubbed here, wired per-zone in later epics"), not a single hardcoded action. Story 2.11's own spec had explicitly scoped out building that mechanism ("Never add a general-purpose command-language/registry to the `:` palette — only wire the one new command"), which was a reasonable-looking MVP simplification at spec time but produces exactly the broken behavior reported: pressing `:` always pops the same screen, with no way to type a command, no autocomplete, and no room for a second command later without another direct rebind.

Reported directly by Max after exercising the built story; confirmed by code inspection of `app-shell.tsx` and cross-referenced against `EXPERIENCE.md`/`epics.md`'s existing (and always-consistent) description of `:` as command entry.

## 2. Impact Analysis

**Epic impact:** Epic 2 (still open, same branch lineage as stories 2.7–2.13) is not derailed — no epic-level rework. Story 2.11 needed a text correction to its Implementation notes (the `:` reference was factually wrong) and a new story to carry the actual command-entry mechanism it depends on.

**Story impact:**
- **Story 2.11** — amended: its "reachable via the `:` command palette" note corrected to "reachable as a registered command in the `:` command-entry bar (Story 2.14)"; a superseding blockquote note added.
- **Story 2.14 (new)** — "Command Entry Bar (`:`) & Registered Commands": builds the actual `:` mechanism (text input, prefix-filtered command list, `Tab` autocomplete on a single match, `Enter` runs an exact match, `Esc` cancels), with the registry screen wired as its first and only registered command for now.
- **Story 2.12** (zone-tab-bar `Tab`-focus) — no code impact, but 2.14 explicitly carries an AC ensuring the command bar consumes `Tab` for autocomplete and 2.12's tab-bar-focus behavior never fires while it's open.

**Artifact conflicts:**
- PRD: none — the palette's exact mechanics were never PRD-level (FR/NFR untouched).
- Architecture: none — stays inside `adapters/driving/tui`, no new port/adapter (mirrors 2.11's own rule); no `ARCHITECTURE-SPINE.md` edit needed.
- UX (`DESIGN.md`/`EXPERIENCE.md`): real but narrow — the command bar is documented as a `modal-dialog` instance (reusing existing input/candidate-list treatment, same pattern as the `?` help screen and the registry screen itself), not a new visual component/token. New `UX-DR29`; `UX-DR27` corrected to stop naming the old (wrong) mechanism.
- Testing/CI/deployment: unaffected — same AD-13 layering (store tested directly, TUI smoke-tested via `render()`).

## 3. Recommended Approach

**Direct Adjustment** (Option 1 of the checklist): amend Story 2.11's text, add Story 2.14 to the still-open Epic 2, update `sprint-status.yaml`.

- Rollback (Option 2) was rejected: the registry screen itself is correct and wanted; only its trigger mechanism is wrong, so reverting completed work would lose value for no benefit.
- MVP/PRD scope review (Option 3) was rejected: no PRD requirement is affected; this is a UX/keybinding-contract correction, fully containable within existing scope.

**Effort:** Medium (one new small UI primitive — command dispatch table + input handling — reusing existing `modal-dialog`/`list-row` components; no core/port change). **Risk:** Low (isolated to `adapters/driving/tui`, same testing pattern as every other TUI story).

## 4. Detailed Change Proposals

### 4.1 `epics.md` — Story 2.11 amendment

**OLD** (Implementation notes):
> reuses Story 1.5's existing `scan`/`register` use-cases — no new port/adapter. Reachable via the `:` command palette (stubbed since Story 1.13). The exact manifest-generator skill invocation text is to be verified at build time.

**NEW:**
> reuses Story 1.5's existing `scan`/`register` use-cases — no new port/adapter. Reachable as a registered command in the `:` command-entry bar (Story 2.14) — not bound directly to the `:` keypress itself. The exact manifest-generator skill invocation text is to be verified at build time.

Plus a new blockquote note recording the correction and pointing to Story 2.14.

**Rationale:** the original note asserted a mechanism that turned out to be wrong; the correction points at the story that now owns the real mechanism.

### 4.2 `epics.md` — Story 2.14 (new)

Full story added under Epic 2, after Story 2.13: "Command Entry Bar (`:`) & Registered Commands" — user story, 9 acceptance criteria (bar open/filter/autocomplete/exact-run/unknown-command/cancel/registry-as-command/no-stacking-overlays/Tab-exclusivity-vs-Story-2.12/keyboard-only), and implementation notes (static in-memory command registry, no core/port change, reuses `modal-dialog`+`list-row`).

**Rationale:** the generic command-entry mechanism the keybinding contract has promised since Story 1.13 was never actually built; Story 2.11 needs it as a dependency rather than a workaround.

### 4.3 `epics.md` — UX-DR27/UX-DR29

`UX-DR27` (repo registry screen) corrected to stop describing "`:` command palette" as the trigger; new `UX-DR29` added for the command-entry bar itself.

### 4.4 `DESIGN.md` — `modal-dialog` component prose

**OLD:** "...used for confirmations, guided-resolution menus, similar interruptions, and the keybinding-help screen (`?`)."

**NEW:** "...used for confirmations, guided-resolution menus, similar interruptions, the keybinding-help screen (`?`), and the command-entry bar (`:`, Story 2.14, amended 2026-08-25 Sprint Change Proposal)."

**Rationale:** no new visual component needed — the command bar is a `modal-dialog` instance, same as the existing help screen.

### 4.5 `EXPERIENCE.md` — Interaction Primitives, Component Patterns, State Patterns

- `:` bullet corrected to describe the bar's actual behavior (type/filter/`Tab`/`Enter`/`Esc`).
- New `command-bar` row in the Component Patterns table.
- New "Command bar open" row in the cross-cutting State Patterns table.

**Rationale:** keeps the behavioral spec (EXPERIENCE.md) in sync with the visual spec (DESIGN.md) and epics.md's new story.

### 4.6 `sprint-status.yaml`

Added `2-14-command-entry-bar-registered-commands: backlog` under `epic-2`.

## 5. Implementation Handoff

**Scope classification: Moderate** — backlog reorganization (this proposal) is complete; implementation is a normal `bmad-build` pass.

**Next steps:**
1. Developer agent runs `bmad-build` for Story 2.14 on a new branch off `epic-2-...` (per CLAUDE.md's one-branch-per-story convention) — builds the command-entry bar and re-wires the registry screen as its `registry` command.
2. As part of that story's implementation, `app-shell.tsx`'s current direct `shouldOpenCommand → openRegistryScreen()` wiring is replaced by the command bar + dispatch table; `src/adapters/driving/tui/shared/repo-registry-screen.tsx` itself is untouched (only its trigger changes).
3. Story 2.11 stays at `review` status until 2.14 lands, since its "reachable via `:`" acceptance criterion is only truly satisfied once 2.14 exists — the person closing out 2.11 should account for this dependency instead of treating it as already fully done.

**Success criteria:** `:` opens a real command-entry bar in every zone; typing filters candidates; `Tab` completes an unambiguous match; `Enter` runs an exact match (or shows "unknown command"); `Esc` cancels; the registry screen opens only via its `registry` command; `Tab` inside the bar never triggers Story 2.12's zone-tab-bar focus.
