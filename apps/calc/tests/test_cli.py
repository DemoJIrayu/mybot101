"""Subprocess tests for the ``python -m calc`` command-line interface."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

CALC_ROOT = Path(__file__).resolve().parent.parent


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    """Run ``python -m calc <args>`` from the app directory with it on ``PYTHONPATH``."""
    env = dict(os.environ)
    env["PYTHONPATH"] = str(CALC_ROOT)
    return subprocess.run(  # noqa: S603 - fixed argv, no shell, test-local code only
        [sys.executable, "-m", "calc", *args],
        cwd=CALC_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_add_integers_prints_exactly_five():
    result = run_cli("add", "2", "3")
    assert result.returncode == 0
    assert result.stdout == "5\n"
    assert result.stderr == ""


def test_divide_by_zero_exits_one_with_the_documented_message():
    result = run_cli("divide", "1", "0")
    assert result.returncode == 1
    assert result.stdout == ""
    assert "cannot divide by zero" in result.stderr


def test_divide_prints_a_float_result():
    result = run_cli("divide", "1", "2")
    assert result.returncode == 0
    assert result.stdout == "0.5\n"
    assert result.stderr == ""


def test_float_operands_are_accepted():
    result = run_cli("add", "1.5", "2.25")
    assert result.returncode == 0
    assert result.stdout == "3.75\n"


@pytest.mark.parametrize(
    "args",
    [
        pytest.param((), id="no-arguments"),
        pytest.param(("add",), id="one-argument"),
        pytest.param(("add", "1"), id="two-arguments"),
        pytest.param(("add", "1", "2", "3"), id="four-arguments"),
        pytest.param(("multiply", "2", "3"), id="unknown-command"),
        pytest.param(("add", "two", "3"), id="non-numeric-first"),
        pytest.param(("divide", "1", "x"), id="non-numeric-second"),
    ],
)
def test_bad_invocation_exits_two_with_usage_on_stderr(args):
    result = run_cli(*args)
    assert result.returncode == 2
    assert result.stdout == ""
    assert "usage: python -m calc <add|divide> <a> <b>" in result.stderr
