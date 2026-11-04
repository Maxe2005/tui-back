import { describe, expect, it } from 'vitest';
import type { ServiceAction } from '../../../../../core/service-actions/index.js';
import { renderToString } from './render-to-string.js';
import { ServiceActionsRow } from './service-actions-row.js';

const ACTIONS: ServiceAction[] = [
  { id: 'open-in-ide', label: 'Open in IDE', key: 'Ctrl+O', availability: { available: true } },
  { id: 'restart-simple', label: 'Restart', key: 'Ctrl+R', availability: { available: false, reason: 'no container' } },
];

describe('ServiceActionsRow', () => {
  it('renders each action with its key and the reason of an unavailable one', async () => {
    const output = await renderToString(<ServiceActionsRow actions={ACTIONS} />);
    expect(output).toContain('[Ctrl+O] Open in IDE');
    expect(output).toContain('[Ctrl+R] Restart (no container)');
  });

  it('shows an extra registry entry with no component change', async () => {
    const extra: ServiceAction = { id: 'tail', label: 'Tail logs', key: 'Ctrl+T', availability: { available: true } };
    const output = await renderToString(<ServiceActionsRow actions={[...ACTIONS, extra]} />);
    expect(output).toContain('[Ctrl+T] Tail logs');
  });

  it('cuts a single action wider than the terminal on one line with an ellipsis', async () => {
    const long: ServiceAction = { id: 'x', label: 'L'.repeat(300), key: 'Ctrl+X', availability: { available: true } };
    const output = await renderToString(<ServiceActionsRow actions={[long]} />);
    expect(output.trimEnd().split('\n')).toHaveLength(1);
    expect(output).toContain('…');
  });

  it('wraps onto further lines at action boundaries instead of cutting the row', async () => {
    const five: ServiceAction[] = [
      { id: 'open-in-ide', label: 'Open in IDE', key: 'Ctrl+O', availability: { available: true } },
      { id: 'restart-simple', label: 'Restart', key: 'Ctrl+R', availability: { available: true } },
      { id: 'restart-clean', label: 'Clean restart', key: 'Ctrl+L', availability: { available: true } },
      { id: 'terminal-service', label: 'Terminal', key: 'Ctrl+T', availability: { available: true } },
      { id: 'terminal-container', label: 'Container terminal', key: 'Ctrl+X', availability: { available: false, reason: 'container not running' } },
    ];
    const output = await renderToString(<ServiceActionsRow actions={five} />, { columns: 60, rows: 20 });
    const lines = output.trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(output).not.toContain('…');
    for (const text of ['[Ctrl+O] Open in IDE', '[Ctrl+R] Restart', '[Ctrl+L] Clean restart', '[Ctrl+T] Terminal', '[Ctrl+X] Container terminal (container not running)']) {
      expect(lines.some((line) => line.includes(text))).toBe(true);
    }
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it('never grows past maxLines, however many actions there are', async () => {
    const many: ServiceAction[] = Array.from({ length: 40 }, (_, index) => ({
      id: `a${index}`,
      label: `Action ${index}`,
      key: `Ctrl+${index}`,
      availability: { available: true },
    }));
    const output = await renderToString(<ServiceActionsRow actions={many} maxLines={2} />, { columns: 40, rows: 20 });
    expect(output.trimEnd().split('\n').length).toBeLessThanOrEqual(2);
  });

  it('omits the parentheses when an unavailable action has a blank reason', async () => {
    const blank: ServiceAction = { id: 'x', label: 'Restart', key: 'Ctrl+R', availability: { available: false, reason: '  ' } };
    const output = await renderToString(<ServiceActionsRow actions={[blank]} />);
    expect(output).toContain('[Ctrl+R] Restart');
    expect(output).not.toContain('()');
  });
});
