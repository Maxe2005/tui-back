// adapters/driven/manifest: loads and validates a repo's root .tui-back.yaml, the
// single per-repo activation surface (AD-4). A repo is "managed" iff this file exists
// and validates; its absence is the unmanaged primitive (manifest-not-found) that
// Story 1.5's scan silently skips — never a crash and never name-based special-casing.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { err, ok, type Result } from '../../../core/result.js';
import type { Manifest } from '../../../core/ports/manifest.js';
import { createManifestSchema, manifestSchema } from './schema.js';

const UNKNOWN_MODULE_ISSUE = /^Unknown module id "/;

export interface LoadManifestOptions {
  knownModuleIds?: ReadonlySet<string>;
}

export async function loadManifest(
  repoPath: string,
  options: LoadManifestOptions = {},
): Promise<Result<Manifest>> {
  let content: string;
  try {
    content = await readFile(join(repoPath, '.tui-back.yaml'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return err('manifest-not-found', `No .tui-back.yaml found in ${repoPath}`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('manifest-read-error', `Failed to read .tui-back.yaml in ${repoPath}: ${detail}`);
  }

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('manifest-invalid-yaml', `Invalid YAML in ${join(repoPath, '.tui-back.yaml')}: ${detail}`);
  }

  const schema = options.knownModuleIds ? createManifestSchema(options.knownModuleIds) : manifestSchema;
  const result = schema.safeParse(parsed);
  if (!result.success) {
    // Story 1.6 (AD-5): a manifest naming a module id the tool does not know must fail loudly,
    // naming the offending id AND the repo path it came from. The schema flags the id (it has
    // no repoPath); the loader owns repoPath and assigns the distinct kebab-case code.
    const moduleIssue = result.error.issues.find(
      (issue) => issue.path[0] === 'modules' && UNKNOWN_MODULE_ISSUE.test(issue.message),
    );
    if (moduleIssue) {
      const id = moduleIssue.path[1] as string;
      return err('unknown-module', `Unknown module id "${id}" in ${repoPath}`, {
        issues: result.error.issues,
      });
    }

    const first = result.error.issues[0];
    const field = first ? (first.path.length > 0 ? first.path.join('.') : '(root)') : '<unknown>';
    const reason = first ? first.message : 'unknown validation error';
    return err(
      'manifest-validation-failed',
      `Invalid .tui-back.yaml in ${repoPath}: ${field} — ${reason}`,
      { issues: result.error.issues },
    );
  }

  return ok(result.data);
}
