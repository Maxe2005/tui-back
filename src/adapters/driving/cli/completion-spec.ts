// adapters/driving/cli/completion-spec: pure generator of the bash completion script from the
// live subcommand registry. Names, verbs and flags are scraped from the `usage` strings, so a
// new subcommand shows up without touching this file. No I/O: callable in-process.

export interface CompletionCommand {
  name: string;
  usage: string;
}

export interface CompletionSpec {
  commands: CompletionCommand[];
}

const STATIC_WORDS = ['tui', 'mcp', '--help', '-h'];
const FLAG_PATTERN = /--[a-z][a-z-]*/g;
const ALIASES = ['tui-back', 'tb'];

function scrapeFlags(text: string): string[] {
  return [...new Set(text.match(FLAG_PATTERN) ?? [])];
}

function scrapeVerbs(command: CompletionCommand): Map<string, string[]> {
  const verbs = new Map<string, string[]>();
  const marker = new RegExp(`tui-back ${command.name} ([a-z][a-z-]*)`, 'g');
  for (const line of command.usage.split('\n')) {
    const hits = [...line.matchAll(marker)];
    hits.forEach((hit, index) => {
      const segment = line.slice(hit.index, hits[index + 1]?.index ?? line.length);
      const flags = verbs.get(hit[1]) ?? [];
      verbs.set(hit[1], [...new Set([...flags, ...scrapeFlags(segment)])]);
    });
  }
  return verbs;
}

export function generateBashCompletion(spec: CompletionSpec): string {
  const names = [...spec.commands.map((command) => command.name), ...STATIC_WORDS];
  const verbCases: string[] = [];
  const verbFlagCases: string[] = [];
  const commandFlagCases: string[] = [];

  for (const command of spec.commands) {
    // A command is verb-style when its usage has `tui-back <name> <verb>` lines (derived, not listed).
    const verbs = scrapeVerbs(command);
    if (verbs.size > 0) {
      verbCases.push(`    ${command.name}) words="${[...verbs.keys()].join(' ')}" ;;`);
      for (const [verb, flags] of verbs) {
        verbFlagCases.push(`    "${command.name} ${verb}") words="${flags.join(' ')}" ;;`);
      }
    } else {
      const flags = scrapeFlags(command.usage);
      if (flags.length > 0) {
        commandFlagCases.push(`        "${command.name}") words="${flags.join(' ')}" ;;`);
      }
    }
  }

  const lines = [
    '# bash completion for tui-back (generated; do not edit)',
    '_tui_back() {',
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    '  local cmd="${COMP_WORDS[1]}"',
    '  local words=""',
    '  COMPREPLY=()',
    '  if [ "$COMP_CWORD" -eq 1 ]; then',
    `    words="${names.join(' ')}"`,
    '  elif [ "$COMP_CWORD" -eq 2 ] && [[ "$cur" != -* ]]; then',
    '    case "$cmd" in',
    ...verbCases,
    '    esac',
    '  elif [[ "$cur" == -* ]]; then',
    '    case "$cmd ${COMP_WORDS[2]}" in',
    ...verbFlagCases,
    "      *)",
    "        case \"$cmd\" in",
    ...commandFlagCases,
    '        esac',
    '        ;;',
    '    esac',
    '  fi',
    '  mapfile -t COMPREPLY < <(compgen -W "$words" -- "$cur")',
    '}',
    `complete -o default -F _tui_back ${ALIASES.join(' ')}`,
    '',
  ];
  return lines.join('\n');
}
