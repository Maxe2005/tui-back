# Interaction inventory — Story 7.4 (UX-DR36), read-only audit

Scope: `src/adapters/driving/tui/` (abbreviated `T/`). Contract: EXPERIENCE.md "Interaction Primitives" (arrows move, Home/End jump, Space toggle, Enter confirm, Esc cancel, Tab/Shift+Tab cycle, `/` filter; no vim keys per shared/README rule 10; footer + `?` help "generated from focus-nav declarations", FR-33).

Key reducer building blocks that already exist: `moveSelection/jumpSelection/resolveSelection*` (`T/zones/edts/edts-zone.logic.ts:157-190`, clamping, no wrap), `nextTextInputValue` (`T/shared/components/text-edit.ts`), `resolveFocusStep/stepFocus` (`T/shared/keys/focus-navigation.ts`), `handleFilterablePickListKey` (`T/shared/components/filterable-pick-list.tsx:80`), `ModalDialog` (`T/shared/components/modal-dialog.tsx`, onConfirm/onCancel props are never used: every caller passes `() => {}`).

## 1. List cursor / jump

| Surface | Up/Down | Home/End | Other | Ref |
|---|---|---|---|---|
| EDTs zone (3 lists) | yes, clamp | yes | Tab/Shift+Tab pane focus | edts-zone.tsx:732-796, edts-zone.logic.ts:157 |
| Update zone service list | yes | yes | `g/G`,`a/A`,`p/P` = ACTION letters | update-zone.tsx:280-292, 132-151 |
| Routes list / panels | yes | yes (3 sites) | `[h/H]`, `[+/-]` | routes-zone.tsx:1070,1123,1191 |
| Logs services list | yes | NO (Home/End only in filter text editor) | `g` = toggle global (not jump) | logs-zone.tsx:436,512,719 |
| Logs pane grid | arrows move pane focus (4 dirs) | n/a | Ctrl+Up/Down scroll | logs-zone.tsx:691 |
| Dashboard / shared-types | none (ZonePlaceholder) | none | | dashboard-zone.tsx, shared-types-zone.tsx |
| Dialogs: service-actions, modify, delete, create step 2 | yes | yes | | service-actions-dialog.tsx:189, modify-dialog.tsx:279, delete-dialog.tsx:93, step-services.tsx:27 |
| Update service menu / blocker menu / update-config simple | yes | yes | | update-service-menu-dialog.tsx:43, update-config-dialog.logic.ts:404 |
| FilterablePickList (quick-pick, update-service-pick) | yes | NO (Home/End move the text caret) | typing filters | filterable-pick-list.tsx:97 |
| Update config panels / service box, wizard override box, switch resolution | yes (row) | NO | Tab = panel | update-config-panels.logic.ts:190, update-service-box.logic.ts:112 |
| Settings screen | yes | NO | Left/Right tabs | settings-screen.tsx:439-660 |
| Repo registry, reset screen | yes | NO | | repo-registry-screen.tsx:234, reset-screen.logic.ts:87 |
| Command bar / grid | arrows (grid) | NO | | command-bar.tsx:439 |
| Keybinding help | yes | yes | | keybinding-help.tsx:24 |
| Add/switch-confirm/issues dialogs | n/a (no list) | | | |

Note: reset-screen clamps with its own `Math.max/min` (reset-screen.logic.ts:87-92); settings/registry hand-roll cursors too (no shared `moveSelection`). `g` is reserved by EXPERIENCE for top-of-list yet means "group update" in Update and "toggle global filter" in Logs.

## 2. Enter / activate

| Surface | Enter does | Ref |
|---|---|---|
| EDTs list | Switch (or Modify if active EDT) | edts-zone.logic.ts:424, edts-zone.tsx:756 |
| EDT services / other services | open service-actions / add-to-edt | edts-zone.tsx:773,793 |
| Update zone | open service menu | update-zone.tsx:178 |
| Routes list | open request pane | routes-zone.tsx:1375 |
| Logs services | preview (full-screen); Space toggles | logs-zone.tsx:628-676 |
| Dialogs service-actions / update menus | choose highlighted | service-actions-dialog.tsx:201, update-service-menu-dialog.tsx:55 |
| Update config (simple) | `[e]/[Enter]` edit branch; `y` starts run | update-config-dialog.tsx:22, logic:416-425 |
| Update config panels | Enter configure row / Space/Enter change; `y` Lancer | update-config-panels.logic.ts:200-221 |
| Create wizard | Enter = next/confirm per step; Ctrl+N advance | create-wizard.tsx:391 |
| Registry / reset / settings | Enter scans/registers/removes; Enter advances step | repo-registry-screen.tsx:218-273, reset-screen.logic.ts:97-111 |

