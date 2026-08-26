import { describe, it, expect } from 'vitest';
import { DashboardZone } from './dashboard-zone.js';
import { BANNER_LINES } from './launch-banner.js';
import { createAppStore } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';

describe('DashboardZone launch banner (story 2.16, UX-DR14)', () => {
  it('shows the k9s-inspired ASCII banner on the first Dashboard render', async () => {
    const store = createAppStore();
    const output = await renderToString(<DashboardZone useStore={store} />);
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }
  });

  it('always shows the banner regardless of any flag — permanent, not one-time (story 2.16)', async () => {
    const store = createAppStore();
    const output = await renderToString(<DashboardZone useStore={store} />);
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }
    expect(output).toContain('DASHBOARD');
  });
});
