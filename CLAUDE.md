# CLAUDE.md

## Git workflow

- **One branch per epic**, created from the `devlopment` root branch and named after the epic's title in `_bmad-output/planning-artifacts/epics.md` (e.g. `epic-1-foundation-navigation-shell`). It stays alive until the epic is done.
- **One branch per story**, created from that epic branch and named after the story's sprint-status key (e.g. `story-1-3-persistence-port-interfaces-mazerepository-settingsrepository`). Every story is implemented on its own branch — never committed directly to the epic branch.
  - Note: stories 1.1 and 1.2 predate this convention and were committed directly to the epic branch; leave that history as-is. Every story from here on follows it.
- **Commit in atomic steps**: one logical unit of work per commit (e.g. one value object/module plus its tests), not one giant commit per story.
- **Conventional Commits, in English**: a `feat:`/`fix:`/`perf:`/`docs:` subject line, plus a body explaining *why*, not just what.
- **Story numbering must be visible in the subject line** whenever a commit belongs to a story, for quick identification — e.g. `feat(domain): add Cell value object with wall-bit decoding (story 1.1)`.
- **Merge the story branch into its epic branch** with `git merge --no-ff` (keeps a visible merge commit marking the story's contribution) once the story's implementation is complete and reviewed.
- **Merge the epic branch into `devlopment` only once the whole epic is finished and closed** — and only via a pull request, never a direct local merge.
  - Exception: the `/worktree-merge` skill (`.claude/skills/worktree-merge`) is explicitly authorized to merge epic branches into `devlopment` locally (`git merge --no-ff`) when the user invokes it. Outside that skill, the pull-request rule applies.

## Troubleshooting: dependencies in worktrees

- Each git worktree needs its **own** `node_modules`: run `npm ci` at the worktree root (it is git-ignored). Never replace it with a symlink to another checkout's `node_modules`.
- `Cannot find package 'tsx'` when running `node src/bin/tui-back.mjs` means `node_modules` is missing or incomplete in this worktree → run `npm ci`.
- Vitest/Ink failures like `Cannot read properties of null (reading 'useRef')` mean two copies of React are loaded. Look for a stray `node_modules/node_modules` symlink (typically created by an `ln -s ... node_modules` run while the directory already existed) and delete it, plus `node_modules/.vite`; if in doubt, `rm -rf node_modules && npm ci`.
- Never leave a worktree without `node_modules` after a verification run: if one was linked temporarily, remove the link and run `npm ci`.
