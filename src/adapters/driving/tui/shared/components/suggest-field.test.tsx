import { describe, expect, it } from 'vitest';
import { SuggestField } from './suggest-field.js';
import { createSuggestFieldState } from './suggest-field.logic.js';
import { renderToString } from './render-to-string.js';

const SUGGESTIONS = ['development', 'feat/x', 'feat/y'];

describe('SuggestField', () => {
  it('shows the placeholder while the field is empty, in and out of editing', async () => {
    const idle = await renderToString(
      <SuggestField label="Source branch" state={createSuggestFieldState()} suggestions={SUGGESTIONS} placeholder="<shared-branch>" maxLines={4} editing={false} />,
    );
    expect(idle).toContain('<shared-branch>');
    const editing = await renderToString(
      <SuggestField label="Source branch" state={createSuggestFieldState()} suggestions={SUGGESTIONS} placeholder="<shared-branch>" maxLines={4} editing />,
    );
    expect(editing).toContain('<shared-branch>');
    expect(editing).toContain('development');
  });

  it('drops the placeholder once text is typed and filters the list', async () => {
    const output = await renderToString(
      <SuggestField label="Source branch" state={createSuggestFieldState('feat')} suggestions={SUGGESTIONS} placeholder="<shared-branch>" maxLines={4} editing />,
    );
    expect(output).not.toContain('<shared-branch>');
    expect(output).toContain('feat/x');
    expect(output).not.toContain('development');
  });

  it('stays within its line budget', async () => {
    const many = Array.from({ length: 30 }, (_, index) => `branch-${index}`);
    const output = await renderToString(
      <SuggestField label="Branch" state={createSuggestFieldState()} suggestions={many} placeholder="<x>" maxLines={5} editing />,
    );
    expect(output.split('\n').filter((line) => line.trim() !== '').length).toBeLessThanOrEqual(6);
  });
});