Divergence: "start" is `y` (update config, panels) vs Enter (every other confirm); Ctrl+N confirms in switch-resolution (logic:347) vs Enter elsewhere.

## 3. Edit / commit / cancel (text)

Text editing is uniform: ALL surfaces use `nextTextInputValue` (text-edit.ts) and render with `TextInputLine` (14 files). Differences are commit/cancel semantics and hint:

| Surface | Commit | Cancel | Ref |
|---|---|---|---|
| Topic (modify, wizard step 1) | Enter | Esc closes dialog | modify-dialog.tsx:335, step-name.tsx:20 |
| Branch edit (wizard step 3, switch-res, override/service boxes) | Enter | Esc (closes field, then box, then dialog) | step-branches.tsx:97-127, switch-resolution.logic.ts:361-370 |
| Logs filter editor | Enter/Esc = "done" (both commit; draft applies live) | none: no true cancel | log-filter-editor.tsx:101-102, logs-zone.tsx:341-410 |
| Routes request rows / filter / raw editor | Enter; raw body: Esc = done, Enter = newline | Esc | routes-zone.tsx:922-1016, 1343-1381 |
| `/` filter modal (app-shell) | Enter | Esc | app-shell.tsx:388 |
| Settings editor-command | Enter | Esc | settings-screen.tsx:172,187 |
| Reset confirm word | Enter when word valid | Esc | reset-screen.logic.ts:104-117 |
| Update config branch | Enter commit | Esc cancel-edit only | update-config-dialog.logic.ts:373-395 |

`TextInputLine` itself prints "[Enter] confirm  [Esc] cancel" (text-input-line.tsx:58) in addition to each dialog's own footer, so hints are duplicated (see 11).

## 4. Toggle (Space)

| Surface | Space | Ref |
|---|---|---|
| CheckboxListItem users: modify, wizard step 2, delete, update config, logs, registry, settings, reset | toggle | step-services.tsx:37, delete-dialog.tsx:105, logs-zone.tsx:628,666, repo-registry-screen.tsx:242,266, reset-screen.logic.ts:93, settings-screen.tsx:184 |
| Wizard step 4 radio | Space/arrows choose | activation.logic.ts:87-93 |
| Switch-resolution box / update service box / override box | Space, Tab, Left/Right all flip mode (3 different key sets) | switch-resolution.logic.ts:379, update-service-box.logic.ts:129, override-box.logic.ts:241 |
| Update config panels | Space or Enter changes | update-config-panels.logic.ts:200-221 |
| Routes filter rules | `[space]` remove | routes-zone.tsx:1349 |
| Settings | Space OR Enter toggles on some rows (settings-screen.tsx:472,493), Space only on others (:184,:521) |

Divergence: Enter sometimes toggles (settings, update panels) although contract says Enter confirms and Space toggles.

## 5. Dialog confirm / cancel

| Dialog | Confirm | Cancel | Ref |
|---|---|---|---|
| switch-confirm | Enter | Esc (blocked while submitting) | switch-dialog.tsx:115-122 |
| delete | Enter | Esc | delete-dialog.tsx:80,113 |
| modify, add-to-edt, service-actions | Enter | Esc | modify-dialog.tsx:271,327; service-actions-dialog.tsx:166 |
| create wizard | Ctrl+N/Enter per step | Esc ("Annuler" or "Quitter" when no EDT) | create-wizard.tsx:387-391,442 |
| issues / result summaries (switch, wizard) | Enter or Esc close | | edts-zone.tsx:723, switch-dialog.tsx:89, create-wizard.tsx:354 |
| update all-repos confirm | Enter | Esc | update-zone.tsx:186-195 |
| update quit-mid-run | `y` OR Enter | `n` OR Esc | update-zone.tsx:199-206 |
| update blocker menu | Enter choose | Esc = `cancel-repo` | update-zone.tsx:214-247 |
| quick-pick / update service pick | Enter (no-op on zero matches) | Esc | filterable-pick-list.tsx:88-110 |
| update config (simple / panels) | `y` | Esc | update-config-dialog.logic.ts:419, panels.logic.ts:178-186 |
| settings | none (immediate) | Esc | settings-screen.tsx:372 |
| keybinding help | none | Esc or `?` | keybinding-help.tsx:56 |

