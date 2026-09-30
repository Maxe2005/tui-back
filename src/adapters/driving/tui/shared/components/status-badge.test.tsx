import { describe, it, expect } from 'vitest';
import { theme } from '../theme/index.js';
import { STATUS_BADGES, StatusBadge } from './index.js';
import { renderToString } from './render-to-string.js';

const ALL_STATES = [
  'up',
  'down',
  'done',
  'failed',
  'in-progress',
  'selection',
  'action',
  'restarting',
  'updating',
  'migrating',
  'error',
] as const;

describe('STATUS_BADGES', () => {
  it('covers every status-badge state (AC1)', () => {
    expect(Object.keys(STATUS_BADGES)).toEqual([...ALL_STATES]);
  });

  it('ships glyph and color together for every state — never color alone (AC1)', () => {
    for (const entry of Object.values(STATUS_BADGES)) {
      expect(entry.glyph).toBeTruthy();
      expect(entry.color).toBeTruthy();
    }
  });

  it('is frozen at runtime so consumers cannot mutate the vocabulary', () => {
    expect(Object.isFrozen(STATUS_BADGES)).toBe(true);
  });

  it('locks the seven exact glyph/color pairings from DESIGN.md (AC1)', () => {
    const { colors } = theme;
    expect(STATUS_BADGES.up).toEqual({ glyph: '●', color: colors.success });
    expect(STATUS_BADGES.down).toEqual({ glyph: '○', color: colors.error });
    expect(STATUS_BADGES.done).toEqual({ glyph: '✔', color: colors.success });
    expect(STATUS_BADGES.failed).toEqual({ glyph: '✖', color: colors.error });
    expect(STATUS_BADGES['in-progress']).toEqual({
      glyph: '⣾',
      color: colors.info,
    });
    expect(STATUS_BADGES.selection).toEqual({ glyph: '›', color: colors.accent });
    expect(STATUS_BADGES.action).toEqual({ glyph: '▸', color: colors.accent });
  });

  it('story 3.6: the Update zone status set gets its own distinct glyphs, never bridged through in-progress (AC2)', () => {
    const { colors } = theme;
    expect(STATUS_BADGES.restarting).toEqual({ glyph: '↻', color: colors.info });
    expect(STATUS_BADGES.updating).toEqual({ glyph: '⇄', color: colors.info });
    expect(STATUS_BADGES.migrating).toEqual({ glyph: '⇒', color: colors.info });
    expect(STATUS_BADGES.error).toEqual({ glyph: '✖', color: colors.error });
    const newGlyphs = [STATUS_BADGES.restarting.glyph, STATUS_BADGES.updating.glyph, STATUS_BADGES.migrating.glyph];
    expect(new Set(newGlyphs).size).toBe(newGlyphs.length);
    expect(STATUS_BADGES.restarting.glyph).not.toBe(STATUS_BADGES['in-progress'].glyph);
  });

  it('selection and action use accent, never a status color (AC1, 1.8 AC4)', () => {
    const { colors } = theme;
    const statusColors = new Set<string>([
      colors.success,
      colors.error,
      colors.warning,
      colors.info,
    ]);
    expect(statusColors.has(STATUS_BADGES.selection.color)).toBe(false);
    expect(statusColors.has(STATUS_BADGES.action.color)).toBe(false);
    expect(STATUS_BADGES.selection.color).toBe(colors.accent);
    expect(STATUS_BADGES.action.color).toBe(colors.accent);
  });
});

describe('StatusBadge', () => {
  it.each([
    ['up', '●'],
    ['down', '○'],
    ['done', '✔'],
    ['failed', '✖'],
    ['in-progress', '⣾'],
    ['selection', '›'],
    ['action', '▸'],
    ['restarting', '↻'],
    ['updating', '⇄'],
    ['migrating', '⇒'],
    ['error', '✖'],
  ] as const)('renders the %s glyph via Ink (AC1)', async (state, glyph) => {
    const output = await renderToString(<StatusBadge state={state} />);
    expect(output).toContain(glyph);
  });
});
