import { describe, expect, it } from 'vitest';
import { generateBashCompletion } from './completion-spec.js';

const completionFixture = [
  { name: 'ping', usage: 'tui-back ping' },
  { name: 'register', usage: 'tui-back register [--reset] <path>' },
  {
    name: 'edt',
    usage:
      'tui-back edt create --topic <topic> [--create-branches]\n' +
      'tui-back edt switch --to <topic> [--force] (remark)\n' +
      'tui-back edt delete <topic> [--branches x]',
  },
  {
    name: 'registry',
    usage: 'tui-back registry clean | tui-back registry clean --yes --path <p>\ntui-back registry validate',
  },
];

describe('generateBashCompletion', () => {
  const script = generateBashCompletion({ commands: completionFixture });

  it('lists registry names plus the static entries at word 1', () => {
    expect(script).toContain('words="ping register edt registry tui --help -h"');
  });

  it('completes verbs for edt and registry only', () => {
    expect(script).toContain('edt) words="create switch delete" ;;');
    expect(script).toContain('registry) words="clean validate" ;;');
    expect(script).not.toContain('register) words=');
  });

  it('scopes flags per verb and per command', () => {
    expect(script).toContain('"edt switch") words="--to --force"');
    expect(script).toContain('"edt create") words="--topic --create-branches"');
    expect(script).toContain('"registry clean") words="--yes --path"');
    expect(script).toContain('"register") words="--reset"');
  });

  it('registers the function for tui-back and tb', () => {
    expect(script).toContain('complete -F _tui_back tui-back tb');
  });
});
