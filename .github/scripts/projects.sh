#!/usr/bin/env bash
# Print each project directory that contains one of the given marker files,
# skipping the legacy BotTeam demo code and dependency folders.
#   .github/scripts/projects.sh package.json
#   .github/scripts/projects.sh pyproject.toml requirements.txt
set -euo pipefail

# Legacy code from the original demo: security-scanned, but not built or tested.
LEGACY_DIRS=(./botadmin ./botoffice ./rakazo ./docs)

prune=()
for d in "${LEGACY_DIRS[@]}"; do prune+=(-path "$d" -o); done
prune+=(-path ./.git -o -name node_modules -o -name .venv -o -name .next)

names=()
for n in "$@"; do names+=(-name "$n" -o); done
unset 'names[${#names[@]}-1]'

find . \( "${prune[@]}" \) -prune -o \( "${names[@]}" \) -type f -print0 \
  | xargs -0 -r -n1 dirname | sort -u
