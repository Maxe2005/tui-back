// tui/zones/routes: bounded list and route filter (real keypresses).
import { describe, it, expect } from 'vitest';
import { KEYS } from '../../shared/test-support/fake-tty.js';
import { RoutesZone } from './routes-zone.js';
import { ROWS, seed, mount, press, lastFrame } from './routes-zone.test-support.js';

describe('RoutesZone bounded list', () => {
  it('keeps the list inside its area: sibling rows stay visible, indicators never overlap rows, no summary in the list', async () => {
    const store = seed();
    const { instance, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const frame = lastFrame(stdout);
      const lines = frame.split('\n');
      expect(lines.length).toBeLessThanOrEqual(ROWS);
      expect(lines[0]).toContain('TABS-ROW');
      expect(frame).toContain('FOOTER-ROW');
      expect(frame).toContain('▼ more below');
      // Only the focused route's summary (detail pane) is ever rendered.
      expect(frame).toContain('SUMMARY-0');
      expect(frame).not.toContain('SUMMARY-1 ');
      expect(frame).not.toContain('SUMMARY-2');
    } finally {
      instance.unmount();
    }
  });
});

describe('RoutesZone route filter', () => {
  it('narrows the list as you type, keeps it on Enter, and clears on Esc', async () => {
    const store = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '/');
      expect(store.getState().zoneInputCaptured).toBe(true);
      await press(instance, stdin, 'p');
      await press(instance, stdin, 'o');
      await press(instance, stdin, 's');
      await press(instance, stdin, 't');
      let frame = lastFrame(stdout);
      expect(frame).toContain('Filter: post');
      expect(frame).toContain('POST /resource-1/{id}');
      expect(frame).not.toContain('GET /resource-0/{id}');
      expect(frame).toContain('(20/40)');

      await press(instance, stdin, KEYS.enter);
      expect(store.getState().zoneInputCaptured).toBe(false);
      frame = lastFrame(stdout);
      expect(frame).toContain('Filter: post');
      expect(frame).not.toContain('GET /resource-0/{id}');

      await press(instance, stdin, KEYS.escape);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await instance.waitUntilRenderFlush();
      frame = lastFrame(stdout);
      expect(frame).toContain('GET /resource-0/{id}');
      expect(frame).not.toContain('Filter:');
    } finally {
      instance.unmount();
    }
  });

  it("'f' opens the route filter exactly like '/' and types literally once editing", async () => {
    const store = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'f');
      expect(store.getState().zoneInputCaptured).toBe(true);
      await press(instance, stdin, 'p');
      let frame = lastFrame(stdout);
      expect(frame).toContain('Filter: p');
      expect(frame).not.toContain('GET /resource-0/{id}');
      // A second 'f' lands as text in the open editor, it does not reopen anything.
      await press(instance, stdin, 'f');
      frame = lastFrame(stdout);
      expect(frame).toContain('Filter: pf');
      await press(instance, stdin, KEYS.escape);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout)).not.toContain('Filter:');
    } finally {
      instance.unmount();
    }
  });

  it('shows a distinct message when nothing matches', async () => {
    const store = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '/');
      await press(instance, stdin, 'z');
      await press(instance, stdin, 'z');
      expect(lastFrame(stdout)).toContain('No routes match the filter.');
    } finally {
      instance.unmount();
    }
  });

  it('keeps the filter across an unmount/remount (tab switch)', async () => {
    const store = seed();
    const first = mount(store);
    await first.instance.waitUntilRenderFlush();
    await press(first.instance, first.stdin, '/');
    await press(first.instance, first.stdin, 'p');
    await press(first.instance, first.stdin, KEYS.enter);
    first.instance.unmount();

    const second = mount(store);
    try {
      await second.instance.waitUntilRenderFlush();
      const frame = lastFrame(second.stdout);
      expect(frame).toContain('Filter: p');
      expect(frame).not.toContain('GET /resource-0/{id}');
    } finally {
      second.instance.unmount();
    }
  });

  it('jumps with Home/End and keeps the cursor across a remount', async () => {
    const store = seed();
    const first = mount(store);
    await first.instance.waitUntilRenderFlush();
    await press(first.instance, first.stdin, KEYS.end);
    expect(store.getState().routesSelected).toBe(39);
    expect(lastFrame(first.stdout)).toContain('/resource-39/{id}');
    await press(first.instance, first.stdin, KEYS.home);
    expect(store.getState().routesSelected).toBe(0);
    await press(first.instance, first.stdin, KEYS.down);
    await press(first.instance, first.stdin, KEYS.down);
    first.instance.unmount();

    const second = mount(store);
    try {
      await second.instance.waitUntilRenderFlush();
      expect(store.getState().routesSelected).toBe(2);
      expect(lastFrame(second.stdout)).toContain('SUMMARY-2');
    } finally {
      second.instance.unmount();
    }
  });
});
