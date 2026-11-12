# Sprint Change Proposal — 2026-08-25-2

**Trigger:** manifest `migrationCommand` field must not be mandatory — services without database migrations need a first-class way to declare that.

**Status:** Approved by Max — ready for implementation.

**Scope classification:** Minor (direct implementation by Developer agent, no backlog reorganization, no PRD/epic restructuring).

---

## 1. Issue Summary

`src/adapters/driven/manifest/schema.ts` and `src/core/ports/manifest.ts` currently require every `.tui-back.yaml` manifest to declare a non-empty `migrationCommand` (Story 1.4, *done*, merged into `devlopment`). In reality, not every managed service runs migrations.

This is not a new requirement — it's a latent inconsistency in the project's own artifacts, only now surfaced:

- `epics.md` (Story 3.2 AC, *backlog*) already reads: *"Given a service with no `migrationCommand` declared … Then the migration step is skipped for that service without error."*
- `epic-3-context.md` already reads: *"a service without one skips this step without error."*
- Both were written **after** Story 1.4 shipped a schema that makes the field mandatory, so the AC for a not-yet-built story (3.2) already contradicts the shipped implementation of an already-done story (1.4).
- `ARCHITECTURE-SPINE.md` AD-4 lists `migrationCommand` as a bare required field (unlike `sharedBranch`, explicitly marked optional).
- Most urgently: `src/adapters/driving/tui/shared/repo-registry-screen.tsx` — Story 2.11's onboarding guidance, **currently in review on this branch, not yet merged** — displays `migrationCommand` to the user as a required manifest field. This is the concrete surface that prompted the correction.

## 2. Impact Analysis

**Epic impact:**
- Epic 1 (*done*, merged into `devlopment`): Story 1.4's intent stands; its implementation needs a backward-compatible relaxation (required → optional). No story reopening needed.
- Epic 2 (*in-progress*): Story 2.11 (in review, unmerged) must have its onboarding guidance corrected before merge.
- Epic 3 (*backlog*): already written correctly (Story 3.2 AC, `epic-3-context.md`) — no content change needed, no impact on future implementation.

**Story impact:** None require reopening or re-scoping. Story 1.4 gets one additional AC documenting the omitted-field case; Story 2.11's in-flight implementation gets corrected before it ships.

**Artifact conflicts:**
- Code: `core/ports/manifest.ts`, `adapters/driven/manifest/schema.ts`, `adapters/driven/manifest/index.test.ts`, `adapters/driving/tui/shared/repo-registry-screen.tsx`.
- Planning: `ARCHITECTURE-SPINE.md` (AD-4), `epics.md` (AD-4 summary line + Story 1.4 AC).
- Implementation spec: `spec-2-11-repo-registry-screen-manifest-onboarding-guidance.md` (Code Map field reference).
- PRD: no conflict, no mention of `migrationCommand`, no MVP impact.
- UX designs: no conflict, no mention of `migrationCommand`.

**Technical impact:** Non-breaking, additive relaxation (a required field becomes optional). No data migration, no consumer currently reads `migrationCommand` at runtime outside the manifest loader (Epic 3's group-update consumer doesn't exist yet). `src/core/edt/create.ts`'s placeholder-manifest stub (`migrationCommand: 'true'`) remains valid as-is and is explicitly left unchanged.

## 3. Recommended Approach

