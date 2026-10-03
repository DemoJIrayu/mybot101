"""Third QA pass for PR #3 (``apps/calc``): differential + runtime contract tests.

What was already covered before this file:

* ``test_calc.py`` (shipped with the change) – the happy path.
* ``test_calc_edge_cases.py`` – zero divisors of every builtin numeric type,
  non-numeric operands, IEEE-754 specials, public API.
* ``test_calc_qa_hardening.py`` – zero-like subclasses/enums, decimal contexts,
  huge values, packaging metadata, purity.

This file attacks the angles those did not:

* **differential contract** – for every numeric pair the result *and* its type, or
  the type of the exception, must be exactly what Python's own ``a + b`` / ``a / b``
  produce, with ``b == 0`` as the single documented deviation (``ValueError``);
* the zero check must happen **before** any operand arithmetic runs (observable via
  a sentinel operand and via the decimal context's ``DivisionByZero`` flag);
* the error contract – exactly ``ValueError``, never a ``ZeroDivisionError`` and
  never implicitly chained from one;
* the guard is real code, not an ``assert`` (it must survive ``python -O`` /
  ``-OO``), and importing/using the package emits no warnings under ``-W error``;
* the **shipped artifact** – the built wheel contains the runtime package only,
  declares the Python floor, has no runtime dependencies and installs into a clean
  virtualenv where the README example works.
"""

from __future__ import annotations

import decimal
import itertools
import math
import os
import random
import shutil
import subprocess
import sys
import textwrap
import zipfile
from decimal import Decimal
from fractions import Fraction
from pathlib import Path

import pytest

import calc
from calc import add, divide
from calc.core import add as core_add
from calc.core import divide as core_divide

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ZERO_MESSAGE = "cannot divide by zero"

#: Values chosen to cover every numeric family the annotations (``float``) leave open.
NUMERIC_GRID: list[object] = [
    0,
    1,
    -1,
    2,
    3,
    7,
    -7,
    10**20,
    -(10**20),
    10**308,
    True,
    False,
    0.0,
    -0.0,
    1.5,
    -2.5,
    1e-323,
    2.0**1023,
    float("inf"),
    float("-inf"),
    float("nan"),
    Decimal(0),
    Decimal("-0"),
    Decimal("1.5"),
    Decimal("NaN"),
    Decimal("Infinity"),
    Fraction(0),
    Fraction(7, 2),
    Fraction(-1, 3),
    0j,
    1j,
    complex(-0.0, 0.0),
]


def _is_nan(value: object) -> bool:
    if isinstance(value, float):
        return math.isnan(value)
    if isinstance(value, Decimal):
        return value.is_nan()
    return False


def _same_value(left: object, right: object) -> bool:
    """Compare like Python would, but treat NaN == NaN as equal for test purposes."""
    if type(left) is not type(right):
        return False
    try:
        unequal = bool(left != right)
    except Exception:  # noqa: BLE001 - exotic operands are part of the grid
        return False
    if unequal:
        return _is_nan(left) and _is_nan(right)
    return True


def _outcome(call) -> tuple[str, object]:  # noqa: ANN001 - tiny local helper
    """``("value", result)`` or ``("error", exception type)`` for one operator call."""
    try:
        return ("value", call())
    except Exception as exc:  # noqa: BLE001 - the exception type is the data
        return ("error", type(exc))


def _same_outcome(left: tuple[str, object], right: tuple[str, object]) -> bool:
    if left[0] != right[0]:
        return False
    return left[1] is right[1] if left[0] == "error" else _same_value(left[1], right[1])


