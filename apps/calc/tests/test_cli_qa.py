"""QA pass over the ``python -m calc`` command-line interface (``calc/__main__.py``).

``tests/test_cli.py`` (shipped with the change) covers the happy path and the
documented exit codes. This file goes after the angles that are still open:

* the stdout/stderr split must hold for *every* error path, including the ones
  the interpreter itself can raise;
* operands are attacker-controlled text: they must be parsed, never evaluated,
  and must never turn into a silently rounded number;
* integer operands at and beyond CPython's limits (very large values, the
  4300-digit ``int(str)`` guard) must not be silently floated;
* importing the module must not run the CLI (``if __name__ == "__main__"`` guard).
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

CALC_ROOT = Path(__file__).resolve().parent.parent
USAGE = "usage: python -m calc <add|divide> <a> <b>"
DIVIDE_BY_ZERO = "cannot divide by zero"


def run_cli(*args: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    """Run ``python -m calc <args>`` from the app directory with it on ``PYTHONPATH``."""
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(
        part for part in (str(CALC_ROOT), env.get("PYTHONPATH", "")) if part
    )
    return subprocess.run(  # noqa: S603 - fixed argv, no shell, test-local code only
        [sys.executable, "-m", "calc", *args],
        cwd=CALC_ROOT if cwd is None else cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def assert_no_interpreter_noise(result: subprocess.CompletedProcess[str]) -> None:
    """An expected error must be a short message, not an unhandled exception."""
    assert "Traceback" not in result.stderr
    assert result.stderr.count("\n") <= 2
    for exc in ("OverflowError", "TypeError", "ZeroDivisionError", "MemoryError"):
        assert exc not in result.stderr


# --------------------------------------------------------------- happy paths


def test_integer_operands_stay_exact_for_large_values():
    """``add`` must not route big integer operands through ``float``."""
    operand = str(10**100)
    result = run_cli("add", operand, operand)
    assert result.returncode == 0
    assert result.stdout == f"{2 * 10**100}\n"
    assert result.stderr == ""


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        pytest.param(("add", "-2", "3"), "1\n", id="negative-first"),
        pytest.param(("add", "2", "-3"), "-1\n", id="negative-second"),
        pytest.param(("add", "-2", "-3"), "-5\n", id="both-negative"),
        pytest.param(("divide", "-1", "2"), "-0.5\n", id="negative-numerator"),
        pytest.param(("divide", "-1", "-2"), "0.5\n", id="negative-both"),
        pytest.param(("divide", "7", "2"), "3.5\n", id="non-terminating-int-quotient"),
        pytest.param(("add", "+2", "-3.5"), "-1.5\n", id="signed-float"),
    ],
)
def test_signed_operands_are_values_not_options(args, expected):
    """A leading ``-`` must reach the parser instead of being treated as a flag."""
    result = run_cli(*args)
    assert result.returncode == 0
    assert result.stdout == expected
    assert result.stderr == ""


# ------------------------------------------------------------ error handling


@pytest.mark.parametrize(
    "divisor",
    [
        pytest.param("0", id="int-zero"),
        pytest.param("-0", id="negative-int-zero"),
        pytest.param("0.0", id="float-zero"),
        pytest.param("-0.0", id="negative-float-zero"),
        pytest.param("0e0", id="float-zero-exponent"),
        pytest.param("1e-400", id="denormal-underflows-to-zero"),
    ],
)
def test_zero_divisor_spellings_all_exit_one(divisor):
    result = run_cli("divide", "1", divisor)
    assert result.returncode == 1
    assert result.stdout == ""
    assert DIVIDE_BY_ZERO in result.stderr
    assert_no_interpreter_noise(result)


@pytest.mark.parametrize(
    "args",
    [
        pytest.param((), id="no-command"),
        pytest.param(("add",), id="missing-both-operands"),
        pytest.param(("divide", "1", "0", "extra"), id="too-many-arguments"),
        pytest.param(("--help",), id="help-flag-not-supported"),
        pytest.param(("Add", "2", "3"), id="wrong-case-command"),
        pytest.param(("sum", "2", "3"), id="alias-not-supported"),
        pytest.param(("add", "", "3"), id="empty-operand"),
        pytest.param(("add", "2", ""), id="trailing-empty-operand"),
        pytest.param(("divide", "1.2.3", "2"), id="malformed-float"),
        pytest.param(("divide", "0x10", "2"), id="hex-literal-not-decimal"),
        pytest.param(("add", "3 4", "1"), id="two-numbers-in-one-argument"),
    ],
)
def test_unusable_invocation_exits_two_with_usage_only_on_stderr(args):
    result = run_cli(*args)
    assert result.returncode == 2
    assert result.stdout == ""
    assert USAGE in result.stderr
    assert_no_interpreter_noise(result)


def test_operands_are_parsed_and_never_evaluated(tmp_path):
    """argv is untrusted text: nothing in it may be shell-expanded or executed."""
    marker = tmp_path / "pwned.txt"
    payloads = [
        f"__import__('os').system('touch {marker}')",
        f"$(touch {marker})",
        f"`touch {marker}`",
        f"1; touch {marker}",
        f'eval(\'open("{marker}", "w")\')',
        "1+1",
        "[1][0]",
        "%s",
    ]
    for payload in payloads:
        result = run_cli("add", payload, "1")
        assert result.returncode == 2, (payload, result)
        assert result.stdout == "", payload
        assert USAGE in result.stderr, payload
        assert_no_interpreter_noise(result)
    assert not marker.exists()


def test_importing_the_module_does_not_run_the_cli():
    """``import calc.__main__`` must be side-effect free (guarded entry point)."""
    env = dict(os.environ)
    env["PYTHONPATH"] = str(CALC_ROOT)
    result = subprocess.run(  # noqa: S603 - fixed argv, no shell, test-local code only
        [sys.executable, "-c", "import calc.__main__ as m; print(callable(m.main))"],
        cwd=CALC_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == "True\n"
    assert result.stderr == ""


# ------------------------------------------------------------------- bugs


@pytest.mark.xfail(
    strict=True,
    reason="BUG: integer division overflowing float escapes as an uncaught OverflowError traceback",
)
def test_quotient_too_large_for_float_is_reported_cleanly():
    """``divide`` with an int quotient beyond ``float`` range must not dump a traceback."""
    numerator = "1" + "0" * 309  # 10**309: repr(10**309 / 1) overflows a float
    result = run_cli("divide", numerator, "1")
    assert result.returncode in (1, 2), result
    assert result.stdout == ""
    assert DIVIDE_BY_ZERO not in result.stderr
    assert_no_interpreter_noise(result)


@pytest.mark.xfail(
    strict=True,
    reason="BUG: operands past the 4300-digit int() limit silently fall back to float",
)
def test_operand_past_the_int_string_limit_is_not_silently_floated():
    """``int(str)`` refuses >4300 digits; the fallback must not invent ``inf``/``1.0``."""
    zeros = "0" * 5000
    result = run_cli("add", zeros, "1")
    assert result.returncode == 0, result
    assert result.stdout == "1\n", result.stdout

    ones = "1" * 4301
    result = run_cli("add", ones, "0")
    assert result.stdout == f"{ones}\n", result.stdout[:40]
