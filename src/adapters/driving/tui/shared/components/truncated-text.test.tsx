import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ClampedParagraph, TruncatedText, clampParagraph } from './truncated-text.js';
import { renderToString } from './render-to-string.js';

describe('clampParagraph', () => {
  it('keeps short text as is', () => {
    expect(clampParagraph('a\nb', 20, 5)).toEqual(['a', 'b']);
  });

  it('ends with the hidden-line count when over maxLines', () => {
    const lines = clampParagraph(['1', '2', '3', '4', '5', '6'].join('\n'), 20, 3);
    expect(lines).toEqual(['1', '2', '… +4 lines']);
  });
});

describe('bounded text components', () => {
  it('renders a multi-line, ANSI-laden message as one line', async () => {
    const out = await renderToString(createElement(TruncatedText, null, 'a\n\u001b[31mb\u001b[0m\nc'));
    expect(out).toContain('a b c');
  });

  it('clamps a paragraph', async () => {
    const out = await renderToString(
      createElement(ClampedParagraph, { maxLines: 2, width: 30, children: 'one\ntwo\nthree\nfour' }),
    );
    expect(out).toContain('one');
    expect(out).toContain('… +3 lines');
    expect(out).not.toContain('four');
  });
});
