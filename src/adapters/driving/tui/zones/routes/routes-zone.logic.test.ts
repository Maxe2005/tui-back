// tui/zones/routes/logic: unit tests for story 6.1's pure Routes helpers — the
// useInput callback itself is never invoked by any test (renderToString's fake stdin never
// emits a keypress), so selection behavior is only verifiable through these functions.
import { describe, expect, it } from 'vitest';
import {
  formatRouteDetail,
  formatRouteRow,
  moveRoutesSelection,
  resolveRoutesDirection,
} from './routes-zone.logic.js';

describe('resolveRoutesDirection', () => {
  it('maps Down/Up arrows to down/up and nothing else to null', () => {
    expect(resolveRoutesDirection({ downArrow: true })).toBe('down');
    expect(resolveRoutesDirection({ upArrow: true })).toBe('up');
    expect(resolveRoutesDirection({})).toBeNull();
    expect(resolveRoutesDirection({ upArrow: false, downArrow: false })).toBeNull();
  });
});

describe('moveRoutesSelection', () => {
  it('moves within bounds and clamps at both ends', () => {
    expect(moveRoutesSelection(0, 'down', 3)).toBe(1);
    expect(moveRoutesSelection(1, 'up', 3)).toBe(0);
    expect(moveRoutesSelection(2, 'down', 3)).toBe(2);
    expect(moveRoutesSelection(0, 'up', 3)).toBe(0);
  });

  it('stays at zero for an empty list', () => {
    expect(moveRoutesSelection(0, 'down', 0)).toBe(0);
  });
});

describe('formatRouteRow', () => {
  it('renders METHOD + path with the summary as meta', () => {
    expect(formatRouteRow({ method: 'GET', path: '/users', summary: 'List users' })).toEqual({
      label: 'GET /users',
      meta: 'List users',
    });
  });

  it('omits meta when the scanner found no summary', () => {
    expect(formatRouteRow({ method: 'DELETE', path: '/users/:id' })).toEqual({
      label: 'DELETE /users/:id',
    });
  });
});

describe('formatRouteDetail', () => {
  it('joins method, path, and summary into one Text-safe string', () => {
    expect(formatRouteDetail({ method: 'POST', path: '/users', summary: 'Create a user' })).toBe(
      'POST /users\n\nCreate a user',
    );
  });

  it('names the missing summary instead of rendering blank', () => {
    expect(formatRouteDetail({ method: 'GET', path: '/health' })).toContain('No summary available.');
  });
});
