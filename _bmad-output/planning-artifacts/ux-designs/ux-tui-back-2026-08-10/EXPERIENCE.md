---
name: tui-back — Experience Spine
status: final
updated: 2026-08-11
sources:
  - ../../prds/prd-tui-back-2026-08-10/prd.md
  - .memlog.md
inherits: DESIGN.md
---

# tui-back — Experience Spine

> Single-surface terminal TUI for a solo developer administering a 10-service NestJS backend locally. Paired with `DESIGN.md` (the "Atelier" visual identity). This spine covers behavior — the mechanics of navigation, interaction, and state — not aesthetics.

## Foundation

Single-surface terminal TUI, built with TypeScript/Ink (React-based). Keyboard-primary, mouse-optional — the keyboard surface is the product; the mouse, where supported, mirrors the same actions rather than adding new ones (see Responsive & Platform for why this is "optional" rather than "equal"). Local-machine-only: the tool only ever touches local repo copies, never a remote or deployed environment. Single-user: Max is the sole operator of a single running instance (a second instance on the same machine is detected and blocked). `DESIGN.md` is the visual identity contract for every surface described here — colors, type, spacing, and component visuals are specified there and referenced here by token, never restated.

**Governing principles.** Two blanket Trust bars from the PRD's Constraints and Guardrails govern this entire spine, not just individual features. **Trust — Usability**: navigation confusing enough to cause outright rejection of the tool is a non-negotiable failure mode, not a polish item — every navigation and interaction decision below answers to it. **Trust — Single Source of Truth**: the tool must never force Max to check another source to get the full picture — this is why FR-9 (branch/divergence inline), FR-18 (inline health next to logs), and FR-22 (response + correlated logs together) read the way they do, and any zone added later must satisfy it too.

## Information Architecture

Six permanent zones, always reachable from the top bar:

| Zone | Purpose | FR range |
|---|---|---|
| Dashboard | Landing surface on launch, rewritten 2026-10-15 (Epic 8): under the permanent, non-compacting banner, the active EDT's services table (container state, branch, ahead/behind vs. shared branch, issue marker) with the shared per-service actions (`Ctrl+O` open in IDE, `Ctrl+R` restart, `Ctrl+L` clean restart, `Ctrl+T` terminal, `Ctrl+X` container terminal, extensible), an Attention block, a registry-health summary and the EDT actions (enter, choose/create). Read-only apart from those actions; refreshed on mount and `R`. No group-update outcome and no background-event badge. | (summary surface; draws on FR-9, FR-29, FR-35) |
| EDTs | Create, modify, and protected-switch EDTs; membership and per-service working branches. | FR-3–FR-9 |
| Update | A permanent left-hand service list with live status (up/down/restarting/updating/migrating/error); a shared configuration screen (service selection, per-service source branch, migrate/clean-restart toggles) gates every run — EDT-scoped, all-repos, or single-service — followed by live per-service tracking, assisted resolution of conflicts, and migration-failure handling. Per-service quick actions (clean restart, single-service update) are available from the list at any time. | FR-10–FR-12, FR-25–FR-27 |
| Logs | Aggregated live log stream across the active EDT's services (or a chosen subset), filterable, with inline health and developer-triggered restart. | FR-16–FR-18 |
| Routes | Route-explorer module: discover routes, fire requests with automatic dev-mode auth, save/customize/re-fire, response + correlated logs together, global saved-request library. | FR-19–FR-23 |
| shared-types | Propagate a `shared-types` version to chosen consuming services, publish a new version, see declared-version drift; the smart update is configured from the Update zone. | FR-13–FR-15, FR-30, FR-31 |

Routes and shared-types are gated at two levels (amended 2026-08-24, Sprint Change Proposal — supersedes the original "always-present, never hidden" decision): fully omitted from the tab bar only when *no repo in the entire registry* (across every EDT, or none) ever activates the relevant module (`route-explorer` for Routes; `shared-types-source`/`shared-types-consumer` for shared-types) — but when the module exists somewhere in the registry and just isn't present on an active-EDT member, the tab stays visible in a disabled state (dimmed/strikethrough) and, when selected, shows an explanatory message naming which registered repos do carry the module. What's manifest-gated at the *content* level (which services/repos appear inside an enabled zone) is unchanged.

