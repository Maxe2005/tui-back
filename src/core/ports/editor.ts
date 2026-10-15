// core/ports/editor: the editor-launch port contract. Opens a repo in the developer's editor
// with the terminal handed over until the editor exits; the adapter owns how it is spawned.
import type { Result } from '../result.js';

export interface EditorPort {
  // Resolves the command (configured setting, then $EDITOR, then `vi`), runs it on repoPath
  // and waits for exit. The exit status is deliberately unread; only a command that could not
  // be started surfaces, as `editor-launch-failed`, never a throw.
  launch(repoPath: string, editorCommand: string): Result<void>;
}
