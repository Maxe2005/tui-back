import { describe, expect, it } from 'vitest';
import { renderToString } from './render-to-string.js';
import { RestartModeSelector } from './restart-mode-selector.js';

describe('RestartModeSelector', () => {
  it('marks the current mode and keeps the switch title and hint by default', async () => {
    const output = await renderToString(<RestartModeSelector mode="simple" />, { columns: 200, rows: 10 });
    expect(output).toContain('Redémarrer les services après le switch');
    expect(output).toContain('(•) Redémarrage simple');
    expect(output).toContain('( ) Aucun');
    expect(output).toContain('←/→ ou Espace pour changer.');
  });

  it('takes the owning dialog title and keys', async () => {
    const output = await renderToString(<RestartModeSelector mode="clean" title="Redémarrer les services après le realign" keysHint="←/→ pour changer." />, {
      columns: 200,
      rows: 10,
    });
    expect(output).toContain('après le realign');
    expect(output).toContain('(•) Clean restart');
    expect(output).toContain('←/→ pour changer.');
  });

  it('offers only the modes it is given, in order', async () => {
    const output = await renderToString(<RestartModeSelector mode="simple" modes={['simple', 'clean']} />, { columns: 200, rows: 10 });
    expect(output).not.toContain('Aucun');
    expect(output).toMatch(/\(•\) Redémarrage simple\s+\( \) Clean restart/);
  });
});
