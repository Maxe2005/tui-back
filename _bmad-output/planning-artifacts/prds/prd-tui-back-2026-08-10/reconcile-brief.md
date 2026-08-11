# Reconciliation: Brief + Addendum vs. PRD

**Re-check pass — 2026-08-10.** This is a fresh-context re-run of a prior reconciliation. The prior pass (also dated 2026-08-10, see `.memlog.md` line 18) found 12 gaps total across this document and `reconcile-research.md`; all 12 were resolved directly in the PRD. Of those 12, the 7 that were brief/addendum-specific (this document's prior scope) are individually re-verified as resolved below. Since that prior pass, the PRD gained two substantial changes — a multi-EDT membership model (§4.2, FR-3/FR-6/FR-8/FR-9) and a new FR-23 (global saved-request library across EDTs) — which this pass checks with particular care for consistency against the brief/addendum's stated codebase model and Non-Negotiable Constraints, in addition to a full fresh Must/Non-Goal/persona/addendum mapping.

**Inputs compared:**
- `_bmad-output/planning-artifacts/briefs/brief-tui-back-2026-08-07/brief.md`
- `_bmad-output/planning-artifacts/briefs/brief-tui-back-2026-08-07/addendum.md`
- `_bmad-output/planning-artifacts/prds/prd-tui-back-2026-08-10/prd.md`

**Method:** Read all three documents in full, with no reliance on the prior reconciliation report's conclusions beyond using it as a checklist to re-verify. Mapped every brief Must-scope item, Non-Negotiable Constraint, persona nuance, and Won't-scope boundary to its PRD counterpart (FR, NFR, Constraint, Non-Goal, or Glossary entry). Mapped every addendum finding (repo inventory, legacy script behaviors, the RPC orphaned-message-pattern audit stat, the zombie `micro-bookings` repo, "no manifest/service registry exists" finding) to its PRD counterpart. Separately traced the two new additions (multi-EDT membership, FR-23) against the brief/addendum's codebase model (13 folders / gateway + 9 microservices + `shared-types`, no existing manifest/registry) and against every Non-Negotiable Constraint and Non-Goal, looking specifically for contradiction — not just absence. Flagged only items dropped, weakened, or contradicted by the current PRD text — not the PRD's known, intentional elaborations beyond the brief (branch creation, non-member-repo branch enforcement, route explorer reclassified as core, multi-EDT membership, FR-23 itself — none of these were stated *or ruled out* by the brief, so their addition alone is not a gap).

---

## Gaps Found

No new gaps found in this pass, and no regressions in the 7 previously-fixed brief-specific gaps. See the two sections below for the re-verification detail and the specific checks run against the two new additions.

---

## Re-Verification of the 7 Prior Brief-Specific Gaps

1. **"Navigation must never be confusing enough to cause outright rejection"** — present verbatim in `Constraints and Guardrails` → *Trust — Usability*: "Navigation must never be confusing enough to cause outright rejection of the tool — a non-negotiable bar carried from the brief, not a polish item to defer." Confirmed resolved.

2. **"Single source of truth" as a blanket constraint** — present as its own named subsection, `Constraints and Guardrails` → *Trust — Single Source of Truth*: "The tool must never force a developer to check another source to get the full picture. This is a blanket bar, not a per-feature one — FR-9..., FR-18..., and FR-22... are instances of it today, and any feature added later is expected to satisfy it too." Confirmed resolved — and note this section already anticipates future features (like FR-23, added after this constraint was written) inheriting the bar by default, which is exactly the erosion risk the original gap flagged.

3. **"UI/UX approach" as an undecided Must-scope technical foundation** — present as §8 Open Question 2: "This PRD resolves the other three but leaves navigation model, screen structure, and keybinding conventions undecided... Recommend resolving via `bmad-ux`." Confirmed resolved (tracked explicitly rather than silently dropped, which was the original gap's concern).

4. **Vision's "hand it to someone else" ambition** — present in §1 Vision: "The long-run ambition sits beyond even the second project: not just personal reuse, but something solid enough to hand to someone else facing the same 'everything around the code is manual' problem on their own backend." Confirmed resolved.

5. **Secondary-persona "just works, not an efficiency argument" pitch nuance** — present in §2.1: "the pitch that lands with this audience is a setup that 'just works' out of the box, not an efficiency argument aimed at a developer already fluent in the manual way." Confirmed resolved.

6. **FR-13 (shared-types publish) weaker error-handling bar than FR-11/FR-12** — FR-13's consequences now read: "the tool re-verifies before marking the version published — the same detect → fix → re-verify guarantee as FR-11/FR-12, applied here too," plus a dedicated resume-from-failed-step consequence. Confirmed resolved.

7. **RPC orphaned-message audit (31%) missing from PRD** — present in §4.5 description: "The cost of low visibility today isn't hypothetical: an internal audit of declared vs. used RPC message patterns across services found 31% orphaned/dead code — invisible without dedicated cross-service tooling." Confirmed resolved.

---

## Consistency Check: Multi-EDT Membership Model (§4.2, FR-3/FR-6/FR-8/FR-9)

Checked specifically against: the brief's codebase model, all five Non-Negotiable Constraints, and the Won't-scope boundaries.

- **Codebase model (13 folders, gateway + 9 microservices, no manifest/registry):** No contradiction. Multi-EDT membership is a workspace-management concept layered on top of the addendum's repo inventory, not a claim about the repos themselves. The addendum's "shared microservice used across several concurrent workstreams" scenario (a service like `micro-users` touched by two different tickets at once) is exactly the kind of situation this model is built for, and nothing in the addendum's audit (branch-naming conventions, container-naming-by-convention, no registry) implies or requires service-to-EDT exclusivity.
- **No data loss on EDT switch:** Holds under the multi-membership model. FR-6 and FR-8 both explicitly carry the "same no-data-loss guarantee" forward regardless of which EDT(s) a service belongs to; a service losing its "member" status for the *newly active* EDT still gets its uncommitted work auto-preserved before being moved to `development` (FR-8), the same as any other non-member repo.
- **Git write access limited to developer's own feature/fix branches; `development`/preprod/prod read-only; EDT never claims a shared branch:** Holds. A service registered to two EDTs simply has two different developer-owned branches, one per EDT (FR-3's consequence: "each EDT records and tracks its own branch for that service independently") — never a shared/protected branch, and FR-7's rejection rule is unaffected by how many EDTs reference the service.
- **"Navigation must never be confusing" / "single source of truth":** No contradiction found, though worth noting for the PM: the Glossary's EDT definition (§3) doesn't itself state the multi-membership rule (it's introduced only in §4.2's feature description and the individual FRs) and FR-9's branch/divergence view doesn't show *which* EDT(s) a shared service belongs to, only its current branch. Neither of these is a brief/addendum contradiction — the brief never described EDT membership rules in enough detail to compare against — so this is not logged as a gap, but it's a candidate follow-up for `bmad-ux`/architecture given the Usability and Single-Source-of-Truth bars are already flagged as non-negotiable.
- **Won't-scope / Non-Goals:** No interaction — multi-EDT membership doesn't touch the AI-copilot exclusion or the second-project validation deferral.

## Consistency Check: FR-23 (Global Saved-Request Library Across EDTs)

Checked specifically against: the brief's route-explorer Must-scope wording, the addendum's codebase model, all five Non-Negotiable Constraints, and the Won't-scope boundaries.

- **Brief's route-explorer wording ("saved/reusable request bodies... as a company-specific module"):** The brief never states saved requests are EDT-scoped or siloed — it's silent on the question, since the brief predates the EDT-per-workspace mechanics being worked out in this level of detail. FR-23's global-library model doesn't weaken or contradict anything the brief actually said about saved requests (reusability, avoiding manual re-auth); if anything it strengthens the "reused, saved request body" framing from the brief's Solution section by making reuse work across every EDT rather than only within one.
- **Codebase model:** No contradiction. FR-23 operates entirely within this single company backend's route-explorer scope (today, `api-gateway` only, per the addendum's audit that it's the sole HTTP-route-exposing repo) — it does not claim or imply cross-backend sharing with the second, structurally different personal project, which stays correctly out of scope per §5's Non-Goal.
- **Single source of truth:** Reinforces rather than threatens this constraint — a global library with per-EDT hide/favorite is explicitly the mechanism for *not* forcing the developer to remember which EDT a request was originally saved in.
- **No data loss / Git Access constraints:** Not implicated — saved requests are tool-managed metadata (method/path/body/headers, hide/favorite flags), not git state or repo content.
- **Won't-scope / Non-Goals:** No interaction.

---

## Nothing to Flag (Full Fresh Mapping, Confirmed Clean)

- All five **Git Access** Non-Negotiable Constraint sub-bullets — present verbatim in `Constraints and Guardrails`, unaffected by the two new additions.
- **No data loss on EDT switch** — present as both a constraint carry-forward and FR-6/FR-8 consequences, holds under multi-EDT membership (see above).
- **No perceptible slowness** — present in Cross-Cutting NFRs with concrete targets (~150ms UI, ~1s log latency).
- **Errors surfaced with detect → fix → re-verify loop** — present via FR-11/FR-12/FR-13, consistently applied (gap 6 above).
- **"Single source of truth"** and **"navigation never confusing"** — both present as named, blanket Trust bars (gaps 1–2 above).
- All three **primary/secondary/tertiary personas** — present in §2.1/§2.2, correctly distinguishing "deferred, not out of scope" (teammates) from "not validated in v1" (second personal project).
- **Craft project framing** — explicitly preserved in §1 Vision's closing paragraph.
- All **Must-scope Scope items** map cleanly to FRs, including "UI/UX approach" now tracked as an explicit Open Question rather than silently dropped.
- All **Won't-scope items** (AI-copilot layer, second-project validation) map cleanly to §5 Non-Goals.
- **Could-scope item** (guided onboarding wizard) — preserved in §6.2 with the same rationale.
- Addendum's **repo inventory / zombie `micro-bookings`** — preserved in the Glossary's "Managed repo" and "Gateway" entries.
- Addendum's **"no manifest or service registry exists anywhere"** finding — directly reflected in FR-2 and the "Manifest" glossary entry.
- Addendum's **RPC orphaned-message audit stat (31%, 544/364/170)** — present in §4.5's motivating description (gap 7 above).
- Addendum's **`shared-types`'s existing `npm run v` release script** — directly absorbed into FR-13.
- The two new additions (**multi-EDT membership**, **FR-23**) — both checked individually above; neither contradicts a Non-Negotiable Constraint, a Non-Goal, or the brief/addendum's stated codebase model. Both read as legitimate elaborations into territory the brief left unspecified, not as departures from anything it committed to.
