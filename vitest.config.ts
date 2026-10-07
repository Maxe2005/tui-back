import { configDefaults, defineConfig } from 'vitest/config';

// Vitest discovers every test file under the project root. Agent worktrees live inside it
// (`.claude/worktrees/<name>` is a full checkout of another branch), so without this exclude
// `npm test` also runs that checkout's copy of the suite — doubling the run and reporting
// failures from code that isn't this working tree's.
export default defineConfig({
  test: {
    // Render assertions match plain text; a FORCE_COLOR/COLORTERM in the caller's shell would
    // wrap it in ANSI codes and split the expected strings.
    env: { FORCE_COLOR: '0', NO_COLOR: '1' },
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
