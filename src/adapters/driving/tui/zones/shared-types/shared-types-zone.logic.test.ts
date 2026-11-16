import { describe, expect, it } from 'vitest';
import {
  PUBLISH_FAILED_CHOICES,
  canRun,
  clampChoiceCursor,
  historyDisabledReason,
  initialFormState,
  publishDoneChoices,
  reduceForm,
  resolvePublishDoneChoice,
  resolvePublishFailedChoice,
  resolveQuitDecision,
  rowTarget,
  sharedTypesActions,
  shouldConfirmQuit,
  summarizeResult,
  type SharedTypesActionsInput,
} from './shared-types-zone.logic.js';

const PATHS = ['/r/a', '/r/b'];
const none = {};

describe('reduceForm', () => {
  it('starts on the version field pre-filled 0.1. with every consumer checked', () => {
    const state = initialFormState();
    expect(state.version).toEqual({ value: '0.1.', cursor: 4 });
    expect(state.row).toBe(0);
    expect(state.unchecked.size).toBe(0);
  });

  it('a pre-focused version field ignores keystrokes until Enter starts editing', () => {
    let state = initialFormState();
    expect(state.editing).toBe(false);
    for (const char of '3q') {
      state = reduceForm(state, char, none, PATHS).state;
    }
    expect(state.version.value).toBe('0.1.');
    state = reduceForm(state, '', { return: true }, PATHS).state;
    expect(state.editing).toBe(true);
    expect(state.row).toBe(0);
  });

  it('Enter, Esc and arrows leave the editing mode', () => {
    const editing = { ...initialFormState(), editing: true };
    expect(reduceForm(editing, '', { return: true }, PATHS).state.editing).toBe(false);
    expect(reduceForm(editing, '', { escape: true }, PATHS).state.editing).toBe(false);
    const down = reduceForm(editing, '', { downArrow: true }, PATHS).state;
    expect(down.editing).toBe(false);
    expect(down.row).toBe(1);
  });

  it('types into the version field, letters like q included', () => {
    let state = { ...initialFormState(), editing: true };
    for (const char of '3674q') {
      state = reduceForm(state, char, none, PATHS).state;
    }
    expect(state.version.value).toBe('0.1.3674q');
  });

  it('moves with arrows and toggles a consumer and an option with Space', () => {
    let state = reduceForm(initialFormState(), '', { downArrow: true }, PATHS).state;
    expect(rowTarget(state.row, PATHS.length)).toEqual({ kind: 'consumer', index: 0 });
    state = reduceForm(state, ' ', none, PATHS).state;
    expect([...state.unchecked]).toEqual(['/r/a']);
    state = { ...state, row: 3 };
    const before = state.options.install;
    state = reduceForm(state, ' ', none, PATHS).state;
    expect(state.options.install).toBe(!before);
  });

  it('runs on Enter outside the version field only when a version and a service are chosen', () => {
    const base = { ...initialFormState(), version: { value: '0.1.5', cursor: 5 }, row: 1 };
    expect(reduceForm(base, '', { return: true }, PATHS).run).toBe(true);
    expect(reduceForm({ ...base, unchecked: new Set(PATHS) }, '', { return: true }, PATHS).run).toBe(false);
    expect(canRun({ ...base, version: { value: ' ', cursor: 1 } }, PATHS)).toBe(false);
  });

  it('cannot run with only the 0.1. prefix or an invalid version', () => {
    const base = { ...initialFormState(), row: 1 };
    expect(canRun(base, PATHS)).toBe(false);
    expect(canRun({ ...base, version: { value: '0.1.abc', cursor: 7 } }, PATHS)).toBe(false);
    expect(canRun({ ...base, version: { value: '0.1.3674', cursor: 8 } }, PATHS)).toBe(true);
    expect(reduceForm(base, '', { return: true }, PATHS).run).toBe(false);
  });

  it('Enter on the version field edits it instead of running', () => {
    const step = reduceForm(initialFormState(), '', { return: true }, PATHS);
    expect(step.run).toBe(false);
    expect(step.state.editing).toBe(true);
  });
});

describe('quit handling', () => {
  it('asks for confirmation only for q mid-run', () => {
    expect(shouldConfirmQuit('q', 'running')).toBe(true);
    expect(shouldConfirmQuit('q', 'idle')).toBe(false);
    expect(resolveQuitDecision('', { return: true })).toBe('confirm');
    expect(resolveQuitDecision('', { escape: true })).toBe('cancel');
    expect(resolveQuitDecision('y', {})).toBeNull();
  });
});

