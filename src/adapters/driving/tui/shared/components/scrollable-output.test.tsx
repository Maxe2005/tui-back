import { createElement } from 'react';
import { Box, Text } from 'ink';
import { describe, expect, it } from 'vitest';
import { ScrollableOutput } from './scrollable-output.js';
import { FullscreenFrame } from './fullscreen-frame.js';
import { renderToString } from './render-to-string.js';
import { MATRIX_SIZES, frameLines } from '../test-support/matrix.js';
import { LONG_TEXT } from '../test-support/dialog-registry.js';

type Line = { text: string; err: boolean };

const lines = (count: number, text: (i: number) => string = (i) => `line-${i}`): Line[] =>
  Array.from({ length: count }, (_, i) => ({ text: text(i), err: i % 2 === 0 }));

function output(props: { lines: Line[]; offset?: number; wrap?: boolean; placeholder?: string | null }) {
  return createElement(
    Box,
    { flexDirection: 'column', height: 10, width: 40 },
    createElement(ScrollableOutput<Line>, {
      lines: props.lines,
      offset: props.offset ?? 0,
      wrap: props.wrap ?? false,
      fallbackRows: 10,
      fallbackWidth: 40,
      format: (line) => line.text,
      color: (line) => (line.err ? 'red' : 'white'),
      placeholder: props.placeholder === null ? null : createElement(Text, null, props.placeholder ?? 'EMPTY'),
    }),
  );
}

describe('ScrollableOutput', () => {
  it('tail + truncate: the last lines fill the measured height, one row each', async () => {
    const frame = frameLines(await renderToString(output({ lines: lines(500) }), { columns: 40, rows: 10 }));
    expect(frame).toHaveLength(10);
    expect(frame[0]).toBe('line-490');
    expect(frame.at(-1)).toBe('line-499');
    expect(frame.join('\n')).not.toContain('EMPTY');
  });

  it('scrolled + wrap: the window ends `offset` lines from the tail, sized by wrapped row cost', async () => {
    const long = lines(500, (i) => `${i}-${'a'.repeat(70)}`);
    const frame = frameLines(await renderToString(output({ lines: long, offset: 10, wrap: true }), { columns: 40, rows: 10 }));
    expect(frame.length).toBeLessThanOrEqual(10);
    const text = frame.join('\n');
    expect(text).toContain('489-');
    expect(text).not.toContain('490-');
    expect(text).toContain('486-');
  });

  it('renders an oversized line clipped rather than a blank viewport', async () => {
    const frame = frameLines(await renderToString(output({ lines: [{ text: LONG_TEXT, err: false }], wrap: true }), { columns: 40, rows: 10 }));
    expect(frame.join('')).toContain('x'.repeat(40));
    expect(frame.length).toBeLessThanOrEqual(10);
  });

  it('renders the placeholder (and no lines) when empty, nothing when the caller passes null', async () => {
    expect(await renderToString(output({ lines: [] }), { columns: 40, rows: 10 })).toContain('EMPTY');
    expect((await renderToString(output({ lines: [], placeholder: null }), { columns: 40, rows: 10 })).trim()).toBe('');
  });
});

describe('ScrollableOutput bounds', () => {
  for (const size of MATRIX_SIZES) {
    for (const wrap of [false, true]) {
      it(`5000 long lines at ${size.columns}x${size.rows} (wrap ${wrap ? 'on' : 'off'}) stay inside the terminal`, async () => {
        const huge = Array.from({ length: 5000 }, (_, i) => ({ text: LONG_TEXT, err: i % 2 === 0 }));
        const node = createElement(
          Box,
          { flexDirection: 'column', height: size.rows, width: size.columns },
          createElement(
            FullscreenFrame,
            null,
            createElement(ScrollableOutput<Line>, {
              lines: huge,
              offset: 0,
              wrap,
              fallbackRows: size.rows,
              fallbackWidth: size.columns,
              format: (line) => line.text,
              color: (line) => (line.err ? 'red' : 'white'),
            }),
          ),
        );
        const frame = frameLines(await renderToString(node, size));
        expect(frame.length).toBeLessThanOrEqual(size.rows);
        expect(frame.length).toBeGreaterThan(0);
        for (const line of frame) {
          expect(Array.from(line).length).toBeLessThanOrEqual(size.columns);
        }
      });
    }
  }
});