Note: `ModalDialog` ignores `onConfirm/onCancel`; the Enter/Esc contract lives in ~15 hand-written handlers, not in the component.

## 6. Destructive-action confirmation

| Action | Mechanism | Ref |
|---|---|---|
| Delete EDT | modal; Space marks per-branch disposition; Enter confirms; no typed word | delete-dialog.tsx:105-113 |
| Switch discard ("Écraser") | second view; Ctrl+E destroys, Enter/Esc go back | switch-resolution.logic.ts:347,439; view :124,:30 |
| Wizard overwrite on activation | same Ctrl+E pattern | activation.logic.ts:10,56-71 |
| Switch force-switch (blocked) | Enter "force switch anyway" | switch-dialog.tsx:220 |
| Update quit mid-run | y/n or Enter/Esc | update-zone.tsx:199 |
| Update all-repos | Enter/Esc modal | update-zone.tsx:186 |
| Reset data | 3 steps incl. typed confirm word | reset-screen.logic.ts:82-117 |
| Registry clean stale / register | Space select + Enter, no extra confirm | repo-registry-screen.tsx:242-273 |
| Logs clear panes | immediate (`c`, `Ctrl+C`) | logs-zone.tsx:523-526 |
| Routes row delete `[d]` | immediate | routes-zone.tsx:1376 |
| Restart service `R` (logs), clean restart (update) | immediate / menu | logs-zone.tsx:543 |

Divergence: 5 distinct confirmation patterns (Enter, typed word, Ctrl+E, y/n, none).

## 7. Filter

| Surface | Mechanism | Ref |
|---|---|---|
| Global `/` | AppShell "FILTER" ModalDialog | app-shell.tsx:388 |
| Logs | `/` global filter editor, `f` per pane filter, text/regex Tab, level Ctrl+Left/Right, history Up/Down | logs-zone.tsx:341-523, log-filter-editor.tsx:40,101 |
| Routes | `/` or `f` filter, plus `h/H` filter rules, `f` rules in tree | routes-zone.tsx:922,1345-1350 |
| Quick-pick lists | built-in type-to-filter | filterable-pick-list.tsx |
| EDTs / Update lists | `/` goes to the global filter only; semantic unclear | footer.tsx:11 |
| Esc | "clear filter (cascade)" in Logs; none elsewhere | logs-zone.tsx:869 |

## 8. Refresh / retry

No generic refresh key. Retry exists in: update blocker menu "Open in editor, then retry" (update-zone.tsx:218), wizard pause `[R]` (activation.logic.ts:9), `findRetryableFailedRow` + Enter in modify/service-actions (modify-dialog.tsx:239, service-actions-dialog.tsx:179), FailedResultList inline `[Enter] <label>` (failed-result-list.tsx:55), Logs `[R]` restart (logs-zone.tsx:543). Load failures ("Failed to load services/EDTs/branches", edts-zone.tsx:825,857, update-zone.tsx:790, logs-zone.tsx:776, branch-picker.tsx:485) offer NO retry key (reload only by reopening the zone/dialog). Capital `R` in 3 places, `Ctrl+R` fires a request in Routes (routes-zone.tsx:1021) but "revert to global" in wizard/update boxes, and rename in BranchPicker (branch-picker.tsx:357): same chord, 3 meanings.

## 9. Footer / help generation

