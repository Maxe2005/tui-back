import { describe, expect, it } from 'vitest';
import {
  openOverrideBox,
  overrideBoxLines,
  OVERRIDE_BOX_ERRORS,
  protectedExistingError,
  protectedNameError,
  reduceOverrideBoxKey,
  shadowedRemoteError,
  validateOverrideBox,
  type OverrideBoxContext,
  type OverrideBoxKeyResult,
  type OverrideBoxState,
} from './override-box.js';

const CONTEXT: OverrideBoxContext = {
  status: 'ready',
  local: ['main', 'x', 'prod', 'feat/z'],
  remote: ['origin/dev', 'origin/x', 'origin/w'],
  sharedBranch: 'main',
};

function box(overrides: Partial<OverrideBoxState> = {}): OverrideBoxState {
  return { ...openOverrideBox('/repos/a', { base: 'main', name: 'auth-flow' }), ...overrides };
}

function updated(result: OverrideBoxKeyResult): OverrideBoxState {
  if (result.type !== 'update') {
    throw new Error(`expected an update, got ${result.type}`);
  }
  return result.box;
}

function press(state: OverrideBoxState, input: string, key: Record<string, boolean> = {}): OverrideBoxKeyResult {
  return reduceOverrideBoxKey(state, CONTEXT, input, key);
}

function typeInto(state: OverrideBoxState, text: string): OverrideBoxState {
  let current = state;
  for (const char of text) {
    current = updated(press(current, char));
  }
  return current;
}

describe('openOverrideBox (story 2.37)', () => {
  it('a global row opens in "Créer nouvelle" pre-filled with its base and the global name', () => {
    const opened = openOverrideBox('/repos/a', { base: 'origin/rel', name: 'auth-flow' });
    expect(opened).toMatchObject({ mode: 'create', line: 'mode', editing: false, rename: false, error: null });
    expect(opened.base.value).toBe('origin/rel');
    expect(opened.name.value).toBe('auth-flow');
  });

  it('an existing override is loaded back as-is', () => {
    const opened = openOverrideBox('/repos/a', { override: { kind: 'existing', branch: 'origin/w', renameTo: 'w2' }, base: 'main', name: 'n' });
    expect(opened).toMatchObject({ mode: 'existing', rename: true });
    expect(opened.existing.value).toBe('origin/w');
    expect(opened.newName.value).toBe('w2');
  });
});

describe('reduceOverrideBoxKey (story 2.37)', () => {
  it('Space or Tab on the Mode line toggles the mode; lines follow the mode and the rename checkbox', () => {
    const toggled = updated(press(box(), ' '));
    expect(toggled.mode).toBe('existing');
    expect(updated(press(toggled, '', { tab: true })).mode).toBe('create');
    expect(overrideBoxLines(box())).toEqual(['mode', 'base', 'name', 'apply']);
    expect(overrideBoxLines({ mode: 'existing', rename: false })).toEqual(['mode', 'existing', 'rename', 'apply']);
    expect(overrideBoxLines({ mode: 'existing', rename: true })).toEqual(['mode', 'existing', 'rename', 'newName', 'apply']);
  });

  it('↑/↓ move between lines, clamped', () => {
    const down = updated(press(box(), '', { downArrow: true }));
    expect(down.line).toBe('base');
    expect(updated(press(box(), '', { upArrow: true })).line).toBe('mode');
    expect(updated(press(box({ line: 'apply' }), '', { downArrow: true })).line).toBe('apply');
  });

  it('Enter enters a field; inside a text field Enter commits and focuses the next line', () => {
    const editing = updated(press(box({ line: 'name' }), '', { return: true }));
    expect(editing.editing).toBe(true);
    const typed = typeInto(editing, '2');
    expect(typed.name.value).toBe('auth-flow2');
    const committed = updated(press(typed, '', { return: true }));
    expect(committed).toMatchObject({ editing: false, line: 'apply' });
  });

  it('autocomplete field: an exact match commits at once, otherwise Enter inserts the highlighted branch first', () => {
    const editing = box({ line: 'base', editing: true, base: { value: 'orig', cursor: 4, pickCursor: 0 } });
    const inserted = updated(press(editing, '', { return: true }));
    expect(inserted.base.value).toBe('origin/dev');
    expect(inserted.editing).toBe(true);
    const committed = updated(press(inserted, '', { return: true }));
    expect(committed).toMatchObject({ editing: false, line: 'name' });
    expect(committed.base.value).toBe('origin/dev');
  });

  it('autocomplete field: no match at all is an inline error', () => {
    const editing = box({ line: 'base', editing: true, base: { value: 'zzz', cursor: 3, pickCursor: 0 } });
    expect(updated(press(editing, '', { return: true })).error).toBe(OVERRIDE_BOX_ERRORS.noMatch);
  });

  it('Esc leaves the field first, then closes the box without applying', () => {
    const editing = box({ line: 'name', editing: true });
    const left = updated(press(editing, '', { escape: true }));
    expect(left.editing).toBe(false);
    expect(press(left, '', { escape: true })).toEqual({ type: 'close' });
  });

  it('Ctrl+R reverts from anywhere, even inside a field', () => {
    expect(press(box(), 'r', { ctrl: true })).toEqual({ type: 'revert' });
    expect(press(box({ line: 'name', editing: true }), 'r', { ctrl: true })).toEqual({ type: 'revert' });
  });

  it('Perso: Enter on [ Appliquer ] applies a create plan', () => {
    const ready = box({ line: 'apply', base: { value: 'origin/dev', cursor: 10, pickCursor: 0 }, name: { value: 'q', cursor: 1 } });
    expect(press(ready, '', { return: true })).toEqual({ type: 'apply', plan: { kind: 'create', base: 'origin/dev', name: 'q' } });
  });

  it('Existing / Rename: the checkbox toggles with Space and the plan carries renameTo', () => {
    const existing = box({ mode: 'existing', line: 'rename', existing: { value: 'origin/w', cursor: 8, pickCursor: 0 } });
    const renaming = updated(press(existing, ' '));
    expect(renaming.rename).toBe(true);
    const named = { ...renaming, line: 'apply' as const, newName: { value: 'w2', cursor: 2 } };
    expect(press(named, '', { return: true })).toEqual({ type: 'apply', plan: { kind: 'existing', branch: 'origin/w', renameTo: 'w2' } });
    const plain = { ...existing, line: 'apply' as const, existing: { value: 'feat/z', cursor: 6, pickCursor: 0 } };
    expect(press(plain, '', { return: true })).toEqual({ type: 'apply', plan: { kind: 'existing', branch: 'feat/z' } });
  });

  it('a refused Apply stays open with its inline error', () => {
    const refused = updated(press(box({ line: 'apply', name: { value: 'development', cursor: 11 } }), '', { return: true }));
    expect(refused.error).toBe(protectedNameError('development'));
  });
});

