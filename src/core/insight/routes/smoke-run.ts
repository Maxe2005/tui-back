// core/insight/routes/smoke-run: fires the EDT's non-stale favorite routes through the existing
// `fireRequest` path and returns a closed-outcome table (the CLI `routes smoke` and the TUI share
// it). Skip order: stale → mutating (unless `includeMutating`) → unfilled path params. Fired rows
// go through `runPool` (bounded concurrency, never two in flight on one repo). The run never
// rejects past the up-front EDT resolution: one failure never stops the others, rows keep the
// favorites order, and a `signal` turns the not-yet-started rows into `skipped: cancelled`.
import { ok, type Result } from '../../result.js';
import type { Route } from '../../ports/modules/route-scanner.js';
import { ROUTES_MODULE_ID } from '../../workspace/edt/shared-edt/resolve-tab-visibility.js';
import { runPool } from '../../workspace/scripts/update-support/run-pool.js';
import { fireRequest, type FireRequestDeps, type FireResult } from './fire-request.js';
import { listFavoriteRoutes, type FavoriteRoutesListDeps, type FavoriteWithStale } from './favorites.js';

export type SmokeOutcome = 'ok' | 'client-error' | 'server-error' | 'auth-error' | 'network-error' | 'skipped';

export const SMOKE_OUTCOMES: readonly SmokeOutcome[] = ['ok', 'client-error', 'server-error', 'auth-error', 'network-error', 'skipped'];

export interface SmokeRow {
  repoPath: string;
  method: string;
  path: string;
  outcome: SmokeOutcome;
  status?: number;
  durationMs?: number;
  // Bytes of the returned body.
  size?: number;
  // Why a row was skipped (`stale`, `skipped (mutating)`, `missing params: a, b`, `cancelled`) or the failure message.
  reason?: string;
  errorCode?: string;
}

export type SmokeSummary = Record<SmokeOutcome, number>;

export interface SmokeRunResult {
  rows: SmokeRow[];
  summary: SmokeSummary;
}

export type SmokeRowUpdate =
  | { phase: 'pending' | 'firing'; route: { repoPath: string; method: string; path: string } }
  // `response` is the full fire result of a fired row (body included) so a TUI can keep it; the
  // result's `rows` stay body-free.
  | { phase: 'done'; row: SmokeRow; response?: FireResult };

