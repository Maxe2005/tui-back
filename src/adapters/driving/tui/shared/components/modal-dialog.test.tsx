import { describe, it, expect } from 'vitest';
import { ModalDialog } from './index.js';
import { renderToString } from './render-to-string.js';

describe('ModalDialog', () => {
  it('renders a box-drawn modal dialog with title', async () => {
    const output = await renderToString(
      <ModalDialog title="Test modal" onConfirm={() => {}} onCancel={() => {}} open />,
    );
    expect(output).toContain('╔');
    expect(output).toContain('╗');
    expect(output).toContain('Test modal');
  });

  it('renders title with accent color and bold style', async () => {
    const output = await renderToString(
      <ModalDialog title="Test modal" onConfirm={() => {}} onCancel={() => {}} open />,
    );
    expect(output).toContain('Test modal');
  });

  it('renders confirm/cancel divider', async () => {
    const output = await renderToString(
      <ModalDialog title="Test modal" onConfirm={() => {}} onCancel={() => {}} open />,
    );
    expect(output).toContain('──');
  });
});