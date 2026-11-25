import { describe, it, expect } from 'vitest';
import { colors, spacing, typography, rounded, theme, methodColor, methodColors } from './theme.js';

describe('theme colors', () => {
  it('exposes every color token at the exact hex value from DESIGN.md', () => {
    expect(colors).toEqual({
      background: '#1c1b1f',
      surface: '#232228',
      'surface-selected': '#28262c',
      border: '#3a3844',
      text: '#eae7e1',
      'text-dim': '#8f8b98',
      accent: '#c9a13b',
      success: '#3f9d6e',
      error: '#c1495e',
      warning: '#cf9a3e',
      info: '#4f80a8',
    });
  });

  it('exposes the four status colors as a closed set', () => {
    expect(colors.success).toBe('#3f9d6e');
    expect(colors.error).toBe('#c1495e');
    expect(colors.warning).toBe('#cf9a3e');
    expect(colors.info).toBe('#4f80a8');
  });

  it('accent is not a status color and differs from warning', () => {
    const statusColors: ReadonlySet<string> = new Set([
      colors.success,
      colors.error,
      colors.warning,
      colors.info,
    ]);
    expect(statusColors.has(colors.accent)).toBe(false);
    expect(colors.accent).not.toBe(colors.warning);
  });
});

describe('theme spacing', () => {
  it('exposes the character-cell scale as named constants', () => {
    expect(spacing).toEqual({
      '0': 0,
      '1': 1,
      '2': 2,
      '3': 3,
      'glyph-gap': 1,
      indent: 2,
      'pane-padding-x': 2,
      'row-gap': 0,
      'section-gap': 1,
      'chrome-row': 1,
    });
  });
});

describe('theme typography', () => {
  it('uses a single monospace family stack (DESIGN.md §Typography)', () => {
    expect(typography.base.family).toBe(
      'ui-monospace, Cascadia Code, SF Mono, Fira Code, Consolas, monospace',
    );
  });

  it('defines the label, dim-wink, and active-tab rendering roles', () => {
    expect(typography.label.bold).toBe(false);
    expect(typography['dim-wink'].italic).toBe(true);
    expect(typography['active-tab'].bold).toBe(true);
  });

  it('defines the disabled-tab role: dim + strikethrough, never bold', () => {
    expect(typography['disabled-tab'].bold).toBe(false);
    expect(typography['disabled-tab'].strikethrough).toBe(true);
  });
});

describe('theme rounded', () => {
  it('renders every corner at 0px — no rounding anywhere', () => {
    expect(Object.values(rounded).every((value) => value === 0)).toBe(true);
  });
});

describe('theme aggregate', () => {
  it('exposes colors, spacing, typography, and rounded under a single theme object', () => {
    expect(theme.colors).toBe(colors);
    expect(theme.spacing).toBe(spacing);
    expect(theme.typography).toBe(typography);
    expect(theme.rounded).toBe(rounded);
  });

  it('is deeply frozen so consumers cannot mutate the token vocabulary at runtime', () => {
    expect(Object.isFrozen(colors)).toBe(true);
    expect(Object.isFrozen(spacing)).toBe(true);
    expect(Object.isFrozen(typography)).toBe(true);
    expect(Object.isFrozen(rounded)).toBe(true);
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(typography.base)).toBe(true);
    expect(Object.isFrozen(typography.label)).toBe(true);
    expect(Object.isFrozen(typography['dim-wink'])).toBe(true);
    expect(Object.isFrozen(typography['active-tab'])).toBe(true);
    expect(Object.isFrozen(typography['disabled-tab'])).toBe(true);
  });
});

describe('methodColor', () => {
  it('maps each known method to its token, case-insensitively', () => {
    expect(methodColor('GET')).toBe(methodColors.GET);
    expect(methodColor('get')).toBe(methodColors.GET);
    expect(methodColor('Post')).toBe(methodColors.POST);
    expect(methodColor('put')).toBe(methodColors.PUT);
    expect(methodColor('PATCH')).toBe(methodColors.PATCH);
    expect(methodColor('delete')).toBe(methodColors.DELETE);
  });

  it('falls back for HEAD, OPTIONS, unknown and empty methods without throwing', () => {
    for (const m of ['HEAD', 'OPTIONS', 'TRACE', '']) {
      expect(methodColor(m)).toBe(methodColors.fallback);
    }
    expect(() => methodColor(undefined as unknown as string)).not.toThrow();
  });

  it('only uses hexes of the existing palette and keeps the five methods distinguishable', () => {
    const palette: ReadonlySet<string> = new Set(Object.values(colors));
    for (const value of Object.values(methodColors)) {
      expect(palette.has(value)).toBe(true);
    }
    const five = [methodColors.GET, methodColors.POST, methodColors.PUT, methodColors.PATCH, methodColors.DELETE];
    expect(new Set(five).size).toBe(5);
    expect(methodColors.fallback).not.toBe(colors.accent);
  });
});