// A caller-supplied request for one favorite. `path` is the concrete path (params already filled).
export interface SmokeDraft {
  path?: string;
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface SmokeRunOptions {
  edt?: string;
  repo?: string;
  includeMutating?: boolean;
  concurrency?: number;
  drafts?: (favorite: FavoriteWithStale) => SmokeDraft | undefined;
  onRow?: (index: number, update: SmokeRowUpdate) => void;
  signal?: AbortSignal;
}

export type SmokeRunDeps = FavoriteRoutesListDeps & FireRequestDeps;

export const DEFAULT_SMOKE_CONCURRENCY = 3;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PATH_PARAM = /\{([^/{}]+)\}/g;

const stripSlash = (value: string): string => (value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value);

function paramNames(path: string): string[] {
  return [...path.matchAll(PATH_PARAM)].map((match) => match[1] as string);
}

function primitiveExample(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value === '' ? undefined : value;
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
}

// Pure default draft: path params filled from the scanner `example`, `bodyExample` as the body
// (never on GET/HEAD), no query, no headers. `missing` lists the unfilled path params.
export function defaultSmokeDraft(
  method: string,
  path: string,
  route: Route | undefined,
): { path: string; body?: unknown; missing: string[] } {
  const missing: string[] = [];
  const filled = path.replace(PATH_PARAM, (whole, name: string) => {
    const parameter = route?.parameters?.find((candidate) => candidate.in === 'path' && candidate.name === name);
    const example = primitiveExample(parameter?.example);
    if (example === undefined) {
      if (!missing.includes(name)) {
        missing.push(name);
      }
      return whole;
    }
    return encodeURIComponent(example);
  });
  const hasBody = method !== 'GET' && method !== 'HEAD' && route?.bodyExample !== undefined;
  return { path: filled, ...(hasBody ? { body: route?.bodyExample } : {}), missing };
}

function emptySummary(): SmokeSummary {
  return { ok: 0, 'client-error': 0, 'server-error': 0, 'auth-error': 0, 'network-error': 0, skipped: 0 };
}

function outcomeOfStatus(status: number): SmokeOutcome {
  return status >= 500 ? 'server-error' : status >= 400 ? 'client-error' : 'ok';
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function smokeRunFavorites(deps: SmokeRunDeps, options: SmokeRunOptions = {}): Promise<Result<SmokeRunResult>> {
  const listed = await listFavoriteRoutes(deps, options.edt === undefined ? {} : { edt: options.edt });
  if (!listed.ok) {
    return listed;
  }
  const repoFilter = options.repo;
  const favorites = listed.data.favorites.filter((favorite) => repoFilter === undefined || favorite.repoPath === repoFilter);
  const emit = (index: number, update: SmokeRowUpdate): void => {
    try {
      options.onRow?.(index, update);
    } catch {
      // A throwing observer must not break the run.
    }
  };

  // One scan per repo for the default drafts; a scan/manifest failure only means "no examples".
  const scans = new Map<string, Route[] | null>();
  for (const repoPath of new Set(favorites.map((favorite) => favorite.repoPath))) {
    try {
      const loaded = await deps.manifest.load(repoPath);
      const config = loaded.ok ? loaded.data.modules[ROUTES_MODULE_ID] : undefined;
      const scanned = config == null ? undefined : await deps.scanner.scan(repoPath, config);
      scans.set(repoPath, scanned?.ok === true ? scanned.data : null);
    } catch {
      scans.set(repoPath, null);
    }
  }

  const rows: (SmokeRow | undefined)[] = new Array<SmokeRow | undefined>(favorites.length).fill(undefined);
  const finish = (index: number, row: SmokeRow, response?: FireResult): SmokeRow => {
    rows[index] = row;
    emit(index, response === undefined ? { phase: 'done', row } : { phase: 'done', row, response });
    return row;
  };
  const skipped = (favorite: FavoriteWithStale, reason: string): SmokeRow => ({
    repoPath: favorite.repoPath,
    method: favorite.method,
    path: favorite.path,
    outcome: 'skipped',
    reason,
  });

  interface Job {
    index: number;
    favorite: FavoriteWithStale;
    path: string;
    draft: SmokeDraft;
  }
  const jobs: Job[] = [];
  favorites.forEach((favorite, index) => {
    emit(index, { phase: 'pending', route: { repoPath: favorite.repoPath, method: favorite.method, path: favorite.path } });
  });
  favorites.forEach((favorite, index) => {
    if (favorite.stale) {
      finish(index, skipped(favorite, 'stale'));
      return;
    }
    if (MUTATING.has(favorite.method.toUpperCase()) && options.includeMutating !== true) {
      finish(index, skipped(favorite, 'skipped (mutating)'));
      return;
    }
    // A throwing caller callback must not reject the run: fall back to the default draft.
    let supplied: SmokeDraft | undefined;
    try {
      supplied = options.drafts?.(favorite);
    } catch {
      supplied = undefined;
    }
    const scanned = scans.get(favorite.repoPath) ?? null;
    const route = scanned?.find(
      (candidate) => candidate.method.toUpperCase() === favorite.method.toUpperCase() && stripSlash(candidate.path) === favorite.path,
    );
    const fallback = defaultSmokeDraft(favorite.method, favorite.path, route);
    const draft: SmokeDraft = supplied ?? { path: fallback.path, ...(fallback.body !== undefined ? { body: fallback.body } : {}) };
    const path = draft.path ?? fallback.path;
    const missing = paramNames(path);
    if (missing.length > 0) {
      finish(index, skipped(favorite, `missing params: ${missing.join(', ')}`));
      return;
    }
    jobs.push({ index, favorite, path, draft });
  });

  const cancelledRow = (job: Job): SmokeRow => finish(job.index, skipped(job.favorite, 'cancelled'));
  await runPool<Job, SmokeRow>(
    jobs,
    {
      concurrency: options.concurrency ?? DEFAULT_SMOKE_CONCURRENCY,
      keyOf: (job) => job.favorite.repoPath,
      onCancelled: cancelledRow,
      onError: (job, error) =>
        finish(job.index, {
          repoPath: job.favorite.repoPath,
          method: job.favorite.method,
          path: job.favorite.path,
          outcome: 'network-error',
          errorCode: 'request-failed',
          reason: reasonOf(error),
        }),
    },
    async (job) => {
      if (options.signal?.aborted === true) {
        return cancelledRow(job);
      }
      const { favorite, draft, path } = job;
      emit(job.index, { phase: 'firing', route: { repoPath: favorite.repoPath, method: favorite.method, path: favorite.path } });
      const fired = await fireRequest(deps, favorite.repoPath, favorite.method, path, {
        ...(draft.body !== undefined && favorite.method !== 'GET' && favorite.method !== 'HEAD' ? { body: draft.body } : {}),
        ...(draft.query !== undefined ? { query: draft.query } : {}),
        ...(draft.headers !== undefined ? { headers: draft.headers } : {}),
      });
      const base = { repoPath: favorite.repoPath, method: favorite.method, path: favorite.path };
      if (fired.ok) {
        return finish(job.index, {
          ...base,
          outcome: outcomeOfStatus(fired.data.status),
          status: fired.data.status,
          durationMs: fired.data.durationMs,
          size: Buffer.byteLength(fired.data.body, 'utf8'),
        }, fired.data);
      }
      const auth = fired.error.code === 'auth-unauthorized' || fired.error.code === 'auth-forbidden';
      return finish(job.index, {
        ...base,
        outcome: auth ? 'auth-error' : 'network-error',
        errorCode: fired.error.code,
        reason: fired.error.message,
      });
    },
  );

  const finalRows = rows.map((row, index) => {
    // Unreachable in practice (every job resolves a row); guards a pool that dropped one.
    const favorite = favorites[index] as FavoriteWithStale;
    return row ?? finish(index, { ...skipped(favorite, 'cancelled') });
  });
  const summary = emptySummary();
  for (const row of finalRows) {
    summary[row.outcome] += 1;
  }
  return ok({ rows: finalRows, summary });
}

export function smokeRunFailed(result: SmokeRunResult): boolean {
  return result.rows.some((row) => row.outcome !== 'ok' && row.outcome !== 'skipped');
}

