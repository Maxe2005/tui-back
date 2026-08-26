import { describe, it, expect } from 'vitest';
import { DashboardZone } from './dashboard-zone.js';
import { BANNER_LINES } from './launch-banner.js';
import { createAppStore } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';

describe('DashboardZone launch banner (story 2.16, UX-DR14)', () => {
  // story 2.16: launchBannerShown/markLaunchBannerShown were removed entirely — there is no
  // flag left to vary, so this is the single test covering the banner's permanent, unconditional
  // rendering (formerly split across a "first render" and a "regardless of any flag" case).
  it('shows the k9s-inspired ASCII banner on every Dashboard render, above the placeholder content', async () => {
    const store = createAppStore();
    const output = await renderToString(<DashboardZone useStore={store} />);
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }
    expect(output).toContain('DASHBOARD');
  });
});
