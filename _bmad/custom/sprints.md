# Multi-sprint convention (project override — survives BMAD updates)

This project runs several distinct sprints, each with its own epics file and its own sprint-status file.

- Registry: `_bmad-output/sprints/registry.json`. Resolve the sprint with
  `python3 {project-root}/_bmad/scripts/sprint_registry.py resolve [--sprint <id>]` (JSON: `epics_file`, `status_file`, `sprint_id`).
- **Wherever a skill, step or reference says `{planning_artifacts}/epics.md` (or any epics file), use the resolved sprint's `epics_file`.**
- **Wherever it says `{implementation_artifacts}/sprint-status.yaml`, use the resolved sprint's `status_file`.**
  This includes sync-sprint-status, sprint_plan.py `--epic-file/--status-file`, sprint_status.py `--file`, and retrospective epic detection.
- Default = the registry's active sprint. If the user names a story/epic that belongs to another sprint (look the key up in each sprint's
  status file), or passes `--sprint <id>`, use that sprint instead and say so in one line.
- Epic numbers are GLOBAL across sprints (a new sprint continues after the highest epic number: `sprint_registry.py next-epic`).
  Story keys, story files (`{implementation_artifacts}/epic-N/`), epic branches and retro keys therefore never collide.
  `{implementation_artifacts}` stays the single place for story/spec files, whatever the sprint.
- Sprint 1 (epics 1-11) is the legacy sprint and keeps its original paths; do not move its files.
- Sprint lifecycle (new / activate / close / list): skill `bmad-sprint-manage`.
