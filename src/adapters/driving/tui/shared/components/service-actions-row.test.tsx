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

  it('stays on one line, cut with an ellipsis, when the actions are wider than the terminal', async () => {
    const long: ServiceAction = { id: 'x', label: 'L'.repeat(300), key: 'Ctrl+X', availability: { available: true } };
    const output = await renderToString(<ServiceActionsRow actions={[long]} />);
    expect(output.trimEnd().split('\n')).toHaveLength(1);
    expect(output).toContain('…');
  });
});
