# Sprint Change Proposal — 2026-11-26: Epic 15, Reliability, Performance and UX Hardening (from the tool audit of 2026-11-25)

Mode: Batch. Scope: **Moderate** (one new epic of 21 stories in sprint 2; two backlog stories moved from sprint 1; 5 FRs and 1 NFR added; AD-1, AD-3 and AD-7 amended; conformance notes on AD-10 and AD-12; no rollback). Sprint: **sprint-2** (`sprint-2-refonte-fichiers-volumineux`), registry range now `12-15`.

## 1. Issue Summary

On 2026-11-25 Max asked for an audit of the tool (user experience, reliability, performance, features), then asked to turn every finding into a new sprint 2 epic. Each finding was checked against the code on `devlopment` (`9a2f90df`); findings marked *(ledger)* come from `implementation-artifacts/deferred-work.md` and were not re-proven.

Baseline at audit time: `npm run typecheck` and `npm run depcheck` green (1902 modules, no violation); `vitest run --configLoader runner` → 313 files, 5717 passed, 1 skipped; CLI `--help` 0.2 s, `dashboard` 0.4 s on 8 repos.

| # | Finding | Evidence | Story |
|---|---------|----------|-------|
| F1 | `npm test` does not start | vite 8.3.8 + rolldown 1.2.19 (locked since `73f50cd0`): `sourcemapPathTransform option: The function returned object` when bundling `vitest.config.ts` | 15.1 |
| F2 | State/config writes are not atomic | plain `writeFile` in `storage/{state,registry,edt-registry,settings}/index.ts`; only `manifest/carry.ts` uses rename | 15.5 |
| F3 | Git calls have no timeout | `runProcess` gets `timeout` only from docker, npm and HTTP callers; restart/migration commands also unbounded *(ledger)* | 15.2 |
| F4 | `fetchBranch` / `fetchRemoteBranch` can prompt | `refs/remote.ts:17,29` lack `GIT_TERMINAL_PROMPT=0` (set by `pullBranch`, restart, migration) | 15.2 |
| F5 | EDT switch not crash-atomic *(ledger)* | three independent read-modify-write cycles over `state.json` / `edts.yaml` | 15.10 |
| F6 | `edt modify` checks out before locking *(ledger)* | step 3 (stash/checkout/restore) runs before `lock.acquire()` in `lifecycle/modify.ts` | 15.11 |
| F7 | TUI never re-syncs CLI/MCP changes | `edt-slice.ts:173` "Not continuously synced via fs.watch/poll" — contradicts AD-10 | 15.6 |
| P1 | Log stream: one store update and one full buffer copy per line | `core/insight/logs/index.ts` `onUpdate()` per line, `getEntry` returns `[...entry.lines]`, `splice(0, …)` per line — contradicts AD-12 | 15.8 |
| P2 | `edt list` reads repos sequentially, `currentBranch` twice per repo | `lifecycle/list.ts:98` *(ledger for the double call)* | 15.12 |
| P3 | Switch processes repos sequentially *(ledger)* | per-repo loop in `edt/switch` | 15.12 |
| P4 | Synchronous `node:fs` in core | `lifecycle/create.ts` (6 calls), `delete.ts` (2) — bypasses ports (AD-1, AD-13) | 15.13 |
| U1 | No `--help` / `--version`, no typo suggestion | `tui-back --version` → `unknown-subcommand`; `edt switch --help` → `invalid-argument`; `edt swich` dumps 6 usage lines | 15.3 |
| U2 | Inconsistent command names | `list-repos` / `edts` / `edt list`, `list-routes` / `routes favorites`, `fire-request` / `request-fire` (also in MCP) | 15.15 |
| U3 | Dashboard never refreshes by itself | `dashboard-body.tsx:176` only ticks the "updated Ns ago" clock | 15.7 |
| U4 | Overlay key leaks *(ledger)* | zones gate `useInput` on the flags they know (`registryScreenOpen`, `filterOpen`, `helpOpen` missing in places) | 15.14 |
| U5 | Forms editable while submitting *(ledger)* | `handleCreateInput` / `handleModifyDialogInput` only guard Enter and Escape | 15.14 |
| U6 | Ended log stream never reconnects | `docker/index.ts:116` reports `log stream ended` and stops | 15.9 |
| U7 | `MaxListenersExceededWarning` (resize) during tests | 11 listeners on `FakeTtyStdout`; probably harness-only, to confirm | 15.1 |
| X1 | Sprint 1 backlog: 4.8 generated files, 4.9 CLI/MCP auto-resolution | `sprint-1/sprint-status.yaml` (both `backlog`) | 15.17, 15.18 |
| X2 | Orphan `tui-back:<ulid>` stashes accumulate *(ledger)* | stashes of repos never revisited by their EDT | 15.16 |
| X3 | No setup diagnosis | — | 15.19 |
| X4 | No operation history | — | 15.20 |
| X5 | 1046-line `deferred-work.md`, untriaged | many entries predate the sprint 2 refactors | 15.4 |

