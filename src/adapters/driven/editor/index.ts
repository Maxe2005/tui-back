// adapters/driven/editor: the driven implementation of core's EditorPort. The editor runs
// synchronously with stdio inherited so it owns the terminal until it exits.
import { spawnSync } from 'node:child_process';
import { err, ok } from '../../../core/result.js';
import type { EditorPort } from '../../../core/ports/editor.js';
import { resolveEditorCommand } from './command.js';

export function createEditorPort(env: NodeJS.ProcessEnv = process.env): EditorPort {
  return {
    launch(repoPath, editorCommand) {
      const { binary, args } = resolveEditorCommand(editorCommand, env.EDITOR, repoPath);
      // Invalid arguments (e.g. a NUL byte) make spawnSync throw rather than report an error.
      try {
        const result = spawnSync(binary, args, { stdio: 'inherit' });
        if (result.error !== undefined) {
          return err('editor-launch-failed', `Could not launch "${binary}": ${result.error.message}`);
        }
        return ok(undefined);
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        return err('editor-launch-failed', `Could not launch "${binary}": ${cause}`);
      }
    },
  };
}
