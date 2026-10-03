"""CLI tests for ``python -m calc``.

The exit code and the split between stdout and stderr are part of the contract, so
the module is exercised in a real subprocess rather than by calling ``main`` only.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from calc.cli import _number, main

SOURCE_ROOT = Path(__file__).resolve().parents[1]
ERROR = "cannot divide by zero"

# CPython refuses to convert integers longer than this to/from strings by default.
DIGIT_LIMIT = sys.get_int_max_str_digits()


def run_calc(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - fixed argv, no shell, test-local input only
        [sys.executable, "-m", "calc", *args],
        cwd=SOURCE_ROOT,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_add_prints_the_sum():
    result = run_calc("add", "2", "3")
    assert result.returncode == 0
    assert result.stdout.strip() == "5"
    assert result.stderr == ""


def test_divide_prints_the_quotient():
    result = run_calc("divide", "6", "3")
    assert result.returncode == 0
    assert result.stdout.strip() == "2.0"
    assert result.stderr == ""


def test_float_operands_are_accepted():
    result = run_calc("add", "1.5", "2.25")
    assert result.returncode == 0
    assert result.stdout.strip() == "3.75"


@pytest.mark.parametrize("numerator", ["1", "0", "-2.5"])
def test_divide_by_zero_prints_an_error_and_exits_1(numerator):
    result = run_calc("divide", numerator, "0")
    assert result.returncode == 1
    assert result.stdout == ""
    assert ERROR in result.stderr


@pytest.mark.parametrize(
    "args",
    [("multiply", "2", "3"), ("add", "2"), ("add", "2", "3", "4"), ()],
)
def test_bad_command_line_is_a_usage_error(args):
    result = run_calc(*args)
    assert result.returncode == 1
    assert result.stdout == ""
    assert "usage" in result.stderr.lower()


@pytest.mark.parametrize("bad", ["two", "", "1..2", "0x10"])
def test_malformed_operands_are_rejected(bad):
    result = run_calc("add", bad, "3")
    assert result.returncode == 1
    assert result.stdout == ""
    assert "invalid number" in result.stderr


def test_unknown_operation_message_lists_the_supported_ones():
    result = run_calc("pow", "2", "3")
    assert result.returncode == 1
    assert "'add'" in result.stderr
    assert "'divide'" in result.stderr


def test_help_is_printed_on_stdout():
    result = run_calc("--help")
    assert result.returncode == 0
    assert "add" in result.stdout
    assert result.stderr == ""


def test_main_is_callable_in_process(capsys):
    assert main(["add", "2", "3"]) == 0
    assert capsys.readouterr().out.strip() == "5"


def test_main_returns_zero_for_help_instead_of_raising(capsys):
    """``--help`` is success: print the help on stdout and return 0."""
    assert main(["--help"]) == 0
    captured = capsys.readouterr()
    assert "add" in captured.out
    assert captured.err == ""


def test_main_returns_one_for_a_usage_error_instead_of_raising(capsys):
    """An ``argparse``-level error is reported like any other: return 1, stderr only."""
    assert main(["multiply", "2", "3"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "usage" in captured.err.lower()


def test_main_reports_division_by_zero_on_stderr(capsys):
    assert main(["divide", "1", "0"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert ERROR in captured.err


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        (("add", "-1e5", "1"), "-99999.0"),
        (("add", "-1.5e3", "0"), "-1500.0"),
        (("add", "-inf", "1"), "-inf"),
        (("divide", "-1e5", "2"), "-50000.0"),
    ],
)
def test_negative_operands_are_not_mistaken_for_options(args, expected):
    """``argparse`` only knows ``-123``/``-1.5``; other negatives are still operands."""
    result = run_calc(*args)
    assert result.returncode == 0
    assert result.stdout.strip() == expected
    assert result.stderr == ""


def test_the_double_dash_separator_still_works():
    result = run_calc("add", "--", "-1e5", "1")
    assert result.returncode == 0
    assert result.stdout.strip() == "-99999.0"


@pytest.mark.skipif(DIGIT_LIMIT == 0, reason="interpreter allows unlimited int digits")
def test_an_operand_longer_than_the_digit_limit_stays_an_exact_integer():
    operand = "9" * (DIGIT_LIMIT + 10)
    parsed = _number(operand)
    assert isinstance(parsed, int)
    assert parsed == 10 ** len(operand) - 1
    assert sys.get_int_max_str_digits() == DIGIT_LIMIT  # the limit is put back


@pytest.mark.skipif(DIGIT_LIMIT == 0, reason="interpreter allows unlimited int digits")
def test_main_prints_an_exact_result_longer_than_the_digit_limit(capsys):
    operand = "9" * DIGIT_LIMIT  # parses fine, the exact sum has one digit more
    assert main(["add", operand, "1"]) == 0
    captured = capsys.readouterr()
    assert captured.out.strip() == "1" + "0" * DIGIT_LIMIT
    assert captured.err == ""
    assert sys.get_int_max_str_digits() == DIGIT_LIMIT  # the limit is put back


def test_main_reports_a_quotient_that_no_float_can_represent(capsys):
    """``10**400 / 1`` has no float value: report it, do not raise a traceback."""
    assert main(["divide", "1" + "0" * 400, "1"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.startswith("error: ")
