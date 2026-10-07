import { describe, expect, it } from 'vitest';
import { resolveStateLineText } from './state-line.js';

describe('resolveStateLineText', () => {
  it('words loading, empty and error the same way everywhere', () => {
    expect(resolveStateLineText({ kind: 'loading', subject: 'services' })).toBe('Loading services…');
    expect(resolveStateLineText({ kind: 'empty', subject: 'EDTs' })).toBe('No EDTs yet.');
    expect(resolveStateLineText({ kind: 'empty', subject: 'routes', text: 'No routes match the filter.' })).toBe('No routes match the filter.');
    expect(resolveStateLineText({ kind: 'error', subject: 'services' })).toBe('Failed to load services.');
  });

  it('takes another verb for the operation that is running or failed', () => {
    expect(resolveStateLineText({ kind: 'loading', subject: '/repos', verb: 'Scanning' })).toBe('Scanning /repos…');
    expect(resolveStateLineText({ kind: 'error', subject: '/repos', verb: 'Failed to scan' })).toBe('Failed to scan /repos.');
  });

  it('advertises [R] retry only when the host binds it', () => {
    expect(resolveStateLineText({ kind: 'error', subject: 'EDTs', retry: true })).toBe('Failed to load EDTs. [R] retry');
  });
});
