// adapters/driven/state: the driven implementation of core's StatePort — state.json under
// XDG_STATE_HOME (JSON, not YAML). ENOENT reads as "nothing yet" (ok(null)). Every write is a
// read-merge-write serialized per file, so writing one field never clobbers another; a read
// I/O error inside a write is propagated, never written over. A field failing validation is
// recovered on its own, so one corrupt field never blocks reading the others.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { err, ok, type Result } from '../../../core/result.js';
import type { StatePort } from '../../../core/ports/state.js';
import type { XdgPaths } from '../xdg/index.js';
import { ensureXdgDir } from '../xdg/index.js';
import { stateSchema } from './schema.js';

type StateFileShape = {
  activeEdt: string | null;
  splitterRatios?: Record<string, number[]>;
  filterHistory?: Record<string, string[]>;
};

export function resolveStateFile(xdg: XdgPaths): string {
  return join(xdg.stateDir, 'state.json');
}

export function createStatePort(stateFile: string): StatePort {
  return {
    readActiveEdt: () => readActiveEdt(stateFile),
    writeActiveEdt: (ulid) => writeActiveEdt(stateFile, ulid),
    readSplitterRatios: () => readSplitterRatios(stateFile),
    writeSplitterRatios: (ratios) => writeSplitterRatios(stateFile, ratios),
    readFilterHistory: () => readFilterHistory(stateFile),
    writeFilterHistory: (history) => writeFilterHistory(stateFile, history),
  };
}

// One promise chain per state file, module-scoped — a real process only has one `stateFile`
// in practice, so this is effectively a per-process write lock, but keyed by path so distinct
// tmp files across a test run never serialize against each other. Every write (the whole
// read-merge-write, not just the final `writeStateFile` call) goes through this so two
// concurrent writers against the same file never each read a pre-the-other's-write snapshot.
const writeLocks = new Map<string, Promise<unknown>>();

