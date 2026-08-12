// adapters/driven/manifest: loads and validates a repo's root .tui-back.yaml, the
// single per-repo activation surface (AD-4). A repo is "managed" iff this file exists
// and validates; its absence is the unmanaged primitive (manifest-not-found) that
// Story 1.5's scan silently skips — never a crash and never name-based special-casing.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { err, ok, type Result } from '../../../core/result.js';
import type { Manifest } from '../../../core/ports/manifest.js';
import { manifestSchema } from './schema.js';

export async function loadManifest(repoPath: string): Promise<Result<Manifest>> {
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

  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
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