**Direct Adjustment (Option 1).** Relax the schema/port from required to optional, fix the one user-facing surface that currently states the wrong contract (Story 2.11's onboarding text), and correct the two planning documents (architecture spine, epics) so they stop contradicting the already-written Epic 3 AC.

- Effort: Low (one field relaxation + one text correction + two doc edits + test updates).
- Risk: Low (backward-compatible; existing manifests with `migrationCommand` set keep working unchanged).
- Timeline impact: None — folds into finishing Story 2.11 before its merge.

Rejected alternative: a reserved sentinel value (e.g. `migrationCommand: none`) instead of an optional field. Rejected because it introduces a magic string to document/validate/keep in sync everywhere, while the optional-field approach already matches the `sharedBranch` precedent and the wording already committed to `epics.md`/`epic-3-context.md` for Story 3.2.

## 4. Detailed Change Proposals

### Code

**`src/core/ports/manifest.ts`**
```diff
 export interface Manifest {
   service: string;
   container: string;
-  migrationCommand: string;
+  migrationCommand?: string;
   sharedBranch: string;
   modules: Record<string, Record<string, unknown>>;
 }
```

**`src/adapters/driven/manifest/schema.ts`**
```diff
     .object({
       service: z.string().trim().min(1),
       container: z.string().trim().min(1),
-      migrationCommand: z.string().trim().min(1),
+      migrationCommand: z.string().trim().min(1).optional(),
       sharedBranch: z.string().min(1).optional().default('development'),
       modules: z.record(z.string(), moduleConfigSchema),
     })
```
Rationale: absent → `undefined` (no default value — there is no sensible "default migration command"). Present-but-empty/whitespace stays rejected (`.trim().min(1)` still applies when the field is present), so an accidental `migrationCommand: ""` never silently passes as "no migrations".

**`src/adapters/driven/manifest/index.test.ts`**
- Modify the existing AC2 test ("fails with a clear validation error naming the missing field") to drop `migrationCommand` from the missing-field example and use `service`/`container` instead — those remain required.
- Add: manifest omitting `migrationCommand` → `ok`, with `migrationCommand === undefined`.
- Add: manifest with `migrationCommand: ""` (or whitespace-only) present → still `manifest-validation-failed`.

**`src/adapters/driving/tui/shared/repo-registry-screen.tsx`**
```diff
-// Static manifest-creation guidance (Boundaries & Constraints: "always shown alongside
-// scan/register controls — never gated to first launch only"). Field names mirror Story
-// 1.4's zod schema (adapters/driven/manifest/schema.ts): service, container,
-// migrationCommand, modules, optional sharedBranch (default development).
+// Static manifest-creation guidance (Boundaries & Constraints: "always shown alongside
+// scan/register controls — never gated to first launch only"). Field names mirror Story
+// 1.4's zod schema (adapters/driven/manifest/schema.ts): service, container, modules,
+// optional migrationCommand (absent = no migrations to run), optional sharedBranch
+// (default development).
 export const MANIFEST_GUIDANCE_LINES: readonly string[] = [
-  'A repo is managed once it has a root .tui-back.yaml declaring service, container,',
-  'migrationCommand, and modules (sharedBranch is optional, defaults to "development").',
+  'A repo is managed once it has a root .tui-back.yaml declaring service, container,',
+  'and modules (migrationCommand is optional — omit it if the service has no migrations;',
+  'sharedBranch is optional too, defaults to "development").',
   'Create one by hand, or run the /manifest-generator skill inside the target repo.',
 ];
```
`repo-registry-screen.test.tsx` sources `MANIFEST_GUIDANCE_LINES` directly — no hardcoded text to resync there.

**Explicitly left unchanged:** `src/core/edt/create.ts`'s placeholder manifest (`migrationCommand: 'true'`) — still valid, no reason to touch it ahead of Story 2.5.

### Planning artifacts

**`_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md`** (AD-4 rule)
```diff
-- **Rule:** a repo is managed iff it carries a root `.tui-back.yaml`, zod-validated on load, declaring `service` (identity), `container` (docker-compose/container target name), `migrationCommand`, optional `sharedBranch` (default `development` — FR-8), and `modules` (map of module-id → per-module config, e.g. `route-explorer: {scanner: nestjs-openapi, auth: jose-dev-jwt}`). A repo or module absent from a manifest is invisible to every tool action — no special-case code anywhere in `core/`.
+- **Rule:** a repo is managed iff it carries a root `.tui-back.yaml`, zod-validated on load, declaring `service` (identity), `container` (docker-compose/container target name), optional `migrationCommand` (absent means the service has no migrations — a group update skips the migration step for it without error, FR-10/FR-12), optional `sharedBranch` (default `development` — FR-8), and `modules` (map of module-id → per-module config, e.g. `route-explorer: {scanner: nestjs-openapi, auth: jose-dev-jwt}`). A repo or module absent from a manifest is invisible to every tool action — no special-case code anywhere in `core/`.
```

**`_bmad-output/planning-artifacts/epics.md`** — two spots:

a) AD-4 summary line:
```diff
-- **Manifest is the only per-repo activation surface.** A repo is managed iff it carries a root `.tui-back.yaml`, zod-validated on load, declaring `service`, `container`, `migrationCommand`, optional `sharedBranch` (default `development`), and `modules` (module-id → per-module config) (AD-4).
+- **Manifest is the only per-repo activation surface.** A repo is managed iff it carries a root `.tui-back.yaml`, zod-validated on load, declaring `service`, `container`, optional `migrationCommand` (absent = the service has no migrations), optional `sharedBranch` (default `development`), and `modules` (module-id → per-module config) (AD-4).
```

