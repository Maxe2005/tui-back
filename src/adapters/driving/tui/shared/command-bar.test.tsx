// tui/shared/command-bar: unit coverage for the pure key-handling functions driving the
// story 2.14 command bar's text entry and Tab-autocomplete (the shared renderToString
// harness's fake stdin never emits data, so useInput itself is never exercised by a test —
// see render-to-string.ts and repo-registry-screen.test.tsx for the established convention).
// Real-keypress coverage of the bar mounted inside AppShell lives in
// app-shell.interaction.test.tsx.
import { describe, it, expect } from 'vitest';
import type { Command } from '../commands/commands.js';
import { backspaceCommandQuery, resolveTabAutocomplete, typeCommandQueryChar } from './command-bar.js';

describe('typeCommandQueryChar', () => {
  it('appends a printable character', () => {
    expect(typeCommandQueryChar('reg', 'i', { ctrl: false, meta: false })).toBe('regi');
  });

  it('ignores empty-input control keys', () => {
    expect(typeCommandQueryChar('reg', '', { ctrl: false, meta: false })).toBe('reg');
  });

  it('ignores Ctrl/Meta combos', () => {
    expect(typeCommandQueryChar('reg', 'w', { ctrl: true, meta: false })).toBe('reg');
    expect(typeCommandQueryChar('reg', 'w', { ctrl: false, meta: true })).toBe('reg');
  });
});

describe('backspaceCommandQuery', () => {
  it('drops the last character', () => {
    expect(backspaceCommandQuery('reg')).toBe('re');
  });

  it('is a no-op on an empty query', () => {
    expect(backspaceCommandQuery('')).toBe('');
  });
});

describe('resolveTabAutocomplete (I/O matrix: Autocomplete single/ambiguous/none)', () => {
  const registry: Command = { name: 'registry', run: () => {} };
  const reload: Command = { name: 'reload', run: () => {} };

  it('completes the query to the single match\'s full name', () => {
    expect(resolveTabAutocomplete('reg', [registry])).toBe('registry');
  });

  it('leaves the query unchanged on zero matches', () => {
    expect(resolveTabAutocomplete('zzz', [])).toBe('zzz');
  });

  it('leaves the query unchanged on an ambiguous 2+ match — never guesses', () => {
    expect(resolveTabAutocomplete('re', [registry, reload])).toBe('re');
  });
});
