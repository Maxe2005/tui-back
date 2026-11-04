// core/shell/line-buffer: the bounded ring buffer a shell session retains its output in. Only
// the last `capacity` lines are kept; older ones are counted in `droppedCount` so the view can
// show an "N lines dropped" marker instead of growing without bound.
import type { ShellLine } from '../ports/shell-session.js';

export interface LineBufferSnapshot {
  lines: ShellLine[];
  droppedCount: number;
}

export interface LineBuffer {
  push(line: ShellLine): void;
  snapshot(): LineBufferSnapshot;
}

export const DEFAULT_MAX_LINES = 5000;

// A non-finite capacity (NaN, ±Infinity) falls back to the default; anything else is floored
// and clamped to at least one line, so construction never throws.
export function clampCapacity(capacity: number): number {
  return Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : DEFAULT_MAX_LINES;
}

export function createLineBuffer(capacity: number): LineBuffer {
  const size = clampCapacity(capacity);
  const slots: (ShellLine | undefined)[] = new Array<ShellLine | undefined>(size);
  let start = 0;
  let count = 0;
  let droppedCount = 0;

  return {
    push(line) {
      if (count < size) {
        slots[(start + count) % size] = line;
        count += 1;
        return;
      }
      slots[start] = line;
      start = (start + 1) % size;
      droppedCount += 1;
    },
    snapshot() {
      const lines: ShellLine[] = [];
      for (let index = 0; index < count; index += 1) {
        const line = slots[(start + index) % size];
        if (line !== undefined) {
          lines.push(line);
        }
      }
      return { lines, droppedCount };
    },
  };
}

export function markerText(droppedCount: number): string {
  return `${String(droppedCount)} ${droppedCount === 1 ? 'line' : 'lines'} dropped`;
}
