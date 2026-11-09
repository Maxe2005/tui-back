// Render coverage shared by the grid pane and the fullscreen preview: both draw their lines
// through ScrollableOutput, so each scenario runs against both views.
import { createElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { LogLine } from '../../../../../core/ports/docker.js';
import type { LogsPaneData } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { LogsPaneView } from './logs-pane-view.js';
import { FullscreenPane } from './fullscreen-pane.js';
import { DEFAULT_LOG_FILTER, DEFAULT_VISIBILITY_FLAGS, type VisibilityFlags } from './logs-zone.logic.js';

function logLines(count: number, stream: (i: number) => LogLine['stream'] = () => 'stdout'): LogLine[] {
  return Array.from({ length: count }, (_, i) => ({ timestamp: `ts-${i}`, text: `line-${i}`, stream: stream(i) }));
}

function paneData(overrides: Partial<LogsPaneData> = {}): LogsPaneData {
  return {
    repoPath: '/repos/svc',
    service: 'svc',
    lines: [],
    streamError: null,
    noMoreHistory: false,
    health: 'up',
    restarting: false,
    notice: null,
    scrollOffset: 0,
    ...overrides,
  };
}

type ViewProps = { pane: LogsPaneData; visibility?: VisibilityFlags };

const common = ({ pane, visibility = DEFAULT_VISIBILITY_FLAGS }: ViewProps) => ({
  pane,
  visibility,
  wrapLines: false,
  visibleLines: 20,
  contentWidth: 80,
  globalFilter: DEFAULT_LOG_FILTER,
  engaged: true,
  ownFilter: null,
});

const VIEWS: [string, (props: ViewProps) => ReactElement][] = [
  [
    'LogsPaneView',
    (props) =>
      createElement(LogsPaneView, {
        ...common(props),
        service: { service: 'svc', path: '/repos/svc' } as never,
        focused: true,
      }),
  ],
  ['FullscreenPane', (props) => createElement(FullscreenPane, { ...common(props), repoPath: '/repos/svc', serviceName: 'svc' })],
];

const SIZE = { columns: 100, rows: 20 };

for (const [name, view] of VIEWS) {
  describe(`${name} output`, () => {
    it('a scrolled pane shows older lines and hides the tail', async () => {
      const out = await renderToString(view({ pane: paneData({ lines: logLines(50), scrollOffset: 10 }) }), SIZE);
      expect(out).toContain('line-39');
      expect(out).not.toContain('line-49');
      expect(out).not.toContain('line-40');
    });

    it('prefixes each line with its timestamp only while timestamps are on', async () => {
      const pane = paneData({ lines: logLines(3) });
      const on = await renderToString(view({ pane }), SIZE);
      expect(on).toContain('[ts-2] line-2');
      const off = await renderToString(view({ pane, visibility: { ...DEFAULT_VISIBILITY_FLAGS, showTimestamps: false } }), SIZE);
      expect(off).toContain('line-2');
      expect(off).not.toContain('[ts-2]');
    });

    it('a stream error with no lines shows the error, not the waiting placeholder', async () => {
      const out = await renderToString(view({ pane: paneData({ streamError: { code: 'boom', message: 'stream exploded' } }) }), SIZE);
      expect(out).toContain('stream exploded');
      expect(out).not.toContain('Waiting for logs');
    });

    it('reads "All lines hidden by filters" when the toggles hide every buffered line', async () => {
      const out = await renderToString(
        view({ pane: paneData({ lines: logLines(5) }), visibility: { ...DEFAULT_VISIBILITY_FLAGS, showStdout: false } }),
        SIZE,
      );
      expect(out).toContain('All lines hidden by filters');
      expect(out).not.toContain('line-4');
    });
  });
}
