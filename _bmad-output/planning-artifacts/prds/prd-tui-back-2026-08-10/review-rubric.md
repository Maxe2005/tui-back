# PRD Quality Review — TUI Admin Tool for a Microservices Backend (prd-tui-back-2026-08-10)

## Overall verdict

This is a well-earned PRD: the single-operator scope keeps it disciplined, the architectural thesis (standalone-idempotent-scripts as the trust mechanism) actually drives feature and NFR choices instead of sitting decoratively in §1, and the tech-bet risk (Ink's rendering ceiling) is surfaced honestly with a named fallback rather than smoothed over. The two structural weak points are mechanical rather than conceptual: FR-14 and FR-17 are the only two of twenty-two FRs with no testable consequences block, which matters precisely because this PRD is chain-top and story creation will lean on that section hardest; and the Assumptions Index (2 entries) likely under-counts the inferences actually made in the FR text (e.g., FR-9's divergence semantics, FR-17's regex-filter scope). Fix those two things and this PRD is ready to hand to `bmad-architecture` and `bmad-ux` as written.

## Decision-readiness — strong

The PRD resists the "everything balances" failure mode. The TypeScript/Ink decision is explicitly not re-argued (§0: "This PRD does not re-argue that decision — it is carried forward as settled"), which is the correct move for a settled prior decision, and the residual risk from that decision is not buried: SM-8 and SM-9 exist specifically to falsify or confirm the tech bet, and Open Question 3 names a concrete fallback ("OpenTUI... is the pre-identified fallback if the aggregated log view's render frequency or dataset size hits it") rather than leaving the risk unaddressed. Open Questions 1 and 2 are genuinely open — no answer is smuggled into the next sentence — and Open Question 2 is tied back to a concrete consequence (the Usability trust bar in Constraints and Guardrails is unresolvable until it's answered).

Non-Goals (§5) name what's given up, not just what's chosen: the AI-copilot exclusion states the actual risk being avoided ("an under-bounded automated executor risks runaway restarts or destroyed in-progress work"), not a placeholder reason.

### Findings
- **low** Single NOTE FOR PM sits at a low-tension checkpoint (§4.1, FR-2 Notes) — deferring the manifest schema to architecture is an uncontroversial, already-expected deferral, not a live tension needing PM judgment. Meanwhile a genuinely judgment-shaped call — "flag if this should be prioritized higher" for AI-assisted manifest bootstrapping (§6.2) — is tagged `[ASSUMPTION]` instead of `[NOTE FOR PM]`, where the rubric's convention would put a prioritization tension. *Fix:* retag the §6.2 bullet as `[NOTE FOR PM]`, since it's asking for a PM prioritization call, not documenting an unconfirmed inference.

## Substance over theater — strong

One persona (Max), no persona padding. The Vision (§1) is specific enough that it could not swap into another PRD unchanged — it names the actual failure mode ("bash scripts that were never built to survive a merge conflict or a failed migration gracefully"), the actual architecture bet, and the actual long-run ambition, rather than reaching for generic language. Cross-Cutting NFRs avoid boilerplate: "Performance" is a quantified bound (~150ms interaction, ~1s log latency) tied to a specific reasoning chain (I/O-bound workload → deciding factor in the TS/Ink choice), not "the system must be performant." "Extensibility" is explicitly self-limited — "(structural, not validated in v1)" — which is the opposite of NFR theater. The 31% orphaned-RPC-pattern stat in §4.5 is a real, sourced data point (verified against the brief's addendum, see Mechanical notes) grounding the observability feature rather than an invented pain point.

No findings — nothing here reads as furniture.

## Strategic coherence — strong

The thesis is explicit and load-bearing: "a single architectural bet: every action the tool performs is a standalone, parameterized, idempotent script" (§1), and every Must-scope feature in §6.1 traces back to that bet (manifest-gated scripts, propagation staged-not-finalized, route explorer built core-first with only scanning/auth pushed to modules). Counter-metrics are present and specific (SM-C1, SM-C2 explicitly forbid trading safety for the speed gains SM-1/SM-3 chase), which is exactly the mechanism the rubric asks for and most PRDs skip.

### Findings
- **low** MVP scope kind is never named explicitly (§6). The scope logic reads as problem-solving/efficiency (every in-scope item removes a specific manual-workflow cost named in §2.1's JTBDs), which is internally coherent, but the PRD doesn't say so in those terms. *Fix:* one sentence at the top of §6, e.g. "This is a problem-solving MVP: scope is bounded by which manual workflows it eliminates for the primary developer, not by breadth of coverage."

## Done-ness clarity — adequate

Twenty of twenty-two FRs carry a "Consequences (testable)" block with genuinely verifiable conditions, and the pattern is used well — e.g. FR-1's idempotency consequence, FR-10's "no service silently absent from the summary," FR-16's debounce requirement tied to a stated rendering ceiling. Vague-adjective language is largely purged or, where it appears, explicitly flagged as unresolved rather than left to stand: "Navigation must never be confusing enough to cause outright rejection" (Constraints and Guardrails, Trust — Usability) is adjective-heavy on its face, but it's pointed at Open Question 2 rather than presented as done.

### Findings
- **high** FR-14 ("See propagation status without a manual check", §4.4) and FR-17 ("Filter the aggregated stream", §4.5) are the only two FRs with no "Consequences (testable)" block at all — no verifiable condition follows the description. This is the exact dimension the rubric asks to be unforgiving on, and it's also the section downstream story creation will pull from directly. *Fix:* add consequences, e.g. for FR-14: "Propagation status for every EDT-member service is shown without the developer running `npm ls`/checking `package.json` by hand" + "Status reflects the latest published version, not a cached one, at the moment it's viewed." For FR-17: "Applying or changing a filter does not interrupt the live stream" + "Regex filters that don't compile are rejected with an inline error, not silently ignored."
- **medium** FR-9 ("Branch and divergence visibility", §4.2) describes divergence as bidirectional ("how far that branch has diverged from its own origin/upstream") but its only testable consequence covers the behind case ("visible when a service's branch is behind its origin"). The ahead case (local commits not yet pushed — plausible and relevant given the tool's own auto-branch-switching behavior in FR-6/FR-8) has no stated consequence. *Fix:* either add an explicit ahead-case consequence or narrow the FR's description to "behind" if ahead-tracking isn't actually intended for v1.

## Scope honesty — adequate

§5 Non-Goals and §6.2 Out of Scope do real work — each item states why, not just what (e.g., the AI-copilot exclusion's runaway-restart risk, the second-project validation's explicit "deferred past this version"). The Assumptions Index round-trips cleanly: both inline `[ASSUMPTION: ...]` tags (FR-3 manual-selection, §6.2 Could-scope flag) are indexed in §9, and nothing in §9 lacks an inline counterpart.

### Findings
- **medium** Only two `[ASSUMPTION]` tags across a 22-FR, 4-UJ document with several other inference points that read as unconfirmed but aren't tagged: FR-9's divergence semantics (ahead/behind vs. a simple boolean — see Done-ness finding above), FR-17's choice to support regex (a specific, non-trivial capability commitment, not just "search"), and FR-21's overwrite-vs-save-as-new UX detail (a specific interaction model, not obviously dictated by the brief). None of these are flagged as inferred. *Fix:* either tag them `[ASSUMPTION: ...]` and add to §9, or confirm in-line that these came from an explicit source (brief/addendum) rather than inference.

## Downstream usability — strong

This PRD explicitly feeds `bmad-architecture` and `bmad-create-epics-and-stories` (§0), so this dimension carries real weight, and it holds up mechanically: FR IDs run 1–22 with no gaps or duplicates, UJ IDs run 1–4, SM IDs run 1–9 plus two counter-metrics, and every FR/UJ cross-reference checked resolves to a real ID (e.g., UJ-1's FR-4/FR-8/FR-9/FR-10/FR-12, UJ-3's FR-13/FR-14/FR-15). The Glossary (§3) is used consistently — EDT, Manifest, Module, Core, Script, Group update, Propagation, Assisted resolution, Route-explorer module, Gateway all appear with stable meaning everywhere they're used, including in the Constraints and Cross-Cutting NFR sections that come after the Features section. Every UJ carries a named protagonist (Max) with entry state, path, climax, and resolution — no floating UJs.

No findings beyond the Done-ness gaps already noted (FR-14/FR-17 lacking consequences also weakens what a story-writer can extract from those two FRs specifically).

## Shape fit — strong

Single-operator internal tool, correctly given a capability-spec shape rather than forced into consumer-product trappings: one persona, JTBD-style framing (§2.1) instead of a persona matrix, and Success Metrics that are operational/self-observed rather than instrumented ("metrics are observed through real daily use, not instrumented telemetry," §7). The four UJs are not overhead here — each illustrates a multi-step, stateful workflow (EDT switch with data preservation, merge-conflict assisted resolution) that a plain FR list would leave ambiguous, so they're pulling real weight rather than padding.

Brownfield accuracy was spot-checked against the linked brief/addendum and holds up: the 31% orphaned-RPC-pattern figure (§4.5) matches the addendum's `audit-messages-pattern.js` finding exactly ("170 orphaned (31%)"), the four legacy script names and behaviors (`update_repo.sh`, `update-services.sh`, `run_migrations.sh`, `check_health.sh`) match the addendum's descriptions, the "~every-2–3-days" cadence (FR-10) matches the addendum's "~11 sessions, July–Aug 2026" evidence, and `micro-bookings`'s zombie status (§3 Glossary) matches the addendum's "no `.git`, no docker-compose... already removed from the gateway."

No findings.

## Mechanical notes

- **Glossary drift:** none found. Term usage (EDT, Manifest, Module, Core, Script, Group update, Propagation, Route-explorer module, Gateway) is stable across Features, Cross-Cutting NFRs, and Constraints sections.
- **ID continuity:** FR-1…FR-22 contiguous, no gaps/duplicates. UJ-1…UJ-4 contiguous. SM-1…SM-9 plus SM-C1/SM-C2 contiguous. All cross-references checked resolve to a defined ID.
- **Assumptions Index roundtrip:** clean — both inline `[ASSUMPTION: ...]` tags (§4.2 FR-3, §6.2) are indexed in §9; both §9 entries have inline counterparts. (See Scope honesty finding above on likely under-tagging elsewhere.)
- **Tag-type mismatch:** the §6.2 `[ASSUMPTION: Could-scope, not required for v1 — flag if this should be prioritized higher]` reads as a prioritization question for the PM, not an unconfirmed inference — better suited to `[NOTE FOR PM]` (see Decision-readiness finding).
- **UJ protagonist naming:** all four UJs name "Max" with concrete entry state/context inline — no floating UJs.
- **Required sections:** all present for this stakes/product-type combination (Vision, Target User, Glossary, Features/FRs, Cross-Cutting NFRs, Constraints and Guardrails, Non-Goals, MVP Scope, Success Metrics, Open Questions, Assumptions Index).
