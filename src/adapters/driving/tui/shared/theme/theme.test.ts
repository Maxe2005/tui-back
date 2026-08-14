import { describe, it, expect } from 'vitest';
import { colors, spacing, typography, rounded, theme } from './theme.js';

describe('theme colors', () => {
  it('exposes every color token at the exact hex value from DESIGN.md (AC1)', () => {
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

  it('accent is not a status color and differs from warning (AC4)', () => {
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
  it('exposes the character-cell scale as named constants (AC2)', () => {
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
    expect(typography.base.family).toContain('monospace');
  });

  it('defines the label, dim-wink, and active-tab rendering roles', () => {
    expect(typography.label.weight).toBe(600);
    expect(typography.label.letterSpacing).toBe('0.05em');
    expect(typography['dim-wink'].italic).toBe(true);
    expect(typography['active-tab'].weight).toBe(700);
  });
});

describe('theme rounded', () => {
  it('renders every corner at 0px — no rounding anywhere (AC3)', () => {
    expect(rounded.sm).toBe(0);
    expect(rounded.md).toBe(0);
    expect(rounded.lg).toBe(0);
  });
});

describe('theme aggregate', () => {
  it('exposes colors, spacing, typography, and rounded under a single theme object', () => {
    expect(theme.colors).toBe(colors);
    expect(theme.spacing).toBe(spacing);
    expect(theme.typography).toBe(typography);
    expect(theme.rounded).toBe(rounded);
  });
});