function withWriteLock<T>(stateFile: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(stateFile) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Chained purely for ordering — never let a failed/rejected attempt permanently poison the
  // lock for the next writer (in practice `fn` never rejects; every failure here is carried as
  // a `Result`, not a thrown error, but this stays defensive regardless).
  writeLocks.set(
    stateFile,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
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

// fs-read + JSON.parse only — no schema validation. ENOENT and an empty file both read as
// "nothing persisted yet" (ok(null)); a genuine I/O error or invalid JSON is document-level
// corruption/failure, never isolable to one field.
async function readRawStateFile(stateFile: string): Promise<Result<unknown | null>> {
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

  try {
    return ok(JSON.parse(content));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('state-invalid-json', `Invalid JSON in ${stateFile}: ${detail}`);
  }
}

// The shared read-parse-validate step. On a schema validation failure, the raw parsed JSON is
// carried in `error.details.raw` so `readActiveEdt`/`readSplitterRatios` can each attempt an
// isolated single-field recovery rather than failing outright over a sibling field's own
// corruption.
async function readStateFile(stateFile: string): Promise<Result<StateFileShape | null>> {
  const raw = await readRawStateFile(stateFile);
  if (!raw.ok) {
    return raw;
  }
  if (raw.data === null) {
    return ok(null);
  }

  const result = stateSchema.safeParse(raw.data);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first ? (first.path.length > 0 ? first.path.join('.') : '(root)') : '<unknown>';
    const reason = first ? first.message : 'unknown validation error';
    return err('state-invalid-format', `Invalid state file ${stateFile}: ${field} — ${reason}`, {
      issues: result.error.issues,
      raw: raw.data,
    });
  }

  return ok(result.data);
}

// Best-effort recovery of `activeEdt` alone from raw parsed JSON, used only when the whole-file
// schema validation already failed (readStateFile's `state-invalid-format`) — e.g. a corrupt
// `splitterRatios` must never block reading `activeEdt`, which core use-cases
// (switch.ts/list.ts/resolve-tab-visibility.ts) depend on and have nothing to do with UI layout
// state.
function extractActiveEdt(raw: unknown): Result<string | null> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err('state-invalid-format', 'Invalid state file: expected a JSON object');
  }
  const result = stateSchema.shape.activeEdt.safeParse((raw as Record<string, unknown>).activeEdt);
  if (!result.success) {
    const reason = result.error.issues[0]?.message ?? 'unknown validation error';
    return err('state-invalid-format', `Invalid state file: activeEdt — ${reason}`, {
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

// Symmetric to extractActiveEdt: recovers `splitterRatios` alone when it's `activeEdt` that
// failed the whole-file validation.
function extractSplitterRatios(raw: unknown): Result<Record<string, number[]> | undefined> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err('state-invalid-format', 'Invalid state file: expected a JSON object');
  }
  const result = stateSchema.shape.splitterRatios.safeParse((raw as Record<string, unknown>).splitterRatios);
  if (!result.success) {
    const reason = result.error.issues[0]?.message ?? 'unknown validation error';
    return err('state-invalid-format', `Invalid state file: splitterRatios — ${reason}`, {
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

// Symmetric to extractSplitterRatios: recovers `filterHistory` alone when it's `activeEdt` or
// `splitterRatios` that failed the whole-file validation.
function extractFilterHistory(raw: unknown): Result<Record<string, string[]> | undefined> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err('state-invalid-format', 'Invalid state file: expected a JSON object');
  }
  const result = stateSchema.shape.filterHistory.safeParse((raw as Record<string, unknown>).filterHistory);
  if (!result.success) {
    const reason = result.error.issues[0]?.message ?? 'unknown validation error';
    return err('state-invalid-format', `Invalid state file: filterHistory — ${reason}`, {
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

// The shared read-merge-write step: writes the full `StateFileShape`, letting `JSON.stringify`
// drop an `undefined` `splitterRatios`/`filterHistory` rather than writing a spurious key.
async function writeStateFile(stateFile: string, data: StateFileShape): Promise<Result<void>> {
  const ensured = await ensureStateDir(stateFile);
  if (!ensured.ok) {
    return ensured;
  }

  try {
    await writeFile(stateFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('state-write-error', `Failed to write state file ${stateFile}: ${detail}`);
  }
  return ok(undefined);
}

async function readActiveEdt(stateFile: string): Promise<Result<string | null>> {
  const result = await readStateFile(stateFile);
  if (result.ok) {
    return ok(result.data?.activeEdt ?? null);
  }
  if (result.error.code !== 'state-invalid-format') {
    // A genuine I/O error or document-level (invalid-JSON) corruption — nothing to isolate.
    return result;
  }
  const raw = (result.error.details as { raw?: unknown } | undefined)?.raw;
  const recovered = extractActiveEdt(raw);
  return recovered.ok ? ok(recovered.data) : result;
}

async function writeActiveEdt(stateFile: string, ulid: string | null): Promise<Result<void>> {
  return withWriteLock(stateFile, async () => {
    // Read-merge-write: preserves whatever `splitterRatios`/`filterHistory` are already on
    // disk (or leaves them absent) rather than clobbering the whole file with only
    // `{ activeEdt }`.
    const current = await readStateFile(stateFile);
    if (!current.ok && current.error.code === 'state-read-error') {
      // A genuine I/O error reading the existing file — unlike corruption
      // (state-invalid-json/state-invalid-format, where there is nothing left to preserve),
      // good data may be there that a transient read failure just couldn't see. Propagate
      // rather than silently writing over it as if it were empty.
      return current as Result<void>;
    }
    const existing = current.ok ? current.data : null;
    return writeStateFile(stateFile, {
      activeEdt: ulid,
      splitterRatios: existing?.splitterRatios,
      filterHistory: existing?.filterHistory,
    });
  });
}

async function readSplitterRatios(stateFile: string): Promise<Result<Record<string, number[]> | null>> {
  const result = await readStateFile(stateFile);
  if (result.ok) {
    return ok(result.data?.splitterRatios ?? null);
  }
  if (result.error.code !== 'state-invalid-format') {
    return result;
  }
  const raw = (result.error.details as { raw?: unknown } | undefined)?.raw;
  const recovered = extractSplitterRatios(raw);
  return recovered.ok ? ok(recovered.data ?? null) : result;
}

async function writeSplitterRatios(stateFile: string, ratios: Record<string, number[]>): Promise<Result<void>> {
  return withWriteLock(stateFile, async () => {
    // Read-merge-write: preserves whatever `activeEdt`/`filterHistory` is already on disk
    // (defaulting to `null` on a fresh machine, same as `readActiveEdt`'s own ENOENT
    // convention).
    const current = await readStateFile(stateFile);
    if (!current.ok && current.error.code === 'state-read-error') {
      return current as Result<void>;
    }
    const existing = current.ok ? current.data : null;
    return writeStateFile(stateFile, {
      activeEdt: existing?.activeEdt ?? null,
      splitterRatios: ratios,
      filterHistory: existing?.filterHistory,
    });
  });
}

async function readFilterHistory(stateFile: string): Promise<Result<Record<string, string[]> | null>> {
  const result = await readStateFile(stateFile);
  if (result.ok) {
    return ok(result.data?.filterHistory ?? null);
  }
  if (result.error.code !== 'state-invalid-format') {
    return result;
  }
  const raw = (result.error.details as { raw?: unknown } | undefined)?.raw;
  const recovered = extractFilterHistory(raw);
  return recovered.ok ? ok(recovered.data ?? null) : result;
}

async function writeFilterHistory(stateFile: string, history: Record<string, string[]>): Promise<Result<void>> {
  return withWriteLock(stateFile, async () => {
    // Read-merge-write: preserves whatever `activeEdt`/`splitterRatios` is already on disk,
    // same convention as writeActiveEdt/writeSplitterRatios above.
    const current = await readStateFile(stateFile);
    if (!current.ok && current.error.code === 'state-read-error') {
      return current as Result<void>;
    }
    const existing = current.ok ? current.data : null;
    return writeStateFile(stateFile, {
      activeEdt: existing?.activeEdt ?? null,
      splitterRatios: existing?.splitterRatios,
      filterHistory: history,
    });
  });
}