describe('validateOverrideBox (story 2.37)', () => {
  it('Protected: a protected new-branch name, or the service\'s own sharedBranch, is refused', () => {
    expect(validateOverrideBox(box({ name: { value: 'development', cursor: 0 } }), CONTEXT)).toEqual({ ok: false, error: protectedNameError('development') });
    expect(validateOverrideBox(box({ name: { value: 'main', cursor: 0 } }), CONTEXT)).toEqual({ ok: false, error: protectedNameError('main') });
  });

  it('Protected: an existing protected branch without a rename is refused; a protected new name too', () => {
    const existing = box({ mode: 'existing', existing: { value: 'prod', cursor: 4, pickCursor: 0 } });
    expect(validateOverrideBox(existing, CONTEXT)).toEqual({ ok: false, error: protectedExistingError('prod') });
    expect(validateOverrideBox({ ...existing, rename: true, newName: { value: 'preprod', cursor: 7 } }, CONTEXT)).toEqual({
      ok: false,
      error: protectedNameError('preprod'),
    });
  });

  it('Remote shadowed: origin/x while a local x exists, without a rename, is refused', () => {
    const shadowed = box({ mode: 'existing', existing: { value: 'origin/x', cursor: 8, pickCursor: 0 } });
    expect(validateOverrideBox(shadowed, CONTEXT)).toEqual({ ok: false, error: shadowedRemoteError('x') });
    expect(validateOverrideBox({ ...shadowed, rename: true, newName: { value: 'x2', cursor: 2 } }, CONTEXT)).toEqual({
      ok: true,
      plan: { kind: 'existing', branch: 'origin/x', renameTo: 'x2' },
    });
  });

  it('unknown branches, empty fields and unavailable lists are refused', () => {
    expect(validateOverrideBox(box({ base: { value: 'nope', cursor: 4, pickCursor: 0 } }), CONTEXT)).toEqual({ ok: false, error: OVERRIDE_BOX_ERRORS.baseNotFound });
    expect(validateOverrideBox(box({ name: { value: ' ', cursor: 1 } }), CONTEXT)).toEqual({ ok: false, error: OVERRIDE_BOX_ERRORS.nameRequired });
    expect(validateOverrideBox(box({ mode: 'existing' }), CONTEXT)).toEqual({ ok: false, error: OVERRIDE_BOX_ERRORS.existingRequired });
    expect(validateOverrideBox(box(), { ...CONTEXT, status: 'error' })).toEqual({ ok: false, error: OVERRIDE_BOX_ERRORS.listsUnavailable });
  });
});
