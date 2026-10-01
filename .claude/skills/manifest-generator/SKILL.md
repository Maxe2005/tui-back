---
name: manifest-generator
description: Scan a repository and generate a .tui-back.yaml manifest file for the tui-back tool. The skill analyses the repo structure (package.json, docker-compose.yml, migration scripts, existing config) to populate the manifest fields: service, container, migrationCommand, sharedBranch, protectedBranches, and modules. Use when IA agents need to quickly create manifests for new micro-services or when refactoring existing ones.
---

# BMad Manifest Generator

## Overview

Scans a repository and produces a `.tui-back.yaml` manifest file that declares the repo's service identity, container configuration, migration command, and active modules. The generated manifest is validated against the project's zod schema (AD-4, AD-5) — every module id must be a known compiled-in module id.

## When to Use

- Creating a new manifest for a micro-service that has none
- Refactoring an existing manifest to match the repo's actual structure
- IA agents need to quickly generate a valid manifest without manual schema lookup

## Command Invocation

```bash
uv run --no-cache "{project-root}/_bmad/scripts/render_skill.py" \
  --project-root "{project-root}" \
  --skill "{skill-root}"
```

On success, follow the one absolute `workflow.md` instruction printed to stdout.

## Input

The skill resolves the repo path from one of two sources:

1. **Provided argument** — if the first invocation message or the `--root` flag supplies an absolute path to a repository, use it directly.
2. **Interactive prompt** — if no path is given, ask the user: "Absolute path to the repository to scan?"

## Scanning Logic

The skill walks the repo and extracts values for each manifest field:

| Field | Source | Fallback |
|-------|--------|----------|
| `service` | `package.json` `name` field, or repo basename | `"unknown-service"` |
| `container` | `docker-compose.yml` service names (first service), or `null` | `null` |
| `migrationCommand` | `package.json` `scripts.[migrate]` or `migrate`, or `db:migrate` | `null` |
| `sharedBranch` | Default: `"development"` (never prompt, always default) | `"development"` |
| `protectedBranches` | Default: `[development, preprod, prod]` (never prompt; the developer edits it to match the service's branching model) | `[development, preprod, prod]` |
| `modules` | Compiled-in `knownModuleIds` set (empty by default); if the repo has a `modules` config file or directory, those keys are attempted against the registry — unknown ids are logged but do not block generation | `{}` (empty) |

### Detailed Extraction

1. **`service`**: Read `package.json` (if present) and use the `name` field. If no `package.json`, use the repo directory basename, trimmed of trailing `/` and `-invalid` chars.

2. **`container`**: Read `docker-compose.yml` (if present at repo root). If the file exists and has a `services` top-level key, use the first service name found. If no docker-compose file, set to `null`.

3. **`migrationCommand`**: Read `package.json` `scripts` field. Look for any of: `migrate`, `db:migrate`, `migration`. Use the first found value. If none, set to `null`.

4. **`sharedBranch`**: Always `"development"` — the schema provides this default; the skill does not prompt for it.

4b. **`protectedBranches`**: Always emit `protectedBranches: [development, preprod, prod]`. Since Story 2.42 a service's protected set (FR-7) is exactly `protectedBranches ∪ {sharedBranch}` — nothing is protected implicitly — so the generator writes the usual release branches explicitly. The developer trims or extends the list to match the service's branching model. The field is optional in the schema; every entry must be a non-empty string.

5. **`modules`**: The manifest's `modules` record keys must be members of the compiled-in `knownModuleIds` set (currently empty — Epics 4/6 will populate it). The skill attempts to map any module ids it finds in the repo against this set. Unknown ids are recorded in a `.memlog.md` note but do not prevent manifest generation; the generated manifest will only include known module ids.

## Output

A `.tui-back.yaml` file written at the repo root, with this structure:

```yaml
service: <detected-or-unknown>
container: <detected-or-null>
migrationCommand: <detected-or-null>
sharedBranch: development
protectedBranches: [development, preprod, prod]
modules:
  # only known module ids included; unknown ids logged separately
  <known-id-1>:
    <config-key>: <config-value>
  <known-id-2>: {}
```

If a `.tui-back.yaml` already exists at the repo root, the skill prompts the user before overwriting:

> A `.tui-back.yaml` already exists at <path>. Overwrite?

In headless mode, the existing file is overwritten without prompt.

## Verification of Manifest Definition Stability

The skill includes a self-check: after generating the manifest, it re-loads the generated `.tui-back.yaml` using the project's `loadManifest` adapter and validates it against the current schema. If the schema has changed (e.g., new required fields, changed module-id check), the skill reports a **definition drift** warning with the specific mismatch (e.g., "Schema now requires `migrationCommand` but generated manifest has `null`", or "New unknown-module check would flag module X").

This check is performed by running the project's own validation logic (`src/adapters/driven/manifest/index.ts` `loadManifest`) inside the skill's workflow. The check ensures that manifests generated by earlier versions of the skill remain valid under updated schemas — a form of forward/backward compatibility guard.

## Self-Check / Definition Stability

After writing the manifest, the skill:

1. Calls `loadManifest(repoPath)` using the project's manifest adapter
2. If validation succeeds: normal completion
3. If validation fails with `manifest-validation-failed`: report the specific missing/invalid fields
4. If validation fails with `unknown-module`: list the unknown module ids detected
5. If `manifest-not-found`: should not happen (file was just written), but handle gracefully

The verdict (success or drift warnings) is appended to `.memlog.md` in the repo root for auditability.

## Example

```bash
# Scan a repo and generate manifest
tui-back manifest-generate /path/to/my-micro-service

# Interactive mode (no argument)
tui-back manifest-generate
```

Will produce (example output):

```yaml
service: my-auth-service
container: auth-api
migrationCommand: docker exec my-auth-service npx prisma migrate deploy
sharedBranch: development
protectedBranches: [development, preprod, prod]
modules:
  route-explorer:
    scanner: nestjs-openapi
    auth: jose-dev-jwt
```

## Notes

- The skill never modifies source code — it only creates/overwrites `.tui-back.yaml`
- Module config values are passed through as `Record<string, unknown>` — the schema only validates that module *ids* are known, not the shape of their config
- If the repo has no `knownModuleIds` registered, the generated manifest will have an empty `modules: {}` — this is valid per the schema
- The skill is intentionally conservative: it only includes module ids that are in the compiled-in registry; unknown ids are logged but do not block manifest generation