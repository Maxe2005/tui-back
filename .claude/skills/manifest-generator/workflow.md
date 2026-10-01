# Manifest Generator Workflow

**Goal:** Scan a target repository and produce a `.tui-back.yaml` manifest at its root — declaring `service`, `container`, `migrationCommand`, `sharedBranch`, `protectedBranches`, and `modules` — then self-check the generated file against the project's own manifest adapter so schema drift is caught, not silently shipped.

**CRITICAL:** If a step directs you to another snapshot file, read it fully and follow it. No exceptions.

## Conventions

- `{project-root}` is this project (`tui-back`) — the repo this skill lives in, whose adapter code performs the self-check.
- `{target_repo}` is the repository being scanned and manifested — resolved in Step 1. It is a *different* repository from `{project-root}` in the normal case.
- A relative `{target_repo}` argument resolves against the working directory the skill was invoked from, not against `{project-root}`.
- Every write this workflow makes lands only under `{target_repo}` (the manifest, the `.memlog.md` note) — this workflow never modifies source code, in `{target_repo}` or in `{project-root}`.

## HALT

To HALT with a final status and optional blocking condition:

1. If a memlog has already been initialized at `{target_repo}/.memlog.md` (Step 6), append one entry recording the halt: `--type event --text "halted: <status> — <blocking condition, if any>"`.
2. Report the status and blocking condition to the user directly (there is no story file or spec file this workflow writes back to).
3. Stop the workflow.

## On Activation

### Step 1: Resolve the target repository

- If an absolute or relative path was supplied as an argument to this skill, resolve it (relative to the invoking working directory) to an absolute path. Verify it exists and is a directory; if not, HALT with status `blocked` and blocking condition `target repository not found`.
- If no path was supplied, ask the user: "Absolute path to the repository to scan?" Do not guess or default silently.
- Call the resolved absolute path `{target_repo}` for the rest of this workflow.

### Step 2: Check for an existing manifest

- Check whether `{target_repo}/.tui-back.yaml` already exists.
- If it exists **and** this invocation is interactive, ask the user to confirm: "A `.tui-back.yaml` already exists at `{target_repo}/.tui-back.yaml`. Overwrite?" Proceed only on confirmation; otherwise HALT with status `cancelled` and blocking condition `user declined overwrite`.
- If it exists **and** this invocation is headless/non-interactive, proceed straight to overwrite — no prompt.
- If it does not exist, proceed directly.

### Step 3: Scan the target repository

Extract each field by reading files under `{target_repo}` directly (do not guess):

1. **`service`**: Read `{target_repo}/package.json` if present and use its `name` field. If there is no `package.json` or no `name` field, use `{target_repo}`'s directory basename, trimmed of trailing `/` and any trailing `-invalid` suffix. If neither yields a usable value, fall back to `"unknown-service"`.
2. **`container`**: Read `{target_repo}/docker-compose.yml` if present. If it has a top-level `services` key, use the name of the first service listed. If the file is absent, or has no `services` key, treat `container` as undetected for this repo (carry this forward as `null` for now — Step 5 will check whether the real schema still accepts that).
3. **`migrationCommand`**: Read `{target_repo}/package.json` `scripts`. Look for `migrate`, `db:migrate`, `migration`, in that order, and use the first one found. If none exist, treat `migrationCommand` as undetected (`null` for now, same caveat as `container`).
4. **`sharedBranch`**: Always `"development"`. Never prompt for this value.
4b. **`protectedBranches`**: Always `[development, preprod, prod]`. Never prompt for this value. Nothing is protected implicitly — a service's protected set is exactly `protectedBranches ∪ {sharedBranch}` — so the default must be written explicitly; the developer adjusts it afterwards to the service's branching model.
5. **`modules`**: Look for a `modules` config file or directory in `{target_repo}` (e.g. a `modules.json`, `modules.yaml`, or `modules/` directory naming module ids). Collect any ids found as candidates; do not include any of them in the manifest yet — Step 4 filters them against the project's real compiled-in registry.

### Step 4: Filter module ids against the compiled-in registry

