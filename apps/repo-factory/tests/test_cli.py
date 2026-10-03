"""Tests for repo-factory CLI."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add the repo_factory package to path for testing
sys.path.insert(0, str(Path(__file__).parent.parent))

from repo_factory.__main__ import _execute_commands, main


@pytest.fixture
def sample_manifest():
    """Sample manifest data for testing."""
    return {
        "default_visibility": "private",
        "template": "",
        "repositories": [
            "test-repo-1",
            "test-repo-2"
        ]
    }


@pytest.fixture
def temp_manifest_file(sample_manifest):
    """Create a temporary manifest file for testing."""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        import json
        json.dump(sample_manifest, f)
        temp_path = f.name
    yield temp_path
    os.unlink(temp_path)


def test_main_dry_run_default(capsys, temp_manifest_file):
    """Test main function with default dry-run behavior."""
    test_args = ['repo_factory', '--manifest', temp_manifest_file]
    
    with patch.object(sys, 'argv', test_args), \
         patch('repo_factory.__main__.load_manifest') as mock_load:
        mock_load.return_value = {
            "repositories": ["test-repo-1", "test-repo-2"]
        }
        result = main()
            
    captured = capsys.readouterr()
    assert result == 0
    assert "gh repo create test-repo-1 --private" in captured.out
    assert "gh repo create test-repo-2 --private" in captured.out


def test_main_with_template_and_visibility(capsys, temp_manifest_file):
    """Test main function with template and visibility options."""
    test_args = [
        'repo_factory', 
        '--manifest', temp_manifest_file,
        '--template', 'acme/default',
        '--visibility', 'public'
    ]
    
    with patch.object(sys, 'argv', test_args), \
         patch('repo_factory.__main__.load_manifest') as mock_load:
        mock_load.return_value = {
            "repositories": ["test-repo"]
        }
        result = main()
            
    captured = capsys.readouterr()
    assert result == 0
    assert "gh repo create test-repo --public --template acme/default" in captured.out


def test_main_apply_mode_missing_gh(capsys, temp_manifest_file):
    """Test apply mode when gh command is missing."""
    test_args = ['repo_factory', '--manifest', temp_manifest_file, '--apply']
    
    with patch.object(sys, 'argv', test_args), \
         patch('repo_factory.__main__.load_manifest') as mock_load:
        mock_load.return_value = {
            "repositories": ["test-repo"]
        }
        with patch('shutil.which', return_value=None):  # gh not found
            result = main()
                
    assert result == 1
    captured = capsys.readouterr()
    assert "Error: 'gh' command not found" in captured.err


def test_execute_commands_success(capsys):
    """Test successful command execution."""
    commands = ["echo 'test command'"]
    
    with patch('shutil.which', return_value='/usr/local/bin/gh'), \
         patch('subprocess.run') as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        result = _execute_commands(commands)
            
    assert result == 0
    # Updated to expect shlex.split behavior
    mock_run.assert_called_once_with(['echo', 'test command'], check=True)


def test_execute_commands_failure(capsys):
    """Test command execution failure."""
    commands = ["failing-command"]
    
    with patch('shutil.which', return_value='/usr/local/bin/gh'), \
         patch('subprocess.run') as mock_run:
        mock_run.side_effect = subprocess.CalledProcessError(1, "failing-command")
        result = _execute_commands(commands)
            
    assert result == 1


def test_main_file_not_found(capsys):
    """Test main function with non-existent manifest file."""
    test_args = ['repo_factory', '--manifest', 'nonexistent.json']
    
    with patch.object(sys, 'argv', test_args):
        result = main()
        
    assert result == 1
    captured = capsys.readouterr()
    assert "Error: Manifest file 'nonexistent.json' not found" in captured.err


def test_main_invalid_repo_name(capsys, temp_manifest_file):
    """Test main function with invalid repository name."""
    test_args = ['repo_factory', '--manifest', temp_manifest_file]
    
    with patch.object(sys, 'argv', test_args), \
         patch('repo_factory.__main__.load_manifest') as mock_load:
        mock_load.return_value = {
            "repositories": ["invalid name with spaces"]
        }
        result = main()
            
    assert result == 1
    captured = capsys.readouterr()
    assert "Error: Invalid repository name:" in captured.err