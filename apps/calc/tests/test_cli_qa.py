"""QA pass for the ``python -m calc`` CLI.

``tests/test_cli.py`` (shipped with the change) covers the happy path and the
documented failures. This file pushes on the edges a caller can actually reach
through ``argv``:

* the exact stdout/stderr split and exit code for *every* failure kind (no
  ``argparse`` exit code 2, no traceback leaking to the user);
* operand parsing: integral operands stay integral, negatives and float
  exponents work, malformed/empty operands are rejected;
* very large operands (beyond CPython's 4300-digit ``int``/``str`` conversion
  limit) must not silently degrade to a float or crash;
* operands are data, never code, and running the CLI has no side effects;
* the in-process ``main()`` API mirrors the subprocess contract.

The four tests at the bottom were added as ``xfail`` bug reports in the first QA
pass; the bugs are fixed, so they now run as ordinary regression tests.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from calc.cli import main

SOURCE_ROOT = Path(__file__).resolve().parents[1]

# CPython refuses to convert integers longer than this to/from strings by default.
DIGIT_LIMIT = sys.get_int_max_str_digits()

CLEAN_ERROR = "cannot divide by zero"


def run_calc(
    *args: str,
    cwd: Path = SOURCE_ROOT,
    pythonpath: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run ``python -m calc`` in a subprocess and capture both streams."""
    env = dict(os.environ)
    if pythonpath is not None:
        env["PYTHONPATH"] = str(pythonpath) + os.pathsep + env.get("PYTHONPATH", "")
    return subprocess.run(  # noqa: S603 - fixed argv, no shell, test-local input only
        [sys.executable, "-m", "calc", *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


# ------------------------------------------------------------ failure contract

FAILURES = [
    pytest.param(("divide", "1", "0"), id="divide-by-zero"),
    pytest.param(("multiply", "2", "3"), id="unknown-operation"),
    pytest.param(("add", "two", "3"), id="malformed-first-operand"),
    pytest.param(("add", "2", "three"), id="malformed-second-operand"),
    pytest.param(("add", "2"), id="missing-second-operand"),
    pytest.param(("add",), id="missing-both-operands"),
    pytest.param(("add", "2", "3", "4"), id="extra-operand"),
    pytest.param((), id="no-arguments-at-all"),
]


@pytest.mark.parametrize("args", FAILURES)
def test_every_failure_is_a_clean_exit_1_on_stderr_only(args):
    """Errors are messages on stderr with status 1 - never stdout, never a traceback."""
    result = run_calc(*args)
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr.strip() != ""
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize("zero", ["0", "0.0", "-0", "-0.0", "0e0", "0.000"])
def test_divide_by_zero_is_reported_for_every_spelling_of_zero(zero):
    result = run_calc("divide", "1", zero)
    assert result.returncode == 1
    assert result.stdout == ""
    assert CLEAN_ERROR in result.stderr
    assert "Traceback" not in result.stderr


def test_divide_by_zero_error_goes_only_to_stderr():
    result = run_calc("divide", "7", "0")
    assert result.stdout == ""
    assert result.stderr.strip() == f"error: {CLEAN_ERROR}"


@pytest.mark.parametrize("operation", ["Add", "ADD", "Divide", "DIVIDE"])
def test_operations_are_case_sensitive(operation):
    result = run_calc(operation, "6", "3")
    assert result.returncode == 1
    assert result.stdout == ""
    assert "'add'" in result.stderr  # the usage error still names the valid choices


@pytest.mark.parametrize("args", [("add", "", "3"), ("add", "3", "")])
def test_empty_operands_are_rejected(args):
    result = run_calc(*args)
    assert result.returncode == 1
    assert result.stdout == ""
    assert "invalid number" in result.stderr


# ---------------------------------------------------------------- operands


def test_integer_operands_are_printed_once_and_stay_integral():
    result = run_calc("add", "2", "3")
    assert result.returncode == 0
    assert result.stdout == "5\n"  # not "5.0", no extra output
    assert result.stderr == ""


def test_large_integers_are_added_exactly():
    """A 401-digit operand is still a Python int: no float rounding on the way."""
    operand = "1" + "0" * 400
    result = run_calc("add", operand, operand)
    assert result.returncode == 0
    assert result.stdout.strip() == "2" + "0" * 400


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        (("add", "-2.5", "0.5"), "-2.0"),
        (("add", "-3", "-4"), "-7"),
        (("divide", "-7", "2"), "-3.5"),
        (("add", "1.5e3", "0"), "1500.0"),
        (("divide", "1", "4"), "0.25"),
    ],
)
def test_supported_number_spellings(args, expected):
    result = run_calc(*args)
    assert result.returncode == 0
    assert result.stdout.strip() == expected


