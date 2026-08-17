// core/edt/create: the core use-case for creating a new EDT (Environment de Développement
// Temporisé). Returns a Result containing the EDT's ulid on success, or an error on failure.
// AD-7: one SQLite per EDT — the DB file lives at edtsBaseDir/<ulid>.db, a sibling of the
//       EDT directory (edtsBaseDir/<ulid>/), not nested inside it.
// AD-4: the .tui-back.yaml manifest is written with non-empty, ulid-based placeholder values
//       (service/container/migrationCommand are stubs — story 2.5 "modify an EDT" is where a
//       user fills in the real values) and validated through the caller-supplied
//       ManifestPort, the same zod schema every other manifest consumer enforces.
// AD-6: the EDT is also recorded in a dedicated EDT registry (ports/edt-registry.ts, not
//       RegistryPort's { repos: string[] } shape — an EDT entry isn't a repo path) under the
//       same per-resource advisory lock (AD-9) register/reset already use for their own
//       registry writes, so concurrent `edt create` runs don't race the read-modify-write.
// AD-1: core/ never imports adapters/ — XDG paths and every port (manifest, EDT registry,
//       lock) are provided by the caller (CLI/TUI composition root). Direct node:fs and the
//       `ulid`/`better-sqlite3` packages are plain runtime deps, not adapters, so importing
//       them here doesn't cross the boundary (mirrors this file's pre-existing node:fs use).
//
// Story 2.1 review (2026-08-17): AC3 (git branch `edt-<ulid>` + the AD-8 branch-scope safety
// gate) is explicitly deferred to story 2.2 — see deferred-work.md. createEdt does not touch
// git; it takes no repo/service selection, which is what 2.2's branch semantics need.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ulid as generateUlid } from 'ulid';
import { stringify } from 'yaml';
import { withActionLock } from '../locking.js';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestPort } from '../ports/manifest.js';
import { err, ok, type Result } from '../result.js';

export interface CreateEdtParams {
  edtsBaseDir: string;
  manifest: ManifestPort;
  edtRegistry: EdtRegistryPort;
  lock: LockPort;
  edtRegistryResourceKey: string;
}

export async function createEdt(params: CreateEdtParams): Promise<Result<string>> {
  const { edtsBaseDir, manifest, edtRegistry, lock, edtRegistryResourceKey } = params;

  const ulid = generateUlid();
  const edtDir = join(edtsBaseDir, ulid);
  const dbPath = join(edtsBaseDir, `${ulid}.db`);

  if (existsSync(edtDir)) {
    return err('edt-creation-failed', `EDT directory already exists: ${edtDir}`);
  }

  try {
    mkdirSync(edtDir, { recursive: true });
  } catch (createError) {
    return err('edt-creation-failed', `Failed to create EDT directory ${edtDir}`, createError);
  }

  const rollback = (): void => {
    try {
      rmSync(edtDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`Failed to clean up EDT directory ${edtDir} after a failed creation:`, cleanupError);
    }
    try {
      rmSync(dbPath, { force: true });
    } catch (cleanupError) {
      console.error(`Failed to clean up EDT database ${dbPath} after a failed creation:`, cleanupError);
    }
  };

  // Write state.json (transient state — AD-7)
  const statePath = join(edtDir, 'state.json');
  const stateInit = JSON.stringify({ ulid, createdAt: new Date().toISOString(), status: 'active' }, null, 2);
  try {
    writeFileSync(statePath, stateInit, 'utf8');
  } catch (stateError) {
    rollback();
    return err('edt-creation-failed', `Failed to write state.json at ${statePath}`, stateError);
  }

  // Write .tui-back.yaml (AD-4) with non-empty, ulid-based placeholder values, then validate
  // it through the caller's ManifestPort — the same zod schema loadManifest enforces
  // everywhere else, so a manifest this use-case writes is guaranteed loadable by the rest
  // of the system.
  const manifestPath = join(edtDir, '.tui-back.yaml');
  const placeholderManifest = {
    service: `edt-${ulid}`,
    container: `edt-${ulid}`,
    migrationCommand: 'true',
    modules: {},
  };
  try {
    writeFileSync(manifestPath, stringify(placeholderManifest), 'utf8');
  } catch (manifestWriteError) {
    rollback();
    return err('edt-creation-failed', `Failed to write .tui-back.yaml at ${manifestPath}`, manifestWriteError);
  }

  const validated = await manifest.load(edtDir);
  if (!validated.ok) {
    rollback();
    return err(
      'edt-creation-failed',
      `Generated .tui-back.yaml at ${manifestPath} failed manifest validation`,
      validated.error,
    );
  }

  // Create the SQLite database (AD-7) as a sibling of the EDT directory, at
  // edtsBaseDir/<ulid>.db — better-sqlite3 gives a real, valid (empty) SQLite file rather
  // than a 0-byte placeholder. Real schema/migrations land in stories 2.2+.
  try {
    new Database(dbPath).close();
  } catch (dbError) {
    rollback();
    return err('edt-creation-failed', `Failed to create SQLite database at ${dbPath}`, dbError);
  }

  // Record the EDT in the EDT registry (AD-6/Task 2), under the same advisory-lock pattern
  // register/reset already use for their own registry writes (AD-9).
  const registered = await withActionLock(lock, edtRegistryResourceKey, () =>
    edtRegistry.add({ ulid, branch: `edt-${ulid}`, createdAt: new Date().toISOString(), status: 'active' }),
  );
  if (!registered.ok) {
    rollback();
    return registered;
  }

  return ok(ulid);
}
