#!/usr/bin/env bash
# Prechecks git and Node >= 24, then runs the npx installer. Writes nothing itself.
set -eu

REPO="github:Maxe2005/tui-back"
MIN_NODE=24

fail() {
  printf 'tui-back install: %s\n' "$1" >&2
  shift
  for line in "$@"; do printf '  %s\n' "$line" >&2; done
  exit 1
}

if ! command -v git >/dev/null 2>&1; then
  fail "git is required but was not found." \
    "Debian/Ubuntu: sudo apt install git" \
    "macOS (Homebrew): brew install git"
fi

node_help=(
  "nvm:  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash && nvm install ${MIN_NODE}"
  "apt:  see https://nodejs.org/en/download for the NodeSource setup for Node ${MIN_NODE}"
  "brew: brew install node@${MIN_NODE}"
)

if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  fail "node and npx (Node >= ${MIN_NODE}) are required but were not found." "${node_help[@]}"
fi

node_version="$(node -v)"
node_version="${node_version#v}"
node_major="${node_version%%.*}"
case "$node_major" in
  ''|*[!0-9]*) fail "could not parse the Node version '${node_version}'." "${node_help[@]}" ;;
esac
if [ "$node_major" -lt "$MIN_NODE" ]; then
  fail "Node >= ${MIN_NODE} is required (found ${node_version})." "${node_help[@]}"
fi

exec npx -y "${REPO}" install "$@"