b) Story 1.4 Acceptance Criteria — add an explicit AC for the omitted-field case:
```diff
 **Given** a repo with a root `.tui-back.yaml` declaring `service`, `container`, `migrationCommand`, `modules`
 **When** loaded
 **Then** it validates against the zod schema and exposes the identity/modules to core

+**Given** a repo with a root `.tui-back.yaml` that omits `migrationCommand`
+**When** loaded
+**Then** it validates successfully and the service is treated as having no migrations (consistent with Story 3.2's group-update skip behavior)
+
 **Given** a manifest missing a required field
 **When** loaded
 **Then** loading fails with a clear validation error naming the field — never a generic crash
```

Story 3.2 AC (lines ~1009-1011) and `epic-3-context.md` line 27 are already correct — no change needed there.

**`_bmad-output/implementation-artifacts/epic-2/spec-2-11-repo-registry-screen-manifest-onboarding-guidance.md`** (Code Map — still a live spec, Story 2.11 unmerged):
```diff
-- `src/adapters/driven/manifest/schema.ts` -- manifest field reference (`service`, `container`, `migrationCommand`, `modules`) for the static guidance text
+- `src/adapters/driven/manifest/schema.ts` -- manifest field reference (`service`, `container`, `modules`, optional `migrationCommand`) for the static guidance text
```

### Explicitly out of scope for this change

- `epic-1-context.md`, `1-4-manifest-schema-loader-validation.md`, `1-6-static-module-registry.md` — frozen implementation records of an already-closed, already-merged epic (Epic 1, merged into `devlopment`). Left as historical record; `epics.md`/`ARCHITECTURE-SPINE.md` remain the living source of truth and are the ones corrected above.
- `src/core/edt/create.ts` placeholder manifest — remains valid unchanged.
- PRD, UX designs — no mention of `migrationCommand`, nothing to change.

## 5. Implementation Handoff

**Scope: Minor.** Route directly to the Developer agent (current branch: `story-2-11-repo-registry-screen-manifest-onboarding-guidance`).

**Suggested commit sequence** (atomic, Conventional Commits, per `CLAUDE.md`):
1. `fix(manifest): make migrationCommand optional in schema and port` — items 1–3 above (port, schema, tests).
2. `fix(tui): correct manifest onboarding guidance for optional migrationCommand (story 2.11)` — the onboarding text + its spec Code Map note.
3. `docs(architecture,planning): document migrationCommand as optional (AD-4)` — `ARCHITECTURE-SPINE.md` + `epics.md`.

**Success criteria:**
- `npm test`, `npm run typecheck`, `npm run depcheck` all green.
- A manifest without `migrationCommand` loads successfully; one with an empty/whitespace value still fails validation.
- The repo-registry screen's guidance text no longer states `migrationCommand` as required.
- `ARCHITECTURE-SPINE.md` and `epics.md` no longer contradict Story 3.2's AC / `epic-3-context.md`.

**sprint-status.yaml:** no change needed — no epic/story added, removed, or renumbered; Story 1.4 stays `done`, Story 2.11 stays `review` pending this correction being folded in before merge.
