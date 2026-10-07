// tui/zones/routes/saved tab: render tests for the route-scoped Saved sub-tab view —
// not-loaded vs. teaching empty states, the filtered list and the inline error line.
import { describe, it, expect } from 'vitest';
import { renderToString } from '../../shared/components/render-to-string.js';
import { createFilterablePickListState } from '../../shared/components/filterable-pick-list.js';
import { RoutesSavedTab } from './routes-saved-tab.js';

function item(name: string, method = 'GET', path = '/users') {
  return { key: `id-${name}`, label: name, meta: `${method} ${path}`, value: { id: `id-${name}`, name } as never };
}

describe('RoutesSavedTab', () => {
  it('shows a dim not-loaded hint when the cache is not loaded', async () => {
    const output = await renderToString(
      <RoutesSavedTab items={[]} pickState={createFilterablePickListState()} error={null} isLoaded={false} />,
    );
    expect(output).toContain('not loaded');
  });

  it('shows the teaching empty state when the route has no saves', async () => {
    const output = await renderToString(
      <RoutesSavedTab items={[]} pickState={createFilterablePickListState()} error={null} isLoaded={true} />,
    );
    expect(output).toContain('No saved requests for this route');
    expect(output).toContain('press s');
  });

  it('lists the route-scoped rows and the no-match line under a filter', async () => {
    const listed = await renderToString(
      <RoutesSavedTab
        items={[item('alpha'), item('beta')]}
        pickState={createFilterablePickListState()}
        error={null}
        isLoaded={true}
      />,
    );
    expect(listed).toContain('alpha');
    expect(listed).toContain('beta');

    const noMatch = await renderToString(
      <RoutesSavedTab
        items={[item('alpha'), item('beta')]}
        pickState={{ query: 'zzz', queryCursor: 3, cursor: 0 }}
        error={null}
        isLoaded={true}
      />,
    );
    expect(noMatch).toContain('No saved requests match');
  });

  it('renders the inline error line above the list', async () => {
    const output = await renderToString(
      <RoutesSavedTab items={[item('alpha')]} pickState={createFilterablePickListState()} error="boom" isLoaded={true} />,
    );
    expect(output).toContain('boom');
    expect(output).toContain('alpha');
  });
});
