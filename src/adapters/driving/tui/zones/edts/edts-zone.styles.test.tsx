// Story 2.18 review fix: the AC1 plain-text test in edts-zone.test.tsx only proves both rows
// render, never that the active row is actually styled — without FORCE_COLOR=1, Ink emits no
// ANSI codes at all, so bold/color assertions would vacuously pass either way. Mirrors
// zone-tab-bar.styles.test.tsx's own pattern: set FORCE_COLOR before the render/component
// modules are first imported (dynamic import inside each test, not a static top-level import),
// isolated to its own file so no other suite's plain-text `toContain` assertions are put at
// risk of matching raw escape sequences instead.
import { describe, it, expect, beforeAll } from 'vitest';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';

// String.fromCharCode (not a literal control byte in this source file) — keeps the escape
// sequence unambiguous and immune to any editor/tooling that might normalize raw control
// bytes embedded directly in a source file.
const BOLD = `${String.fromCharCode(0x1b)}[1m`;

beforeAll(() => {
  process.env.FORCE_COLOR = '1';
});

function edtEntry(overrides: Partial<EdtRegistryEntry> = {}): EdtRegistryEntry {
  return {
    ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
    topic: 'demo',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'inactive',
    members: [],
    ...overrides,
  };
}

const noopAsync = async () => {};

describe('EdtsZone rendered styling (story 2.18 AC1)', () => {
  it('renders the active EDT\'s row bold, and a differently-selected non-active row not bold — independent of each other', async () => {
    const { renderToString } = await import('../../shared/components/render-to-string.js');
    const { createAppStore } = await import('../../store/app-store.js');
    const { EdtsZone } = await import('./edts-zone.js');

    const store = createAppStore();
    store.setState({
      // Row 0 (default cursor/selection) is 'other-edt', NOT the active EDT; row 1
      // ('active-edt') is the active EDT but never gets the cursor here — proves the active
      // label style and the cursor treatment apply to two different rows independently.
      edts: [
        edtEntry({ ulid: 'other-ulid', topic: 'other-edt', status: 'inactive' }),
        edtEntry({ ulid: 'active-ulid', topic: 'active-edt', status: 'active' }),
      ],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });

    const output = await renderToString(<EdtsZone useStore={store} />);

    // The active row's label is bold — the bold escape sequence immediately precedes its text.
    expect(output).toContain(`${BOLD}active-edt`);
    // The cursor (selected) row is a *different*, non-active row — never bold.
    expect(output).not.toContain(`${BOLD}other-edt`);
  });
});