- Footer: `DEFAULT_FOOTER_HINTS` hand-written strings (footer.tsx:9-18); only the `focus` hint (edts, logs) comes from a declaration (`focusNavFooterHint`, footer.tsx:22-41); `Footer` receives only `zone` (app-shell.tsx:404), so it is NOT context-live for dialogs/modals/panes.
- Zone/dialog hints are hand-written and rendered inline, not in the footer: edts-zone.tsx:845 (`DimAnnotation`), logs-zone.tsx:854-869 (16-line list), routes-zone.tsx:1335-1381, fullscreen-pane.tsx:105, every dialog (see 11).
- Help (`?`): `KEYBINDINGS` hand-written array (keybindings.ts:19-166); only one row (`focusNavKeysLabel('tab')`) derives from focus-nav. Contains ~40 rows, ~30 of them dialog-specific; lacks Routes, Logs (other than `W`), Update letter keys (`g/a/p`), Settings/Registry keys. `focusNavHint()` (focus-navigation.ts:94) is exported but unused.
- Focus-nav primitive adoption (7.7): used by edts pane/form (edts-zone.logic.ts:203,220), logs pane (logs-zone.logic.ts:76), settings tabs (settings-screen.tsx:398,410), wizard/switch two-panel (step-branches.tsx:89, switch-resolution.logic.ts:485), branch-picker mode (branch-picker.tsx:221), routes section (routes-zone.tsx:1038), resize boundary (app-shell.tsx:280, navigation-slice.ts:199), update panels (update-config-panels.logic.ts:181). NOT adopted: `resolveTabNavKey` direct in routes tab (routes-zone.tsx:1024), wizard step Ctrl+N/P via alias (wizard.logic.ts:142), raw `key.tab` checks (logs-zone.tsx:410, update-service-box.logic.ts:121,129, override-box.logic.ts:241, switch-resolution.logic.ts:379), command-bar Tab (command-bar.tsx:474-500; completion semantics, legitimately different). Footer hints exist for only 2 of the 5+ declaring zones.

## 10. Footer-hint wording and order

| Style | Where |
|---|---|
| `[Key] verb` two-space separated, English, capital key | Footer.tsx:9; text-input-line.tsx:58; dialogs (delete-dialog.tsx:149, switch-dialog.tsx:220-225, issues-dialog.tsx:44), update-config-dialog.tsx:22, fullscreen-pane.tsx:105 |
| `[Key] verb • [Key] verb`, French | wizard/switch/update panels/service box/override box (step-branches.tsx:18, create-wizard.tsx:471, activation.logic.ts:9-12, switch-resolution.logic.ts:89, switch-resolution-view.tsx:29-30, override-box.tsx:66, update-service-box.tsx:10, update-config-panels.tsx:31-32) |
| `[key] verb · [key] verb`, lowercase keys | Routes (routes-zone.tsx:1345-1381) and json-tree (json-tree.tsx:93) |
| Prose "Space to toggle, Enter to register" | repo-registry-screen.tsx:297,340,362,390,420 |
| `^W resize` caret notation | footer.tsx:17 vs `Ctrl+W` everywhere else |
| Order of confirm/cancel | `[Enter] confirm [Esc] cancel` (most), `[Esc] ... [Enter]` first (routes), `[Esc] cancel` alone (delete-dialog.tsx:128), confirm-then-nav (wizard) |
| Case of "Esc" | `Esc` (most) vs `esc` (routes) vs `Escape` never |
| Up/Down glyph | `[↑↓]` (footer.tsx:10, routes, json-tree) vs `[↑/↓]` (dialogs, wizard, panels) |

## 11. Modal titles

| Style | Titles | Ref |
|---|---|---|
| UPPERCASE English (majority, 18) | FILTER, SERVICE LISTING ISSUES, SERVICE ACTIONS (x2, edts and update, same string), ADD TO EDT, SWITCH EDT, MODIFY EDT, DELETE EDT, GLOBAL LOG FILTER, PANE LOG FILTER, CONFIGURE GROUP UPDATE, CONFIGURE ALL-REPOS UPDATE, QUIT MID-RUN, ALL-REPOS UPDATE, UPDATE BLOCKED, UPDATE SERVICE, REPO REGISTRY, COMMAND, SETTINGS, KEYBINDINGS | modal usages above |
| UPPERCASE English with " — SELECT" suffix | `SWITCH EDT — SELECT`, `MODIFY EDT — SELECT`, `DELETE EDT — SELECT`, `CREATE FROM EDT — SELECT` | quick-pick-dialog.tsx:44-49 |
| Title-case mixed FR | `EDT Wizard: Création d'un espace de travail` | create-wizard.tsx:46 |
| UPPERCASE French | `CONFIGURER LA MISE À JOUR`, `... · TOUS LES REPOS`, `PARAMÈTRES GLOBAUX`, `RÉSUMÉ ET EXCEPTIONS PAR SERVICE` | update-config-panels.tsx:26-29 |
| DetailPane titles (not modals) sentence case | `All-repos update`, `Group update`, `Route`, `Response`, `Service`, `EDT` | update-zone.tsx:875, routes-zone.tsx:1457 |