describe('summarizeResult', () => {
  it('names the failing step and code', () => {
    const text = summarizeResult({
      service: 'b', repoPath: '/r/b', outcome: 'failed', steps: [], failedStep: 'install', error: { code: 'restart-failed', message: 'npm ERR' },
    });
    expect(text).toContain('install');
    expect(text).toContain('restart-failed');
  });

  it('gives the skip reason', () => {
    expect(summarizeResult({ service: 'a', repoPath: '/r/a', outcome: 'skipped', steps: [], reason: 'package.json dirty' })).toContain('package.json dirty');
  });
});

describe('initialFormState — default options', () => {
  it('keeps the historical defaults without argument', () => {
    expect(initialFormState().options).toEqual({ install: true, cleanRestart: false, commit: true });
  });

  it('seeds the toggles from the given settings, copying them', () => {
    const saved = { install: false, cleanRestart: true, commit: false };
    const form = initialFormState(saved);
    expect(form.options).toEqual(saved);
    expect(form.options).not.toBe(saved);
  });
});

describe('sharedTypesActions', () => {
  // A propagatable form: valid version, cursor on the first consumer row.
  const validForm = { ...initialFormState(), version: { value: '0.1.42', cursor: 6 }, row: 1 };
  const ready: SharedTypesActionsInput = {
    form: validForm,
    repoPaths: PATHS,
    sourcesStatus: 'ready',
    sourceError: undefined,
    sourceCount: 1,
    consumersStatus: 'ready',
    publishStatus: 'idle',
    runStatus: 'idle',
  };
  const reasons = (input: SharedTypesActionsInput) =>
    Object.fromEntries(sharedTypesActions(input).map((action) => [action.id, action.availability.available ? null : action.availability.reason]));

  it('lists Publish, Propagate, History and Reload with their keys, in declaration order', () => {
    expect(sharedTypesActions(ready).map((action) => [action.id, action.key, action.label])).toEqual([
      ['publish', 'P', 'publish'],
      ['propagate', 'Enter', 'propagate'],
      ['history', 'H', 'history'],
      ['reload', 'R', 'reload'],
    ]);
  });

  it('puts available actions first, keeping declaration order within each group', () => {
    const order = sharedTypesActions({ ...ready, sourcesStatus: 'error', sourceError: 'boom', sourceCount: 0 }).map((action) => action.id);
    expect(order).toEqual(['propagate', 'reload', 'publish', 'history']);
  });

  it('all ready: everything available but Reload, which has nothing to reload', () => {
    expect(reasons(ready)).toEqual({ publish: null, propagate: null, history: null, reload: 'nothing to reload' });
  });

  it('no single source: Publish and History dim, History with historyDisabledReason', () => {
    expect(reasons({ ...ready, sourceCount: 0 })).toMatchObject({
      publish: 'no source repo in the EDT',
      history: 'the shared-types source repo is not part of the active EDT',
    });
    expect(reasons({ ...ready, sourceCount: 2 })).toMatchObject({ publish: 'several source repos', history: 'several source repos are in the active EDT' });
    expect(reasons({ ...ready, sourcesStatus: 'loading', sourceCount: 0 })).toMatchObject({ publish: 'source repo loading' });
    expect(reasons({ ...ready, sourcesStatus: 'error', sourceError: 'boom', sourceCount: 0 })).toMatchObject({
      publish: 'source repo unavailable',
      history: 'boom',
      reload: null,
    });
  });

  it('Propagate says what is missing: a valid version, then a checked consumer', () => {
    expect(reasons({ ...ready, form: initialFormState() }).propagate).toBe('enter a valid version');
    expect(reasons({ ...ready, form: { ...validForm, unchecked: new Set(PATHS) } }).propagate).toBe('select a consumer');
    expect(reasons({ ...ready, repoPaths: [] }).propagate).toBe('no consuming service');
    expect(reasons({ ...ready, consumersStatus: 'loading' }).propagate).toBe('consuming services loading');
    expect(reasons({ ...ready, consumersStatus: 'error' })).toMatchObject({ propagate: 'consuming services unavailable', reload: null });
  });

  it('Propagate is dim while Enter would only edit or leave the version field', () => {
    expect(reasons({ ...ready, form: { ...validForm, row: 0 } }).propagate).toBe('move to a consumer row');
    expect(reasons({ ...ready, form: { ...validForm, row: 0, editing: true } }).propagate).toBe('finish editing the version');
    // An option row propagates too (reduceForm runs on Enter from any non-version row).
    expect(reasons({ ...ready, form: { ...validForm, row: PATHS.length + 1 } }).propagate).toBeNull();
  });

  it('dims Publish and Propagate while something runs', () => {
    expect(reasons({ ...ready, publishStatus: 'running' })).toMatchObject({ publish: 'a run is in progress', propagate: 'a run is in progress' });
    expect(reasons({ ...ready, runStatus: 'running' })).toMatchObject({ publish: 'a run is in progress', propagate: 'a run is in progress' });
  });
});

