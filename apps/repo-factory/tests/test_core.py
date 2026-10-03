import os

import pytest

from repo_factory.core import _is_valid_repo_name, build_commands, load_manifest


def test_load_manifest():
    """Test loading manifest from JSON file."""
    # Get the directory where this test file is located
    test_dir = os.path.dirname(os.path.abspath(__file__))
    manifest_path = os.path.join(test_dir, "..", "repos.json")
    
    manifest = load_manifest(manifest_path)
    assert manifest["default_visibility"] == "private"
    assert manifest["template"] == ""
    assert len(manifest["repositories"]) == 3
    assert "noname-chatbot-api" in manifest["repositories"]


def test_build_commands_default():
    """Test building commands with default settings."""
    manifest = {
        "repositories": [
            "noname-chatbot-api",
            "noname-chatbot-web",
            "noname-chatbot-admin"
        ]
    }
    commands = build_commands(manifest)
    expected = [
        "gh repo create noname-chatbot-api --private",
        "gh repo create noname-chatbot-web --private",
        "gh repo create noname-chatbot-admin --private"
    ]
    assert commands == expected


def test_build_commands_with_template():
    """Test building commands with template parameter."""
    manifest = {
        "repositories": ["test-repo"]
    }
    commands = build_commands(manifest, template="acme/default")
    assert commands == ["gh repo create test-repo --private --template acme/default"]


def test_build_commands_with_visibility():
    """Test building commands with visibility parameter."""
    manifest = {
        "repositories": ["test-repo"]
    }
    commands = build_commands(manifest, visibility="public")
    assert commands == ["gh repo create test-repo --public"]


def test_build_commands_with_both_params():
    """Test building commands with both template and visibility parameters."""
    manifest = {
        "repositories": ["test-repo"]
    }
    commands = build_commands(manifest, template="acme/default", visibility="public")
    assert commands == ["gh repo create test-repo --public --template acme/default"]


def test_invalid_repo_names():
    """Test that invalid repository names raise ValueError."""
    # Test empty name
    manifest = {"repositories": [""]}
    with pytest.raises(ValueError, match="Invalid repository name: "):
        build_commands(manifest)
    
    # Test name with space
    manifest = {"repositories": ["invalid name"]}
    with pytest.raises(ValueError, match="Invalid repository name: invalid name"):
        build_commands(manifest)
    
    # Test name with special character
    manifest = {"repositories": ["invalid@name"]}
    with pytest.raises(ValueError, match="Invalid repository name: invalid@name"):
        build_commands(manifest)


def test_is_valid_repo_name():
    """Test repository name validation helper."""
    # Valid names
    assert _is_valid_repo_name("valid-name")
    assert _is_valid_repo_name("valid_name")
    assert _is_valid_repo_name("Valid.Name123")
    assert _is_valid_repo_name("valid-name-123")
    
    # Invalid names
    assert not _is_valid_repo_name("")  # Empty
    assert not _is_valid_repo_name("invalid name")  # Space
    assert not _is_valid_repo_name("invalid@name")  # @ symbol
    assert not _is_valid_repo_name("invalid/name")  # / symbol
    assert not _is_valid_repo_name("invalid$name")  # $ symbol