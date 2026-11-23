// cli/commands/basic: the small single-use-case commands (register, list-repos, scan, ping, edts, dashboard).
import { err } from '../../../../core/result.js';
import { ping } from '../../../../core/ping.js';
import { listEdtBranchesDivergence } from '../../../../core/edt/lifecycle/list.js';
import { buildDashboardSnapshot } from '../../../../core/dashboard/snapshot.js';
import { healthCheckEnabledFrom } from '../../../../core/ports/storage/settings.js';
import { registerRepo } from '../../../../core/scripts/registry/register.js';
import { resetRepo } from '../../../../core/scripts/reset/reset.js';
import { listRepos } from '../../../../core/scripts/registry/list-repos.js';
import { scanRepos } from '../../../../core/scripts/registry/scan.js';
import { Subcommand } from '../dispatch.js';
import { SubcommandDeps } from './deps.js';
import { loadSettingsOrDefaults } from './shared.js';

export function registerSubcommand(deps: SubcommandDeps): Subcommand {
  return {
    name: 'register',
    usage: 'tui-back register [--reset] <path>',
    run: async (args) => {
      if (args.length === 0) {
        return registerRepo(deps.registry, deps.lock, deps.registryResourceKey, undefined);
      }
      if (args[0] === '--reset') {
        if (args.length > 2) {
          return err('invalid-argument', 'Usage: tui-back register --reset <path>');
        }
        return resetRepo(deps.registry, deps.lock, deps.registryResourceKey, args[1]);
      }
      if (args.length > 1) {
        return err('invalid-argument', 'Usage: tui-back register <path>');
      }
      return registerRepo(deps.registry, deps.lock, deps.registryResourceKey, args[0]);
    },
  };
}

export function listReposSubcommand(deps: SubcommandDeps): Subcommand {
  return {
    name: 'list-repos',
    usage: 'tui-back list-repos',
    run: async (args) =>
      args.length === 0
        ? listRepos(deps.registry, deps.manifest)
        : err('invalid-argument', 'Usage: tui-back list-repos'),
  };
}

export function scanSubcommand(deps: SubcommandDeps): Subcommand {
  return {
    name: 'scan',
    usage: 'tui-back scan <root>',
    run: async (args) => {
      if (args.length === 0) {
        return scanRepos(deps.registry, undefined);
      }
      if (args.length > 1) {
        return err('invalid-argument', 'Usage: tui-back scan <root>');
      }
      return scanRepos(deps.registry, args[0]);
    },
  };
}

export function pingSubcommand(deps: SubcommandDeps): Subcommand {
  return {
    name: 'ping',
    usage: 'tui-back ping',
    run: async (args) => (args.length === 0 ? ping() : err('invalid-argument', 'Usage: tui-back ping')),
  };
}

export function edtsSubcommand(deps: SubcommandDeps): Subcommand {
  return {
    name: 'edts',
    usage: 'tui-back edts',
    // Every managed service's current branch + ahead/behind divergence from its own
    // configured upstream (FR-9), uniformly for EDT members and non-members alike.
    run: async (args) =>
      args.length === 0
        ? listEdtBranchesDivergence({
            registry: deps.registry,
            manifest: deps.manifest,
            git: deps.git,
            edtRegistry: deps.edtRegistry,
            state: deps.state,
          })
        : err('invalid-argument', 'Usage: tui-back edts'),
  };
}

export function dashboardSubcommand(deps: SubcommandDeps): Subcommand {
  return {
    name: 'dashboard',
    usage: 'tui-back dashboard',
    // The Dashboard's snapshot (active EDT services with their health-first status, registry
    // health), read-only.
    run: async (args) => {
      if (args.length !== 0) {
        return err('invalid-argument', 'Usage: tui-back dashboard');
      }
      const settings = await loadSettingsOrDefaults(deps.settings);
      return buildDashboardSnapshot({
        registry: deps.registry,
        manifest: deps.manifest,
        git: deps.git,
        docker: deps.docker,
        ...(deps.healthProbe === undefined ? {} : { healthProbe: deps.healthProbe }),
        isHealthCheckEnabled: healthCheckEnabledFrom(() => settings),
        edtRegistry: deps.edtRegistry,
        state: deps.state,
      });
    },
  };
}
