// cli/commands/registry: the `registry` verb-dispatch subcommand (clean / validate).
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { err, ok, type Result } from '../../../../core/result.js';
import { classifyStaleRegistry, removeStaleRegistryEntries } from '../../../../core/workspace/scripts/registry/clean-registry.js';
import { validateRegistry } from '../../../../core/workspace/scripts/registry/validate-registry.js';
import { GitPort } from '../../../../core/ports/vcs/git.js';
import { ManifestPort } from '../../../../core/ports/vcs/manifest.js';
import { RegistryPort } from '../../../../core/ports/storage/registry.js';
import { EdtRegistryPort } from '../../../../core/ports/storage/edt-registry.js';
import { LockPort } from '../../../../core/ports/runtime/lock.js';
import { Subcommand } from '../dispatch/dispatch.js';
import { SubcommandDeps } from './deps.js';

const REGISTRY_CLEAN_USAGE =
  'tui-back registry clean (interactive on a TTY) | tui-back registry clean --yes --path <path>...';
const REGISTRY_VALIDATE_USAGE = 'tui-back registry validate';
const REGISTRY_USAGE = `${REGISTRY_CLEAN_USAGE}\n${REGISTRY_VALIDATE_USAGE}`;

// `registry clean` flag parsing + the interactive/scripted split. Scripted mode (--yes with at
// least one --path) never classifies — it removes exactly the given paths. A bare invocation
// always classifies first (so zero candidates is reported the same way regardless of TTY);
// with candidates, a non-TTY run is rejected with confirmation-required (like update's `--all`
// alone), and a TTY run lists every candidate (path + reason + memberOfEdts note) and prompts
// for one whole-list confirmation before removing.
async function runRegistryClean(
  deps: {
    registry: RegistryPort;
    manifest: ManifestPort;
    edtRegistry: EdtRegistryPort;
    lock: LockPort;
    registryResourceKey: string;
    isTTY?: boolean;
  },
  args: string[],
): Promise<Result<unknown>> {
  let yes = false;
  const paths: string[] = [];
  // The same resolved path given via multiple --path flags is deduped so
  // removeStaleRegistryEntries never removes it twice or reports a duplicate row.
  const seenPaths = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--yes') {
      yes = true;
      continue;
    }
    if (flag === '--path') {
      const value = args[i + 1];
      if (value === undefined) {
        return err('invalid-argument', `Missing value for --path. Usage: ${REGISTRY_CLEAN_USAGE}`);
      }
      // A value that looks like another flag (e.g. `--path --yes`) is a missing value in
      // disguise, not a literal path.
      if (value.startsWith('--')) {
        return err(
          'invalid-argument',
          `--path value must not look like a flag: "${value}". Usage: ${REGISTRY_CLEAN_USAGE}`,
        );
      }
      // `--path ""` would resolve() to process.cwd() and could remove an unintended entry —
      // reject an empty/whitespace-only value instead of guessing.
      if (value.trim() === '') {
        return err('invalid-argument', `--path value must not be empty. Usage: ${REGISTRY_CLEAN_USAGE}`);
      }
      const resolved = resolve(value);
      if (!seenPaths.has(resolved)) {
        seenPaths.add(resolved);
        paths.push(resolved);
      }
      i += 1;
      continue;
    }
    return err('invalid-argument', `Unknown registry clean option: "${flag}". Usage: ${REGISTRY_CLEAN_USAGE}`);
  }

  if (yes || paths.length > 0) {
    if (!yes || paths.length === 0) {
      return err(
        'invalid-argument',
        `Scripted use requires --yes together with at least one --path <path>. Usage: ${REGISTRY_CLEAN_USAGE}`,
      );
    }
    return removeStaleRegistryEntries(
      { registry: deps.registry, lock: deps.lock, registryResourceKey: deps.registryResourceKey },
      paths,
    );
  }

  const classified = await classifyStaleRegistry({
    registry: deps.registry,
    manifest: deps.manifest,
    edtRegistry: deps.edtRegistry,
  });
  if (!classified.ok) {
    return classified;
  }
  if (classified.data.candidates.length === 0) {
    // Zero candidates is an explicit "no stale entries" result, reported the same way whether
    // or not the run is interactive. `errors` still surfaces any path that couldn't even be
    // checked, so a healthy-looking run never hides it.
    return ok({ candidates: [], errors: classified.data.errors, results: [] });
  }

  if (deps.isTTY !== true) {
    return err(
      'confirmation-required',
      `registry clean found ${classified.data.candidates.length} stale ` +
        `${classified.data.candidates.length === 1 ? 'entry' : 'entries'} — rerun with --yes --path <path>... to ` +
        `confirm removal. Usage: ${REGISTRY_CLEAN_USAGE}`,
      { candidates: classified.data.candidates, errors: classified.data.errors },
    );
  }

  process.stdout.write(`Stale registry entries (${classified.data.candidates.length}):\n`);
  for (const candidate of classified.data.candidates) {
    const note = candidate.memberOfEdts.length > 0 ? ` [member of EDT: ${candidate.memberOfEdts.join(', ')}]` : '';
    process.stdout.write(`  ${candidate.path} — ${candidate.reason}${note}\n`);
  }
  // A path that couldn't be checked at all is reported too, distinct from the removable
  // candidate list above.
  if (classified.data.errors.length > 0) {
    process.stdout.write(`Could not be checked (${classified.data.errors.length}, left alone):\n`);
    for (const error of classified.data.errors) {
      process.stdout.write(`  ${error.path} — ${error.code}: ${error.message}\n`);
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await rl.question(`Remove ${classified.data.candidates.length === 1 ? 'this entry' : 'these entries'}? [y/N] `);
  } finally {
    rl.close();
  }

  if (!/^y(es)?$/i.test(answer.trim())) {
    return ok({ candidates: classified.data.candidates, errors: classified.data.errors, results: [] });
  }

  const removed = await removeStaleRegistryEntries(
    { registry: deps.registry, lock: deps.lock, registryResourceKey: deps.registryResourceKey },
    classified.data.candidates.map((candidate) => candidate.path),
  );
  if (!removed.ok) {
    return removed;
  }
  return ok({ candidates: classified.data.candidates, errors: classified.data.errors, results: removed.data.results });
}

