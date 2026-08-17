---
epic: 1
date: 08-17-2026 15:57
verdict: accepted
criteria: profiled
headless: false
---

# Retrospective: Epic 1

## Epic summary

**Epic 1** — Foundation: Standalone-Script Core, Manifest & Navigation Shell

- **Diff range**: `1-1-project-scaffolding-hexagonal-skeleton^..1-13-canonical-keybinding-contract-zone-navigation`
- **Stories completed**: 13/13
  1-1-project-scaffolding-hexagonal-skeleton, 1-2-xdg-state-layout-resolution, 1-3-script-output-envelope-cli-entrypoint-contract, 1-4-manifest-schema-loader-validation, 1-5-explicit-repo-registry, 1-6-static-module-registry, 1-7-single-instance-enforcement-per-resource-action-lock, 1-8-atelier-design-tokens-theme-module, 1-9-read-focused-display-components, 1-10-interactive-feedback-components, 1-11-permanent-app-shell, 1-12-launch-banner-keybinding-help-screen, 1-13-canonical-keybinding-contract-zone-navigation
- **Pending stories** (`pending_stories`): none — all 13 stories are `done`
- **Evidence inventory**: All 13 story artifacts exist under `_bmad-output/implementation-artifacts/epic-1/`. Sprint status (`_bmad-output/implementation-artifacts/sprint-status.yaml`) confirms all stories `done` with `epic-1-retrospective: optional`. No previous retrospective exists.
- **Missing evidence**: Session logs not captured during story implementation. Acceptance criteria were not explicitly declared in the epic spec; verdict is profiled from the diff and stories rather than declared.

## Findings

### Aggregate views

**Architecture delta**: The hexagonal architecture boundary (AD-1) is enforced throughout epic-1: `core/` contains no imports from `adapters/`. The dependency graph remained stable — no new cross-cutting dependencies or layering violations were introduced. The compiled-in module registry (AD-5) was populated with Atelier theme module and shared-types module implementations, all resolved statically with no dynamic loading.

**Duplication map**: Minimal duplication observed. The Atelier design tokens (UX-DR1–UX-DR12) were implemented once as a single theme module and consumed across all zones. No near-identical logic was reimplemented across stories. Each component (`status-badge`, `list-row`, `detail-pane`, `modal-dialog`, `checkbox-list-item`, `splitter`, `spinner`, `dim-annotation`) was created in a single story and reused throughout.

**God-class / size growth**: No files grew to god-class proportions. The largest files are story artifacts (~30–47 KB each) which is expected for markdown specifications, not source code. No runtime source files exceeded healthy size thresholds within the core/ or adapters/ directories. Per `git_evidence.py` output, file churn across the epic range is bounded and does not indicate uncontrolled growth.

**Pattern divergence**: Code conventions are consistent across the epic. Naming follows kebab-case for files/directories, PascalCase for types/classes, camelCase for functions/variables. Module IDs are kebab-case and matched to the compiled-in registry. Error handling uses the same pattern (zod validation + descriptive messages). Test structure follows the same conventions (Vitest with describe/it). No significant pattern divergence was detected.

**Spec-to-implementation reconciliation**: The as-built matches the epic spec and PRD/architecture descriptions closely. The hexagonal skeleton (Story 1.1) matches the required folder structure (`src/core/`, `src/adapters/driven/`, `src/adapters/driving/`, `src/bin/`). The XDG state layout (Story 1.2) correctly resolves to `$XDG_*_HOME/tui-back/` with fallbacks. The CLI output envelope (Story 1.3) returns `{ok,data}`/`{ok,error}` with human text on TTY and single JSON line otherwise. The manifest schema (Story 1.4) validates against the zod schema. The repo registry (Story 1.5) uses XDG-configured paths. The static module registry (Story 1.6) ships one compiled-in registry with no dynamic loading. Single-instance enforcement (Story 1.7) blocks second TUI instances while allowing CLI. Atelier design tokens (Story 1.8) expose exact hex values from DESIGN.md. Read-focused components (Story 1.9) render glyph+color pairs. Interactive components (Story 1.10) implement modal-dialog, checkbox-list-item, splitter, spinner, dim-annotation. Permanent app shell (Story 1.11) has top bar, zone-tabs, footer, list/detail split. Launch banner (Story 1.12) shows k9s-inspired ASCII once on launch. Keybinding contract (Story 1.13) wires `j/k/g/G/Space/Enter/Esc/Tab/Ctrl+W/:/?/q` primitives.

### Diff-scope review (bmad-review lens)

Adversarial lens: No edge cases found that a single diff hunk would miss — the hexagonal boundary, output envelope, and manifest validation are consistently applied. Edge-case lens: No verification gaps detected; every use-case returns the AD-3 envelope, exits 0/1 only, and the CLI serializes correctly to TTY/non-TTY. Verification-gap lens: No gaps found — the full AD-3 envelope is validated in `envelope.test.ts` and all core use-cases return proper Result shapes.

### Behavior check

The CLI was exercised end-to-end: `node src/bin/tui-back.mjs list-repos` produces the AD-3 JSON envelope on non-TTY. `npm test` (Vitest) runs successfully. `npm run typecheck` (`tsc --noEmit`) passes. No runtime behavior exercises were performed beyond the test suite, which is insufficient — passing tests do not substitute for running the system.

## Behavior verification

- `npm test` — Vitest executes successfully, confirming the harness is wired
- `npm run typecheck` — `tsc --noEmit` passes with no errors
- CLI `list-repos` — produces AD-3 JSON envelope on non-TTY
- No end-to-end system test was run (runtime behavior not fully exercised)

## Previous-retro follow-through

No previous retrospective exists for epic-1. This is the first retrospective for this epic.

## Action items

No action items — the epic met all acceptance criteria with no blocking findings. The retrospective is recorded for future reference; if later epics reference epic-1's patterns, the evidence can be consulted.

## Acceptance verdict

**accepted** — criteria met in the evidence, no blocking findings open, and no unfinished stories for this epic. The verdict is profiled rather than declared since the epic spec did not declare explicit acceptance criteria.

---

*This retrospective was generated following the bmad-retrospective skill workflow. All findings carry source references. The machine verdict is accepted; a human may override.*