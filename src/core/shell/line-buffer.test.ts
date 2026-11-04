import { describe, expect, it } from 'vitest';
import { createLineBuffer, markerText } from './line-buffer.js';

const out = (text: string) => ({ stream: 'stdout' as const, text });

describe('createLineBuffer', () => {
  it('keeps every line in order while under capacity', () => {
    const buffer = createLineBuffer(3);
    buffer.push(out('a'));
    buffer.push({ stream: 'stderr', text: 'b' });

    expect(buffer.snapshot()).toEqual({ lines: [out('a'), { stream: 'stderr', text: 'b' }], droppedCount: 0 });
  });

  it('keeps only the last `capacity` lines and counts the dropped ones', () => {
    const buffer = createLineBuffer(3);
    for (let index = 1; index <= 8; index += 1) {
      buffer.push(out(String(index)));
    }

    expect(buffer.snapshot()).toEqual({ lines: [out('6'), out('7'), out('8')], droppedCount: 5 });
  });

  it('starts empty', () => {
    expect(createLineBuffer(5).snapshot()).toEqual({ lines: [], droppedCount: 0 });
  });

  it('clamps a non-positive capacity to one line', () => {
    const buffer = createLineBuffer(0);
    buffer.push(out('a'));
    buffer.push(out('b'));

    expect(buffer.snapshot()).toEqual({ lines: [out('b')], droppedCount: 1 });
  });
});

describe('markerText', () => {
  it('renders the dropped-lines marker', () => {
    expect(markerText(42)).toBe('42 lines dropped');
  });
});