// `registry validate`: flagless read-only semantic validation over every
// registered path — zero args; any excess arg is an explicit invalid-argument rejection,
// never silently ignored (mirrors list-repos's own zero-flag arity pattern). No isTTY
// gate: read-only output has no prompt path, the envelope owns TTY/JSON rendering.
async function runRegistryValidate(
  deps: {
    registry: RegistryPort;
    manifest: ManifestPort;
    git: GitPort;
  },
  args: string[],
): Promise<Result<unknown>> {
  if (args.length > 0) {
    return err('invalid-argument', `Usage: ${REGISTRY_VALIDATE_USAGE}`);
  }
  return validateRegistry({ registry: deps.registry, manifest: deps.manifest, git: deps.git });
}

export function registrySubcommand(deps: SubcommandDeps): Subcommand {
  return {
    name: 'registry',
    usage: REGISTRY_USAGE,
    // Verb-dispatch subcommand, same shape as `edt` in edt.ts — `clean` and `validate` are the actions, but
    // the dispatch shape leaves room for another registry verb without renaming.
    run: async (args) => {
      if (args[0] === 'clean') {
        return runRegistryClean(deps, args.slice(1));
      }
      if (args[0] === 'validate') {
        return runRegistryValidate(deps, args.slice(1));
      }
      const label = args[0] === undefined ? '(none)' : `"${args[0]}"`;
      return err('invalid-argument', `Unknown registry action: ${label}. Usage:\n${REGISTRY_USAGE}`);
    },
  };
}
