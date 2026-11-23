// tui/zones/update: per-service merge/migration/restart step tracking and step views.
import type { GroupUpdateRepoResult, UpdatePhase } from '../../../../../../core/scripts/group-update.js';
import { CONFLICT_OUTCOME_LABELS } from './update-zone.status.logic.js';

// The per-service step tracker behind the detail pane. One service's update is three
// user-visible steps: the merge (core's `pulling` and `merging` phases are both "bringing the
// source in"), the migration, and the restart. Each step is pending, running, done, failed or
// skipped (never reached, or switched off for the run).
export type UpdateStepKey = 'merge' | 'migration' | 'restart';

export type UpdateStepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type ServiceStepStates = Record<UpdateStepKey, UpdateStepState>;

export const UPDATE_STEP_ORDER: readonly UpdateStepKey[] = ['merge', 'migration', 'restart'];

export const PENDING_STEPS: ServiceStepStates = Object.freeze({ merge: 'pending', migration: 'pending', restart: 'pending' });

function stepOfPhase(phase: UpdatePhase): UpdateStepKey {
  return phase === 'pulling' || phase === 'merging' ? 'merge' : phase === 'migrating' ? 'migration' : 'restart';
}

// A live phase emission: every earlier step that is still pending or running is done (a step
// that was switched off, e.g. migrations disabled, is marked skipped when the next one starts
// without it ever running), and the emitted phase's step runs.
export function advanceServiceSteps(current: ServiceStepStates | undefined, phase: UpdatePhase): ServiceStepStates {
  const next: ServiceStepStates = { ...(current ?? PENDING_STEPS) };
  const active = stepOfPhase(phase);
  const activeIndex = UPDATE_STEP_ORDER.indexOf(active);
  UPDATE_STEP_ORDER.forEach((step, index) => {
    if (index < activeIndex) {
      if (next[step] === 'running') {
        next[step] = 'done';
      } else if (next[step] === 'pending') {
        next[step] = 'skipped';
      }
    }
  });
  next[active] = 'running';
  return next;
}

// The run's final row settles whatever was still in flight: an updated service finished every
// step it started; a failed one fails the step it died in (a pending step stays skipped); a
// skipped one never ran anything.
export function finalizeServiceSteps(current: ServiceStepStates | undefined, result: GroupUpdateRepoResult): ServiceStepStates {
  const next: ServiceStepStates = { ...(current ?? PENDING_STEPS) };
  for (const step of UPDATE_STEP_ORDER) {
    if (next[step] === 'running') {
      next[step] = result.outcome === 'updated' ? 'done' : result.outcome === 'failed' ? 'failed' : 'skipped';
    } else if (next[step] === 'pending') {
      next[step] = 'skipped';
    }
  }
  return next;
}

// Step states for a settled result that has no live-step snapshot (e.g. only the recap row
// survives): an updated service finished everything, a skipped one ran nothing, and a failed one
// failed the first step core's run detail gives no evidence of completing.
export function inferSettledSteps(result: GroupUpdateRepoResult): ServiceStepStates {
  if (result.outcome === 'updated') {
    return { merge: 'done', migration: 'done', restart: 'done' };
  }
  if (result.outcome === 'skipped') {
    return { merge: 'skipped', migration: 'skipped', restart: 'skipped' };
  }
  if (result.run?.merge === undefined) {
    return { merge: 'failed', migration: 'skipped', restart: 'skipped' };
  }
  if (result.run.migrations?.kind === 'none') {
    return { merge: 'done', migration: 'done', restart: 'failed' };
  }
  return { merge: 'done', migration: 'failed', restart: 'skipped' };
}

export const UPDATE_STEP_LABELS: Record<UpdateStepKey, string> = {
  merge: 'Merge',
  migration: 'Migration',
  restart: 'Restart',
};

export const UPDATE_STEP_GLYPHS: Record<UpdateStepState, string> = {
  pending: '○',
  running: '◐',
  done: '✔',
  failed: '✖',
  skipped: '–',
};

const UPDATE_STEP_WORDS: Record<UpdateStepState, string> = {
  pending: 'waiting',
  running: 'in progress',
  done: 'done',
  failed: 'failed',
  skipped: 'not run',
};

// One step's headline + optional detail lines, built from the state and the run detail core
// reported (merge diff, migration command/excerpt) once the service finished.
export interface UpdateStepView {
  key: UpdateStepKey;
  state: UpdateStepState;
  headline: string;
  detail: string[];
}

// `full` keeps the migration output and the failure message exactly as core reported them
// (newlines included) instead of flattening each to a single line — the full-screen report's
// fidelity; the inline pane keeps the flattened default.
export function buildServiceStepViews(
  steps: ServiceStepStates,
  result: GroupUpdateRepoResult | undefined,
  options: { full?: boolean } = {},
): UpdateStepView[] {
  const full = options.full === true;
  return UPDATE_STEP_ORDER.map((key) => {
    const state = steps[key];
    const headline = `${UPDATE_STEP_GLYPHS[state]} ${UPDATE_STEP_LABELS[key]} — ${UPDATE_STEP_WORDS[state]}`;
    const detail: string[] = [];
    if (key === 'merge' && state === 'done') {
      const merge = result?.run?.merge;
      if (merge?.kind === 'up-to-date') {
        detail.push('already up to date');
      } else if (merge?.kind === 'advanced') {
        detail.push(
          merge.files === undefined || merge.insertions === undefined || merge.deletions === undefined
            ? 'updated (diff unavailable)'
            : `+${merge.insertions} / −${merge.deletions} lines in ${merge.files} ${merge.files === 1 ? 'file' : 'files'}`,
        );
      }
    }
    if (key === 'merge' && state === 'done' && result?.run?.conflict !== undefined) {
      detail.push(`conflict: ${CONFLICT_OUTCOME_LABELS[result.run.conflict]}`);
    }
    if (key === 'migration' && state === 'done') {
      const migrations = result?.run?.migrations;
      if (migrations?.kind === 'none') {
        detail.push('no migration command');
      } else if (migrations?.kind === 'ran') {
        detail.push(`ran: ${migrations.command}`);
        const excerpt = full ? migrations.outputExcerpt.trim() : migrations.outputExcerpt.replace(/\s*\r?\n\s*/g, ' ↵ ').trim();
        if (excerpt !== '') {
          detail.push(excerpt);
        }
      }
    }
    if (state === 'failed' && result?.detail !== undefined) {
      detail.push(`${result.detail.code}: ${full ? result.detail.message.trim() : result.detail.message.replace(/\s+/g, ' ').trim()}`);
    }
    return { key, state, headline, detail };
  });
}
