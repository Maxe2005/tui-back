import { describe, it, expect } from 'vitest';
import { colors } from '../theme/theme.js';
import { DetailPane, SUMMARY_LINE_COLORS } from './detail-pane.js';
import { renderToString } from './render-to-string.js';

describe('SUMMARY_LINE_COLORS', () => {
  it('maps every summary tone to the exact theme color', () => {
    expect(SUMMARY_LINE_COLORS).toEqual({
      success: colors.success,
      warning: colors.warning,
      error: colors.error,
    });
  });

  it('is frozen at runtime so consumers cannot mutate the mapping', () => {
    expect(Object.isFrozen(SUMMARY_LINE_COLORS)).toBe(true);
  });
});

describe('DetailPane', () => {
  it('renders the title uppercased', async () => {
    const output = await renderToString(
      <DetailPane title="Update — checkout-flash-sale">body</DetailPane>,
    );
    expect(output).toContain('UPDATE — CHECKOUT-FLASH-SALE');
  });

  it('renders the body content', async () => {
    const output = await renderToString(
      <DetailPane title="Update">checking out flash sale</DetailPane>,
    );
    expect(output).toContain('checking out flash sale');
  });

  it('renders the summary line when a run outcome is provided', async () => {
    const output = await renderToString(
      <DetailPane
        title="Update"
        summary={{ tone: 'success', text: 'Résumé : 2/2' }}
      >
        body
      </DetailPane>,
    );
    expect(output).toContain('Résumé : 2/2');
    expect(output).toContain('─');
  });

  it('does not render a summary-line rule without a run outcome', async () => {
    const output = await renderToString(
      <DetailPane title="Update">body</DetailPane>,
    );
    expect(output).not.toContain('─');
  });
});
