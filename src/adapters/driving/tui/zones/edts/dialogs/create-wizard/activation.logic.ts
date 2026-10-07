// tui/zones/edts/dialogs/create-wizard: the create wizard's Step 4 key reducer, pure and kept apart
// from its Ink view (step-activation.tsx). It runs inside the setDialog updater (so keys arriving
// in one input chunk each see the previous key's result) and only RAISES a `decision`; the zone's
// effect hands it to the wizard's effectful handler exactly once.
import type { ActivationBlockedRepo } from '../../../../../../../core/edt/activate.js';
import type { TextEditKey } from '../../../../shared/components/text-edit.js';
import type { ActivationState } from '../../edts-zone.logic.js';
import { formatHints } from '../../../../shared/components/hints.js';

export const ACTIVATION_PAUSE_FOOTER = formatHints([['R', 'retry'], ['E', 'overwrite'], ['Esc', 'stop (the EDT stays created but inactive)']]);
export const OVERWRITE_CONFIRM_FOOTER = formatHints([['Ctrl+E', 'overwrite for good'], ['Enter/Esc', 'back']]);
export const ACTIVATION_RADIO_FOOTER = formatHints([['Space/↑/↓', 'choose'], ['Enter', 'create the EDT']]);
export const ACTIVATION_FIRST_FOOTER = formatHints([['Enter', 'create and activate the EDT']]);

export type ActivationConfirmLine = { key: string; text: string; kind: 'head' | 'file' };

// One head line per blocked service, then one line per file — the confirmation's scroll range.
export function overwriteConfirmLines(blocked: readonly ActivationBlockedRepo[]): ActivationConfirmLine[] {
  const lines: ActivationConfirmLine[] = [];
  for (const repo of blocked) {
    lines.push({ key: `${repo.repoPath}:head`, text: `${repo.service} (${repo.paths.length} file(s))`, kind: 'head' });
    for (const path of repo.paths) {
      lines.push({ key: `${repo.repoPath}:${path}`, text: `    ${path}`, kind: 'file' });
    }
  }
  return lines;
}

// The `overwrite` map activateEdt takes: exactly the listed (confirmed) paths, per repoPath.
export function overwriteFrom(blocked: readonly ActivationBlockedRepo[]): Record<string, string[]> {
  const overwrite: Record<string, string[]> = {};
  for (const repo of blocked) {
    overwrite[repo.repoPath] = [...repo.paths];
  }
  return overwrite;
}

function isCtrl(input: string, key: TextEditKey, letter: string): boolean {
  return key.ctrl === true && input.toLowerCase() === letter;
}

//   - Before the create: `Space`/`↑`/`↓` move the radio (switch now / create without switching)
//     — inert on a first EDT, whose activation is locked on.
//   - The pause panel (first-EDT pre-flight found files at risk): `R` retry, `E` open the
//     overwrite confirmation, `Esc` stop (the EDT stays created, not active).
//   - The overwrite confirmation: lists every file, `↑`/`↓` scroll it, `Ctrl+E` confirms,
//     `Enter`/`Esc` go back.
export function reduceActivationKey(state: ActivationState, input: string, key: TextEditKey): ActivationState {
  if (state.decision !== null || state.outcome !== null) {
    return state;
  }

  if (state.confirm !== null) {
    if (isCtrl(input, key, 'e')) {
      return { ...state, decision: { kind: 'overwrite' } };
    }
    if (key.escape || key.return) {
      return { ...state, confirm: null };
    }
    if (key.upArrow || key.downArrow) {
      const lineCount = overwriteConfirmLines(state.blocked ?? []).length;
      const scroll = Math.min(Math.max(state.confirm.scroll + (key.downArrow ? 1 : -1), 0), Math.max(lineCount - 1, 0));
      return { ...state, confirm: { scroll } };
    }
    return state;
  }

  if (state.blocked !== null) {
    if (key.escape) {
      return { ...state, decision: { kind: 'stop' } };
    }
    if (key.ctrl === true || key.meta === true) {
      return state;
    }
    if (input.toLowerCase() === 'r') {
      return { ...state, decision: { kind: 'retry' } };
    }
    if (input.toLowerCase() === 'e') {
      return { ...state, confirm: { scroll: 0 } };
    }
    return state;
  }

  // Before the create: the radio (a first EDT has nothing to choose).
  if (state.created !== null || state.firstEdt) {
    return state;
  }
  if (input === ' ') {
    return { ...state, choice: state.choice === 'switch' ? 'stay' : 'switch' };
  }
  if (key.upArrow) {
    return { ...state, choice: 'switch' };
  }
  if (key.downArrow) {
    return { ...state, choice: 'stay' };
  }
  return state;
}