Not included: Story 2.48 (fast-forward the shared branches) stays in sprint 1. It is already implemented and in `review`; it only needs its review closed.

## 2. Impact Analysis

**Epics**
- **New Epic 15** in sprint 2 (`backlog`), 21 stories, four waves: quick wins 15.1-15.4, robustness 15.5-15.9, structure 15.10-15.15, features 15.16-15.21.
- **Epics 12-14**: unaffected. All their stories are `done`; their retrospectives stay `optional`. Epic 15 touches files these epics reorganized, so it must start from `devlopment` once Epics 13 and 14 are merged (both are `in-progress` with every story done).
- **Epic 4 (sprint 1)**: Stories 4.8 and 4.9 move to Epic 15 as 15.17 and 15.18 (text unchanged except paths updated after the sprint 2 moves and the 4.8 → 15.17 cross-reference). Epic 4 has no story left open → `done`.
- **Sprint 2 scope**: it was declared "pure-structure refactoring, no functional change". The overview now limits the refactor contract to Epics 12-14 and states that Epic 15 changes behaviour. The sprint name (`Refonte des fichiers volumineux`) is kept to preserve folder names and branch references.

**Stories**: no existing story's acceptance criteria change. 4.8/4.9 keep their criteria verbatim.

**Artifacts**
- **PRD**: FR-54 (self-describing, consistently named CLI), FR-55 (stash inventory and prune), FR-56 (setup diagnosis), FR-57 (operation history), FR-58 (self-refreshing views), NFR-8 (crash safety and bounded external calls). MVP unaffected: these harden or extend shipped features.
- **Architecture**: AD-1 (no `node:fs` in core, enforced by depcheck), AD-3 (help/version/alias envelope), AD-7 (atomic writes, intent journal, history file). Conformance notes on AD-10 and AD-12: the code had drifted from them. No new AD.
- **UX**: no UX document change required. New TUI surfaces (`:doctor`, `:history`, reconnecting line, external-change notice, auto-refresh setting) follow existing patterns (command bar, bounded overlays, settings rows, AD-19).
- **Secondary**: `README.md` (CLI and MCP tool tables, `doctor`, `history`, `stash`), `AGENTS.md` (test script flag, `node:fs` rule), `docs/tui-back-manifest.md` (15.17), `manifest-generator` skill (15.17), bash completion (generated), `.dependency-cruiser.cjs` (15.13).

**Technical risk**
- 15.10 (switch journal) and 15.12 (concurrent switch) both touch the switch: land 15.10 first.
- 15.15 renames user- and agent-facing names: aliases are mandatory, and no alias is removed in this epic.
- 15.6 (`fs.watch`) behaves differently across platforms: a poll fallback is required.

## 3. Recommended Approach

**Direct adjustment: add an epic.** Every finding is additive or a local fix. No completed work has to be reverted (rollback not viable: nothing to undo), and the MVP is untouched (MVP review not needed).

- Effort: **Medium-High** overall (21 stories). Wave 1 is under a day; 15.10, 15.15, 15.17 and 15.20 are the largest.
- Risk: **Low-Medium**. The riskiest items (switch, renames) are sequenced and guarded by aliases and journals.
- Timeline: wave 1 unblocks everything (the test gate). Waves can overlap once 15.1 is merged.

## 4. Detailed Change Proposals

### 4.1 Stories — new Epic 15 (`sprint-2/epics.md`)

Full text is in `epics.md` § "Epic 15". Summary:

| Story | Title | Covers | Prerequisites |
|---|---|---|---|
| 15.1 | Restore the Test Gate | F1, U7 | — |
| 15.2 | Non-Interactive, Time-Bounded Git | F3, F4 | 15.1 |
| 15.3 | CLI Help, Version and Typo Suggestions | U1 | 15.1 |
| 15.4 | Triage the Deferred-Work Ledger | X5 | — |
| 15.5 | Atomic Persistence Writes | F2 | 15.1 |
| 15.6 | Re-Sync the TUI With External Changes | F7 | 15.1 |
| 15.7 | Dashboard Auto-Refresh | U3 | 15.1 |
| 15.8 | Batched Log Rendering and Ring Buffer | P1 | 15.1 |
| 15.9 | Log Stream Auto-Reconnect | U6 | 15.8 recommended |
| 15.10 | Crash-Safe EDT Switch | F5 | 15.5 |
| 15.11 | Lock Before Checkout in EDT Modify | F6 | 15.1 |
| 15.12 | Bounded-Concurrency Repo Reads and Switch | P2, P3 | 15.10 |
| 15.13 | File-System Port for the EDT Lifecycle | P4 | 15.5 |
| 15.14 | TUI Input Guards | U4, U5 | 15.1 |
| 15.15 | Consistent CLI Command Names | U2 | 15.3 |
| 15.16 | Stash Inventory and Prune | X2 | 15.1 |
| 15.17 | Manifest-Declared Generated Files (ex 4.8) | X1 | 15.2 |
| 15.18 | Update Auto-Resolution in the CLI and MCP (ex 4.9) | X1 | 15.17 |
| 15.19 | `tui-back doctor` | X3 | 15.5, 15.10 for their checks |
| 15.20 | Operation History | X4 | 15.5 |
| 15.21 | Close the Audit | all | all others |

