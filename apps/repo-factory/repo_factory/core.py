from __future__ import annotations

import json
import re


def load_manifest(path: str) -> dict:
    """Load repository manifest from JSON file."""
    with open(path, 'r') as f:
        data = json.load(f)
        # Ensure the manifest is a dictionary
        if not isinstance(data, dict):
            raise TypeError(f"Manifest must be a JSON object, got {type(data).__name__}")
        return data


def build_commands(
    manifest: dict, 
    template: str | None = None, 
    visibility: str | None = None
) -> list[str]:
    """Build gh repo create commands from manifest.
    
    Args:
        manifest: Repository manifest dictionary
        template: Optional template repository name
        visibility: Optional visibility setting ("public" or "private")
        
    Returns:
        List of gh repo create command strings
        
    Raises:
        ValueError: If any repository name is invalid
        TypeError: If repositories is not a list or repository names are not strings
    """
    # Validate repositories is a list
    repositories = manifest.get("repositories", [])
    if not isinstance(repositories, list):
        raise TypeError(f"repositories must be a list, got {type(repositories).__name__}")
    
    # Validate repository names
    for repo_name in repositories:
        if not isinstance(repo_name, str):
            raise TypeError(f"Repository name must be a string, got {type(repo_name).__name__}: {repo_name!r}")
        if not _is_valid_repo_name(repo_name):
            raise ValueError(f"Invalid repository name: {repo_name}")
    
    # Validate template if provided
    if template is not None:
        if not isinstance(template, str):
            raise TypeError(f"Template must be a string, got {type(template).__name__}: {template!r}")
        if not _is_valid_template_name(template):
            raise ValueError(f"Invalid template name: {template}")
    
    # Determine visibility
    visibility_flag = "--public" if visibility == "public" else "--private"
    
    # Build commands
    commands = []
    for repo_name in repositories:
        cmd = f"gh repo create {repo_name} {visibility_flag}"
        if template:
            cmd += f" --template {template}"
        commands.append(cmd)
    
    return commands


def _is_valid_repo_name(name: str) -> bool:
    """Check if repository name is valid.
    
    Valid names:
    - Not empty
    - No whitespace
    - Only contains A-Z, a-z, 0-9, ., _, -
    - Does not start with '-'
    """
    if not name:
        return False
    if name.startswith('-'):
        return False
    if re.search(r'\s', name):
        return False
    return bool(re.match(r'^[A-Za-z0-9._-]+$', name))


def _is_valid_template_name(name: str) -> bool:
    """Check if template name is valid.
    
    Valid template names:
    - Not empty
    - No whitespace
    - Only contains A-Z, a-z, 0-9, ., _, -, /
    - Optionally in format owner/name
    """
    if not name:
        return False
    if re.search(r'\s', name):
        return False
    # Allow owner/repo format or just repo name
    return bool(re.match(r'^[A-Za-z0-9._/-]+$', name))