Two dialogs exist for the same intent (update config): simple EN dialog `UpdateConfigDialog` vs FR `update-config-panels` (layout switch at update-zone.tsx:587).

## 12. Empty / loading / error states

No shared component; every surface hand-writes `<Text color=text-dim>` / `colors.error` strings:

| State | Wording variants | Ref |
|---|---|---|
| Loading | "Loading EDTs…", "Loading services…" (6 sites), "Loading services…", "Loading routes…", "Loading branches…", "Loading member status…" (DimAnnotation), "Loading member services…", "Loading action history…" (DimAnnotation), "Loading the summary… Esc to cancel.", FR "Préparation de la résolution…", "Création…", "Activation…" | edts-zone.tsx:824,856,944; update-zone.tsx:62,789; logs-zone.tsx:775; routes-zone.tsx:1309; delete-dialog.tsx:131; reset-screen.tsx:133; switch-dialog.tsx:215; create-wizard.tsx:464 |
| Loading, glyph | `Spinner` only in registry, routes response, update zone | repo-registry-screen.tsx:304-428, routes-response-tab.tsx, update-zone.tsx:834-840; absent for all text "Loading…" |
| Error | "Failed to load X" in colors.error (Text) vs DimAnnotation ("Failed to load action history") vs "Failed to load branches." (with period) | edts-zone.tsx:825,945; branch-picker.tsx:485; branch-autocomplete-input.tsx:146 |
| Empty | "No EDTs yet.", "No registered services available.", "No issues.", "No routes match the filter.", "No response yet — [ctrl+r] fires ...", "No members — only ...", prop-driven `emptyText/noMatchText` in FilterablePickList ("No EDT to select", "No service to select", "No matching EDT"), "No matching command.", "No manifest-carrying repos found here." | edts-zone.tsx:827; modify-dialog.tsx:384; issues-dialog.tsx:20; routes-zone.tsx:1439; routes-response-tab.tsx:26; quick-pick-dialog.tsx:118; command-bar.tsx:557 |
| Per-repo failure | `FailedResultList` shared (6 EDTs dialogs) but Update/Routes/Logs/Registry use their own | failed-result-list.tsx |
| Dashboard/shared-types | custom `Text` + `DimAnnotation` | dashboard-zone.tsx:12-16, shared-types-zone.tsx:15 |

Shared components in use: Spinner (3 files), DimAnnotation (17), FailedResultList (6), ZonePlaceholder (2), BoundedList (10).

## 13. Pick lists

`FilterablePickList` only in quick-pick and update-service-pick (2 users). Hand-rolled list+cursor in: service-actions (ListRow x N), update service menu / blocker menu (own `resolveServiceMenuKey`/`resolveBlockerMenuKey`), settings tabs, registry screen, reset screen, command-grid, wizard step 2, modify members (CheckboxListItem + own cursor). Several of these are short fixed menus (acceptable) but 3 menus (service-actions, update service menu, blocker menu) duplicate the same "ListRow + arrows/Home/End + Enter + Esc" reducer.

## 14. Branch inputs

| Surface | Component | Ref |
|---|---|---|
| Update config (simple) | BranchAutocompleteInput | update-config-dialog.tsx |
| Wizard override box | BranchAutocompleteInput | override-box.tsx |
| Wizard step 3 global line, switch-res global line | `TextInputLine` (+ `SHARED_BRANCH_PLACEHOLDER`), no autocomplete | step-branches.tsx:233-237 |
| Update panels / service box | `SuggestField` (separate autocomplete component) | update-service-box.tsx, update-config-panels.tsx |
| Service-actions, modify, add-to-edt | `BranchPicker` (which itself embeds BranchAutocompleteInput) | branch-picker.tsx |
| Switch resolution box | TextInputLine | switch-resolution-view.tsx |

