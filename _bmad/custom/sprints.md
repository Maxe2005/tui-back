# Multi-sprint convention (project override — survives BMAD updates)

This project runs several distinct sprints, each with its own epics file and its own sprint-status file.
One folder per sprint, **same folder name in both trees** (`<sprint>` = e.g. `sprint-2-refonte-fichiers-volumineux`):

```
_bmad-output/
├── sprints/
│   ├── registry.json
│   └── <sprint>/
│       ├── epics.md
│       └── sprint-change-proposal-*.md          # all change proposals of that sprint
├── implementation-artifacts/
│   ├── deferred-work.md                         # shared, sprint-agnostic
│   └── <sprint>/
│       ├── sprint-status.yaml (+ sprint-status-archive.yaml)
│       ├── epic-N-context.md
│       └── epic-N/                              # every story spec / retro of the epic (+ no-epic/ for epic-less specs)
└── planning-artifacts/                          # sprint-agnostic: architecture, prds, ux-designs, briefs, research, readiness reports
```

- Registry: `_bmad-output/sprints/registry.json`. Resolve the sprint with
  `python3 {project-root}/_bmad/scripts/sprint_registry.py resolve [--sprint <id>]`
  (JSON: `sprint_id`, `epics_file`, `status_file`, `sprint_dir`, `artifacts_dir`).
- **Wherever a skill, step or reference says `{planning_artifacts}/epics.md` (or any epics file), use the resolved sprint's `epics_file`.**
- **Wherever it says `{implementation_artifacts}/sprint-status.yaml`, use the resolved sprint's `status_file`.**
  This includes sync-sprint-status, sprint_plan.py `--epic-file/--status-file`, sprint_status.py `--file`, and retrospective epic detection.
- **Wherever it says `{implementation_artifacts}` for story specs, `epic-N/` folders, `epic-N-context.md`, retrospectives or the
  sprint-status archive, use the resolved sprint's `artifacts_dir`.** The only exception is `{implementation_artifacts}/deferred-work.md`,
  which stays at the shared root.
- **Sprint change proposals** (`sprint-change-proposal-*.md`, bmad-correct-course output) are written to the sprint's `sprint_dir`
  (next to its `epics.md`), never to `{planning_artifacts}`.
- Default = the registry's active sprint. If the user names a story/epic that belongs to another sprint (look the key up in each sprint's
  status file), or passes `--sprint <id>`, use that sprint instead and say so in one line.
- Epic numbers are GLOBAL across sprints (a new sprint continues after the highest epic number: `sprint_registry.py next-epic`).
  Story keys, epic branches and retro keys therefore never collide.
- Sprint 1 (epics 1-11) is `sprint-1-delivery-of-tui-back`; it follows the same layout as every other sprint.
- Sprint lifecycle (new / activate / close / list): skill `bmad-sprint-manage`.
