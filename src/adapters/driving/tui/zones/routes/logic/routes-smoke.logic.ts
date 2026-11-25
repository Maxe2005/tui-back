// tui/zones/routes/logic: the smoke table's pure logic — the mutating favorites to confirm,
// outcome -> glyph/colour, row label/meta, the summary line, the run header and the row budget.
// Kept out of the zone so every outcome is unit-testable without Ink.
import type { FireResult } from '../../../../../../core/insight/routes/fire-request.js';
import type { FavoriteWithStale } from '../../../../../../core/insight/routes/favorites.js';
import { SMOKE_OUTCOMES, type SmokeOutcome, type SmokeRow, type SmokeSummary } from '../../../../../../core/insight/routes/smoke-run.js';
import { routeKeyFor } from '../../../shared/components/json-tree/model.js';
import { ROUTES_SMOKE_MAX_BODY_ROWS } from '../routes-zone.constants.js';
import { resolveFavoritesPaneRows } from './routes-favorites.logic.js';
import { colors } from '../../../shared/theme/theme.js';

export type SmokePhase = 'pending' | 'firing' | 'done';

// One table row of the TUI: the favorite's identity, where it is in its life, and — once done —
// the core row (body-free) plus, for a fired row, the full response the TUI keeps.
export type SmokeTableRow = {
  repoPath: string;
  method: string;
  path: string;
  phase: SmokePhase;
  row?: SmokeRow;
  // The full response of a fired row, kept so `Enter` can open it on Response.
  response?: FireResult;
};

export type SmokeBadge = { glyph: string; color: string };

// Every outcome has its own glyph AND colour (never colour alone).
const OUTCOME_BADGES: Readonly<Record<SmokeOutcome, SmokeBadge>> = {
  ok: { glyph: '✔', color: colors.success },
  'client-error': { glyph: '◐', color: colors.warning },
  'server-error': { glyph: '✖', color: colors.error },
  'auth-error': { glyph: '⚠', color: colors.warning },
  'network-error': { glyph: '✕', color: colors.error },
  skipped: { glyph: '–', color: colors['text-dim'] },
};

const PENDING_BADGE: SmokeBadge = { glyph: '○', color: colors['text-dim'] };
const FIRING_BADGE: SmokeBadge = { glyph: '⣾', color: colors.info };

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutatingMethod(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

// The non-stale mutating favorites a run would fire only with the developer's go-ahead
// (stale ones are skipped regardless), as `METHOD path` lines for the confirm dialog.
export function mutatingFavoriteLabels(favorites: readonly Pick<FavoriteWithStale, 'method' | 'path' | 'stale'>[]): string[] {
  return favorites.filter((favorite) => !favorite.stale && isMutatingMethod(favorite.method)).map((favorite) => `${favorite.method} ${favorite.path}`);
}

export function smokeBadge(entry: Pick<SmokeTableRow, 'phase' | 'row'>): SmokeBadge {
  if (entry.phase === 'pending') {
    return PENDING_BADGE;
  }
  if (entry.phase === 'firing' || entry.row === undefined) {
    return FIRING_BADGE;
  }
  return OUTCOME_BADGES[entry.row.outcome];
}

function skippedMeta(reason: string | undefined): string {
  if (reason === undefined || reason === '') {
    return 'skipped';
  }
  return reason.startsWith('skipped') ? reason : `skipped (${reason})`;
}

// `METHOD path` plus a short meta: the phase while it runs, then `status · duration`, the skip
// reason or the failure message.
export function formatSmokeRow(entry: SmokeTableRow): { label: string; meta: string } {
  const label = `${entry.method} ${entry.path}`;
  if (entry.phase === 'pending') {
    return { label, meta: 'pending' };
  }
  const row = entry.row;
  if (entry.phase === 'firing' || row === undefined) {
    return { label, meta: 'firing…' };
  }
  if (row.outcome === 'skipped') {
    return { label, meta: skippedMeta(row.reason) };
  }
  if (row.status !== undefined) {
    return { label, meta: `${row.status}${row.durationMs === undefined ? '' : ` · ${row.durationMs}ms`}` };
  }
  return { label, meta: `${row.outcome}${row.reason === undefined ? '' : `: ${row.reason}`}` };
}

export function summarizeSmokeRows(rows: readonly SmokeTableRow[]): SmokeSummary {
  const summary: SmokeSummary = { ok: 0, 'client-error': 0, 'server-error': 0, 'auth-error': 0, 'network-error': 0, skipped: 0 };
  for (const entry of rows) {
    if (entry.phase === 'done' && entry.row !== undefined) {
      summary[entry.row.outcome] += 1;
    }
  }
  return summary;
}

// `ok 3 · client-error 1 · server-error 0 · auth-error 0 · network-error 0 · skipped 2` — all six counts.
export function formatSmokeSummary(summary: SmokeSummary): string {
  return SMOKE_OUTCOMES.map((outcome) => `${outcome} ${summary[outcome]}`).join(' · ');
}

export function smokeHeader(rows: readonly SmokeTableRow[], running: boolean, error: string | null): string {
  const done = rows.filter((entry) => entry.phase === 'done').length;
  const state = error !== null ? `failed: ${error}` : running ? 'running' : 'done';
  return `SMOKE RUN ${done}/${rows.length} — ${state}`;
}

// The summary split over `lines` rows: one line, or three pairs for a narrow pane that would
// truncate the single line.
export function formatSmokeSummaryLines(summary: SmokeSummary, lines: number): string[] {
  const parts = SMOKE_OUTCOMES.map((outcome) => `${outcome} ${summary[outcome]}`);
  if (lines < 3) {
    return [parts.join(' · ')];
  }
  return [parts.slice(0, 2).join(' · '), parts.slice(2, 4).join(' · '), parts.slice(4).join(' · ')];
}

// The body rows wanted for `rowCount` table rows: three summary lines, the rows, capped.
export function smokeWantedBodyRows(rowCount: number, maxBodyRows: number): number {
  return Math.min(maxBodyRows, rowCount + 3);
}

// The pane's body budget: the summary comes first (three lines when there is room (4+ rows), else one),
// the bounded table gets the rest.
export function resolveSmokeBodyRows(bodyRows: number): { summary: number; table: number } {
  const body = Math.max(0, Math.floor(bodyRows));
  const summary = body >= 4 ? 3 : body >= 1 ? 1 : 0;
  return { summary, table: body - summary };
}

// The route key of a table row is the favorite's template identity, same as the responses map.
export function smokeRowRouteKey(entry: Pick<SmokeTableRow, 'method' | 'path'>): string {
  return routeKeyFor(entry.method, entry.path);
}

// The row budget of the slot above the route list, whichever of the Favorites list or the smoke
// table fills it — one function so the renderer and the Tab stops agree.
export function resolveTopPaneRows(
  windowRows: number,
  favoriteCount: number,
  recentCount: number,
  smokeRowCount: number | null,
): ReturnType<typeof resolveFavoritesPaneRows> {
  return smokeRowCount === null
    ? resolveFavoritesPaneRows(windowRows, favoriteCount, recentCount)
    : resolveFavoritesPaneRows(windowRows, smokeWantedBodyRows(smokeRowCount, ROUTES_SMOKE_MAX_BODY_ROWS), recentCount, ROUTES_SMOKE_MAX_BODY_ROWS);
}
