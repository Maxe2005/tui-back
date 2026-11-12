---
name: bmad-sprint-manage
description: 'Manage multiple distinct sprints, each with its own epics file and sprint-status file. Use when the user says "new sprint", "nouveau sprint", "list sprints", "switch sprint", "activate sprint", "close sprint" or "which sprint is active".'
---

# Sprint management

Several sprints coexist; each owns an `epics.md` and a `sprint-status.yaml` under `_bmad-output/sprints/<id>-<slug>/` (sprint 1 keeps its legacy paths). Convention: `{project-root}/_bmad/custom/sprints.md`. Registry: `_bmad-output/sprints/registry.json`. All registry writes go through `python3 {project-root}/_bmad/scripts/sprint_registry.py` — never hand-edit the JSON.

Communicate in the project's `communication_language`.

## Intents

- **list / which is active** — `sprint_registry.py list`; show id, name, status, active marker, epic range, and per sprint the `bmad-sprint-planning` status summary if its status file exists.
- **new** — ask for the sprint name and its epics (or take them from the user's message). Run `sprint_registry.py new --name "<name>"` (it allocates `sprint-N`, creates the folder, activates it, and returns `next_epic_number`). Then hand over to `bmad-create-epics-and-stories` to write the sprint's `epics_file`, numbering epics from `next_epic_number` (global numbering, never restart at 1). Finally run `bmad-sprint-planning` (generate) so the sprint's `sprint-status.yaml` exists.
- **activate <id>** — `sprint_registry.py activate <id>`; this is the default target of every BMAD skill.
- **close <id>** — verify every epic of that sprint is `done` in its status file (use `bmad-sprint-planning` status view); if not, list the open items and ask before closing. Then `sprint_registry.py close <id>` and propose activating another sprint.

## Rules

- Epic numbers are global; story files stay in `{implementation_artifacts}/epic-N/`.
- A story/epic key is looked up in the sprint that owns it; to act on a non-active sprint, pass `--sprint <id>` to `resolve`.
- Do not move or rename sprint 1's files.
- External orchestrators (e.g. `bmad-loop`) that read a fixed `sprint-status.yaml` path only see sprint 1; point them to the active sprint's `status_file` explicitly.
