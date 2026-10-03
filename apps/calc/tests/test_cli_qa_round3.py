"""Third QA round for the ``python -m calc`` CLI.

Round 1 reported four defects (huge integer operands silently becoming ``inf``, a
``ValueError`` while printing an over-long result, an uncaught ``OverflowError``
for an exact quotient with no float representation, and negative operands being
mistaken for option strings) and round 2 reported that ``main()`` raised
``SystemExit`` instead of returning the exit code for ``argparse``-level errors.
All five are fixed, so this file pins the fix for the last one in the way an
embedder sees it and probes the edges that are still open:

* ``main(argv)`` must be indistinguishable from the ``python -m calc`` process -
  same status, same stdout, same stderr - for success, every failure kind and
  ``--help``, and it must never raise ``SystemExit``;
* that promise has to survive repeated calls and an empty ``sys.argv``;
* ``_without_digit_limit`` mutates an interpreter-wide setting, so it must put it
  back on every path, including a usage error that follows a huge operand;
* a zero divisor is zero however long the operand is, and a huge integer mixed
  with a float operand must fail cleanly instead of raising;
* undecodable argv bytes must not crash the process;
* finite decimal operands outside the float range must never be answered with
  ``inf``/``nan`` (the two ``xfail`` tests at the bottom reproduce the defect that
  is still present: ``float()`` saturates ``1e400`` to ``inf``, so
  ``divide 1e309 1e308`` prints ``inf`` although the exact answer ``10.0`` is a
  perfectly representable float, and ``divide 1e-400 1e-400`` blames a zero
  divisor).
"""

from __future__ import annotations

import os
import subprocess
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pytest

from calc.cli import main

SOURCE_ROOT = Path(__file__).resolve().parents[1]

# CPython refuses to convert integers longer than this to/from strings by default.
DIGIT_LIMIT = sys.get_int_max_str_digits()

# Longer than the interpreter's conversion limit, i.e. only parseable/printable
# because the CLI lifts the limit.
HUGE = "9" * ((DIGIT_LIMIT or 100) + 100)


