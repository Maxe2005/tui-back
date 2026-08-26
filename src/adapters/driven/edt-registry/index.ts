// adapters/driven/edt-registry: the driven implementation of core's EdtRegistryPort.
 // Persists created-EDT entries to XDG_CONFIG_HOME/tui-back/edts.yaml — a dedicated file,
 // not registry.yaml (repo paths), mirroring adapters/driven/registry/index.ts's read/parse/
 // validate/append shape.
 // Story 2.15: adds action log methods that read/write to each EDT's SQLite database
 // (edtsBaseDir/<ulid>.db) — the action_log table is created on-demand.
 import { readFile, writeFile } from 'node:fs/promises';
 import { dirname, join } from 'node:path';
 import { parse, stringify } from 'yaml';
 import Database from 'better-sqlite3';
 import { err, ok, type Result } from '../../../core/result.js';
 import type { EdtRegistryEntry, EdtRegistryPort, EdtMember, EdtStatus, EdtActionLogEntry } from '../../../core/ports/edt-registry.js';
 import type { XdgPaths } from '../xdg/index.js';
 import { ensureXdgDir } from '../xdg/index.js';
 import { edtRegistrySchema } from './schema.js';
 
 export function resolveEdtRegistryFile(xdg: XdgPaths): string {
   return join(xdg.configDir, 'edts.yaml');
 }
 
 // Story 2.15: createEdtRegistryPort now accepts edtsBaseDir to access per-EDT SQLite databases
 // for action logging. The port still manages edts.yaml for EDT metadata; the SQLite dbs
 // (one per EDT at edtsBaseDir/<ulid>.db) hold the action_log table.
 export function createEdtRegistryPort(edtRegistryFile: string, edtsBaseDir: string): EdtRegistryPort {
   return {
     add: (entry) => addEdtRegistryEntry(edtRegistryFile, entry),
     list: () => listEdtRegistry(edtRegistryFile),
     setStatus: (ulid, status) => setEdtStatus(edtRegistryFile, ulid, status),
     update: (ulid, patch) => updateEdtEntry(edtRegistryFile, ulid, patch),
     logAction: (ulid, actionType, outcome, detail) => logEdtAction(edtsBaseDir, ulid, actionType, outcome, detail),
     getActionLog: (ulid, limit) => getEdtActionLog(edtsBaseDir, ulid, limit),
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
 
 // Story 2.5: read/find/replace/write one entry in place, mirroring setEdtStatus's shape.
 // Used by modifyEdt to apply topic and/or members changes under the per-resource advisory lock
 // (AD-9). Fails with edt-not-found if ulid isn't registered.
 async function updateEdtEntry(edtRegistryFile: string, ulid: string, patch: { topic?: string; members?: EdtMember[] }): Promise<Result<void>> {
   const ensured = await ensureEdtRegistryDir(edtRegistryFile);
   if (!ensured.ok) {
     return ensured;
   }
 
   const listed = await listEdtRegistry(edtRegistryFile);
   if (!listed.ok) {
     return listed;
   }
 
   const index = listed.data.findIndex((candidate) => candidate.ulid === ulid);
   if (index === -1) {
     return err('edt-not-found', `No EDT registered with ulid ${ulid}`);
   }
 
   const updated = [...listed.data];
   const entry = updated[index];
   if (patch.topic !== undefined) {
     entry.topic = patch.topic;
   }
   if (patch.members !== undefined) {
     entry.members = patch.members;
   }
 
   try {
     await writeFile(edtRegistryFile, stringify({ edts: updated }), 'utf8');
   } catch (error) {
     const detail = error instanceof Error ? error.message : String(error);
     return err('edt-registry-write-error', `Failed to write EDT registry file ${edtRegistryFile}: ${detail}`);
   }
   return ok(undefined);
 }
 
 // Story 2.4: read/find/replace/write, mirroring addEdtRegistryEntry's shape above. Used to
 // flip an EDT's status (active/inactive/interrupted) during a switch.
 async function setEdtStatus(edtRegistryFile: string, ulid: string, status: EdtStatus): Promise<Result<void>> {
   const ensured = await ensureEdtRegistryDir(edtRegistryFile);
   if (!ensured.ok) {
     return ensured;
   }
 
   const listed = await listEdtRegistry(edtRegistryFile);
   if (!listed.ok) {
     return listed;
   }
 
   const index = listed.data.findIndex((candidate) => candidate.ulid === ulid);
   if (index === -1) {
     return err('edt-not-found', `No EDT registered with ulid ${ulid}`);
   }
 
   const updated = [...listed.data];
   updated[index] = { ...updated[index], status };
 
   try {
     await writeFile(edtRegistryFile, stringify({ edts: updated }), 'utf8');
   } catch (error) {
     const detail = error instanceof Error ? error.message : String(error);
     return err('edt-registry-write-error', `Failed to write EDT registry file ${edtRegistryFile}: ${detail}`);
   }
   return ok(undefined);
 }
 
 // Story 2.15: logs an action to the EDT's SQLite action_log table.
 // Creates the table if it doesn't exist.
 async function logEdtAction(
   edtsBaseDir: string,
   ulid: string,
   actionType: string,
   outcome: 'success' | 'failed',
   detail: string,
 ): Promise<Result<void>> {
   const dbPath = join(edtsBaseDir, `${ulid}.db`);
   try {
     const db = new Database(dbPath);
     // Create action_log table if not exists
     db.exec(`
       CREATE TABLE IF NOT EXISTS action_log (
         id TEXT PRIMARY KEY,
         timestamp TEXT NOT NULL,
         action_type TEXT NOT NULL,
         outcome TEXT NOT NULL,
         detail TEXT NOT NULL
       )
     `);
     const stmt = db.prepare(
       'INSERT INTO action_log (id, timestamp, action_type, outcome, detail) VALUES (?, ?, ?, ?, ?)'
     );
     const { ulid: generateUlid } = await import('ulid');
     const id = generateUlid();
     const timestamp = new Date().toISOString();
     stmt.run(id, timestamp, actionType, outcome, detail);
     db.close();
     return ok(undefined);
   } catch (error) {
     const detailMsg = error instanceof Error ? error.message : String(error);
     return err('edt-action-log-error', `Failed to log action for EDT ${ulid}: ${detailMsg}`);
   }
 }
 
 // Story 2.15: retrieves the action log for an EDT (most recent first, limited).
 async function getEdtActionLog(
   edtsBaseDir: string,
   ulid: string,
   limit = 5,
 ): Promise<Result<EdtActionLogEntry[]>> {
   const dbPath = join(edtsBaseDir, `${ulid}.db`);
   try {
     const db = new Database(dbPath);
     // Check if table exists
     const tableExists = db.prepare(
       "SELECT name FROM sqlite_master WHERE type='table' AND name='action_log'"
     ).get();
     if (!tableExists) {
       db.close();
       return ok([]);
     }
     const rows = db.prepare(
       'SELECT id, timestamp, action_type, outcome, detail FROM action_log ORDER BY timestamp DESC LIMIT ?'
     ).all(limit) as Array<{ id: string; timestamp: string; action_type: string; outcome: 'success' | 'failed'; detail: string }>;
     db.close();
     // Map action_type to actionType for the EdtActionLogEntry type
     const mappedRows = rows.map((row) => ({
       id: row.id,
       timestamp: row.timestamp,
       actionType: row.action_type,
       outcome: row.outcome,
       detail: row.detail,
     }));
     return ok(mappedRows);
   } catch (error) {
     const detailMsg = error instanceof Error ? error.message : String(error);
     return err('edt-action-log-error', `Failed to get action log for EDT ${ulid}: ${detailMsg}`);
   }
 }
