// adapters/driven/state: the driven implementation of core's StatePort (AD-10, AD-7).
// Persists the active-EDT pointer to XDG_STATE_HOME/tui-back/state.json — JSON, not YAML
// (unlike registry.yaml/edts.yaml), per the story's Code Map. Mirrors
// adapters/driven/edt-registry/index.ts's read/parse/validate shape: ENOENT reads as "no
// active EDT yet" (ok(null)), never an error — a fresh machine has no state.json until the
// first switch writes one.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { err, ok, type Result } from '../../../core/result.js';
import type { StatePort } from '../../../core/ports/state.js';
import type { XdgPaths } from '../xdg/index.js';
import { ensureXdgDir } from '../xdg/index.js';
import { stateSchema } from './schema.js';

export function resolveStateFile(xdg: XdgPaths): string {
  return join(xdg.stateDir, 'state.json');
}

export function createStatePort(stateFile: string): StatePort {
  return {
    readActiveEdt: () => readActiveEdt(stateFile),
    writeActiveEdt: (ulid) => writeActiveEdt(stateFile, ulid),
  };
}

async function ensureStateDir(stateFile: string): Promise<Result<void>> {
  try {
    ensureXdgDir(dirname(stateFile));
    return ok(undefined);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('state-write-error', `Failed to create state directory ${dirname(stateFile)}: ${detail}`);
  }
}

async function readActiveEdt(stateFile: string): Promise<Result<string | null>> {
  let content: string;
  try {
    content = await readFile(stateFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok(null);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('state-read-error', `Failed to read state file ${stateFile}: ${detail}`);
  }

  const trimmed = content.trim();
  if (trimmed === '') {
    return ok(null);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('state-invalid-json', `Invalid JSON in ${stateFile}: ${detail}`);
  }

  const result = stateSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first ? (first.path.length > 0 ? first.path.join('.') : '(root)') : '<unknown>';
    const reason = first ? first.message : 'unknown validation error';
    return err('state-invalid-format', `Invalid state file ${stateFile}: ${field} — ${reason}`, {
      issues: result.error.issues,
    });
  }

  return ok(result.data.activeEdt);
}

async function writeActiveEdt(stateFile: string, ulid: string): Promise<Result<void>> {
  const ensured = await ensureStateDir(stateFile);
  if (!ensured.ok) {
    return ensured;
  }

  try {
    await writeFile(stateFile, JSON.stringify({ activeEdt: ulid }, null, 2), 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('state-write-error', `Failed to write state file ${stateFile}: ${detail}`);
  }
  return ok(undefined);
}