Three autocomplete implementations (BranchAutocompleteInput, SuggestField, BranchPicker's internal one).

## 15. Mixed French/English user-visible strings

Majority of user-visible text is English. French is confined to 4 clusters (about 90 string literals across 11 files):

1. Create wizard: wizard.logic.ts:30-38,207-223,538-548,618-620; create-wizard.tsx:46,96,442-471; step-services.tsx:79; step-branches.tsx:18,233,237; step-name.tsx:34; step-activation.tsx:54,80,104; activation.logic.ts:9-12; override-box.logic.ts:63-123; override-box.tsx:66,84,89 (while EN in same flow: create-wizard.tsx:88 "Topic must not be empty", step-services.tsx:67-69 "Loading services…").
2. Switch resolution / switch results: switch-resolution.logic.ts:89-101,221; switch-resolution-view.tsx:27-30,56-63,124,180-193,220,230; switch-dialog.tsx:156-184,215 (same dialog's confirm view stays EN at :220-225).
3. Update panels: update-config-panels.tsx:26-32; update-service-box.tsx:10,72,94; update-config-dialog.logic.ts:270,280,289 (inside the otherwise EN simple dialog); update-slice.ts:873 (FR error in an EN store).
4. EDT zone: edts-zone.tsx:564 (FR error in EN zone).
5. Keybindings help mixes EN prose with FR tokens: keybindings.ts:103,139,143,147 ("Configurer", "Écraser", "Adopter").
Mixed-in-one-string: `Mode : ... Créer nouvelle ... Choisir existante` (override-box.tsx:89), `[Créer (Global)]` (wizard.logic.ts:207), "Branche source par défaut:" vs EN "Branch" labels elsewhere.
Note: EXPERIENCE.md Voice and Tone examples are French (`✔ EDT créé: ...`), but the shipped code, README and help are English; no document states a UI language decision.

## Divergences (counts)

| Intent | # | Main divergences |
|---|---|---|
| List cursor / jump | 6 | Home/End missing in Logs services, pick lists, settings, registry, reset, panels; `g` meaning; hand-rolled cursors in 5 places; no wrap everywhere (OK) |
| Enter / activate | 3 | `y` as start key; Ctrl+N confirm in switch-resolution; Enter as toggle |
| Edit / commit / cancel | 4 | Logs filter Enter=Esc=done; raw-body Esc=done; Esc layered; duplicate hints with TextInputLine |
| Toggle | 4 | Space/Tab/Left/Right flip modes; Enter toggles in settings; mixed Space-only/Space+Enter |
| Dialog confirm/cancel | 5 | `y/n` + Enter/Esc; Ctrl+N; read-only Enter-or-Esc close; ModalDialog props unused; Esc="Quitter" |
| Destructive confirm | 5 | Enter / typed word / Ctrl+E / y-n / none (immediate clear, delete row) |
| Filter | 3 | `/` vs `f`; no `/` in EDTs/Update; Esc clear only in Logs |
| Refresh / retry | 4 | No retry for load errors; R/Ctrl+R/Enter-on-row triple semantics |
| Footer / help generation | 6 | Footer not context-live; hint dicts hand-written; help hand-written; `focusNavHint` unused; 2 of 6 zones expose focus hint; raw Tab checks (5) |
| Hint wording/order | 7 | 4 styles, `^W`, `↑↓` vs `↑/↓`, Esc case, order |
| Modal titles | 4 | FR, mixed-case, duplicated "SERVICE ACTIONS", "— SELECT" suffix |
| Empty/loading/error | 5 | no shared component; error vs dim; period vs none; Spinner vs text; FR/EN |
| Text input | 2 | (consistent) hint duplication; Enter/Esc semantics |
| Pick lists | 3 | 3 duplicated menu reducers, FilterablePickList only 2 users |
| Branch inputs | 3 | 3 autocompletes, TextInputLine for branch names without autocomplete |
| Language | ~90 strings | FR clusters 1-5 above |
| Total | about 60 | |

## Proposed canonical choice per intent

| Intent | Canonical (majority / documented) |
|---|---|
| List nav | Up/Down move (clamp), Home/End jump, no vim keys; shared reducer `moveSelection/jumpSelection` extracted to `shared/keys`; every list including settings/registry/reset/panels/pick-list gets Home/End |
| Letter commands | keep letters for commands but never `g/G` (reserve for jump per EXPERIENCE) |
| Enter | confirm/open only; never toggle |
| Space | toggle only |
| Mode flips | Tab/Shift+Tab via `resolveFocusStep` for focus; Space for value toggle; Left/Right only as extras |
| Edit commit/cancel | Enter commits, Esc cancels (no "done"); filter editors included |
| Dialog confirm/cancel | Enter confirm, Esc cancel; Esc layered close-inner-first (documented in help); `y/n` removed; `y` start-key replaced by Enter |
| Destructive | modal + Enter confirm for reversible-ish; Ctrl+E second-step ONLY for irreversible file loss; typed word ONLY for data reset; clears get no confirm but are labelled |
| Filter | `/` opens, Esc clears (documented rule) |
| Retry | `R` (shift) = retry/refresh in current context; load errors show `[R] retry` |
| Footer/help | generate both from a shared declaration list (keys, description, scope, zone/dialog); `Footer` takes active context from store |
| Hint format | `[Key] verb` joined by two spaces, English, `Esc`/`Enter` capitalised, `↑/↓`, `Ctrl+W` |
| Modal title | UPPERCASE English noun phrase, no suffix punctuation (`— SELECT` dropped or kept for quick-pick only) |
| States | `<StateLine kind=loading|empty|error>` shared component: loading = Spinner + "Loading X…", empty = dim "No X yet.", error = error colour "Failed to load X. [R] retry" |
| Text input | keep `nextTextInputValue` + `TextInputLine`, suppress TextInputLine's own hint when host shows a footer |
| Pick list | `FilterablePickList` for filterable; one shared `MenuList` reducer for fixed menus |
| Branch input | one autocomplete (`BranchAutocompleteInput`); retire SuggestField variant or document its separate purpose (commands) |
| UI language | English (code, README, help, majority of strings); decide and document, translate the 5 FR clusters |

## Alignment work list

| # | Item | Size |
|---|---|---|
| 1 | Language decision (one-line doc) + translate FR clusters (about 90 strings across 11 files; tests assert strings) | L |
| 2 | Single keybinding declaration source feeding Footer + `?` help; context-live footer (dialogs/panes push hints); remove hand-written `DEFAULT_FOOTER_HINTS` and `KEYBINDINGS` duplicates; add Routes/Logs/Update/Settings entries | L |
| 3 | Hint formatting helper (`formatHints`) and replace 30+ strings (separators, Esc case, arrows, `^W`) | M |
| 4 | Shared `StateLine` (loading/empty/error + retry) and replace ~25 call sites | M |
| 5 | Shared list-cursor module (`moveSelection`/`jumpSelection`) used by settings, registry, reset, panels, menus; add Home/End | M |
| 6 | Remove `g` collisions (Update `g/G`, Logs `g`), reassign letters; update help/tests | S |
| 7 | Enter-only confirm: replace `y` start-key (2 dialogs), `y/n` quit confirm, Ctrl+N confirm; Enter must not toggle in settings/panels | M |
| 8 | Logs filter editor: Esc cancel, Enter commit (draft revert) | S |
| 9 | Unify duplicated update-config dialogs (simple vs panels) | L (arguably own story) |
| 10 | Unify three menu reducers (service-actions, update service menu, blocker) into one `MenuList` | M |
| 11 | Unify branch autocomplete (BranchAutocompleteInput/SuggestField/BranchPicker) | L (own story) |
| 12 | Raw `key.tab` sites to `resolveFocusStep` (5 sites) | S |
| 13 | Modal title normalisation (4 titles) and `ModalDialog` drop unused `onConfirm/onCancel` or wire them | S |
| 14 | Retry key `R` for load errors in 5 zones + resolve Ctrl+R triple meaning | M |
| 15 | Destructive-confirm guideline doc + align Registry clean / Routes delete | S |

Sizing: S x5, M x6, L x4 (items 1, 2, 9, 11). Total exceeds one story: recommend splitting into (a) 7.4 core = items 3, 4, 5, 6, 7, 8, 12, 13, 15 (hint/state/list/keys consistency, mostly S/M) and (b) follow-ups for 1 (language), 2 (declaration-driven footer/help), 9 and 11 (component unifications) as separate stories or deferred.
