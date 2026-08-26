export const colors = Object.freeze({
  background: '#1c1b1f',
  surface: '#232228',
  // Current-selection fill only — never used on its own without the accent
  // border, never for anything but the current selection (DESIGN.md §Colors).
  'surface-selected': '#28262c',
  border: '#3a3844',
  text: '#eae7e1',
  'text-dim': '#8f8b98',
  // Reserved for active-selection and primary-action affordances only —
  // never a status color (DESIGN.md §Colors, Do/Don't table). Text set on an
  // accent fill reads colors.background (near-black on amber), not colors.text.
  accent: '#c9a13b',
  success: '#3f9d6e',
  error: '#c1495e',
  warning: '#cf9a3e',
  info: '#4f80a8',
} as const);

// Character-cell units: '0'–'3', glyph-gap, indent and pane-padding-x are
// column widths in `ch`; section-gap is one blank ROW between logical groups
// and chrome-row is one chrome ROW — row counts, not `ch` (DESIGN.md
// §Layout & Spacing).
export const spacing = Object.freeze({
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
} as const);

export const typography = Object.freeze({
  base: Object.freeze({
    family:
      'ui-monospace, Cascadia Code, SF Mono, Fira Code, Consolas, monospace',
  }),
  // Uppercase, tracked-out pane-title/section-label, set in colors.text-dim.
  // A terminal has no letter-spacing and no semi-bold, so Ink renders this
  // role at regular weight — it is explicitly NOT bold; only the active
  // zone-tab is ever bold (DESIGN.md §Typography, Do/Don't).
  label: Object.freeze({ bold: false }),
  'dim-wink': Object.freeze({ italic: true }),
  'active-tab': Object.freeze({ bold: true }),
  // Story 2.13: a manifest-gated zone tab (Routes/shared-types) whose module exists
  // somewhere in the registry but has no active-EDT member — text-dim + strikethrough
  // (never bold, never accent-filled), per DESIGN.md's disabled-state convention. No new
  // color: colors['text-dim'] carries it, this token only adds the strikethrough/weight.
  'disabled-tab': Object.freeze({ bold: false, strikethrough: true }),
} as const);

// Atelier is square-cornered by deliberate choice; every panel, modal, badge,
// and row renders at 0px — never round. This is the visual half of "precise
// and instantly scannable" (DESIGN.md §Shapes). DEFAULT is the token
// DESIGN.md references for every surface (modal-dialog.corner, §Shapes).
export const rounded = Object.freeze({
  sm: 0,
  md: 0,
  lg: 0,
  DEFAULT: 0,
} as const);

// Accent (#c9a13b) is reserved exclusively for active-selection and
// primary-action affordances (active zone-tab, selected-row accent bar,
// selection markers, checked checkboxes). It is NEVER a status color — only
// success/error/warning/info are. It sits deliberately close in hue to
// warning (#cf9a3e), so the two must never be told apart by color alone; a
// status is always paired with a glyph (DESIGN.md §Colors, §Components
// status-badge).
export const theme = Object.freeze({
  colors,
  spacing,
  typography,
  rounded,
} as const);
