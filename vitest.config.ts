import { configDefaults, defineConfig } from 'vitest/config';

// Vitest discovers every test file under the project root. Agent worktrees live inside it
// (`.claude/worktrees/<name>` is a full checkout of another branch), so without this exclude
// `npm test` also runs that checkout's copy of the suite — doubling the run and reporting
// failures from code that isn't this working tree's.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
