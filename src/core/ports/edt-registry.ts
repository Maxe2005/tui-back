// core/ports/edt-registry: the EDT registry port — created EDTs (ulid, topic, creation time,
 // status, per-member branches) kept separate from RegistryPort's managed-repo path list (AD-6).
 // Each member records the branch that service is on for this EDT. The action-log methods
 // (per-EDT history in the EDT's SQLite db) are optional.
 import type { Result } from '../result.js';
 
 export interface EdtMember {
   service: string;
   repoPath: string;
   branch: string;
 }
 
 // A closed union, not `string`: a typo would otherwise compile, persist silently and break
 // switchActiveEdt's exact comparisons (`status === 'interrupted'`).
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
   // Read/find/replace/write one entry in place, under the caller's per-resource lock (AD-9).
   // Fails with edt-not-found if ulid isn't registered.
   update(ulid: string, patch: { topic?: string; members?: EdtMember[] }): Promise<Result<void>>;
   // Updates one entry's status field in place. Used by switchActiveEdt to flip the outgoing
   // EDT to 'inactive' (or 'interrupted' under --force past a held lock) and the target EDT to
   // 'active'. Fails with edt-not-found if ulid isn't registered.
   setStatus(ulid: string, status: EdtStatus): Promise<Result<void>>;
   // Removes ulid's entry entirely (no soft-delete/undo). Fails with edt-not-found if ulid
   // isn't registered.
   remove(ulid: string): Promise<Result<void>>;
   // Optional: logs an action to the per-EDT SQLite action_log table.
   logAction?(ulid: string, actionType: string, outcome: 'success' | 'failed', detail: string): Promise<Result<void>>;
   // Optional: retrieves the action log for an EDT (most recent first, limited).
   getActionLog?(ulid: string, limit?: number): Promise<Result<EdtActionLogEntry[]>>;
 }
