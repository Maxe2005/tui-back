// Regression test for `.dependency-cruiser.cjs`'s `no-core-to-adapters` rule.
// This project's tsconfig.json mandates NodeNext-style relative imports ("./foo.js" → "./foo.ts").
// dependency-cruiser@18.2.0 cannot resolve these, flagging `couldNotResolve: true` and recording
// only the raw unresolved specifier (e.g. "../adapters/thing.js") in `resolved`.
// An anchored `to: { path: '^src/adapters(/|$)' }` pattern never matches this shape,
// allowing real core→adapters boundary violations to go undetected.
// This test verifies the current rule catches such violations and doesn't falsely flag
// benign same-boundary imports.
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
async function cruiseFixture(root: string, forbidden: unknown[] = [rule]) {
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const { output } = await cruise(['src/**/*.ts'], {
      validate: true,
      ruleSet: { forbidden },
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

// Regression test for the acorn-fallback landmine found during dev of story-1-3 (see
// deferred-work.md, "Investigated during dev of story-1-3..."): a file containing a generic
// function whose return type references a locally-defined generic *union* type alias (this
// codebase's `Result<T>`/`ok<T>()` shape, first introduced by `src/core/result.ts`) silently
// drops all of that file's own `import` statements from dependency-cruiser's dependency graph
// — but only when those imports are not the first statements in the file. This codebase's
// "imports always go first" convention avoids it; these tests lock in that current behavior
// so a future dependency-cruiser/TypeScript upgrade that silently changes it (in either
// direction) doesn't go unnoticed.
describe('.dependency-cruiser.cjs vs. the generic-function-returning-generic-union-type landmine', () => {
  let fixtureRoot: string;

  afterEach(() => {
    if (fixtureRoot) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  const genericResultShape = `export interface ResultError { code: string; message: string; }
export type Result<T> = { ok: true; data: T } | { ok: false; error: ResultError };
export function ok<T>(data: T): Result<T> { return { ok: true, data }; }
`;

  it('still catches a core -> adapters violation when imports are placed first (this codebase\'s convention)', async () => {
    fixtureRoot = makeFixture();
    writeFileSync(join(fixtureRoot, 'src', 'adapters', 'thing.ts'), 'export const thing = 1;\n');
    writeFileSync(
      join(fixtureRoot, 'src', 'core', 'violator.ts'),
      `import { thing } from '../adapters/thing.js';\n\n${genericResultShape}export const x = thing;\n`,
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

  it('documents the known gap: misses the same violation when the import trails the generic declarations', async () => {
    fixtureRoot = makeFixture();
    writeFileSync(join(fixtureRoot, 'src', 'adapters', 'thing.ts'), 'export const thing = 1;\n');
    writeFileSync(
      join(fixtureRoot, 'src', 'core', 'violator.ts'),
      `${genericResultShape}import { thing } from '../adapters/thing.js';\nexport const x = thing;\n`,
    );

    const result = await cruiseFixture(fixtureRoot);

    // If this ever starts finding the violation, dependency-cruiser/acorn-fallback has fixed
    // the landmine upstream — the "imports first" mitigation can be relaxed, and this test
    // (plus the deferred-work.md entry) should be updated to reflect that.
    expect(result.summary.violations).toEqual([]);
  });

  it('pins the no-tui-leak-outside-driving-tui rule exception for src/bin/tui.ts', async () => {
    // This regression test ensures the widened no-tui-leak rule still correctly
    // allows the sanctioned exception (src/bin/tui.ts) while still flagging
    // non-TUI modules that import from tui/.
    const tuiRule = depCruiserConfig.forbidden.find(
      (candidate: { name: string }) => candidate.name === 'no-tui-leak-outside-driving-tui',
    );

    fixtureRoot = makeFixture();
    mkdirSync(join(fixtureRoot, 'src', 'bin'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'src', 'tui'), { recursive: true });
    writeFileSync(join(fixtureRoot, 'src', 'tui', 'view.ts'), 'export const view = 1;\n');
    // The sanctioned exception: the AD-2 TUI composition root may import from tui/.
    writeFileSync(
      join(fixtureRoot, 'src', 'bin', 'tui.ts'),
      "import { view } from '../tui/view.js';\nexport const x = view;\n",
    );
    // A non-TUI module under src/bin must still be flagged for the same import.
    writeFileSync(
      join(fixtureRoot, 'src', 'bin', 'other.ts'),
      "import { view } from '../tui/view.js';\nexport const y = view;\n",
    );

    const parsed = await cruiseFixture(fixtureRoot, [tuiRule]);

    expect(
      parsed.summary.violations.filter((v: { from: string }) => v.from === 'src/bin/tui.ts'),
    ).toEqual([]);
    expect(parsed.summary.violations).toEqual([
      expect.objectContaining({
        from: 'src/bin/other.ts',
        rule: expect.objectContaining({ name: 'no-tui-leak-outside-driving-tui' }),
      }),
    ]);
  });
});

describe('.dependency-cruiser.cjs no-child-process-outside-driven-adapters rule', () => {
  const childProcessRule = depCruiserConfig.forbidden.find(
    (candidate: { name: string }) => candidate.name === 'no-child-process-outside-driven-adapters',
  );
  let fixtureRoot: string;

  afterEach(() => {
    if (fixtureRoot) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('flags child_process imported from core or a driving adapter, but not from a driven adapter', async () => {
    fixtureRoot = makeFixture();
    mkdirSync(join(fixtureRoot, 'src', 'adapters', 'driving'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'src', 'adapters', 'driven'), { recursive: true });
    writeFileSync(
      join(fixtureRoot, 'src', 'core', 'spawner.ts'),
      "import { spawn } from 'node:child_process';\nexport const s = spawn;\n",
    );
    writeFileSync(
      join(fixtureRoot, 'src', 'adapters', 'driving', 'spawner.ts'),
      "import { spawn } from 'child_process';\nexport const s = spawn;\n",
    );
    writeFileSync(
      join(fixtureRoot, 'src', 'adapters', 'driven', 'spawner.ts'),
      "import { spawn } from 'node:child_process';\nexport const s = spawn;\n",
    );

    expect(childProcessRule).toBeDefined();
    const result = await cruiseFixture(fixtureRoot, [childProcessRule]);

    // The driven fixture must actually have been cruised for its absence below to mean anything.
    const cruised = result.modules.map((module: { source: string }) => module.source);
    expect(cruised).toContain('src/adapters/driven/spawner.ts');
    const offenders = result.summary.violations.map((v: { from: string }) => v.from).sort();
    expect(offenders).toEqual(['src/adapters/driving/spawner.ts', 'src/core/spawner.ts']);
    expect(result.summary.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: expect.objectContaining({ name: 'no-child-process-outside-driven-adapters' }) }),
      ]),
    );
  });
});
