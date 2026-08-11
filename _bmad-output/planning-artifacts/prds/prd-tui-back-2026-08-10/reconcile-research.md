---
title: Reconciliation — Technical Research vs PRD
sourceDocuments:
  - _bmad-output/planning-artifacts/research/technical-typescript-vs-go-local-tui-admin-tool-research-2026-08-07.md
  - _bmad-output/planning-artifacts/prds/prd-tui-back-2026-08-10/prd.md
date: 2026-08-10
pass: 2 (re-run after fixes to the 5 gaps found in pass 1)
---

# Reconciliation: Technical Research → PRD

**Scope note:** The TypeScript-vs-Go decision itself is correctly and explicitly carried forward as settled (PRD §0, §6.1) and is **not** flagged below. This document only checks whether the research's *downstream* implications — concrete roadmap recommendations, monitored risks, and proposed success metrics — are traceable somewhere in the PRD (Vision, NFRs, FRs, Open Questions, or Success Metrics), at whatever light, capability-level mention is appropriate for a PRD.

---

## Prior Gaps — Re-verification (all 5 resolved)

1. **XDG Base Directory conventions.** Now present in Cross-Cutting NFRs ("Local state layout" bullet: `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME`, with the same config/per-EDT-data/transient-state/cache mapping the research proposes) and echoed in §6.1's technical-foundations list. Mapping matches the research's category-by-category breakdown, not just a name-drop. **Resolved, content-accurate.**
2. **Ink's FPS/memory ceiling as a monitored risk.** Now explicit in §8 Open Question 3 ("Ink's documented ceiling (~30 FPS render cap, >50 MB baseline memory — research report) is a monitored risk, not yet observed in practice... No action needed now — revisit only if SM-8 shows it's actually a problem") and reinforced by SM-8. Numbers match the research exactly. **Resolved.**
3. **OpenTUI fallback.** Same Open Question 3: "OpenTUI (same React/TS API, Zig rendering core via Bun) is the pre-identified fallback if the aggregated log view's render frequency or dataset size hits it." Correctly preserves the research's own caveat that OpenTUI is Bun-tied rather than presenting it as a drop-in. **Resolved.**
4. **Debounced/batched log rendering on FR-16.** FR-16's first testable consequence now reads: "Log-stream re-renders are debounced/batched rather than triggering a full redraw per line, so the view stays responsive under multiple concurrent `docker logs -f` streams — a from-day-one requirement, not a later optimization, given Ink's rendering ceiling." This matches the research's Scalability/Performance Patterns finding and Roadmap item 5 (from-day-one, not a later optimization) precisely. **Resolved.**
5. **Research's proposed tech-validation success metrics.** §7 now carries SM-8 (log view responsiveness under real use, explicitly framed as falsifying/confirming the Ink FPS/memory risk) and SM-9 (time-to-first-working-EDT-switch / time-to-first-working-log-stream, explicitly framed as measuring the "near-zero language-adoption cost" claim) — near-verbatim reuse of the research's own KPI wording. The research's third proposed KPI ("zero data races / goroutine-leak-equivalent bugs in log-stream handling") is reasonably left out: the research itself frames it as "trivially satisfied by construction on the TS/event-loop path" now that Go is off the table — it was a comparison artifact of the decision, not an ongoing signal to track post-decision. **Resolved.**

---

## Gaps Found

### 1. Global saved-request library (FR-23) is in tension with the declared "one SQLite file per EDT" storage model, and the PRD never reconciles this

The research's Data Architecture Patterns section grounds the brief's SQLite choice in the **database-per-tenant** pattern specifically: "one file per isolated unit... each unit (here, each EDT/workspace) trivially portable as a single file for backup or inspection... each EDT's SQLite file *is* the tenant boundary." §6.1 of the PRD carries this forward unqualified: "technical foundations: ... `better-sqlite3` (one file per EDT)..." — stated as the storage model, without carve-outs.

FR-23 (reworked in this round) requires exactly the kind of data this pattern doesn't provide a home for: "A developer's saved requests (FR-21) form one global library, not siloed per EDT — a request saved while working in one EDT is discoverable and fireable from any other EDT too." A saved request's core record (route, method, body, headers, name) must be readable and writable from whichever EDT is currently active, which is structurally impossible if the *only* durable store is a file scoped to one EDT at a time — by the pattern's own logic (each file is a tenant boundary; switching EDTs is "closing one file and opening another," per the research), an EDT's own file can't hold data another EDT needs to see. FR-22's learned per-route affected-service set has the same shape: routes are discovered per-repo (FR-19), not per-EDT, so a route's learned correlation plausibly also needs to outlive and span EDTs, which the PRD doesn't scope one way or the other.

This isn't a case of the PRD needing to solve the storage layout (that's rightly `bmad-architecture`'s job, and Open Question 1 already defers the manifest schema there) — it's that §6.1's "one file per EDT" phrasing, inherited directly from the research, now reads as a complete description of storage when FR-23 shows it can't be. Nothing in the PRD flags that a second, global store is also needed, or that "one file per EDT" only describes EDT-*scoped* state.

**Suggested fix:** Soften §6.1's storage bullet to something like "`better-sqlite3`, with per-EDT state in one file per EDT and cross-EDT state (e.g. the FR-23 saved-request library) in a separate global store" — or add a one-line note to FR-23 itself acknowledging its data doesn't fit the per-EDT-file boundary and is deferred to architecture. Either closes the traceability gap without pre-deciding the schema.

---

## Nothing to flag

Everything else swept in this pass is either already covered (carried over from pass 1, re-verified above) or introduces no tension with the research:

- **FR-14/FR-17's new testable consequences** ("status reflects the latest published version, not a cached one"; "a regex filter that doesn't compile is rejected with an inline error") — both are UI/behavior-validation details orthogonal to anything the research addresses; no contradiction.
- **FR-9's ahead/behind divergence display** — the research doesn't cover git branch-divergence UI at all; nothing to reconcile against.
- **The new "Single-instance enforcement" NFR** — actively *reinforces* the research's rationale for `better-sqlite3` ("fits well with a local, single-process TUI... no need for async DB calls to avoid blocking a server request pool") rather than conflicting with it; a second instance would break exactly the single-process assumption the driver choice relies on.
- **FR-22's rework (progressive/learned affected-service correlation)** — the research is silent on the correlation mechanism itself (it only sets the "good-enough, not precise tracing" bar via the brief), so there's no claim in the research this could contradict, beyond the storage-scope question folded into Gap #1 above.
- **SQLite-per-EDT pattern, XDG layout, I/O-bound performance reasoning** — all three are stated in Cross-Cutting NFRs using close-to-verbatim phrasing from the research ("Reliability / blast radius" NFR for the SQLite pattern, "Local state layout" NFR for XDG, "Performance" NFR for the I/O-bound rationale) and remain internally consistent with each other and with the research, aside from the FR-23 tension noted above.
- Roadmap/architecture items already confirmed adequate in pass 1 (hexagonal + plugin pattern, idempotent subprocess scripts, Command-pattern structured stdout/exit-code protocol, least-privilege git-adapter enforcement) remain unaffected by this round's PRD changes.