def test_readme_cli_examples_are_accurate():
    """The README's command-line transcript must match the real behaviour."""
    assert run_calc("add", "2", "3").stdout.strip() == "5"
    assert run_calc("divide", "6", "3").stdout.strip() == "2.0"
    divide_by_zero = run_calc("divide", "1", "0")
    assert divide_by_zero.returncode == 1
    assert divide_by_zero.stderr.strip() != ""


# ---------------------------------------------------------------- security


def test_operands_are_data_and_never_executed(tmp_path):
    """Shell/SQL-ish payloads must be rejected as numbers, with no side effect."""
    payloads = [
        "1; touch pwned",
        "$(touch pwned)",
        "`touch pwned`",
        "__import__('os').system('touch pwned')",
        "1 && touch pwned",
        "' OR 1=1 --",
    ]
    for payload in payloads:
        result = run_calc("add", payload, "1", cwd=tmp_path, pythonpath=SOURCE_ROOT)
        assert result.returncode == 1, payload
        assert result.stdout == ""
        assert "invalid number" in result.stderr
    assert list(tmp_path.iterdir()) == []  # nothing was created or written


def test_module_entry_point_works_from_an_unrelated_directory(tmp_path):
    """``python -m calc`` must work like an installed console entry point."""
    result = run_calc("add", "2", "3", cwd=tmp_path, pythonpath=SOURCE_ROOT)
    assert result.returncode == 0
    assert result.stdout.strip() == "5"
    assert list(tmp_path.iterdir()) == []


# --------------------------------------------------------- in-process API


def test_main_reads_sys_argv_when_argv_is_not_passed(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["python -m calc", "add", "40", "2"])
    assert main() == 0
    captured = capsys.readouterr()
    assert captured.out == "42\n"
    assert captured.err == ""


def test_main_returns_zero_and_writes_only_stdout_for_a_float_result(capsys):
    assert main(["divide", "6", "3"]) == 0
    captured = capsys.readouterr()
    assert captured.out == "2.0\n"
    assert captured.err == ""


# ------------------------------------------------------- bug regressions
# Each test below was written as a failing bug report. The defects are fixed, so
# they are ordinary regression tests now.

@pytest.mark.skipif(DIGIT_LIMIT == 0, reason="interpreter allows unlimited int digits")
def test_very_long_integer_operand_is_not_silently_downgraded_to_inf():
    digits = DIGIT_LIMIT + 1000
    operand = "9" * digits
    result = run_calc("add", operand, "1")
    # 10**digits, i.e. the mathematically exact answer (not "inf").
    assert result.stdout.strip() == "1" + "0" * digits
    assert result.returncode == 0


@pytest.mark.skipif(DIGIT_LIMIT == 0, reason="interpreter allows unlimited int digits")
def test_exact_sum_longer_than_the_digit_limit_is_printed_without_a_traceback():
    operand = "9" * DIGIT_LIMIT  # parses fine, but the sum has one digit too many
    result = run_calc("add", operand, "1")
    assert result.returncode == 0
    assert result.stdout.strip() == "1" + "0" * DIGIT_LIMIT
    assert "Traceback" not in result.stderr


def test_huge_integer_quotient_reports_a_clean_error():
    numerator = "1" + "0" * 400  # exact int, but a/1 has no float representation
    result = run_calc("divide", numerator, "1")
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr.strip() != ""
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize(("args", "expected"), [
    (("add", "-1e5", "1"), "-99999.0"),
    (("add", "-1.5e3", "0"), "-1500.0"),
    (("add", "-inf", "1"), "-inf"),
])
def test_negative_operands_outside_the_argparse_number_regex(args, expected):
    result = run_calc(*args)
    assert result.returncode == 0
    assert result.stdout.strip() == expected
