import { describe, expect, it } from 'vitest';
import { detectTtyCommand, splitSegments, withoutRedirections } from './tty-guard.js';

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

describe('detectTtyCommand — guard gaps', () => {
  it.each(['sudo vim /etc/hosts', 'sudo -u root vim f', 'env vim f', 'env -i FOO=1 vim f', 'exec top', 'nohup less f', 'time htop', 'command vim f', 'sudo bash', 'sudo -u me ssh host'])(
    '(a) sees through the wrapper prefix in %j',
    (command) => {
      expect(detectTtyCommand(command)).not.toBeNull();
    },
  );

  it.each(['sudo ls', 'env FOO=1 ls', 'time make', 'command -v vim', 'sudo -u root bash script.sh'])(
    '(a) lets the wrapped line-oriented command %j through',
    (command) => {
      expect(detectTtyCommand(command)).toBeNull();
    },
  );

  it.each(['(vim x)', '{ vim x; }', 'cd sub && (less f)', '(bash)'])('(b) strips the grouping in %j', (command) => {
    expect(detectTtyCommand(command)).not.toBeNull();
  });

  it.each(['ls # then vim', 'ls #less', '# top'])('(c) ignores the comment in %j', (command) => {
    expect(detectTtyCommand(command)).toBeNull();
  });

  it('(c) resumes scanning after a commented line ends', () => {
    expect(detectTtyCommand('ls # note\nvim x')).toContain('vim');
    expect(detectTtyCommand('echo a#vim')).toBeNull();
  });

  it.each(['node app.js 2>&1', 'make >&2', 'ls &>/dev/null', 'node app.js >& log'])(
    '(d) does not split on the redirection & in %j',
    (command) => {
      expect(detectTtyCommand(command)).toBeNull();
    },
  );

  it('(d) still splits on a real background &', () => {
    expect(splitSegments('make 2>&1 & htop')).toEqual([['make', '2>&1'], ['htop']]);
  });

  it.each(['bash > out.log', 'node 2>&1', 'python < /dev/null', 'psql >f', 'ssh host > log', 'ssh host 2>&1'])(
    '(e) ignores redirections when counting args in %j',
    (command) => {
      expect(detectTtyCommand(command)).not.toBeNull();
    },
  );

  it.each(['vim --version', 'less --help', 'man -h', 'top -b', 'top -bn1', 'top -n1 -b', 'htop --version'])(
    '(f) lets the non-interactive invocation %j through',
    (command) => {
      expect(detectTtyCommand(command)).toBeNull();
    },
  );

  it.each(['top -n1', 'vim -R f'])('(f) still flags %j', (command) => {
    expect(detectTtyCommand(command)).not.toBeNull();
  });

  it.each([
    ['ssh -vp 22 host', false],
    ['ssh -vp 22 host uptime', true],
    ['ssh -p22 host', false],
    ['ssh -vi key host ls', true],
  ])('(g) parses bundled ssh flags in %j (remote command: %s)', (command, hasRemote) => {
    expect(detectTtyCommand(command) === null).toBe(hasRemote);
  });
});

describe('withoutRedirections', () => {
  it('drops attached and detached redirections', () => {
    expect(withoutRedirections(['a', '>', 'f', '2>&1', '<in', '&>x', '>>', 'g', 'b'])).toEqual(['a', 'b']);
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
