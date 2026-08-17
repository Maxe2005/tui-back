// adapters/driven/edt-registry: the driven implementation of core's EdtRegistryPort.
// Persists created-EDT entries to XDG_CONFIG_HOME/tui-back/edts.yaml — a dedicated file,
// not registry.yaml (repo paths), mirroring adapters/driven/registry/index.ts's read/parse/
// validate/append shape.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { err, ok, type Result } from '../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { XdgPaths } from '../xdg/index.js';
import { ensureXdgDir } from '../xdg/index.js';
import { edtRegistrySchema } from './schema.js';

export function resolveEdtRegistryFile(xdg: XdgPaths): string {
  return join(xdg.configDir, 'edts.yaml');
}

export function createEdtRegistryPort(edtRegistryFile: string): EdtRegistryPort {
  return {
    add: (entry) => addEdtRegistryEntry(edtRegistryFile, entry),
  };
}

async function ensureEdtRegistryDir(edtRegistryFile: string): Promise<Result<void>> {
  try {
    ensureXdgDir(dirname(edtRegistryFile));
    return ok(undefined);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(
      'edt-registry-write-error',
      `Failed to create EDT registry directory ${dirname(edtRegistryFile)}: ${detail}`,
    );
  }
}

async function listEdtRegistry(edtRegistryFile: string): Promise<Result<EdtRegistryEntry[]>> {
  let content: string;
  try {
    content = await readFile(edtRegistryFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok([]);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('edt-registry-read-error', `Failed to read EDT registry file ${edtRegistryFile}: ${detail}`);
  }

  const trimmed = content.trim();
  if (trimmed === '') {
    return ok([]);
  }

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('edt-registry-invalid-yaml', `Invalid YAML in ${edtRegistryFile}: ${detail}`);
  }

  const result = edtRegistrySchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first ? (first.path.length > 0 ? first.path.join('.') : '(root)') : '<unknown>';
    const reason = first ? first.message : 'unknown validation error';
    return err('edt-registry-invalid-format', `Invalid EDT registry file ${edtRegistryFile}: ${field} — ${reason}`, {
      issues: result.error.issues,
    });
  }

  return ok(result.data.edts);
}

async function addEdtRegistryEntry(edtRegistryFile: string, entry: EdtRegistryEntry): Promise<Result<void>> {
  const ensured = await ensureEdtRegistryDir(edtRegistryFile);
  if (!ensured.ok) {
    return ensured;
  }

  const listed = await listEdtRegistry(edtRegistryFile);
  if (!listed.ok) {
    return listed;
  }

  try {
    await writeFile(edtRegistryFile, stringify({ edts: [...listed.data, entry] }), 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('edt-registry-write-error', `Failed to write EDT registry file ${edtRegistryFile}: ${detail}`);
  }
  return ok(undefined);
}
