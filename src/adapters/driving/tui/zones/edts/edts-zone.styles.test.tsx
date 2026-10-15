// Styled-render assertions: without FORCE_COLOR=1 Ink emits no ANSI codes, so bold/color checks
// would vacuously pass. FORCE_COLOR is set before the render/component modules are first imported
// (dynamic imports inside each test), isolated in its own file so no other suite's plain-text
// assertions see raw escape sequences. Accent+bold marks the `emphasized` row; the active EDT gets
// a discreet, non-bold `colors.info` " active" suffix instead.
import { describe, it, expect, beforeAll } from 'vitest';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';

// String.fromCharCode (not a literal control byte in this source file) — keeps the escape
// sequence unambiguous and immune to any editor/tooling that might normalize raw control
// bytes embedded directly in a source file.
const BOLD = `${String.fromCharCode(0x1b)}[1m`;
// colors.info (#4f80a8) as a truecolor foreground escape — same convention as
// zone-tab-bar.styles.test.tsx's status-color assertion.
const INFO_FG = `${String.fromCharCode(0x1b)}[38;2;79;128;168m`;
// colors.accent (#c9a13b) / colors.border (#3a3844) as truecolor foreground escapes — the Ctrl+W
// resize-mode's targeted-vs-untargeted splitter coloring.
const ACCENT_FG = `${String.fromCharCode(0x1b)}[38;2;201;161;59m`;
const BORDER_FG = `${String.fromCharCode(0x1b)}[38;2;58;56;68m`;

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

