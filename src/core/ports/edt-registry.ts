// core/ports/edt-registry: the EDT registry port. Tracks created EDTs (ulid, topic,
 // creation time, status, per-member branches) in their own registry, separate from
 // RegistryPort's managed-repo path list (AD-6) — an EDT entry isn't a repo path, so
 // overloading registry.yaml's { repos: string[] } shape would be the wrong fit. Story 2.2
 // evolves the entry shape in place (AD-7): the 2.1 single `branch` placeholder is replaced
 // by `topic` + per-member `members: [{ service, repoPath, branch }]`. Each member records
 // the branch that member service is on for this EDT — created branches become the member's
 // registered EDT branch, feeding Story 2.6's per-EDT divergence view. Core consumes this
 // port without ever importing the driven adapter that persists it (AD-1).
 // Story 2.15: adds optional action log methods for per-EDT action history (stored in each
 // EDT's SQLite database). Implementations that don't support action history can omit these.
 import type { Result } from '../result.js';
 
 export interface EdtMember {
   service: string;
   repoPath: string;
   branch: string;
 }
 
 // Story 2.4 (review patch): a bare `string` status let a typo compile and persist silently,
 // including breaking switchActiveEdt's own exact-string comparisons (`status === 'interrupted'`).
 export type EdtStatus = 'active' | 'inactive' | 'interrupted';
 
 export interface EdtRegistryEntry {
   ulid: string;
   topic: string;
   createdAt: string;
   status: EdtStatus;
   members: EdtMember[];
 }
 
 export interface EdtActionLogEntry {
   id: string;
   timestamp: string;
   actionType: string;
   outcome: 'success' | 'failed';
   detail: string;
 }
 
 export interface EdtRegistryPort {
   add(entry: EdtRegistryEntry): Promise<Result<void>>;
   list(): Promise<Result<EdtRegistryEntry[]>>;
   // Story 2.5: read/find/replace/write one entry in place. Used by modifyEdt to apply
   // topic and/or members changes under the per-resource advisory lock (AD-9). Fails with
   // edt-not-found if ulid isn't registered.
   update(ulid: string, patch: { topic?: string; members?: EdtMember[] }): Promise<Result<void>>;
   // Story 2.4: updates one entry's status field in place (read/find/replace/write). Used by
   // switchActiveEdt to flip the outgoing EDT to 'inactive' (or 'interrupted' under --force
   // past a held lock) and the target EDT to 'active'. Fails with edt-not-found if ulid isn't
   // registered.
   setStatus(ulid: string, status: EdtStatus): Promise<Result<void>>;
   // Story 2.15 (optional): logs an action to the per-EDT SQLite action_log table.
   // Implementations that don't support action history should not implement this.
   logAction?(ulid: string, actionType: string, outcome: 'success' | 'failed', detail: string): Promise<Result<void>>;
   // Story 2.15 (optional): retrieves the action log for an EDT (most recent first, limited).
   getActionLog?(ulid: string, limit?: number): Promise<Result<EdtActionLogEntry[]>>;
 }