- Read `{project-root}/src/adapters/driven/modules/module-registry.ts` and take `knownModuleIds` (the keys of `moduleRegistry`) as the authoritative set — this is the same set the self-check in Step 5 will validate against, so using anything else here would only produce a manifest Step 5 immediately flags.
- Of the candidate module ids collected in Step 3.5, keep only the ones present in that set. Build the `modules` record from those, using whatever config keys/values were found alongside each id (as opaque `Record<string, unknown>`); drop ids not in the set.
- Record every dropped id (with the id and where it was found) to report later — these are not an error, just unknown-to-this-build-of-the-tool ids that stay out of the generated manifest.
- If the registry is empty (no known ids at all — true as of Epics 4/6 not yet landing real modules), `modules` is simply `{}`.

### Step 5: Write the manifest

Write `{target_repo}/.tui-back.yaml`:

```yaml
service: <from Step 3.1>
container: <from Step 3.2, or omit the key entirely if undetected — see note below>
migrationCommand: <from Step 3.3, or omit the key entirely if undetected — see note below>
sharedBranch: development
protectedBranches: [development, preprod, prod]
modules:
  <only ids kept in Step 4>
```

Note on `container`/`migrationCommand` when undetected: this skill's own reference material (`SKILL.md`) describes falling back to a literal `null`. Do not do that without checking first — go to Step 6 before deciding how to render an undetected field, since the self-check there tells you whether the current schema even accepts `null` for these fields. If Step 6 reports that it does not, omit the key from the YAML instead of writing `null`, note the omission in the Step 7 report, and continue — don't block manifest generation on it.

### Step 6: Self-check against the project's own manifest adapter

Determine whether this check is enabled: read `{project-root}/.claude/skills/manifest-generator/customize.toml`'s `workflow.definition_drift_check` value as the default (`true` unless that file says otherwise), then let `{project-root}/_bmad/custom/manifest-generator.toml` and `{project-root}/_bmad/custom/manifest-generator.user.toml` override it if either sets `workflow.definition_drift_check` explicitly (later file wins). Skip straight to Step 7 if the resolved value is `false`.

Otherwise, run the project's real `loadManifest` against the manifest you just wrote, exactly as the project's own code would call it — do not hand-roll an equivalent check:

1. Write a short throwaway TypeScript module (anywhere outside `{project-root}/src`, e.g. under the scratchpad) that:
   - imports `loadManifest` from `{project-root}/src/adapters/driven/manifest/index.ts`
   - imports `knownModuleIds` from `{project-root}/src/adapters/driven/modules/module-registry.ts`
   - calls `await loadManifest({target_repo}, { knownModuleIds })`
   - prints the `Result` as JSON to stdout
2. Run it from `{project-root}` with `npx tsx <path-to-the-throwaway-module>`.
3. Delete the throwaway module once you have the output.
4. Interpret the result:
   - **`ok`**: validation succeeded — normal completion, no drift.
   - **`manifest-validation-failed`**: report the specific missing/invalid field(s) from the error detail (e.g. a required field the scan left out, per the Step 5 note above).
   - **`unknown-module`**: list the unknown module id(s) named in the error — these should already match what Step 4 dropped; if they don't, that mismatch is itself worth flagging.
   - **`manifest-not-found`**: should not happen (the file was just written) — if it does, report it as a definition-drift finding rather than silently retrying.
   - If the failure mode doesn't match the fields this workflow already knows about (i.e. the schema now requires something Step 3 never scans for, or rejects something the schema previously allowed), call this out explicitly as a **definition drift** finding — name the exact mismatch (e.g. "schema now requires `migrationCommand` to be non-empty; this scan produced `null`").

### Step 7: Report and record

1. Report to the user: the fields written (mention that `protectedBranches` was written with its default list and should be adjusted to the service's branching model), any module ids dropped in Step 4 (with reasons), and the Step 6 verdict (success, or the specific drift/validation findings).
2. Record the verdict for auditability: if `{target_repo}/.memlog.md` does not exist yet, create it with `uv run {project-root}/_bmad/scripts/memlog.py init --path {target_repo}/.memlog.md --field topic="manifest generation for <service>"`; then append one entry with `uv run {project-root}/_bmad/scripts/memlog.py append --path {target_repo}/.memlog.md --type event --text "<one-line verdict summary>"`.
3. This workflow is complete. Do not proceed further.