def _run_python(extra_args: list[str], code: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(
        [str(PROJECT_ROOT), env.get("PYTHONPATH", "")]
    ).rstrip(os.pathsep)
    return subprocess.run(  # noqa: S603 - fixed argv, no shell
        [sys.executable, *extra_args, "-c", textwrap.dedent(code)],
        cwd=str(PROJECT_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


# --------------------------------------------------------------------------- #
# Differential contract: calc must not invent its own arithmetic
# --------------------------------------------------------------------------- #
def test_add_matches_the_plus_operator_across_the_numeric_grid() -> None:
    for a, b in itertools.product(NUMERIC_GRID, repeat=2):
        expected = _outcome(lambda a=a, b=b: a + b)  # type: ignore[operator]
        got = _outcome(lambda a=a, b=b: add(a, b))  # type: ignore[arg-type]
        assert _same_outcome(got, expected), f"add({a!r}, {b!r}) -> {got!r}, want {expected!r}"


def test_divide_matches_the_slash_operator_except_for_zero_divisors() -> None:
    for a, b in itertools.product(NUMERIC_GRID, repeat=2):
        expected = (
            ("error", ValueError) if b == 0 else _outcome(lambda a=a, b=b: a / b)  # type: ignore[operator]
        )
        got = _outcome(lambda a=a, b=b: divide(a, b))  # type: ignore[arg-type]
        assert _same_outcome(got, expected), f"divide({a!r}, {b!r}) -> {got!r}, want {expected!r}"


def test_non_zero_divisors_never_trigger_the_divide_by_zero_error() -> None:
    """The guard must only fire for ``b == 0``; every other pair keeps Python's semantics."""
    checked = 0
    for a, b in itertools.product(NUMERIC_GRID, repeat=2):
        if b == 0:
            continue
        expected = _outcome(lambda a=a, b=b: a / b)  # type: ignore[operator]
        try:
            result = divide(a, b)  # type: ignore[arg-type]
        except Exception as exc:  # noqa: BLE001
            assert str(exc) != ZERO_MESSAGE, f"guard misfired for non-zero divisor {b!r}"
            got: tuple[str, object] = ("error", type(exc))
        else:
            got = ("value", result)
        assert _same_outcome(got, expected), f"divide({a!r}, {b!r}) -> {got!r}, want {expected!r}"
        checked += 1
    assert checked == len(NUMERIC_GRID) ** 2 - len(NUMERIC_GRID), "sweep must cover the grid"


def test_randomised_pairs_agree_with_the_reference_operators() -> None:
    """Seeded fuzz over ints/floats/Decimals/Fractions: no drift from ``+`` and ``/``."""
    rng = random.Random(20240517)
    checked = 0

    for _ in range(400):
        a = rng.choice([rng.randint(-(2**160), 2**160), rng.uniform(-1e12, 1e12), Decimal(0)])
        b = rng.choice(
            [
                rng.randint(-(2**160), 2**160),
                math.ldexp(rng.random(), rng.randint(-1074, 1023)),
                Decimal(0),
                Fraction(rng.randint(-1000, 1000), rng.randint(1, 1000)),
            ]
        )
        if isinstance(a, int) and abs(a) >= 2**1024 or isinstance(b, int) and abs(b) >= 2**1024:
            continue  # huge int / int division may legitimately overflow the float result

        assert _same_outcome(
            _outcome(lambda a=a, b=b: add(a, b)),  # type: ignore[arg-type]
            _outcome(lambda a=a, b=b: a + b),  # type: ignore[operator]
        ), f"add({a!r}, {b!r}) drifted from +"

        if b == 0:
            with pytest.raises(ValueError, match=ZERO_MESSAGE):
                divide(a, b)
        else:
            assert _same_outcome(
                _outcome(lambda a=a, b=b: divide(a, b)),  # type: ignore[arg-type]
                _outcome(lambda a=a, b=b: a / b),  # type: ignore[operator]
            ), f"divide({a!r}, {b!r}) drifted from /"
        checked += 1

    assert checked > 300, "the fuzz loop must actually exercise pairs"


# --------------------------------------------------------------------------- #
# The zero check must run before any operand arithmetic
# --------------------------------------------------------------------------- #
class _ArithmeticForbidden:
    """Numerator that blows up if ``calc`` ever tries to divide it by zero."""

    def __truediv__(self, other: object) -> object:
        raise AssertionError("divide() ran operand arithmetic with a zero divisor")

    def __rtruediv__(self, other: object) -> object:
        raise AssertionError("divide() ran operand arithmetic with a zero divisor")


@pytest.mark.parametrize("divisor", [0, 0.0, -0.0, False, Decimal(0), Fraction(0), 0j])
def test_zero_divisor_short_circuits_before_operand_arithmetic(divisor: object) -> None:
    with pytest.raises(ValueError, match=ZERO_MESSAGE):
        divide(_ArithmeticForbidden(), divisor)  # type: ignore[arg-type]


def test_zero_divisor_does_not_set_the_decimal_division_by_zero_flag() -> None:
    """No arithmetic is attempted, so Decimal's global-ish context stays untouched."""
    with decimal.localcontext() as ctx:
        ctx.clear_flags()
        with pytest.raises(ValueError, match=ZERO_MESSAGE):
            divide(Decimal(1), Decimal(0))
        assert ctx.flags[decimal.DivisionByZero] is False

        with pytest.raises(ZeroDivisionError):
            Decimal(1) / Decimal(0)  # the flag is observable once the op really runs
        assert ctx.flags[decimal.DivisionByZero] is True


# --------------------------------------------------------------------------- #
# Error contract
# --------------------------------------------------------------------------- #
def test_error_is_a_plain_value_error_and_not_a_zero_division_error() -> None:
    with pytest.raises(ValueError) as info:
        divide(Decimal(1), Decimal(0))

    exc = info.value
    assert type(exc) is ValueError, f"expected exactly ValueError, got {type(exc)!r}"
    assert not isinstance(exc, ZeroDivisionError)
    assert not isinstance(exc, ArithmeticError), "callers catching ArithmeticError must not see it"
    assert exc.args == (ZERO_MESSAGE,)
    assert exc.__cause__ is None, "the error must not be chained with `raise ... from`"
    assert exc.__context__ is None, "the error must not leak a ZeroDivisionError context"


@pytest.mark.parametrize("flag", ["-O", "-OO"])
def test_divide_by_zero_is_still_enforced_without_assert_statements(flag: str) -> None:
    """A guard written as ``assert b != 0`` would silently disappear under ``-O``."""
    proc = _run_python(
        [flag],
        """
        from calc import divide

        try:
            divide(1, 0)
        except ValueError as exc:
            print("VALUE_ERROR:", exc)
        except BaseException as exc:  # noqa: BLE001
            print("WRONG_ERROR:", type(exc).__name__)
        else:
            print("NO_ERROR")
        """,
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == f"VALUE_ERROR: {ZERO_MESSAGE}", proc.stdout


@pytest.mark.parametrize(
    "flags", [["-W", "error"], ["-W", "error", "-X", "dev"]], ids=["werror", "werror-devmode"]
)
def test_import_and_use_emit_no_warnings(flags: list[str]) -> None:
    proc = _run_python(
        flags,
        """
        import calc
        from calc import add, divide

        print(add(1, 2), divide(6, 3), calc.__version__)
        """,
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.split()[0:2] == ["3", "2.0"], proc.stdout
    assert "Warning" not in proc.stderr


# --------------------------------------------------------------------------- #
# Public surface
# --------------------------------------------------------------------------- #
def test_all_lists_only_the_two_re_exports() -> None:
    assert list(calc.__all__) == ["add", "divide"] or sorted(calc.__all__) == ["add", "divide"]
    assert add is core_add and divide is core_divide, "re-exports must be the core functions"


def test_package_public_surface_has_no_stray_names() -> None:
    public = {name for name in dir(calc) if not name.startswith("_")}
    assert {"add", "divide"} <= public
    assert public <= {"add", "divide", "core"}, f"unexpected public names: {sorted(public)}"


# --------------------------------------------------------------------------- #
# The shipped artifact
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def wheel(tmp_path_factory: pytest.TempPathFactory) -> Path:
    uv = shutil.which("uv")
    if uv is None:
        pytest.skip("uv is required to build the distribution")
    out_dir = tmp_path_factory.mktemp("dist")
    proc = subprocess.run(  # noqa: S603 - fixed argv, no shell
        [uv, "build", "--wheel", "--out-dir", str(out_dir), str(PROJECT_ROOT)],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        pytest.skip(f"cannot build the wheel here (offline?): {proc.stderr.strip()[-200:]}")
    wheels = sorted(out_dir.glob("calc-*.whl"))
    assert wheels, f"no wheel produced in {out_dir}"
    return wheels[-1]


def test_wheel_ships_the_runtime_package_and_not_the_tests(wheel: Path) -> None:
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
    assert "calc/__init__.py" in names
    assert "calc/core.py" in names
    assert not [n for n in names if n.startswith(("tests/", "test_"))], names
    assert any(n.endswith(".dist-info/RECORD") for n in names), names


def test_wheel_declares_the_python_floor_and_has_no_runtime_dependencies(wheel: Path) -> None:
    with zipfile.ZipFile(wheel) as archive:
        metadata_name = next(n for n in archive.namelist() if n.endswith(".dist-info/METADATA"))
        metadata_lines = archive.read(metadata_name).decode("utf-8").splitlines()

    assert any(line.startswith("Name: calc") for line in metadata_lines), metadata_lines[:5]
    assert "Requires-Python: >=3.11" in metadata_lines
    runtime_requires = [
        line
        for line in metadata_lines
        if line.startswith("Requires-Dist:") and "extra ==" not in line
    ]
    assert runtime_requires == [], f"unexpected runtime dependencies: {runtime_requires}"


def test_wheel_installs_into_a_clean_environment_and_runs_the_readme_example(
    wheel: Path, tmp_path: Path
) -> None:
    uv = shutil.which("uv")
    if uv is None:
        pytest.skip("uv is required to create and populate a clean virtualenv")

    venv_dir = tmp_path / "venv"
    create = subprocess.run(  # noqa: S603 - fixed argv, no shell
        [uv, "venv", str(venv_dir)], capture_output=True, text=True, check=False
    )
    assert create.returncode == 0, create.stderr
    python = venv_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

    install = subprocess.run(  # noqa: S603 - fixed argv, no shell
        [
            uv,
            "pip",
            "install",
            "--python",
            str(python),
            "--no-index",
            "--find-links",
            str(wheel.parent),
            "calc",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert install.returncode == 0, install.stderr

    usage = subprocess.run(  # noqa: S603 - fixed argv, no shell
        [
            str(python),
            "-c",
            textwrap.dedent(
                """
                from calc import add, divide

                print(add(1, 2), divide(6, 3))
                try:
                    divide(1, 0)
                except ValueError as exc:
                    print("ValueError:", exc)
                """
            ),
        ],
        cwd=str(tmp_path),  # keep the source tree off sys.path
        capture_output=True,
        text=True,
        check=False,
    )
    assert usage.returncode == 0, usage.stderr
    assert usage.stdout.splitlines() == ["3 2.0", f"ValueError: {ZERO_MESSAGE}"], usage.stdout
