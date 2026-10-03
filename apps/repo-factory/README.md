# Repo Factory

Create GitHub repositories from manifests.

## Overview

Repo Factory is a tool that reads a JSON manifest file describing repositories to create and generates the appropriate `gh repo create` commands. It can either display the commands (dry-run mode) or execute them directly via the GitHub CLI.

## Installation

```bash
pip install -e .
```

## Usage

```bash
# Show commands that would be executed (default behavior)
python -m repo_factory

# Execute commands via gh CLI
python -m repo_factory --apply

# Use custom manifest file
python -m repo_factory --manifest my-repos.json

# Override template and visibility
python -m repo_factory --template acme/default --visibility public

# Combine with apply
python -m repo_factory --apply --template acme/default --visibility public
```

### Important Security Note

The `--apply` flag executes commands on your system and should **never** be run inside the Dev/QA sandbox environment. It must be run by a human on their local machine with the GitHub CLI installed and authenticated.

## Manifest Format

The manifest file is a JSON document with the following structure:

```json
{
  "default_visibility": "private",
  "template": "",
  "repositories": [
    "repo-name-1",
    "repo-name-2"
  ]
}
```

- `default_visibility`: Default visibility for repositories ("public" or "private")
- `template`: Template repository to use as a base (empty string means no template)
- `repositories`: Array of repository names to create

## CLI Options

- `--manifest PATH`: Path to repository manifest JSON file (default: repos.json)
- `--template NAME`: Template repository name
- `--visibility {public,private}`: Repository visibility
- `--dry-run`: Print commands without executing them (default behavior)
- `--apply`: Execute commands via gh CLI

## Requirements

- Python 3.8+
- [GitHub CLI](https://cli.github.com/) installed and authenticated (for `--apply` mode)