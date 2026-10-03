"""Second QA round for the ``python -m calc`` CLI.

The first QA round reported four defects and they are fixed now:

* huge integer operands silently becoming ``inf`` (``add 99...9 1``);
* an uncaught ``ValueError`` when printing a result longer than the interpreter's
  ``int``/``str`` digit limit;
* an uncaught ``OverflowError`` for exact quotients that no float can represent;
* negative operands such as ``-1e5`` / ``-.5`` being rejected as option strings.

This file re-checks those fixes at their boundaries and probes the machinery they
added (``_without_digit_limit`` mutating a process-global setting, ``_Parser``
overriding option detection) for regressions.  Nothing here is a duplicate of
``tests/test_cli.py`` or ``tests/test_cli_qa.py``.

The in-process API bug reported at the bottom (``main`` raising ``SystemExit``
for ``argparse``-level errors) is fixed too, so that test now runs as an ordinary
regression test.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import pytest

from calc.cli import _number, main

SOURCE_ROOT = Path(__file__).resolve().parents[1]

# CPython refuses to convert integers longer than this to/from strings by default.
DIGIT_LIMIT = sys.get_int_max_str_digits()

# Longer than the interpreter's conversion limit, i.e. only parseable/printable
# because the CLI lifts the limit; the literal below is short when the limit is off.
HUGE = "9" * ((DIGIT_LIMIT or 100) + 100)


def run_calc(
    *args: str,
    env_extra: dict[str, str] | None = None,
    cwd: Path = SOURCE_ROOT,
) -> subprocess.CompletedProcess[str]:
    """Run ``python -m calc`` in a subprocess and capture both streams."""
    env = dict(os.environ)
    if env_extra:
        env.update(env_extra)
    return subprocess.run(  # noqa: S603 - fixed argv, no shell, test-local input only
        [sys.executable, "-m", "calc", *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


# ------------------------------------------------- the four fixed bugs, re-checked


@pytest.mark.skipif(DIGIT_LIMIT == 0, reason="interpreter allows unlimited int digits")
def test_huge_negative_operand_is_added_exactly():
    """A 4300-digit negative operand is exact, not ``-inf`` and not rounded."""
    result = run_calc("add", "-" + "9" * DIGIT_LIMIT, "1")
    assert result.returncode == 0
    assert result.stdout.strip() == "-" + "9" * (DIGIT_LIMIT - 1) + "8"
    assert result.stderr == ""


@pytest.mark.skipif(DIGIT_LIMIT == 0, reason="interpreter allows unlimited int digits")
def test_huge_operand_and_result_work_with_a_lowered_interpreter_limit():
    """The lift is needed for parsing *and* for printing a result above the limit."""
    result = run_calc(
        "add",
        "9" * (DIGIT_LIMIT + 1000),
        "1",
        env_extra={"PYTHONINTMAXSTRDIGITS": str(DIGIT_LIMIT)},
    )
    assert result.returncode == 0
    assert result.stdout.strip() == "1" + "0" * (DIGIT_LIMIT + 1000)
    assert result.stderr == ""


def test_huge_operand_that_is_not_a_number_is_a_clean_error():
    """An over-long *malformed* operand must not fall through to ``float`` either."""
    result = run_calc("add", "9" * 5000 + "x", "1")
    assert result.returncode == 1
    assert result.stdout == ""
    assert "invalid number" in result.stderr
    assert "Traceback" not in result.stderr


def test_huge_exact_quotient_that_fits_a_float_is_still_computed():
    """Guard against the ``OverflowError`` fix swallowing valid huge divisions."""
    result = run_calc("divide", "1" + "0" * 400, "1" + "0" * 399)
    assert result.returncode == 0
    assert result.stdout.strip() == "10.0"
    assert result.stderr == ""


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        pytest.param(("add", "-.5", "1"), "0.5", id="leading-dot"),
        pytest.param(("add", "-.5e1", "0"), "-5.0", id="leading-dot-exponent"),
        pytest.param(("add", "-1e-5", "0"), "-1e-05", id="negative-exponent"),
        pytest.param(("add", "-1_0", "0"), "-10", id="underscore"),
        pytest.param(("divide", "-1e5", "2"), "-50000.0", id="negative-exponent-divide"),
    ],
)
def test_negative_spellings_argparse_would_have_rejected(args, expected):
    """``argparse`` only knows ``-123``/``-1.5``; every other negative is an operand."""
    result = run_calc(*args)
    assert result.returncode == 0
    assert result.stdout.strip() == expected
    assert result.stderr == ""


@pytest.mark.parametrize("zero", ["0", "-0", "0.0"])
def test_zero_divided_by_zero_is_a_clean_exit_1(zero):
    result = run_calc("divide", zero, zero)
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr.strip() == "error: cannot divide by zero"


# ------------------------------------- no regression in the digit-limit lifting


@pytest.mark.skipif(DIGIT_LIMIT == 0, reason="interpreter allows unlimited int digits")
@pytest.mark.parametrize(
    "argv",
    [
        pytest.param(["add", HUGE, "1"], id="success-with-huge-result"),
        pytest.param(["add", HUGE, "oops"], id="malformed-second-operand"),
        pytest.param(["multiply", "2", "3"], id="unknown-operation"),
        pytest.param(["divide", "1" + "0" * 400, "1"], id="float-overflow"),
    ],
)
def test_in_process_runs_never_leak_the_raised_digit_limit(argv):
    """``main`` changes a process-global setting; it must be put back on every path."""
    before = sys.get_int_max_str_digits()
    try:
        assert main(argv) in (0, 1)
    except SystemExit as exc:  # argparse-level failure
        assert exc.code == 1
    assert sys.get_int_max_str_digits() == before


@pytest.mark.skipif(DIGIT_LIMIT == 0, reason="interpreter allows unlimited int digits")
def test_child_interpreter_keeps_its_configured_digit_limit_after_the_call():
    script = (
        "import sys\n"
        "from calc.cli import main\n"
        "main(['add', '9' * 700, '1'])\n"
        "print(sys.get_int_max_str_digits())\n"
    )
    result = subprocess.run(  # noqa: S603 - fixed argv, no shell, test-local input only
        [sys.executable, "-c", script],
        cwd=SOURCE_ROOT,
        env={**os.environ, "PYTHONINTMAXSTRDIGITS": "640"},
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0
    lines = result.stdout.splitlines()
    assert lines[0] == "1" + "0" * 700  # the exact sum, above the configured limit
    assert lines[-1] == "640"  # the configured limit is restored afterwards


# ------------------------------------------------------- operand parsing contract


def test_number_returns_int_for_integral_text_and_float_otherwise():
    integral = _number("2")
    assert isinstance(integral, int) and integral == 2
    fractional = _number("2.0")
    assert isinstance(fractional, float) and fractional == 2.0


@pytest.mark.parametrize("bad", ["", "abc", "0x10", "1..2", "9" * 5000 + "x"])
def test_number_rejects_malformed_text_with_an_argparse_error(bad):
    """``argparse`` needs ``ArgumentTypeError`` (not ``ValueError``/``SystemExit``)."""
    with pytest.raises(argparse.ArgumentTypeError) as excinfo:
        _number(bad)
    assert str(excinfo.value).startswith("invalid number:")


@pytest.mark.skipif(DIGIT_LIMIT == 0, reason="interpreter allows unlimited int digits")
def test_a_rejected_operand_still_restores_the_digit_limit():
    before = sys.get_int_max_str_digits()
    with pytest.raises(argparse.ArgumentTypeError):
        _number("9" * (before + 100) + "x")
    assert sys.get_int_max_str_digits() == before


# ------------------------------- no regression in the option-detection override


@pytest.mark.parametrize("token", ["--bogus", "--verbose", "-x", "-1e5"])
def test_option_like_tokens_are_clean_errors_not_argparse_exit_code_2(token):
    """``_Parser`` treats unknown ``-``-prefixed tokens as operands: still exit 1."""
    result = run_calc(token, "2", "3")
    assert result.returncode == 1
    assert result.stdout == ""
    assert "usage" in result.stderr.lower()
    assert "Traceback" not in result.stderr


# ------------------------------------------------------------ in-process API bug


@pytest.mark.parametrize(
    "argv",
    [
        pytest.param(["multiply", "2", "3"], id="unknown-operation"),
        pytest.param(["add", "2"], id="missing-operand"),
        pytest.param(["add", "two", "3"], id="malformed-operand"),
        pytest.param(["add", "2", "3", "4"], id="extra-operand"),
        pytest.param([], id="no-arguments"),
    ],
)
def test_main_returns_the_exit_code_for_usage_errors(argv):
    """``main`` is documented as returning the exit code for *any* error."""
    assert main(argv) == 1
