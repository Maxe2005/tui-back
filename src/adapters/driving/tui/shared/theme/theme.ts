export const colors = {
  background: '#1c1b1f',
  surface: '#232228',
  'surface-selected': '#28262c',
  border: '#3a3844',
  text: '#eae7e1',
  'text-dim': '#8f8b98',
  // Reserved for active-selection and primary-action affordances only —
  // never a status color (DESIGN.md §Colors, Do/Don't table).
  accent: '#c9a13b',
  success: '#3f9d6e',
  error: '#c1495e',
  warning: '#cf9a3e',
  info: '#4f80a8',
} as const;

export const spacing = {
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
} as const;

export const typography = {
  base: {
    family:
      'ui-monospace, Cascadia Code, SF Mono, Fira Code, Consolas, monospace',
  },
  label: { weight: 600, letterSpacing: '0.05em' },
  'dim-wink': { italic: true },
  'active-tab': { weight: 700 },
} as const;

// Atelier is square-cornered by deliberate choice; every panel, modal, badge,
// and row renders at 0px — never round. This is the visual half of "precise
// and instantly scannable" (DESIGN.md §Shapes).
export const rounded = { sm: 0, md: 0, lg: 0 } as const;

// Accent (#c9a13b) is reserved exclusively for active-selection and
// primary-action affordances (active zone-tab, selected-row accent bar,
// selection markers, checked checkboxes). It is NEVER a status color — only
// success/error/warning/info are. It sits deliberately close in hue to
// warning (#cf9a3e), so the two must never be told apart by color alone; a
// status is always paired with a glyph (DESIGN.md §Colors, §Components
// status-badge).
export const theme = { colors, spacing, typography, rounded } as const;
