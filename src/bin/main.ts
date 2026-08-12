// Placeholder CLI entrypoint — real subcommand dispatch lands in later stories (AD-2/AD-3).
// No explicit process.exit() here: calling it right after stdout.write() does not
// guarantee the write is flushed when stdout is a pipe/non-TTY. Setting exitCode and
// letting the script end naturally lets Node drain stdout before exiting.
process.stdout.write('tui-back — not yet implemented\n');
process.exitCode = 0;
