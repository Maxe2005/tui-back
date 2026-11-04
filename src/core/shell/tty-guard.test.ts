import { describe, expect, it } from 'vitest';
import { detectTtyCommand, splitSegments } from './tty-guard.js';

describe('detectTtyCommand', () => {
  it.each(['vim x', 'vi', 'nvim file', 'nano a', 'emacs', 'less f', 'more f', 'man ls', 'top', 'htop', 'watch ls'])(
    'flags the full-screen program in %j',
    (command) => {
      expect(detectTtyCommand(command)).toMatch(/interactive terminal/);
    },
  );

  it.each(['sh', 'bash', 'zsh', 'python', 'python3', 'node', 'psql', 'mysql', 'redis-cli', '  bash  '])(
    'flags the bare REPL %j',
    (command) => {
      expect(detectTtyCommand(command)).not.toBeNull();
    },
  );

  it.each(['ssh host', 'ssh -p 2222 host', 'ssh -i key user@host', 'ssh -A host'])('flags the bare ssh session %j', (command) => {
    expect(detectTtyCommand(command)).toContain('ssh');
  });

  it.each([
    'ssh host uptime',
    'ssh -p 2222 host ls -la',
    "sh -c 'echo hi'",
    'bash script.sh',
    'python -c "print(1)"',
    'node -v',
    "psql -c 'select 1'",
    'redis-cli ping',
    'ls -la',
    'git log --oneline',
    'echo vim',
    "echo 'a; vim'",
    'echo "x | less"',
    '',
    '   ',
  ])('lets the line-oriented command %j through', (command) => {
    expect(detectTtyCommand(command)).toBeNull();
  });

  it.each(['cd sub && vim x', 'ls; less f', 'git log | less', 'false || top', 'make & htop'])(
    'checks every segment of %j',
    (command) => {
      expect(detectTtyCommand(command)).not.toBeNull();
    },
  );

  it('ignores leading env assignments and path prefixes', () => {
    expect(detectTtyCommand('EDITOR=x /usr/bin/vim f')).toContain('vim');
    expect(detectTtyCommand('FOO=1 node')).toContain('node');
    expect(detectTtyCommand('FOO=1 node app.js')).toBeNull();
  });
});

describe('splitSegments', () => {
  it('splits on unquoted operators and strips quotes', () => {
    expect(splitSegments(`a "b c" && d 'e;f' | g; h || i`)).toEqual([['a', 'b c'], ['d', 'e;f'], ['g'], ['h'], ['i']]);
  });

  it('keeps an empty quoted word', () => {
    expect(splitSegments(`echo ""`)).toEqual([['echo', '']]);
  });
});
