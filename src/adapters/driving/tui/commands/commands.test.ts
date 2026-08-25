import { describe, it, expect } from 'vitest';
import { COMMANDS, matchCommands, findExactCommand, type Command } from './commands.js';

const commands: Command[] = [
  { name: 'registry', run: () => {} },
  { name: 'reload', run: () => {} },
  { name: 'quit', run: () => {} },
];

describe('matchCommands (story 2.14)', () => {
  it('shows every command on an empty query', () => {
    expect(matchCommands('', commands)).toEqual(commands);
  });

  it('filters by case-insensitive name-prefix', () => {
    expect(matchCommands('re', commands)).toEqual([commands[0], commands[1]]);
  });

  it('matches regardless of the query\'s case', () => {
    expect(matchCommands('RE', commands)).toEqual([commands[0], commands[1]]);
    expect(matchCommands('Reg', commands)).toEqual([commands[0]]);
  });

  it('narrows to the single exact-name match once the full name is typed', () => {
    expect(matchCommands('registry', commands)).toEqual([commands[0]]);
  });

  it('returns an explicit empty list — never throws — when nothing matches', () => {
    expect(matchCommands('zzz', commands)).toEqual([]);
  });

  it('defaults to filtering the real COMMANDS registry when no list is supplied', () => {
    expect(matchCommands('registry')).toEqual([...COMMANDS]);
    expect(matchCommands('nope')).toEqual([]);
  });
});

describe('findExactCommand (story 2.14)', () => {
  it('finds an exact, case-insensitive name match', () => {
    expect(findExactCommand('registry', commands)).toBe(commands[0]);
    expect(findExactCommand('REGISTRY', commands)).toBe(commands[0]);
  });

  it('returns null on a partial or ambiguous-prefix match — never a guess', () => {
    expect(findExactCommand('reg', commands)).toBeNull();
    expect(findExactCommand('re', commands)).toBeNull();
  });

  it('returns null on a match with trailing extra characters', () => {
    expect(findExactCommand('registryy', commands)).toBeNull();
  });

  it('returns null when no command matches at all', () => {
    expect(findExactCommand('zzz', commands)).toBeNull();
  });
});

describe('COMMANDS (story 2.14)', () => {
  it('registers exactly one command, "registry", for now', () => {
    expect(COMMANDS.map((command) => command.name)).toEqual(['registry']);
  });

  it('the registry command calls the store\'s openRegistryScreen action — no core/ports import', () => {
    const calls: string[] = [];
    const fakeStore = {
      getState: () => ({
        openRegistryScreen: () => calls.push('openRegistryScreen'),
      }),
    } as unknown as Parameters<Command['run']>[0];

    COMMANDS[0]!.run(fakeStore);

    expect(calls).toEqual(['openRegistryScreen']);
  });
});
