"""CLI entry point for repo-factory."""

from __future__ import annotations

import argparse
import json
import shlex
import shutil
import subprocess
import sys

from .core import build_commands, load_manifest


def main() -> int:
    """Main entry point for repo-factory CLI."""
    parser = argparse.ArgumentParser(
        description="Create GitHub repositories from manifests"
    )
    parser.add_argument(
        "--manifest",
        default="repos.json",
        help="Path to repository manifest JSON file (default: repos.json)"
    )
    parser.add_argument(
        "--template",
        help="Template repository name"
    )
    parser.add_argument(
        "--visibility", 
        choices=["public", "private"],
        help="Repository visibility"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print commands without executing them (default behavior)"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Execute commands via gh CLI"
    )

    args = parser.parse_args()

    # Load manifest
    try:
        manifest = load_manifest(args.manifest)
    except FileNotFoundError:
        print(f"Error: Manifest file '{args.manifest}' not found", file=sys.stderr)
        return 1
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in manifest file: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    # Use manifest defaults if not overridden
    visibility = args.visibility or manifest.get("default_visibility")
    template = args.template or manifest.get("template") or None
    
    # Handle empty template string from manifest
    if template == "":
        template = None

    # Build commands
    try:
        commands = build_commands(manifest, template=template, visibility=visibility)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    # Execute based on mode
    if args.apply:
        return _execute_commands(commands)
    else:
        # Dry run is default
        for command in commands:
            print(command)
        return 0


def _execute_commands(commands: list[str]) -> int:
    """Execute commands using gh CLI."""
    # Check if gh is available
    if not shutil.which("gh"):
        print("Error: 'gh' command not found. Please install GitHub CLI and log in.", file=sys.stderr)
        return 1

    # Execute each command
    for command in commands:
        print(f"Executing: {command}")
        try:
            # Use shlex.split to safely parse the command string into arguments
            # This prevents shell injection by avoiding shell=True
            cmd_parts = shlex.split(command)
            subprocess.run(cmd_parts, check=True)
        except subprocess.CalledProcessError as e:
            print(f"Error executing command: {command}", file=sys.stderr)
            return e.returncode
        except KeyboardInterrupt:
            print("\nOperation cancelled by user", file=sys.stderr)
            return 130  # Standard interrupt exit code
        except ValueError as e:
            print(f"Error parsing command: {command}: {e}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())