describe('historyDisabledReason', () => {
  it('keeps the existing sentences', () => {
    expect(historyDisabledReason('error', 'boom', 0)).toBe('History is unavailable: boom');
    expect(historyDisabledReason('ready', undefined, 0)).toBe('History is unavailable: the shared-types source repo is not part of the active EDT.');
    expect(historyDisabledReason('loading', undefined, 1)).toBe('History is unavailable: the source repo is still loading.');
  });

  it('names several sources and an unreadable source instead of falling through', () => {
    expect(historyDisabledReason('ready', undefined, 2)).toBe('History is unavailable: several source repos are in the active EDT.');
    expect(historyDisabledReason('error', undefined, 0)).toBe('History is unavailable: the source repo could not be read.');
  });
});

const DONE = publishDoneChoices('0.1.7');

describe('post-publish choices', () => {
  it('names the published version on the default Propagate choice, each choice explained', () => {
    const choices = publishDoneChoices('0.1.7');
    expect(choices.map((choice) => choice.label)).toEqual(['Propagate 0.1.7 to consumers', 'Back to the form', 'Close']);
    expect(choices.every((choice) => (choice.description ?? '') !== '')).toBe(true);
    expect(choices.map((choice) => choice.value)).toEqual(['propagate', 'back', 'close']);
    expect(publishDoneChoices(null)[0]!.label).toBe('Propagate the published version to consumers');
    expect(PUBLISH_FAILED_CHOICES.map((choice) => [choice.value, choice.label])).toEqual([['relaunch', 'Relaunch'], ['back', 'Back']]);
    expect(PUBLISH_FAILED_CHOICES.every((choice) => (choice.description ?? '') !== '')).toBe(true);
  });

  it('done: arrows move, Enter chooses the highlighted row, Esc closes, C propagates', () => {
    expect(resolvePublishDoneChoice('', { downArrow: true }, 0, DONE)).toEqual({ type: 'move', cursor: 1 });
    expect(resolvePublishDoneChoice('', { end: true }, 0, DONE)).toEqual({ type: 'move', cursor: 2 });
    expect(resolvePublishDoneChoice('', { return: true }, 0, DONE)).toEqual({ type: 'choose', choice: 'propagate' });
    expect(resolvePublishDoneChoice('', { return: true }, 1, DONE)).toEqual({ type: 'choose', choice: 'back' });
    expect(resolvePublishDoneChoice('', { return: true }, 2, DONE)).toEqual({ type: 'choose', choice: 'close' });
    expect(resolvePublishDoneChoice('', { escape: true }, 0, DONE)).toEqual({ type: 'choose', choice: 'close' });
    expect(resolvePublishDoneChoice('C', {}, 2, DONE)).toEqual({ type: 'choose', choice: 'propagate' });
    expect(resolvePublishDoneChoice('c', {}, 1, DONE)).toEqual({ type: 'choose', choice: 'propagate' });
    expect(resolvePublishDoneChoice('n', {}, 0, DONE)).toEqual({ type: 'ignore' });
  });

  it('failed: arrows move, Enter chooses, Esc goes back, R relaunches', () => {
    expect(resolvePublishFailedChoice('', { downArrow: true }, 0)).toEqual({ type: 'move', cursor: 1 });
    expect(resolvePublishFailedChoice('', { home: true }, 1)).toEqual({ type: 'move', cursor: 0 });
    expect(resolvePublishFailedChoice('', { return: true }, 0)).toEqual({ type: 'choose', choice: 'relaunch' });
    expect(resolvePublishFailedChoice('', { return: true }, 1)).toEqual({ type: 'choose', choice: 'back' });
    expect(resolvePublishFailedChoice('', { escape: true }, 0)).toEqual({ type: 'choose', choice: 'back' });
    expect(resolvePublishFailedChoice('R', {}, 1)).toEqual({ type: 'choose', choice: 'relaunch' });
    expect(resolvePublishFailedChoice('r', {}, 1)).toEqual({ type: 'choose', choice: 'relaunch' });
    expect(resolvePublishFailedChoice('x', {}, 0)).toEqual({ type: 'ignore' });
  });

  it('clamps a stale cursor to the last row before resolving', () => {
    expect(clampChoiceCursor(5, 2)).toBe(1);
    expect(clampChoiceCursor(-1, 3)).toBe(0);
    expect(resolvePublishFailedChoice('', { return: true }, 2)).toEqual({ type: 'choose', choice: 'back' });
    expect(resolvePublishDoneChoice('', { return: true }, 9, DONE)).toEqual({ type: 'choose', choice: 'close' });
  });
});
