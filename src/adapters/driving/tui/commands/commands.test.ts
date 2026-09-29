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
    expect(matchCommands('registry')).toEqual([COMMANDS[0]!]);
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

describe('COMMANDS (story 2.14, 2.15)', () => {
  it('registers the registry command', () => {
    expect(COMMANDS.find((c) => c.name === 'registry')).toBeDefined();
  });

  it('registers the edt-create command', () => {
    expect(COMMANDS.find((c) => c.name === 'edt-create')).toBeDefined();
  });

  it('registers the edt-switch command', () => {
    expect(COMMANDS.find((c) => c.name === 'edt-switch')).toBeDefined();
  });

  it('registers the edt-modify command', () => {
    expect(COMMANDS.find((c) => c.name === 'edt-modify')).toBeDefined();
  });

  it('registers the edt-delete command', () => {
    expect(COMMANDS.find((c) => c.name === 'edt-delete')).toBeDefined();
  });

  it('registers the settings command', () => {
    expect(COMMANDS.find((c) => c.name === 'settings')).toBeDefined();
  });

  it('registers the quit command', () => {
    expect(COMMANDS.find((c) => c.name === 'quit')).toBeDefined();
  });

  it('registers the update-edt command on the update zone', () => {
    expect(COMMANDS.find((c) => c.name === 'update-edt')?.zoneId).toBe('update');
  });

  it('registers the update-all command on the update zone', () => {
    expect(COMMANDS.find((c) => c.name === 'update-all')?.zoneId).toBe('update');
  });

  it('registers the update-service command on the update zone', () => {
    expect(COMMANDS.find((c) => c.name === 'update-service')?.zoneId).toBe('update');
  });

  it('the registry command calls the store\'s openRegistryScreen action — no core/ports import', () => {
    const calls: string[] = [];
    const fakeStore = {
      getState: () => ({
        openRegistryScreen: () => calls.push('openRegistryScreen'),
      }),
    } as unknown as Parameters<Command['run']>[0];

    COMMANDS[0]!.run(fakeStore, '');

    expect(calls).toEqual(['openRegistryScreen']);
  });

  it('the edt-create command calls openEdtCreateDialog', () => {
    const calls: string[] = [];
    const fakeStore = {
      getState: () => ({
        openEdtCreateDialog: () => calls.push('openEdtCreateDialog'),
      }),
    } as unknown as Parameters<Command['run']>[0];

    const createCmd = COMMANDS.find((c) => c.name === 'edt-create')!;
    createCmd.run(fakeStore, '');

    expect(calls).toEqual(['openEdtCreateDialog']);
  });

  it('the edt-switch command calls openEdtSwitchDialog with full query', () => {
    const calls: string[] = [];
    const fakeStore = {
      getState: () => ({
        openEdtSwitchDialog: (query: string) => calls.push(query),
      }),
    } as unknown as Parameters<Command['run']>[0];

    const switchCmd = COMMANDS.find((c) => c.name === 'edt-switch')!;
    switchCmd.run(fakeStore, 'edt-switch my-topic');

    expect(calls).toEqual(['edt-switch my-topic']);
  });

  it('the edt-modify command calls openEdtModifyDialog with full query', () => {
    const calls: string[] = [];
    const fakeStore = {
      getState: () => ({
        openEdtModifyDialog: (query: string) => calls.push(query),
      }),
    } as unknown as Parameters<Command['run']>[0];

    const modifyCmd = COMMANDS.find((c) => c.name === 'edt-modify')!;
    modifyCmd.run(fakeStore, 'edt-modify my-topic');

    expect(calls).toEqual(['edt-modify my-topic']);
  });

  it('the edt-delete command calls openEdtDeleteDialog with full query', () => {
    const calls: string[] = [];
    const fakeStore = {
      getState: () => ({
        openEdtDeleteDialog: (query: string) => calls.push(query),
      }),
    } as unknown as Parameters<Command['run']>[0];

    const deleteCmd = COMMANDS.find((c) => c.name === 'edt-delete')!;
    deleteCmd.run(fakeStore, 'edt-delete my-topic');

    expect(calls).toEqual(['edt-delete my-topic']);
  });

  it('the settings command calls the store\'s openSettingsScreen action', () => {
    const calls: string[] = [];
    const fakeStore = {
      getState: () => ({
        openSettingsScreen: () => calls.push('openSettingsScreen'),
      }),
    } as unknown as Parameters<Command['run']>[0];

    const settingsCmd = COMMANDS.find((c) => c.name === 'settings')!;
    settingsCmd.run(fakeStore, '');

    expect(calls).toEqual(['openSettingsScreen']);
  });

  it('the quit command calls requestQuit', () => {
    const calls: string[] = [];
    const fakeStore = {
      getState: () => ({
        runInProgress: false,
        requestQuit: () => calls.push('requestQuit'),
      }),
    } as unknown as Parameters<Command['run']>[0];

    const quitCmd = COMMANDS.find((c) => c.name === 'quit')!;
    quitCmd.run(fakeStore, '');

    expect(calls).toEqual(['requestQuit']);
  });

  it('the quit command is a no-op while a run is in progress, mirroring shouldQuit\'s own guard', () => {
    const calls: string[] = [];
    const fakeStore = {
      getState: () => ({
        runInProgress: true,
        requestQuit: () => calls.push('requestQuit'),
      }),
    } as unknown as Parameters<Command['run']>[0];

    const quitCmd = COMMANDS.find((c) => c.name === 'quit')!;
    quitCmd.run(fakeStore, '');

    expect(calls).toEqual([]);
  });

  it('the update-edt command opens the edt-scoped config (the bar activates the zone via zoneId)', () => {
    const calls: string[] = [];
    const fakeStore = {
      getState: () => ({
        openUpdateConfig: (target: string) => calls.push(`openUpdateConfig:${target}`),
      }),
    } as unknown as Parameters<Command['run']>[0];

    const cmd = COMMANDS.find((c) => c.name === 'update-edt')!;
    cmd.run(fakeStore, 'update-edt');

    expect(calls).toEqual(['openUpdateConfig:edt']);
  });

  it('the update-all command opens the all-repos config (the bar activates the zone via zoneId)', () => {
    const calls: string[] = [];
    const fakeStore = {
      getState: () => ({
        openUpdateConfig: (target: string) => calls.push(`openUpdateConfig:${target}`),
      }),
    } as unknown as Parameters<Command['run']>[0];

    const cmd = COMMANDS.find((c) => c.name === 'update-all')!;
    cmd.run(fakeStore, 'update-all');

    expect(calls).toEqual(['openUpdateConfig:all']);
  });

  it('the update-service command forwards the full query for arg parsing (the bar activates the zone via zoneId)', () => {
    const calls: string[] = [];
    const fakeStore = {
      getState: () => ({
        openUpdateServiceDialog: (query: string) => calls.push(query),
      }),
    } as unknown as Parameters<Command['run']>[0];

    const cmd = COMMANDS.find((c) => c.name === 'update-service')!;
    cmd.run(fakeStore, 'update-service svc-a');

    expect(calls).toEqual(['update-service svc-a']);
  });

  it('the update commands are visible through prefix autocomplete on "update"', () => {
    expect(matchCommands('update').map((c) => c.name)).toEqual(['update-edt', 'update-all', 'update-service']);
  });

  it('the update commands narrow by scope prefix without guessing across scopes', () => {
    expect(matchCommands('update-e').map((c) => c.name)).toEqual(['update-edt']);
    expect(matchCommands('update-s').map((c) => c.name)).toEqual(['update-service']);
  });
});