def run_calc(
    *args: str,
    env_extra: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run ``python -m calc`` in a subprocess and capture both streams."""
    env = dict(os.environ)
    if env_extra:
        env.update(env_extra)
    return subprocess.run(  # noqa: S603 - fixed argv, no shell, test-local input only
        [sys.executable, "-m", "calc", *args],
        cwd=SOURCE_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


# --------------------------------------------------- in-process / process parity


PARITY_CASES = [
    pytest.param(["add", "2", "3"], id="add"),
    pytest.param(["divide", "6", "3"], id="divide"),
    pytest.param(["add", "-1e5", "1"], id="negative-operand"),
    pytest.param(["divide", "1", "0"], id="divide-by-zero"),
    pytest.param(["multiply", "2", "3"], id="unknown-operation"),
    pytest.param(["add", "two", "3"], id="malformed-operand"),
    pytest.param(["add", "2"], id="missing-operand"),
    pytest.param(["add", "2", "3", "4"], id="extra-operand"),
    pytest.param([], id="no-arguments"),
    pytest.param(["--help"], id="long-help"),
    pytest.param(["-h"], id="short-help"),
]


@pytest.mark.parametrize("argv", PARITY_CASES)
def test_in_process_main_matches_the_process_contract(argv, capsys):
    """``main(argv)`` must be exactly the process: same status and same streams.

    This is the contract the reported bug broke: an embedder that calls ``main``
    has to see what a shell user sees, including the ``--help`` status.
    """
    result = run_calc(*argv)
    assert main(list(argv)) == result.returncode
    captured = capsys.readouterr()
    assert captured.out == result.stdout
    assert captured.err == result.stderr


@pytest.mark.parametrize(
    "argv",
    [
        pytest.param(["add", "2", "3"], id="success"),
        pytest.param(["divide", "1", "0"], id="divide-by-zero"),
        pytest.param(["multiply", "2", "3"], id="usage-error"),
        pytest.param(["--help"], id="long-help"),
        pytest.param(["-h"], id="short-help"),
        pytest.param([], id="no-arguments"),
    ],
)
def test_main_returns_a_status_and_never_raises_system_exit(argv):
    """``main`` promises the exit code; ``SystemExit`` must not escape it."""
    assert main(list(argv)) in (0, 1)


def test_main_can_be_called_repeatedly_without_leaking_state(capsys):
    """A failed or help-printing call must not disturb the next one."""
    assert main(["add", "2", "3"]) == 0
    assert capsys.readouterr() == ("5\n", "")
    assert main(["divide", "1", "0"]) == 1
    assert capsys.readouterr() == ("", "error: cannot divide by zero\n")
    assert main(["--help"]) == 0
    capsys.readouterr()  # discard the help text
    assert main(["add", "2", "3"]) == 0
    assert capsys.readouterr() == ("5\n", "")


def test_main_with_an_empty_sys_argv_is_a_usage_error(monkeypatch, capsys):
    """``argv=None`` reads ``sys.argv``; a host with no arguments must get status 1."""
    monkeypatch.setattr(sys, "argv", ["python -m calc"])
    assert main() == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "usage" in captured.err.lower()


# ------------------------------------------- the interpreter's int/str digit limit


@pytest.mark.skipif(DIGIT_LIMIT == 0, reason="interpreter allows unlimited int digits")
@pytest.mark.parametrize(
    "argv",
    [
        pytest.param(["add", HUGE], id="missing-second-operand"),
        pytest.param(["add", HUGE, "1", "2"], id="extra-operand"),
        pytest.param(["--help"], id="help-after-nothing"),
    ],
)
def test_the_digit_limit_is_restored_after_parser_level_exits(argv):
    """The lift is process-wide, so every return path must restore it.

    Not just the success path: a usage error raised after a huge operand was
    already parsed leaves the parser through ``_ParserExit``.
    """
    before = sys.get_int_max_str_digits()
    assert main(list(argv)) in (0, 1)
    assert sys.get_int_max_str_digits() == before


@pytest.mark.skipif(DIGIT_LIMIT == 0, reason="this interpreter already has no limit")
def test_an_interpreter_without_a_digit_limit_still_adds_exactly():
    """``PYTHONINTMAXSTRDIGITS=0`` skips the lift; exactness must not depend on it."""
    operand = "9" * 6000
    result = run_calc("add", operand, "1", env_extra={"PYTHONINTMAXSTRDIGITS": "0"})
    assert result.returncode == 0
    assert result.stdout.strip() == "1" + "0" * 6000
    assert result.stderr == ""


def test_a_zero_divisor_longer_than_the_digit_limit_is_still_zero():
    """A 5000-digit ``0`` is a zero operand, not an unparseable one."""
    zeros = "0" * (max(DIGIT_LIMIT, 100) + 1000)
    result = run_calc("divide", "1", zeros)
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr.strip() == "error: cannot divide by zero"
    # and as a numerator it is simply zero
    result = run_calc("divide", zeros, "5")
    assert result.returncode == 0
    assert result.stdout.strip() == "0.0"


def test_huge_integer_mixed_with_a_float_operand_fails_cleanly():
    """``10**400 + 1.5`` raises ``OverflowError``; the CLI must report it, not leak it."""
    huge = "1" + "0" * 400
    for argv in (("add", huge, "1.5"), ("add", "1.5", huge), ("divide", huge, "1.5")):
        result = run_calc(*argv)
        assert result.returncode == 1, argv
        assert result.stdout == ""
        assert result.stderr.startswith("error: ")
        assert "Traceback" not in result.stderr


# ------------------------------------------------------------ hostile operands


def test_undecodable_operand_bytes_are_a_clean_error():
    """A file name with invalid UTF-8 must not crash the CLI with a ``UnicodeError``."""
    result = subprocess.run(  # noqa: S603 - fixed argv, no shell, test-local input only
        [os.fsencode(sys.executable), b"-m", b"calc", b"add", b"\xff\xfe", b"3"],
        cwd=SOURCE_ROOT,
        capture_output=True,
        timeout=120,
    )
    assert result.returncode == 1
    assert result.stdout == b""
    assert b"invalid number" in result.stderr
    assert b"Traceback" not in result.stderr


def test_option_like_operands_are_never_silently_ignored():
    """``-x``/``--bogus`` are operands (and invalid numbers), never swallowed options."""
    for token in ("-x", "--bogus", "-1z"):
        result = run_calc("add", token, "3")
        assert result.returncode == 1, token
        assert result.stdout == ""
        assert "invalid number" in result.stderr


# --------------------------------------------------------------- still-broken


@pytest.mark.xfail(
    strict=True,
    reason=(
        "BUG: an operand that is outside the float range is silently saturated to "
        "inf, so finite operands can print inf/nan (divide 1e309 1e308 -> inf, "
        "divide 1e400 1e400 -> nan) instead of the exact answer or an error"
    ),
)
@pytest.mark.parametrize(
    ("argv", "exact"),
    [
        pytest.param(("divide", "1e309", "1e308"), 10.0, id="exact-answer-is-representable"),
        pytest.param(("divide", "1e400", "1e400"), 1.0, id="nan-instead-of-one"),
        pytest.param(("add", "1e400", "1e400"), None, id="inf-for-a-finite-sum"),
        pytest.param(("add", "9" * 309 + ".0", "1"), None, id="inf-for-a-decimal-literal"),
    ],
)
def test_out_of_range_decimal_operands_never_become_inf_or_nan(argv, exact):
    """Finite operands must produce the exact answer or a reported error - never inf/nan.

    ``exact`` is the mathematically exact result when it is a real float, ``None``
    when no float can represent it (then a clean error is the documented answer).
    """
    result = run_calc(*argv)
    if result.returncode != 0:
        assert result.returncode == 1
        assert result.stdout == ""
        assert result.stderr.strip() != ""
        return
    assert result.stderr == ""
    try:
        value = Decimal(result.stdout.strip())
    except InvalidOperation:
        pytest.fail(f"expected a number, got {result.stdout!r}")
    assert value.is_finite(), f"finite operands answered with {result.stdout.strip()!r}"
    if exact is not None:
        assert value == Decimal(exact), f"expected {exact}, got {result.stdout.strip()!r}"


@pytest.mark.xfail(
    strict=True,
    reason=(
        "BUG: an operand that underflows to zero is treated as an exact zero, so "
        "divide 1e-400 1e-400 blames a zero divisor instead of computing 1"
    ),
)
def test_an_underflowing_divisor_is_not_reported_as_a_zero_divisor():
    """``1e-400`` is a tiny positive number, not zero; the exact quotient is ``1.0``."""
    result = run_calc("divide", "1e-400", "1e-400")
    if result.returncode == 0:
        assert float(result.stdout) == 1.0
    else:
        assert "divide by zero" not in result.stderr, result.stderr
