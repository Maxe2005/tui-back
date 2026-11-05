// tui/shared/heal-dialog: the Heal overlay's pure decisions — which view shows, what a key does
// and the footer context. The component only feeds raw Ink keys here and dispatches the result to
// the store's heal slice.
import type { RestartRow } from '../../../../core/edt/switch-restart.js';
import type { RestartMode } from '../../../../core/service-actions/index.js';
import type { FooterContextId } from '../keybindings/index.js';
import type { HealRun } from '../store/app-store.js';

// Heal always restarts: the selector offers no `none`.
export const HEAL_MODES: readonly RestartMode[] = ['simple', 'clean'];

export const HEAL_CONFIRM_CLOSE_TEXT = 'The heal is still running — Enter closes this view and lets it finish in the background, Esc keeps it open.';

export type HealView = 'confirm' | 'running' | 'confirm-close' | 'done' | 'error';

// The overlay only opens once the plan resolved, so a run it shows is never `planning`; null
// means there is nothing to show.
export function healView(run: HealRun | null, confirmingClose: boolean): HealView | null {
  if (run === null || run.status === 'planning') {
    return null;
  }
  if (run.status === 'running') {
    return confirmingClose ? 'confirm-close' : 'running';
  }
  return run.status;
}

export type HealKey = {
  leftArrow?: boolean;
  rightArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  meta?: boolean;
};

export type HealAction =
  | { type: 'ignore' }
  | { type: 'close' }
  | { type: 'toggle-mode' }
  | { type: 'confirm' }
  | { type: 'confirm-close' }
  | { type: 'keep-open' };

// The overlay owns every key while open; anything not listed here is inert.
export function resolveHealKey(input: string, key: HealKey, view: HealView): HealAction {
  if (key.ctrl === true || key.meta === true) {
    return { type: 'ignore' };
  }
  switch (view) {
    case 'confirm':
      if (key.escape === true) {
        return { type: 'close' };
      }
      if (key.return === true) {
        return { type: 'confirm' };
      }
      return key.leftArrow === true || key.rightArrow === true || input === ' ' ? { type: 'toggle-mode' } : { type: 'ignore' };
    case 'running':
      // Nothing interrupts the run; Esc only asks whether to hide it.
      return key.escape === true ? { type: 'confirm-close' } : { type: 'ignore' };
    case 'confirm-close':
      if (key.return === true) {
        return { type: 'close' };
      }
      return key.escape === true ? { type: 'keep-open' } : { type: 'ignore' };
    case 'done':
    case 'error':
      return key.escape === true || key.return === true ? { type: 'close' } : { type: 'ignore' };
  }
}

export function healFooterContext(view: HealView): FooterContextId {
  switch (view) {
    case 'confirm':
      return 'heal-confirm';
    case 'running':
      return 'heal-busy';
    case 'confirm-close':
      return 'heal-confirm-close';
    case 'done':
    case 'error':
      return 'heal-close';
  }
}

// "2 services to restart · 1 skipped".
export function describeHealPlan(rows: readonly RestartRow[]): string {
  const targets = rows.filter((row) => row.phase === 'pending').length;
  const skipped = rows.length - targets;
  const parts = [`${targets} ${targets === 1 ? 'service' : 'services'} to restart`];
  if (skipped > 0) {
    parts.push(`${skipped} skipped`);
  }
  return parts.join(' · ');
}