### 4.2 Sprint 1 — Stories 4.8 and 4.9

```
File: sprint-1-delivery-of-tui-back/epics.md
OLD: ### Story 4.8: … (no note)
NEW: ### Story 4.8: …
     > Moved 2026-11-26 to sprint 2 as Story 15.17 (Epic 15, …). The sprint 2 copy is the one to implement; this text is kept for history.
(same for 4.9 → 15.18; the FR-52 coverage line gains "moved 2026-11-26 to sprint 2 Stories 15.17, 15.18")

File: sprint-1-delivery-of-tui-back/sprint-status.yaml
OLD:
  epic-4: in-progress
  4-8-manifest-declared-generated-files-regenerated-on-update-conflict: backlog
  4-9-update-conflict-auto-resolution-in-the-cli-and-mcp: backlog
NEW:
  # 4-8 and 4-9 moved to sprint 2 as 15-17 and 15-18 on 2026-11-26 (…).
  epic-4: done
```

Rationale: Max asked for every audit item in the new epic; keeping one live copy avoids two status keys for the same work.

### 4.3 Sprint 2 — `epics.md` header

```
OLD: Sprint 2 is a pure-structure refactoring sprint: no functional change, no new requirement. …
     Common rules for every story of this sprint (referred to below as the refactor contract):
NEW: Sprint 2 started as a pure-structure refactoring sprint (Epics 12-14 …). Epic 15 (added 2026-11-26 …) does change behaviour …
     Common rules for every story of Epics 12-14 (… it does not apply to Epic 15):
Sprint Contents: + "Epic 15: Reliability, Performance and UX Hardening (added 2026-11-26)"
Front matter inputDocuments: + the PRD
```

### 4.4 PRD (`prds/prd-tui-back-2026-08-10/prd.md`)

New FR-54 to FR-58 appended to §4.1 (after FR-33); NFR-8 appended to Cross-Cutting NFRs; front-matter `updated: 2026-11-26`. Full text in the PRD.

### 4.5 Architecture (`ARCHITECTURE-SPINE.md`)

Amendment blocks added under AD-1, AD-3 and AD-7, and conformance notes under AD-10 and AD-12 (full text in the spine).

### 4.6 Status and registry

- `sprint-2/sprint-status.yaml`: `epic-15: backlog`, 21 story keys `15-1-…` to `15-21-…` (`backlog`), `epic-15-retrospective: optional`; `last_updated: 2026-11-26`.
- `sprints/registry.json`: sprint-2 `epics: "12-15"`.
- `sprint_registry.py check`: ok.

## 5. Implementation Handoff

**Scope: Moderate.** Backlog reorganization (new epic, two stories moved between sprints); no PM/Architect replan needed.

- **Developer agent (`bmad-build`)**: implements the stories in wave order. Git per `CLAUDE.md`: epic branch `epic-15-reliability-performance-and-ux-hardening` from `devlopment` (after Epics 13 and 14 are merged), one story branch per key, atomic Conventional Commits with `(story 15.N)`, `--no-ff` story → epic merges, epic → `devlopment` by PR.
- **Max (PO)**: closes 2.48's review in sprint 1; approves 15.4's triage outcome and any new story it suggests; validates the command names of 15.15 before implementation (the proposed names are a starting point).

**Success criteria**
- `npm test && npm run typecheck && npm run depcheck` green from 15.1 on.
- Every finding of §1 is closed, deferred with a reason, or dropped in the appendix below (Story 15.21).
- No state file can be truncated by a crash; no git/docker/manifest command can hang without a timeout.
- A burst of 10 000 log lines causes a bounded number of store updates; a CLI/MCP switch is visible in an open TUI within about 1 s.

## Appendix — Audit closure (filled by Story 15.21)

| Finding | Outcome | Story / commit |
|---|---|---|
| F1-F7, P1-P4, U1-U7, X1-X5 | pending | — |
