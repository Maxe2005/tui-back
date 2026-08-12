// Regression test for `.dependency-cruiser.cjs`'s `no-core-to-adapters` rule.
//
// Context (see deferred-work.md, "Deferred from: dev of story-1-2..."): this project's
// tsconfig.json mandates NodeNext-style relative imports (`./foo.js` resolving to `./foo.ts`),
// which dependency-cruiser@18.2.0 cannot resolve — it flags the edge `couldNotResolve: true`
// and records only the raw unresolved specifier (e.g. `../adapters/thing.js`) in `resolved`.
// An anchored `to: { path: '^src/adapters(/|$)' }` pattern never matches that unresolved,
// non-`src/`-prefixed text, so a real core->adapters boundary violation went undetected for
// the entire lifetime of that pattern. This test locks in that the *current* rule (imported
// directly from `.dependency-cruiser.cjs`, not a copy, so it can't silently drift out of sync)
// actually catches that violation shape, and doesn't falsely flag a benign same-boundary import.
import { describe, it, expect, afterEach } from 'vitest';
import { cruise } from 'dependency-cruiser';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error -- .cjs config file has no type declarations
import depCruiserConfig from './.dependency-cruiser.cjs';

const rule = depCruiserConfig.forbidden.find(
  (candidate: { name: string }) => candidate.name === 'no-core-to-adapters',
);

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'depcruise-fixture-'));
  mkdirSync(join(root, 'src', 'core'), { recursive: true });
  mkdirSync(join(root, 'src', 'adapters'), { recursive: true });
  return root;
}

// dependency-cruiser matches `from`/`to` path patterns against each module's path as reported
// relative to cwd, so the fixture must be cruised from within its own root.
async function cruiseFixture(root: string) {
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const { output } = await cruise(['src/**/*.ts'], {
      validate: true,
      ruleSet: { forbidden: [rule] },
      outputType: 'json',
    });
    return typeof output === 'string' ? JSON.parse(output) : output;
  } finally {
    process.chdir(previousCwd);
  }
}

describe('.dependency-cruiser.cjs no-core-to-adapters rule', () => {
  let fixtureRoot: string;

  afterEach(() => {
    if (fixtureRoot) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('catches a core -> adapters boundary violation expressed as a NodeNext-style relative import', async () => {
    fixtureRoot = makeFixture();
    writeFileSync(join(fixtureRoot, 'src', 'adapters', 'thing.ts'), 'export const thing = 1;\n');
    writeFileSync(
      join(fixtureRoot, 'src', 'core', 'violator.ts'),
      "import { thing } from '../adapters/thing.js';\nexport const x = thing;\n",
    );

    const result = await cruiseFixture(fixtureRoot);

    expect(result.summary.violations).toEqual([
      expect.objectContaining({
        from: 'src/core/violator.ts',
        to: '../adapters/thing.js',
        rule: expect.objectContaining({ name: 'no-core-to-adapters' }),
      }),
    ]);
  });

  it('does not flag a benign core -> core import that happens to resolve fine', async () => {
    fixtureRoot = makeFixture();
    writeFileSync(join(fixtureRoot, 'src', 'core', 'helper.ts'), 'export const helper = 1;\n');
    writeFileSync(
      join(fixtureRoot, 'src', 'core', 'consumer.ts'),
      "import { helper } from './helper.js';\nexport const x = helper;\n",
    );

    const result = await cruiseFixture(fixtureRoot);

    expect(result.summary.violations).toEqual([]);
  });
});
