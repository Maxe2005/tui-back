// Story 2.21 review-pattern note: mirrors edts-zone.styles.test.tsx's own rationale exactly —
// without FORCE_COLOR=1 set *before* ink/chalk are first imported, Ink emits no ANSI codes at
// all, so a color assertion would vacuously pass either way. Isolated to its own file (every
// import here is dynamic, inside each test) so no other suite's plain-text `toContain`
// assertions risk matching raw escape sequences instead, and so this file's own top-level
// import of `splitter.tsx`/`render-to-string.tsx` never runs before FORCE_COLOR is set.
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.FORCE_COLOR = '1';
});

// Converts a `#rrggbb` theme color into the truecolor ANSI foreground escape Ink emits under
// FORCE_COLOR.
function ansiFg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${String.fromCharCode(0x1b)}[38;2;${r};${g};${b}m`;
}

describe('Splitter targeted styling (story 2.21, AC: "the targeted boundary recolors to accent")', () => {
  it('renders colors.border, not colors.accent, when targeted is omitted (the default)', async () => {
    const { renderToString } = await import('./render-to-string.js');
    const { Splitter } = await import('./splitter.js');
    const { colors } = await import('../theme/theme.js');

    const output = await renderToString(<Splitter orientation="horizontal" size={1} />);

    expect(output).toContain(ansiFg(colors.border));
    expect(output).not.toContain(ansiFg(colors.accent));
  });

  it('renders colors.border, not colors.accent, when targeted is explicitly false', async () => {
    const { renderToString } = await import('./render-to-string.js');
    const { Splitter } = await import('./splitter.js');
    const { colors } = await import('../theme/theme.js');

    const output = await renderToString(<Splitter orientation="horizontal" size={1} targeted={false} />);

    expect(output).toContain(ansiFg(colors.border));
    expect(output).not.toContain(ansiFg(colors.accent));
  });

  it('renders colors.accent, not colors.border, when targeted is true', async () => {
    const { renderToString } = await import('./render-to-string.js');
    const { Splitter } = await import('./splitter.js');
    const { colors } = await import('../theme/theme.js');

    const output = await renderToString(<Splitter orientation="horizontal" size={1} targeted={true} />);

    expect(output).toContain(ansiFg(colors.accent));
    expect(output).not.toContain(ansiFg(colors.border));
  });
});