describe('EdtsZone rendered styling', () => {
  it('renders the cursor-driven row bold (emphasized), and the active EDT\'s row with a discreet info-colored suffix instead — independent of each other', async () => {
    const { renderToString } = await import('../../shared/components/render-to-string.js');
    const { createAppStore } = await import('../../store/app-store.js');
    const { EdtsZone } = await import('./edts-zone.js');

    const store = createAppStore();
    store.setState({
      // Row 0 (default cursor/selection index) is 'other-edt', NOT the active EDT; row 1
      // ('active-edt') is the active EDT but never gets the cursor here — proves `emphasized`
      // (driven by cursor/selection) and `active` (the tool-wide active EDT) apply to two
      // different rows independently.
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

    // The cursor row's label is bold (emphasized) — the bold escape sequence immediately
    // precedes its text.
    expect(output).toContain(`${BOLD}other-edt`);
    // The active EDT's row is a *different* row here — never bold.
    expect(output).not.toContain(`${BOLD}active-edt`);
    // The active EDT's row instead carries a discreet, info-colored "• active" suffix.
    expect(output).toContain(`${INFO_FG} • active`);
  });

  it('keeps the cursor-index EDT row emphasized (bold) after focus tabs away to EDT SERVICES/OTHER SERVICES, unlike the cursor bar which is pane-local', async () => {
    const { renderToString } = await import('../../shared/components/render-to-string.js');
    const { createAppStore } = await import('../../store/app-store.js');
    const { EdtsZone } = await import('./edts-zone.js');

    const store = createAppStore();
    store.setState({
      edts: [edtEntry({ ulid: 'other-ulid', topic: 'other-edt', status: 'inactive' })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: noopAsync,
      loadEdtsBranches: noopAsync,
    });

    // Focus starts on EDT SERVICES, not the EDT selector — `emphasized` is driven by
    // `clampedEdtsSelected` (persists regardless of pane focus), while `selected`'s own
    // accent-bar/›-marker cursor treatment is scoped to whichever pane currently has focus.
    const output = await renderToString(
      <EdtsZone useStore={store} initialPaneFocus="edt-services" />,
    );

    expect(output).toContain(`${BOLD}other-edt`);
    // No `›` cursor marker anywhere — focus is on EDT SERVICES (empty here), not the EDT
    // selector, so its row's own cursor-bar treatment is inert despite still being emphasized.
    expect(output).not.toContain('›');
  });
});

// The EDTs zone has 3 splitter boundaries — 1 vertical (list<->detail, rendered
// by the shared ZoneLayout, boundary 0) and 2 horizontal (the list column's own
// EDTS<->rest / EDT SERVICES<->OTHER SERVICES sub-splits, boundaries 1/2). Ctrl+W resize-mode
// recolors whichever one is currently targeted to colors.accent; every other boundary stays
// colors.border. Boundary 0 is a real regression case: it's rendered by ZoneLayout
// (zone-layout.tsx), a component EdtsZone doesn't own outright — a prop-plumbing gap
// there would leave it permanently colors.border regardless of resizeMode.
describe('EdtsZone splitter targeting under Ctrl+W resize-mode', () => {
  it('recolors only boundary 0 (the vertical list<->detail split) to accent when targeted', async () => {
    const { renderToString } = await import('../../shared/components/render-to-string.js');
    const { createAppStore } = await import('../../store/app-store.js');
    const { EdtsZone } = await import('./edts-zone.js');

    const store = createAppStore();
    store.setState({ edtsStatus: 'idle', edts: [], resizeMode: { zone: 'edts', targetBoundary: 0 } });

    const output = await renderToString(<EdtsZone useStore={store} />);

    expect(output).toContain(`${ACCENT_FG}│`);
    expect(output).not.toContain(`${ACCENT_FG}─`);
  });

  it('recolors only boundary 1 (EDTS <-> rest) to accent when targeted', async () => {
    const { renderToString } = await import('../../shared/components/render-to-string.js');
    const { createAppStore } = await import('../../store/app-store.js');
    const { EdtsZone } = await import('./edts-zone.js');

    const store = createAppStore();
    store.setState({ edtsStatus: 'idle', edts: [], resizeMode: { zone: 'edts', targetBoundary: 1 } });

    const output = await renderToString(<EdtsZone useStore={store} />);
    const accentHorizontalCount = output.split(`${ACCENT_FG}─`).length - 1;

    expect(accentHorizontalCount).toBe(1);
    expect(output).not.toContain(`${ACCENT_FG}│`);
    // The other (boundary 2) horizontal splitter stays plain border-colored.
    expect(output).toContain(`${BORDER_FG}─`);
  });

  it('recolors only boundary 2 (EDT SERVICES <-> OTHER SERVICES) to accent when targeted', async () => {
    const { renderToString } = await import('../../shared/components/render-to-string.js');
    const { createAppStore } = await import('../../store/app-store.js');
    const { EdtsZone } = await import('./edts-zone.js');

    const store = createAppStore();
    store.setState({ edtsStatus: 'idle', edts: [], resizeMode: { zone: 'edts', targetBoundary: 2 } });

    const output = await renderToString(<EdtsZone useStore={store} />);
    const accentHorizontalCount = output.split(`${ACCENT_FG}─`).length - 1;

    expect(accentHorizontalCount).toBe(1);
    expect(output).not.toContain(`${ACCENT_FG}│`);
    expect(output).toContain(`${BORDER_FG}─`);
  });

  it('every boundary stays colors.border while resize-mode is inactive', async () => {
    const { renderToString } = await import('../../shared/components/render-to-string.js');
    const { createAppStore } = await import('../../store/app-store.js');
    const { EdtsZone } = await import('./edts-zone.js');

    const store = createAppStore();
    store.setState({ edtsStatus: 'idle', edts: [], resizeMode: null });

    const output = await renderToString(<EdtsZone useStore={store} />);

    // Accent is legitimately used elsewhere in the UI (e.g. the focused pane's label) —
    // narrow the assertion to the splitter glyphs specifically, never accent-colored while
    // resize-mode is inactive.
    expect(output).not.toContain(`${ACCENT_FG}│`);
    expect(output).not.toContain(`${ACCENT_FG}─`);
    expect(output).toContain(`${BORDER_FG}│`);
    expect(output).toContain(`${BORDER_FG}─`);
  });
});
