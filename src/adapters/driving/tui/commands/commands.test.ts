import { describe, it, expect } from 'vitest';
import { COMMANDS, matchCommands, findExactCommand, runCommand, type Command } from './commands.js';

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

  it('tags every edt-* command with the edts zoneId, so runCommand auto-switches to it', () => {
    for (const name of ['edt-create', 'edt-switch', 'edt-modify', 'edt-delete']) {
      expect(COMMANDS.find((c) => c.name === name)!.zoneId).toBe('edts');
    }
  });

  it('leaves zoneId unset on zone-independent commands (registry/settings/quit)', () => {
    for (const name of ['registry', 'settings', 'quit']) {
      expect(COMMANDS.find((c) => c.name === name)!.zoneId).toBeUndefined();
    }
  });

  it('registers the settings command', () => {
    expect(COMMANDS.find((c) => c.name === 'settings')).toBeDefined();
  });

  it('registers the quit command', () => {
    expect(COMMANDS.find((c) => c.name === 'quit')).toBeDefined();
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
});

describe('runCommand', () => {
  function fakeStoreWithZone(activeZone: string) {
    const calls: string[] = [];
    let zone = activeZone;
    const useStore = {
      getState: () => ({
        activeZone: zone,
        setActiveZone: (nextZone: string) => {
          zone = nextZone;
          calls.push(`setActiveZone:${nextZone}`);
        },
        openEdtSwitchDialog: (query: string) => calls.push(`openEdtSwitchDialog:${query}`),
        openRegistryScreen: () => calls.push('openRegistryScreen'),
      }),
    } as unknown as Parameters<Command['run']>[0];
    return { useStore, calls };
  }

  it('switches to the command\'s zone before running it, when launched from a different zone', () => {
    const { useStore, calls } = fakeStoreWithZone('dashboard');
    const switchCmd = COMMANDS.find((c) => c.name === 'edt-switch')!;

    runCommand(switchCmd, useStore, 'edt-switch my-topic');

    expect(calls).toEqual(['setActiveZone:edts', 'openEdtSwitchDialog:edt-switch my-topic']);
  });

  it('never switches zone when the command\'s zone is already active', () => {
    const { useStore, calls } = fakeStoreWithZone('edts');
    const switchCmd = COMMANDS.find((c) => c.name === 'edt-switch')!;

    runCommand(switchCmd, useStore, 'edt-switch my-topic');

    expect(calls).toEqual(['openEdtSwitchDialog:edt-switch my-topic']);
  });

  it('never switches zone for a zone-independent command (e.g. registry), regardless of the active zone', () => {
    const { useStore, calls } = fakeStoreWithZone('dashboard');
    const registryCmd = COMMANDS.find((c) => c.name === 'registry')!;

    runCommand(registryCmd, useStore, '');

    expect(calls).toEqual(['openRegistryScreen']);
  });
});
