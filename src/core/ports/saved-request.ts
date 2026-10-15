// core/ports/saved-request: the SavedRequestPort — the global saved-request library kept in
// `global.db`. Names are unique by exact match; the session cookie is never persisted. The
// `overwrite` method updates one name in place (bumping `updatedAt`); `save` inserts only.
import type { Result } from '../result.js';

export interface SavedRequest {
  id: string;
  name: string;
  repoPath: string;
  method: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  bodyText?: string;
  contentType?: string;
  treeState?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface SavedRequestInput {
  name: string;
  repoPath: string;
  method: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  bodyText?: string;
  contentType?: string;
  treeState?: unknown;
}

export interface SavedRequestPort {
  save(request: SavedRequest): Promise<Result<SavedRequest>>;
  // Updates one name in place, preserving the stored id, name and createdAt (only the
  // payload columns and updatedAt change). Fails with saved-request-not-found when unknown.
  overwrite(name: string, request: SavedRequest): Promise<Result<SavedRequest>>;
  get(name: string): Promise<Result<SavedRequest>>;
  list(): Promise<Result<SavedRequest[]>>;
  remove(name: string): Promise<Result<void>>;
}
