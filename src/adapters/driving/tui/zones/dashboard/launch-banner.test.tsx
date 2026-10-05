import { describe, it, expect } from 'vitest';
import { DashboardZone } from './dashboard-zone.js';
import { BANNER_LINES } from './launch-banner.js';
import { createAppStore } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';

describe('DashboardZone launch banner (UX-DR14)', () => {
  // There is no shown/not-shown flag: the banner renders permanently and unconditionally.
  it('shows the k9s-inspired ASCII banner on every Dashboard render, above the placeholder content', async () => {
    const store = createAppStore();
    const output = await renderToString(<DashboardZone useStore={store} />);
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }
    expect(output).toContain('DASHBOARD');
  });
});