An un-manifested/defunct repo (e.g. the real environment's `micro-bookings`) is simply absent from every list and view across all six zones — invisible by construction (FR-2), never a flagged or excluded special case requiring its own UI treatment.

**Launch banner.** Permanently, on every Dashboard render (amended 2026-08-26, Sprint Change Proposal, Story 2.16 — originally shown once, on launch), before or above the Dashboard's populated content, an ASCII-art banner is shown (k9s-inspired) — see `DESIGN.md`'s Layout & Spacing for its visual spec. A dedicated keybinding-palette/help screen (every key + its description, beyond the contextual footer-hint) opens via `?` from anywhere in the app — it's a `modal-dialog` instance, see Component Patterns below.

**Navigation model.** A permanent top bar is the cross-zone menu — always visible, showing the six zone tabs (`{components.zone-tab}`), the active EDT's name, and the `[/]` filter / `[:]` command affordances. Within a zone, content follows a resizable list/detail split: a selectable list on the left, a detail pane on the right (`{components.list-row}` / `{components.detail-pane}`, divided by `{components.splitter}`). Vim-style keys (`j`/`k` move, `g`/`G` top/bottom) navigate within lists; single-letter zone mnemonics plus `Tab`/`Enter`/`Space`/`Ctrl+W` match the conventions below (see Interaction Primitives). A permanent footer (`{components.footer-hint}`) shows the current context's live keybindings. Post-group-update, the Update zone stays on the run summary rather than auto-returning to Dashboard — the default, but a configurable setting.

→ Composition reference: `mockups/design-directions.html` ("Atelier" section) illustrates the top-bar + list/detail shell on the Dashboard and Update zones. `mockups/key-dashboard.html` (Populated + "No EDT yet" states), `mockups/key-update-run.html` (In-progress + Migration-failure/Assisted-resolution states), `mockups/key-assisted-resolution-modal.html` (guided menu + mid-merge/mid-rebase states, FR-11), and `mockups/key-routes-response-logs.html` (Fired/response + Unlearned-affected-service-set states, FR-22) render the load-bearing surfaces at 1:1 fidelity. EDTs, Logs, and shared-types stay spine-tables-only by choice — they reuse this same list/detail pattern with no new layout to illustrate. This spine wins on conflict with any of these files.

## Voice and Tone

Behavioral mechanic only — brand voice and aesthetic posture live in `DESIGN.md.Brand & Style`.

Every outcome message has two layers. The primary line is always dry/factual — git/docker-CLI register, scannable in an instant, sufficient on its own for comprehension. A second, visually de-emphasized line (`{components.dim-annotation}`) may follow with an optional wink/complicity note — pure garnish, never required, easy to skip.

| Do | Don't |
|---|---|
| `✔ EDT créé: JIRA-1532-refund-flow (2 membres)` | `🎉 New workspace created!` |
| dim: `prêt à l'emploi, à toi de jouer` | Folding the wink into the primary line, forcing it to be read |
| `✖ micro-users: migration 0042_add_refund_table a échoué` | `Error occurred` (generic, no service/migration named) |
| dim: `les autres s'en sortent très bien, eux` | Omitting the dim layer entirely — flat register is fine, a wink is a bonus, not a requirement |
| `✔ micro-users — migrations ok, container restarted` + dim `comme sur des roulettes` | Styling raw stderr as if it were the primary message |
| `Résumé : 1/3 terminé, 1 échec, 0 skip` (always accounts for every targeted service) | A summary that silently omits a service's outcome |

Raw tool/script output (stack trace, raw stderr) always stays one action away from the factual gloss — never fully hidden, so Max can drop into the unfiltered detail on demand.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| zone-tab | Top bar | Single-letter mnemonic or direct click switches zone from anywhere. `Left`/`Right`, with nothing capturing input, directly switch to the previous/next zone in tab-bar order, wrapping at the ends (skipping fully-omitted tabs, landing on disabled ones) — always available, no focus mode to enter first (amended 2026-08-24, Sprint Change Proposal; mechanism corrected 2026-08-25 after a review loopback — `Tab` is unaffected, keeping its pre-existing role). Active EDT name stays visible alongside it at all times. A background-event badge (e.g. a crashed service detected while Max is elsewhere) clears once that zone is visited. Routes/shared-types may render disabled — see the gating rule above. |
| status-badge | Anywhere a state is reported | Passive display — not itself interactive, except where a failing service's badge in Logs exposes an adjacent restart control (FR-18). |
| list-row | Every list/detail split, including bmad-loop-style single-activation lists (OptionList) | Arrow keys move the highlight; `Home`/`End` jump to top/bottom; `Enter` (or a click) activates the highlighted row — same effect regardless of trigger method. |
| detail-pane | Right-hand pane of a list/detail split | Read-focused; content follows the left list's current selection. Becomes its own scrollable/selectable list only where the zone calls for it (e.g. the Logs stream). |
| footer-hint | Bottom row, always present | Passive; always reflects the current context's live keybindings — never stale after a zone or mode change. |
| modal-dialog | Confirmations, guided-resolution menus, any interrupting decision, and the keybinding-help screen (`?`) | `Escape` always cancels/closes; `Enter` always confirms — regardless of whether the modal was opened by mouse or keyboard. Explicit fix for a friction point in bmad-loop, where trigger method and confirm binding could mismatch. The help-screen instance is read-only (no confirm action, `Esc` or `?` again closes it) and scrolls with `j`/`k` when its content exceeds the visible height. See `mockups/key-assisted-resolution-modal.html` for the FR-11 guided-menu instance at 1:1 fidelity. The FR-11 guided-menu instance is hosted by `incident-queue` since Story 3.18 (amended 2026-10-08). |
| incident-queue | Update zone, when a run raises incidents (Story 3.18, added 2026-10-08) | Two-column `modal-dialog`: left a bounded list of pending incidents (service, kind, age, "still blocked" marker), right the selected incident's guided menu (stash / edited / cancel repo / cancel run). `↑/↓` select, `Enter` act, `Esc` closes without resolving (incidents stay queued, services stay paused), reopened via a footer-hinted key. Auto-opens only on the first incident; later ones notify through the Update tab badge and a toast without stealing focus. Services awaiting the developer carry an `awaiting you` status (glyph + color) in the closed service-status set. |
| fullscreen-report | Update zone, from a focused service or a recap row (Story 3.19, added 2026-10-08) | Same chrome as the Logs fullscreen: title bar, scroll indicator, footer hints. Complete step details and issue log, scrollable (`↑/↓`, `PgUp/PgDn`, `Home/End`), `w` toggles wrap/truncate, `n`/`p` jump between failed steps, `f` opens, `Esc` closes. Live while a run is in progress. |
| checkbox-list-item | Multi-select: EDT member selection, log-view service filter, saved-request batch actions | `Space` toggles the highlighted item; `Enter` confirms the whole selection and proceeds. Modeled on the Claude Code / BMad-installer selection UI. |
| splitter | Divider between a list pane and a detail pane (or any two resizable regions) | Mouse-drag resizes directly. `Ctrl+W` enters keyboard resize-mode: arrow keys resize the active boundary, `Tab` cycles which boundary is active (in a zone with more than one), `Enter` or `Esc` exits resize-mode. Pane sizes persist across sessions, per zone independently — not one global size — mirroring bmad-loop's own per-pane persistence (e.g. its `left_width`/`runs_height`/`deferred_height`/`tasks_height` each tracked separately). Available in **every** zone (amended 2026-10-01, Sprint Change Proposal): each zone declares its panes and boundaries through one shared zone-layout contract (UX-DR35); `Ctrl+W` engages resize-mode in whichever zone is active. The Logs zone's former `Ctrl+W` "wrap all panes" is remapped (key chosen in Story 7.3, listed in the footer and `?` help). |
| spinner | Any in-progress action (pull, publish step, propagation) | Purely a running-state indicator — no interaction. |
| dim-annotation | The optional wink line under a factual message | Not focusable, not required reading; purely visual, always attached to the factual line above it. |
| command-bar | Top-level `:` action (Story 2.14, amended 2026-08-25 Sprint Change Proposal — corrects Story 2.11, which had bound `:` directly to one screen instead of this generic input; reveal mechanism amended 2026-08-26 Sprint Change Proposal, Story 2.17) | A `modal-dialog` instance (text input, no command list shown on open). Typing filters matching commands by name-prefix, case-insensitive, but nothing is displayed until `Tab` is pressed: on an empty input `Tab` shows the full `command-grid`; on a non-empty input `Tab` completes on exactly one match, completes to the longest shared prefix when several matches share one, or — once already at that prefix — needs a second `Tab` within a short window to reveal the `command-grid` of matches. `Enter` runs an exact match and closes the bar; `Esc` cancels without executing; an unmatched `Enter` shows an inline "unknown command" message rather than doing nothing silently. Never opens on top of another overlay, and consumes `Tab` itself while open — `Tab` has no zone-switching role to conflict with (Story 2.12 uses `Left`/`Right`, not `Tab`). |
| command-grid | `Down` from the command-bar input, or a double-`Tab` on an ambiguous match (Story 2.17) | A multi-column, arrow-navigable table of matching commands (see `DESIGN.md`'s Component Patterns): `Left`/`Right` moves between columns, `Up`/`Down` moves within a column, `Up` from a column's top row returns to the input, `Enter` completes the input to the highlighted command, and typing any character exits back to editing the input. Truncated (`…`) when the grid is wider than the display; scrolls horizontally at either extremity to reveal hidden columns. |
| settings screen | `:settings` command (Story 2.19) | A tab-organized `modal-dialog` instance (General plus one tab per configurable feature area); `Left`/`Right` cycles tabs, every change applies and persists immediately, `Esc` simply closes (nothing to discard). A **Services** tab (Story 9.11) lists every registered service with a "health check" checkbox (checked = the `healthUrl` is probed); a service without `healthUrl` or with an unloadable manifest is listed disabled with its dim reason. |
| text-input | Free-text fields inside a `modal-dialog` — EDT topic (Create/Modify), branch name (service-actions/Modify/Add-to-EDT/Create) (Story 2.23, added 2026-08-28 Sprint Change Proposal — formalizes a pattern already in use since Story 2.9 with no documented entry) | Cursor-addressable editing — `Left`/`Right`/`Home`/`End` move the caret, typing and `Backspace`/`Delete` apply at it (Story 2.32); a visible cursor glyph renders at the current edit position so the field is never mistaken for a static label; a confirm/cancel hint (`[Enter] confirm [Esc] cancel`) is always shown alongside it. |
| wizard-breadcrumb | Top of a multi-step `modal-dialog` — the create-EDT wizard (Story 2.36, added 2026-09-24 Sprint Change Proposal) | One line `[1. Nom] ── [2. Services] ── [3. Branches] ── [4. Activation]`: the current step reads `▶ … ◀` in accent, completed steps show what was decided (`1. Nom: auth-flow`, `2. Services (3)`), steps not yet reachable (an earlier step is still invalid) are dim. Each step opens with a one-line intro. Step navigation is wizard-scoped: `Ctrl+→`/`Ctrl+N` next (only if the current step is valid, else its inline error shows), `Ctrl+←`/`Ctrl+P` back (always, choices kept); `Tab` stays within the current step; `Esc` closes the innermost open field first, then cancels the whole wizard with nothing written. |
| wizard-branch-strategy | Step 3 "Branches" of the create-EDT wizard (Story 2.37) | Two stacked panels, `Tab` switches between them. **A "STRATÉGIE GLOBALE"** (focused on entry): `↑/↓` move between "Branche source par défaut" (empty = dim `<shared-branch>` placeholder: each service uses its own manifest `sharedBranch`) and "Nom global de la branche" (the Step 1 slug until edited); `Enter` edits the focused line, `Esc` leaves it, and any printable key on the base line starts editing with that character. **B "RÉSUMÉ ET EXCEPTIONS PAR SERVICE"**: a height-bounded table `Service │ Mode │ Base / Source │ Branche cible`, modes `[Créer (Global)]` / `[Créer (Perso)]` / `[Existante]` / `[Renommer]` (target `-> <nouveau nom>`); a global base that matches nothing in a service shows `✖ branche introuvable` (glyph + error color) and blocks `Ctrl+N`. `↑/↓` move the row cursor, `Enter` opens the **"Configurer <service>"** box: `Mode : (•) Créer nouvelle ( ) Choisir existante` (`Space`/`Tab` on that line), then the mode's fields (branch fields are `branch-autocomplete` inputs over the service's local + remote branches), a `[ ] Renommer la branche locale` checkbox (`Space`) in "Choisir existante", and `[ Appliquer ]`. In the box `↑/↓` move between lines, `Enter` enters a field and, inside it, commits and moves on; `Enter` on `[ Appliquer ]` applies; `Ctrl+R` reverts the row to `[Créer (Global)]`. Protected target names (FR-7) are refused inline. `Enter` never advances Step 3; `Esc` closes a field in edit, then the box, then Panel A's edit mode, then the wizard. Footer: `[Tab] Changer de zone • [Entrée] Configurer la ligne • [Ctrl+N] Étape suivante`. |
| wizard-activation | Step 4 "Activation" of the create-EDT wizard (Story 2.38) | Under the read-only recap. **First EDT** (none existed when Step 4 was entered): the option "Définir cet EDT comme espace actif immédiatement" is shown locked on "Oui", with why (no outgoing EDT to preserve); `Enter` creates then activates — every repo is pre-flighted before any checkout (members → their EDT branch, non-members → their manifest `sharedBranch`, fetched if missing). Files a checkout would overwrite (uncommitted ∩ differing between current and target branch) pause the wizard on an "ACTIVATION EN PAUSE" panel listing each service and its files: `R` re-runs the pre-flight (repeatable), `E` opens "CONFIRMER L'ÉCRASEMENT" (every file listed, `↑/↓` scroll, `Ctrl+E` discards exactly those files then activates, `Enter`/`Esc` go back), `Esc` stops — the EDT stays created but not active and the wizard says so (`Enter`/`Esc` close). **Later EDT**: a radio (`Space`/`↑↓`) — `(•) Basculer immédiatement sur ce nouvel EDT` (default; an info block below it: outgoing services' uncommitted work auto-stashed, other dirty services listed to adopt or discard, members to their configured branches, each non-member back to its own shared branch, listed by name) or `( ) Créer sans basculer (rester sur l'EDT courant)`. Switching hands off to the SWITCH EDT dialog on the new EDT at once (the protected switch, with its blocked prompt and dirty-service resolution view). A partial-failure create never activates (failure rows + "EDT créé mais non activé"). Every action-log entry goes to the new EDT. |
| terminal-view | Service / container terminal overlay, `Ctrl+T` / `Ctrl+X` on the focused Dashboard row (Epic 9, Story 9.4) | Header: target (service or container name), cwd, running indicator. Scrollable output shared with the Logs fullscreen primitive (stdout in text colour, stderr in error colour; the echoed `$ <command>` and the `exit N` / `cancelled` / error status lines dim); one prompt line at the bottom. Prompt focused: `Enter` runs (refused with a dim "a command is running" notice while one runs, the draft kept), `↑/↓` recall the in-memory history shared by every terminal for the app run, `Ctrl+C` cancels the running command (idle: clears the draft; never quits). `Tab` moves focus to the output and back; output focused: `↑/↓` scroll, `PgUp/PgDn` page, `?` help, any printable key returns to the prompt. `Ctrl+F` toggles fullscreen from either focus. `Esc` closes, asking first while a command runs (`Enter` cancels it and closes, `Esc` keeps it). Closing discards the session (cwd and output); the overlay owns every key, so `q`, `:`, `?` and the zone mnemonics are text at the prompt. |
| service-action-menu | Logs tab (Epic 9) | The registry's actions as a navigable list with disabled reasons; same entries as the Dashboard `ServiceActionsRow`. |
| action-bar | Shared Types form view (Epic 9) | Labelled commands with keys and disabled reasons replace hint-only lines. |
| next-step-choice | Shared Types after publish success/failure (Epic 9) | Selectable list (`↑/↓` + Enter, Esc = Close), one explanatory line per choice: Propagate <version>, Back to the form, Close (Relaunch on failure). |

## State Patterns

Every real state per zone (loading/empty/error/offline/stale/focus/background-event, as applicable). The fleet is mid-evolution, not a uniformly stable target (services vary in architecture maturity — e.g. one mid-migration to clean architecture, another with known gaps in its own test coverage): UI states must tolerate per-service inconsistency, and no state or copy below assumes every service is equally reliable.

**Dashboard**
| State | Treatment |
|---|---|
| Cold load | Spinner per section; each section fills independently (a slow docker probe never blocks the git sections). |
| Populated | EDT line (name, N services, "updated Ns ago · [R] refresh"), then one row per member service: state glyph + text, issue marker, branch, ahead/behind vs. its shared branch. The focused row shows a reason line and the service-action row. |
| Service action | `Ctrl+O` / `Ctrl+R` / `Ctrl+L` / `Ctrl+T` (terminal) / `Ctrl+X` (container terminal) from Story 7.12's registry (terminals added by Story 9.2; the container terminal is greyed with `no container`, `container not running`, `container state unknown` — Docker unreachable or slower than 1.5 s — or `manifest unreadable`); unavailable actions greyed with their reason; a running action shows its progress inline on the row and disables that row's other actions. |
| Attention | Ordered list: protected branch, no upstream / unknown (offline), uncommitted changes or merge in progress, branch shared with another EDT (named), behind on a shared branch. Single success line when clear. |
| Registry health | Repo count, invalid manifests, unreachable repos, listing issues; shortcut `:registry`; single success line when clear. |
| Probe error | The affected field shows an explicit error state; the rest of the row and the other sections are unaffected. |
| No EDT yet (first run) | Prompts to choose or create an EDT instead of showing a stale/empty summary. |
| No repos registered | Unchanged (Story 2.11) — takes precedence over every other Dashboard content state. |
| Background-event badge | A zone with a pending background event (e.g. Logs) shows its counter badge on its tab while Max is on Dashboard. |

**EDTs**
| State | Treatment |
|---|---|
| Empty (no EDTs exist) | Explicit prompt to create the first one — never a bare empty list. |
| Populated | List of EDTs with member services and, per managed service, current branch + ahead/behind divergence. |
| No upstream / offline | A service's divergence shows an explicit "no upstream" or "unknown (offline)" state rather than a numeric value it can't compute (FR-9). |
| Duplicate-topic rejection | Creating an EDT with a topic matching an existing EDT is rejected before creation; topic must be unique among existing EDTs (FR-3). |
| Zero-member-at-creation rejection | Creating an EDT with no member service selected is rejected — at least one member service is required at creation (FR-3). Distinct from the allowed post-creation state below: an EDT can later be reduced to zero members (FR-5). |
| Per-service branch-creation failure | At EDT creation, a per-service branch-creation problem (e.g. base branch missing, name collision) is reported per service and does not abort creation for the others (FR-4). |
| Shared-branch rejection | Registering a protected/shared branch (the service manifest's `protectedBranches`, plus its `sharedBranch`; Story 2.42) as an EDT's own branch for a service is rejected with a clear explanation before any git write happens — applies both at creation (FR-4) and at a later branch change (FR-5, FR-7). |
| Member added/removed | Adding or removing a member service from an existing EDT does not disturb the other members' recorded branch/state (FR-5). |
| Zero-member EDT display | An EDT reduced to zero members shows an explicit "no members" state — never rendered as an error (FR-5). |
| Member branch change | Changing an existing member's working branch follows the same protected-switch rule as FR-6/FR-7 — no uncommitted work lost, no shared branch accepted (FR-5). |
| Branch already claimed by another EDT | A requested branch (at creation, add-member, or a branch change) that `assertAllowedBranch` rejects as already registered as a *different* EDT's own branch for that repo is shown per-repo, distinguished from other failure kinds, with a guided "try a different branch" resolution — an instance of the Update zone's "Assisted resolution" mechanic (detect → guided action → re-verify), extended to the EDTs zone (Story 2.25, added 2026-08-28 Sprint Change Proposal). |
| Branch used by another EDT (chooser) | In every branch chooser (wizard Step 3 table and "Configurer" box, BranchPicker pick-existing / rename-current), a branch that is another EDT's own branch for that service is annotated `⚠ EDT « <topic> »` (glyph + warning color, never color alone). Choosing it to attach, or renaming it, is refused inline: "utilisée par l'EDT « <topic> » — la reprendre ou la renommer casserait cet EDT". Using it only as a base for a new branch stays allowed (annotated). Core refuses attach/rename too, so the inline check only surfaces the rule earlier (Story 2.43, added 2026-09-28 Sprint Change Proposal). |
| Protected-switch blocked | Switching away from an EDT with a group update in progress is blocked by default; a prompt offers to stop the running update so the switch can proceed (FR-6). |
| Interrupted update | Returning to an EDT whose update was stopped mid-switch shows that it was interrupted and offers to re-run it (FR-6). |

**Update**
| State | Treatment |
|---|---|
| Service list (always visible) | Left-hand list — active EDT members then other managed services — each carrying a status glyph from the closed set up / down / restarting / updating / migrating / error, visible whether or not a run is in progress (FR-27). |
| Idle | No run in progress; selecting a service shows its last outcome in the detail pane. |
| Configuration screen | Opens before any of the three triggers (main, all-repos, single-service) runs anything: per-service checkbox + source-branch field (defaulting to the manifest's `sharedBranch`), plus two run-wide toggles — run migrations, clean restart. Confirming with zero services selected is rejected the same way a zero-member EDT is (FR-25). |
| Merge source: shared branches | EDT-scoped configuration only — the default global strategy: every row's source is its manifest `sharedBranch` (FR-28, added 2026-10-01). |
| Merge source: from EDT | The global strategy names another EDT (never the one being updated); rows resolved from it show `← <edt>` next to the branch; rows not in that EDT show `✖ not in <edt>` (or `✖ branch not found` when the recorded branch no longer exists) in error color + glyph and block the run until set by hand (editor pre-filled with the `sharedBranch`) or deselected. Manual rows keep their branch across strategy changes until reset (FR-28, added 2026-10-01). |
| No-op | A group update triggered on a zero-member EDT, or confirmed from the configuration screen with nothing selected, shows an explicit message, never silent success (FR-10, FR-25). |
| All-repos confirmation gate | The configuration screen opens first, pre-selecting every managed repo; maintenance-mode's own explicit confirmation step follows it before anything starts, since the blast radius exceeds the active EDT (FR-10). |
| Second-run blocked | A second group update is rejected while one is already running, in any scope — including a single-service run already in flight for that same service (FR-10). |
| In progress | Selecting a targeted service shows its current step live — pulling / merging / migrating / restarting — replacing the idle last-outcome view (FR-27). |
| Clean-restart step | When the run's clean-restart toggle is on (or a standalone clean-restart is triggered on one service), that service's current step shows the manifest's declared restart recipe running, command by command; absent a recipe, it falls back to a plain container restart without error (FR-26). |
| Per-service outcome | Each targeted service ends in updated / skipped / failed — the summary line accounts for every one, none silently absent (FR-10). |
| Assisted-resolution menu | A dirty/conflicted repo not covered by the known-safe auto-fix (package.json/lockfile-only) presents the guided menu: stash / open in editor / cancel this repo / cancel the whole run (FR-11) — rendered in front of that service's live detail pane. |
| Mid-merge/mid-rebase | Detected as its own distinct state — surfaced explicitly before the guided menu applies, separate from an ordinary dirty-lockfile state (FR-11). |
| Migration failure (Assisted resolution) | An instance of the glossary's Assisted resolution mechanic (detect → auto-fix-known-safe-or-guided-menu → re-verify): per-service failure detail (service, migration, error output), marked unresolved until re-verified (FR-27), with a re-trigger action that re-verifies success before the service is marked caught up; doesn't block other services' already-succeeded updates in the same run (FR-12). |
| Per-service quick actions | From any service's row, independent of any run: a clean-restart trigger (FR-26), or an update-this-service trigger that opens the same configuration screen pre-scoped to that one service (FR-25). Rejected if that service already has an action running (FR-10's second-run rule, applied per-service). |
| Last-run detail | After a run, each service's detail reports what really happened: an advancing merge shows +N/−M lines and F files, an unchanged HEAD shows "already up to date", the migrate phase shows "ran (<command>)" with an output excerpt or "none" when absent/disabled — session-only, replaced by the next run (FR-30, added 2026-10-05). |
| Quit mid-run | Pressing `q` while a group update is in progress requires explicit confirmation before quitting, consistent with FR-6's EDT-switch-blocked-during-update precedent; if confirmed, the next launch surfaces that run as interrupted and offers to resume it, mirroring the EDTs zone's "Interrupted update" state above. Applies equally to shared-types publish/propagation (see shared-types below). |

**Logs**
| State | Treatment |
|---|---|
| No members | The active EDT has zero member services — nothing to stream; shown as an explicit "no members to aggregate" state, not a bare empty log view (mirrors EDTs' "Zero-member EDT display"). |
| Streaming | Live aggregated stream, debounced/batched re-renders. |
| Filtered | Service / free-text-regex / level filter applied without interrupting the stream (FR-17). |
| Invalid filter | A regex that doesn't compile is rejected with an inline error, never silently ignored (FR-17). |
| Service down / crashed mid-stream | Shown as such inline; the tool attempts automatic reconnection when the service returns (FR-16). |
| Health: up / down / restarting | Visible inline with the log view itself — no separate health check step (FR-18). Every row carries its badge, cursor or not; a restarting service states explicitly that a restart was requested and the container state is being re-verified (amended 2026-10-05). |
| Restart in progress | The restart control disables itself on the already-restarting service — never triggers a second concurrent restart (FR-18). |
| Without-container group | Every container-less registry service (members included) in an info-only section: greyed, unselectable, skipped by Tab and Ctrl+A; Ctrl+A toggles the focused list only (FR-29, added 2026-10-05). |

**Routes**
| State | Treatment |
|---|---|
| Scan in progress | Spinner while the module's scanner discovers routes for the repo. |
| Scan failure vs. empty list | Two visibly distinct states — a scan failure is never displayed as a merely-empty route list (FR-19). |
| Fired / response | Response appears with the correlated aggregated logs for the affected services in the same view, immediately after firing (FR-22). |
| Auth error | A permission mismatch on the target route surfaces as its own distinct auth error, not a generic request failure; an expired dev-mode token refreshes automatically without developer action (FR-20). |
| Unlearned affected-service set | First fire of a route proposes the default candidate set (active EDT's members, logs windowed around the fire); adjustable, then saved against the route for every later fire (FR-22). |
| Stale saved request | A saved request whose route is no longer discovered after a rescan is flagged stale and can be deleted — never fired silently (FR-21). |
| Save-as-new name collision | Saving a customized re-fire as a new request is rejected on a name collision with an existing saved request, prompting for a different name (FR-21). |
| Library hide / favorite | Hiding a saved request in one EDT doesn't remove it from the global library or other EDTs; favoriting is independently per-EDT and global (FR-23). |

**shared-types** *(rewritten 2026-10-05)*
| State | Treatment |
|---|---|
| No members | The active EDT has zero member services — shown explicitly, not a bare empty list. |
| Version entry | A text field pre-filled with `0.1.`, always editable, followed by the consumer checklist (`checkbox-list-item`); the version's existence on the registry is verified before execution (FR-15). |
| Options | Independent toggles: `npm i`, clean restart, commit (`package.json`/`package-lock.json` only, never a push) (FR-15). |
| Propagation in progress / per-service result | Per-service status (rewritten / installed / restarted / committed / skipped with reason / failed); each failure independently retriable (FR-15). A consumer with a dirty `package.json`/lockfile is skipped with an explicit reason. |
| Publish in progress | Per-step (bump → build → publish → push) status, spinner on the running step (FR-13). |
| Publish step failure (Assisted resolution) | Names the failed step; a re-trigger resumes from it, and the version is verified on the registry before being marked published (FR-13). |
| Publish success | Offers to chain into propagation with the version pre-filled, or to stop (FR-13). |
| Drift view *(niche)* | Per consumer: declared version vs. the source repo's version on the EDT branch, in-sync or not, with a one-key jump into propagation (FR-14). |
| Quit mid-run | Pressing `q` while a publish or propagation run is in progress requires explicit confirmation, same rule as the Update zone; if confirmed, the next launch surfaces the run as interrupted and offers to resume it. |

**Update zone — smart update row** *(added 2026-10-05)*: when the EDT contains the `shared-types-source` repo, the update configuration offers a `shared-types` row: *off / publish if the merge changed something / always publish* (FR-30). The run tracking shows the `shared-types` phase first, then per-consumer auto-resolution outcomes (FR-31).

**Cross-cutting, every zone**
| State | Treatment |
|---|---|
| Focus / active selection | `{components.list-row}` selected treatment — accent bar + `surface-selected` fill. |
| Background event | `{components.zone-tab}` badge on the affected zone's tab while Max is elsewhere — no overlay/toast interrupts the current screen. |
| Keybinding-help screen open | A `modal-dialog` instance, opened via `?` from any zone over whatever's currently on screen; `Esc` or `?` again closes it and returns to the underlying zone unchanged. |
| Command bar open | A `modal-dialog`-based overlay opened via `:` from any zone (Story 2.14); filters/autocompletes/executes registered commands; `Esc` or a successful run closes it and returns to the underlying zone unchanged. Never stacks on top of another open overlay. |

## Interaction Primitives

The canonical keybinding contract for downstream implementation:

- `↑` / `↓` — move highlight down/up within a list.
- `Home` / `End` — jump to top/bottom of the current list.
- `Space` — toggle (multi-select / checkbox-list-item).
- `Enter` — confirm, always — opens a row, confirms a modal, confirms a multi-select — identical effect regardless of whether the action was reached by keyboard or mouse.
- `Esc` — cancel, always — closes a modal, exits splitter resize-mode, clears an active filter.
- `Tab` — cycle — between fields in a form, or between resizable boundaries in a multi-splitter zone. `Shift+Tab` always moves back wherever `Tab` moves forward (added 2026-10-05, FR-31).
- `Ctrl+W` — enter keyboard resize-mode on the active splitter; arrow keys resize; `Tab` cycles the active boundary; `Enter`/`Esc` exits.
- Focus navigation (added 2026-10-05, FR-33) — every zone declares its focus movement through one shared primitive (configurable per zone: H/V arrows, Tab/Shift+Tab, Ctrl+N/P) instead of hand-rolled handlers; the footer and `?` help are generated from those declarations.
- `/` — open filter within the current zone.
- `:` — open the command-entry bar (Story 2.14, amended 2026-08-25 Sprint Change Proposal): type a registered command name, `Tab` autocompletes on a single match, `Enter` runs an exact match, `Esc` cancels.
- `?` — open the dedicated keybinding-palette/help screen: every key in the app plus its description, beyond what the contextual footer-hint shows.
- `q` — quit; confirms first if a group update, shared-types publish, or propagation run is in progress (consistent with FR-6's EDT-switch-blocked-during-update precedent) — see the Update and shared-types zones' "Quit mid-run" states.
- Single-letter zone mnemonics — `d`=Dashboard, `e`=EDTs, `u`=Update, `l`=Logs, `r`=Routes, `s`=shared-types; each switches directly to that zone from anywhere. An earlier mockup showed `g` for Dashboard (visible in the footer hint, e.g. `[g] dashboard`) — corrected to `d`, specifically so the zone-mnemonic namespace never collides with the vim-style `g`/`G` list-jump above, which stays reserved for top/bottom-of-list regardless of which zone is active.
- `Ctrl+→` / `Ctrl+N` and `Ctrl+←` / `Ctrl+P` (added 2026-09-24, Sprint Change Proposal, Story 2.36) — wizard-scoped: inside the create-EDT wizard modal only, next / previous step (see `wizard-breadcrumb`). `Ctrl+Arrow` reaches the app only on terminals that send xterm modifier sequences (`\x1b[1;5C`/`D`); `Ctrl+N`/`Ctrl+P` are the always-working fallbacks. Bound nowhere else — every other zone shortcut is gated while a modal owns the keystroke.
- `Ctrl+R` (Story 2.37) — scoped to the create-EDT wizard's Step 3 "Configurer <service>" box: "Revenir à la stratégie globale" (the row goes back to `[Créer (Global)]`, the box closes). No collision: the `BranchPicker`'s own `Ctrl+R` (rename a row) lives in other modals, and the wizard no longer hosts one.
- `Space`/`↑↓`, `R`, `E`, `Ctrl+E` (Story 2.38) — scoped to the create-EDT wizard's Step 4 (see `wizard-activation`): the switch/stay radio; on the first-EDT pause panel, Retry and open the overwrite confirmation (`Esc` stops, leaving the EDT inactive); in that confirmation, `Ctrl+E` discards the listed files and activates (`Enter`/`Esc` go back — the same explicit-confirm convention as the switch discard confirmation).
- `Left` / `Right` (added 2026-08-24, Sprint Change Proposal, Story 2.12; mechanism corrected 2026-08-25 after a review loopback) — with nothing capturing input, directly switch the active zone to the previous/next zone in tab-bar order, wrapping at the ends — an always-available alternative to the mnemonics above, with no separate focus mode.
- `PgUp` / `PgDn` (Story 7.9, UX-DR37) — scroll the body of a dialog taller than the window; the title and footer stay put and a `▲▼ PgUp/PgDn scroll` line appears. Bounded rendering applies everywhere: dynamic text is truncated or clamped, growing lists show `▲`/`▼` or `N older hidden`, and below 40×12 a single "Terminal too small" screen replaces the app until the window grows back.
- Mouse (optional) — click to select/activate, mirroring the keyboard equivalent; drag on a splitter resizes it directly, mirroring `Ctrl+W` mode.

### Interaction consistency contract (UX-DR36, Story 7.4) — validated 2026-10-07

The same intent uses the same key, wording and component in every zone and dialog. Source: `_bmad-output/implementation-artifacts/epic-7/interaction-inventory-7-4.md`. Any deviation must be listed in the last table with its reason.

| Intent | Canonical choice |
|---|---|
| List cursor / jump | `↑`/`↓` move (clamped), `Home`/`End` jump, in every list. No vim keys; `g`/`G` stay reserved for top/bottom and are bound to nothing else. One shared cursor module. |
| Activate | `Enter` confirms or opens, never toggles. |
| Toggle | `Space` toggles only. |
| Focus movement | `Tab`/`Shift+Tab` through the shared focus-navigation primitive; no raw `key.tab` handling. |
| Edit / commit / cancel | `Enter` commits, `Esc` cancels and restores the previous value (filter editors included). |
| Dialog confirm / cancel | `Enter` confirms, `Esc` cancels, closing the innermost layer first. `y`/`n` confirmations and `y` as a start key are removed. |
| Destructive action | Reversible: modal + `Enter`. Irreversible file loss: second step `Ctrl+E`. Data reset: typed word. Clearing a view: no confirmation, but labelled. |
| Filter | `/` opens, `Esc` clears. |
| Refresh / retry | `R` retries or refreshes in the current context; load errors show `[R] retry`. |
| Footer and `?` help | Both generated from one keybinding declaration list. The footer takes its context (zone, dialog, pane, screen) from the store: the layer that owns the keyboard registers a declared context (`keybindings/footer-contexts.ts`), the footer shows exactly that context's hints, and the zone hints return when it closes. The `?` help lists the same context rows. The `?` help is type-to-filter (Story 9.10): printable keys narrow the list (keys, description, section; case-insensitive), Backspace edits, Esc clears a non-empty filter before closing, and `?` closes only when the filter is empty. |
| Hint format | `[Key] verb`, entries joined by two spaces, English, `Esc`/`Enter` capitalised, `↑/↓`, `Ctrl+W`. Built only through `formatHint(s)`; a guard test fails any literal written by hand. |
| Modal title | UPPERCASE English noun phrase, no suffix punctuation. |
| Loading / empty / error | One shared `StateLine`: spinner + "Loading X…", dim "No X yet.", error colour "Failed to load X. [R] retry". |
| Text input | `nextTextInputValue` + `TextInputLine` everywhere. |
| Pick list | `FilterablePickList` when filterable; `MenuList` (one reducer, one view) for fixed menus: service actions, Update service menu, blocker menu. |
| Branch input | One `BranchAutocompleteInput` for every suggestion field (branches, EDT topics): substring suggestions in a window that follows the highlight inside a line budget (`↑/↓ N more` indicators count), `✔`/`✖` validity mark, optional dim placeholder for "use the default", loading/error through `StateLine`. `Enter` fills in the highlighted suggestion, then accepts a listed value. BranchPicker's create-new base-branch field uses it too (arrows highlight instead of overwriting the text). The `branchDropdownMaxRows` setting is now the line budget, indicators included. |
| UI language | English for every label, hint, title and error, with strings kept easy to extract; the French Voice examples above are superseded. A fr/en setting is a separate future story. |
| Retry / restart | `R` = retry or refresh (create-wizard activation pause, load errors). Logs `R` = restart the focused service (documented deviation, same "run again" family). A bare `R` is never active while a text field is focused. |
| Back to global | `Ctrl+R` in every per-service parameter box and table (Update config, wizard override box, switch-resolution box). |
| Rename branch | `Ctrl+T` in `BranchPicker` (replaces `Ctrl+R`). `F2` was validated first but Ink 7.1.1 `useInput` exposes no function-key flag (empty input), so it cannot be bound; `Ctrl+T` is the documented fallback. |

| Deviation | Reason |
|---|---|
| Routes: `Ctrl+R` = fire request | Routes has text fields, so a bare letter cannot be used; `Ctrl+Enter` is not distinguishable from `Enter` on common terminals. |
| Logs: `R` = restart service | Same "run again" family as retry; letter already established. |
| Two-panel screens (wizard step 3, switch resolution): `Ctrl+N` confirms | `Enter` opens or edits the focused row there, so it cannot also confirm; the same chord is the wizard's next-step key. |
| Update config: the run starts only from the `[ Start run ]` line (`Enter` on it) | One dialog for every scope (the plain list is gone); `Enter` on a table row opens the per-service box, so the start action is an explicit last stop of the global panel instead of a chord. |
| `FilterablePickList`: `Home`/`End` move the text caret | The filter text field has focus, so the keys belong to the caret; `↑`/`↓` move the cursor. |
| Routes raw body editor: `Esc` closes and keeps the text, `Enter` is a newline | A multi-line editor needs `Enter` for newlines; discarding a hand-typed body on `Esc` would lose work. |
| Branch lists: no `[R] retry` hint | A bare letter would type into the focused text field; branch lists reload on reopening the field. |
| Clearing views (Logs `c`/`Ctrl+C`) and Routes row `d` act without confirmation | Reversible or trivially re-creatable data; labelled in the hints, per the destructive-action rule. |
| Registry stale-entry cleaning: selection + `Enter`, no second step | The registry entries only point at paths that are gone; nothing on disk is destroyed. |
| `Ctrl+T` = rename branch in `BranchPicker` overlays, service terminal on the Dashboard | The rename only lives in `BranchPicker` overlays, which own their keys while open, so the Dashboard zone is inert behind them and the chord never reaches both. `Ctrl+E` was proposed for the container terminal and rejected to keep its canonical meaning (second-step confirm of irreversible file loss); `Ctrl+X` is used instead. |
| `Ctrl+F` = terminal fullscreen (not the bare `F` of the Epic 9 terminal-view brief) | The terminal prompt must accept every printable character, `F` included, so fullscreen takes a chord that also works from the output focus. `Tab` moves focus between prompt and output (the brief left that key open); it is the canonical focus-cycle key and the prompt has no completion. |
| Dashboard empty-registry sentence (`Press [:] ...`) stays hand-written | The Dashboard belongs to Epic 8 (Dashboard); it is the one allowlisted literal in the hint guard test. |
| Action-progress labels (`Saving…`, `Deleting…`, `Switching…`, `Creating…`) are plain annotations, not `StateLine` | They report an action in flight, not a list being loaded; `StateLine` covers loading, empty and error states. |
| Detail-pane action hints (`[Enter] Switch`, `[Enter] Remove / Change branch`) and the `[i] details` suffix stay inline | They are zone content the settings screen lets the user hide; they are built with `formatHint` and keep their capitalised verbs. |
| A dialog with no key to press (creating, activating, preparing the switch resolution) registers no footer context | The footer falls back to the zone hints for that moment; a context would only advertise keys that do nothing. |

## Accessibility Floor

Behavioral; visual contrast values live in `DESIGN.md`.

- Status is never color-only: every `{components.status-badge}` instance ships a glyph alongside its color, specifically so red/green (and the hue-adjacent accent/warning pair) remain distinguishable without relying on hue discrimination.
- Text/background pairing favors comfortable hours-long daily reading (`{colors.text}` warm off-white on `{colors.background}`/`{colors.surface}` charcoal) — no numeric contrast-ratio target (e.g. a specific WCAG AA/AAA figure) is set, by deliberate choice: this is an internal single-user tool, not a public or regulated product, and Atelier's token choices already prioritize comfortable long-session reading. Closed as a non-blocking non-decision, not an open item.
- Every keyboard primitive in Interaction Primitives is available without a mouse — the keyboard surface is the primary, not a fallback (see Responsive & Platform).
- Terminal minimum-width behavior is deferred, non-blocking — not decided now; see Responsive & Platform and Open Questions.

## Responsive & Platform

- **Mouse is optional, not equal.** Ink has no built-in mouse support — this is a flagged architecture risk, not a settled capability. Mouse-drag splitter resize is the target interaction, modeled on bmad-loop's Splitter widget, but keyboard resize-mode (`Ctrl+W`) is the confirmed-safe fallback if mouse-drag proves infeasible. Every interaction in this spine has a keyboard path; no action is mouse-only.
- **Terminal width/resize.** No specific minimum-width behavior (e.g. a hard floor, a reflow breakpoint, or a "too narrow" message) is decided — deferred, non-blocking. Not designed now; revisit only if narrow-terminal use (e.g. a cramped tmux pane) becomes a real problem in daily use. See Open Questions.
- **Terminal fullscreen rendering.** On launch, the TUI takes over the full terminal via the alternate-screen buffer, sized to the terminal's current rows/columns rather than growing inline with scrollback — consistent with the k9s/lazygit register (see Brand & Style). The original screen content is restored on quit, Ctrl+C, or a crash — no leftover TUI output pollutes the shell afterward. Distinct from the still-deferred narrow-terminal minimum-width question above: this decides *that* the app fills the screen, not *how narrow is too narrow*.
- **Ink FPS/memory ceiling — named, bounded risk.** Ink's documented rendering ceiling (~30 FPS render cap, >50 MB baseline memory) is a known, bounded, monitored risk, not a blocker. It's scoped beyond just the Logs zone to any concurrently-animated surface — e.g. the Update zone's per-service spinners running alongside a live log stream. The debounce/batch mitigation already specified for Logs streaming (see State Patterns) is the first line of defense. `OpenTUI` (same React/TypeScript API, Zig rendering core via Bun) is the pre-identified fallback if this ceiling is ever actually hit in practice — no action is needed now, this is monitored, not scheduled.

## Inspiration & Anti-patterns

- **Lifted from bmad-loop** (Max's own Textual TUI, studied directly): the two-column shell (selectable list left, detail/log right); the Splitter widget (mouse-drag + `Ctrl+W` resize-mode, `Tab` cycles boundary, `Enter`/`Esc` exit); `ModalScreen` (`Escape` cancels); `OptionList` single-activation lists (folded into this spine's `list-row` pattern); `Header`/`Footer` with auto keybinding hints from `Binding(key, action, description)`; status glyph+color pairing; dim-italic secondary text; fixed-width label columns for form alignment; the `border_title` background-counter pattern (e.g. "Runs — ⚑ 2 need attention"), adapted here as the zone-tab background-event badge.
- **Fixed, not lifted, from bmad-loop:** its modal-confirm asymmetry, where the binding available to confirm could differ depending on whether the modal was opened by mouse or keyboard. tui-back's `modal-dialog` rule — `Enter` always confirms, `Esc` always cancels, regardless of trigger method — is an explicit correction of that friction point.
- **Lifted from k9s:** the single always-on top command/filter bar doubling as cross-zone navigation — the basis for this spine's permanent top bar. Two further pieces of k9s's header carry over as well: an ASCII-art banner shown permanently on the Dashboard zone (amended 2026-08-26, Sprint Change Proposal, Story 2.16 — originally on-launch only; see Information Architecture and `DESIGN.md`'s Layout & Spacing), and a dedicated keybinding-palette/help screen — all keys plus their descriptions, beyond what the contextual footer-hint shows — opened via `?` (see Interaction Primitives).
- **Rejected — the generated Swagger UI:** named in the brief as "too cluttered for daily use." The Routes zone is purpose-built and minimal instead of a generic schema browser.
- **Rejected — `update_repo.sh`'s three-way stash/editor/cancel prompt as the whole of error handling:** cited by name as thin. The Update zone's assisted-resolution goes beyond it with an auto-fix-known-safe-cases-first step, a bounded guided menu for everything else, and a re-verify pass before resuming (FR-11).
- **Rejected — `check_health.sh`'s silent auto-restart:** replaced with visible inline health plus a developer-triggered restart control in the Logs zone (FR-18).

## Key Flows

### UJ-1 — Max starts a coding session by switching EDTs

1. Max launches tui-back. The Dashboard zone loads showing the active EDT's services with their state, branch and anomalies; the default highlighted action is "Entrer dans [dernier EDT]".
2. Since today's ticket touches different services, Max instead selects "Choisir un autre EDT / en créer un".
3. In the EDTs zone he creates a new EDT (topic = the ticket name) and selects `micro-users` and `api-gateway` as member services via the `checkbox-list-item` pattern — `Space` toggles each, `Enter` confirms (FR-3).
4. At creation he has the tool create matching dev branches for both services, named after the ticket: he chooses one base branch (default `development`) and one naming mode — grouped (one shared name) or individual (per service) — that apply to the whole creation action (FR-4).
5. The switch to the new EDT auto-preserves any uncommitted work in the outgoing EDT before switching, and every non-member managed repo is put back on `development` (FR-6, FR-8) — surfaced as `✔ EDT créé: JIRA-1532-refund-flow (2 membres)` with dim wink `prêt à l'emploi, à toi de jouer`.
6. Max moves to the Update zone and triggers a group update scoped to the new EDT (FR-10). The list pane shows every managed service with branch + divergence; the detail pane streams per-service progress — a spinner while `api-gateway` pulls, then `✔ micro-users — migrations ok, container restarted` with dim wink `comme sur des roulettes`.
7. **Climax:** the run's summary line accounts for both services explicitly by outcome (`Résumé : 2/2 terminé, 0 échec, 0 skip`) — no ambiguity about whether either was silently skipped.
8. **Resolution:** Max starts coding, confident nothing was silently skipped, and the EDTs zone's branch-visibility view confirms every other service sits safely on `development` (FR-9).

Failure path: if `micro-users` hits a migration failure instead, the run still completes for `api-gateway`; the failure is reported as `✖ micro-users: migration 0042_add_refund_table a échoué` with dim wink `les autres s'en sortent très bien, eux`, and Max re-triggers just that service's migration after a fix (FR-12) rather than the whole run stalling.

### UJ-2 — Max traces a bug mid-session with a saved route request

1. Mid-coding on the EDT from UJ-1, Max opens the Routes zone.
2. He filters (`/`) the global saved-request library and finds the request he needs, even though it was originally saved from a different EDT — the library isn't siloed per EDT (FR-23).
3. He re-fires it as-is, then tweaks one field and re-fires the customized version; the tool asks overwrite-or-save-as-new, and he saves it as a new variant rather than overwriting the original (FR-21).
4. **Climax:** the response and the relevant aggregated logs for the affected services appear together in the same detail pane (FR-22) — no separate terminal to open.
5. **Resolution:** Max spots the issue in the logs, fixes it, and resumes coding without leaving the tool.

Edge case: if this is the first time this exact route has been fired, the tool proposes the default affected-service set (active EDT's members, logs windowed around the fire) rather than asking upfront; Max adds or removes services from that proposal, and the adjustment is saved against the route for every later fire, without asking again (FR-22).

### UJ-3 — Max publishes and propagates a new `shared-types` version

1. With the EDT active whose member services consume the changed type, Max opens the shared-types zone.
2. He either types the version to propagate (field pre-filled with `0.1.`), or triggers publish: the tool runs `shared-types`'s publish command (bump → build → publish → push), with per-step progress and a spinner, verifies the version on the registry and offers to chain into propagation (FR-13).
3. He selects the consuming services via the `checkbox-list-item` pattern and ticks the options: `npm i`, clean restart, commit (FR-15).
4. **Climax:** without editing a single `package.json`, Max sees every selected service rewritten, installed and committed in the same list pane.
5. **Resolution:** the commits contain only `package.json`/`package-lock.json`; nothing was pushed.

Smart-update path: during a group update with the `shared-types` row enabled, steps 2–4 happen automatically before the other services are updated, and `shared-types`-only merge conflicts in consumers resolve by themselves (FR-30, FR-31).

Failure path: a publish step failure names the step and a re-trigger resumes from it (FR-13); a per-service failure is independently retriable (FR-15).

### UJ-4 — Max hits a merge conflict during a group update

1. Max runs a group update (as in UJ-1) and one service diverges beyond a simple lockfile change.
2. The tool detects the conflict isn't the known-safe case (only `package.json`/lockfile dirty auto-resolves silently) and presents the guided menu — stash / open in editor / cancel this repo / cancel the whole run — explaining what's wrong in plain factual terms (FR-11).
3. Max chooses to open the file in his editor, resolves it by hand, and tells the tool to continue.
4. **Climax:** the tool re-verifies the repo's state before resuming the update — it doesn't just trust that Max is done. (A repo already mid-merge/mid-rebase from a previous interrupted run would instead be surfaced as its own distinct state before this same menu applies.)
5. **Resolution:** the update completes for that service and the run's summary line reflects it; Max never had to drop to a separate terminal to figure out what was wrong.

Edge case: canceling this repo alone lets the run continue with the rest; canceling the whole run stops it entirely — either is available from the same menu (FR-11).

## Open Questions

- Terminal minimum-width / narrow-terminal behavior (hard floor, reflow breakpoint, or a "too narrow" message): deferred, non-blocking — not decided now; revisit only if narrow-terminal use (e.g. a cramped tmux pane) becomes a real problem in daily use.
