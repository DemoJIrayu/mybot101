"""QA hardening pass for the ``calc`` package (PR #3).

``test_calc.py`` ships with the change (happy path) and
``test_calc_edge_cases.py`` is the first QA pass (zero divisors, non-numeric
operands, IEEE-754 specials, public API). This file covers the angles that were
still open:

* zero-like values that are *subclasses* or enum members, and zero divisors while
  the decimal context has the ``DivisionByZero`` trap switched off;
* exactness at the integer/float boundary (huge ints, ``Fraction``) and what
  happens when the quotient has no float representation;
* ``add`` must never turn non-numeric operands into a number behind the caller's back;
* purity: no argument mutation, no module state, consistent under concurrency;
* supply-chain surface: import-time side effects, modules pulled in by the import,
  an AST policy check over the package sources (no dynamic code execution, no
  process/network/filesystem calls, no third-party imports) and no unreviewed new
  module files in the runtime package;
* the README import and the declared version/metadata actually work.
"""

from __future__ import annotations

import ast
import decimal
import enum
import inspect
import json
import math
import os
import subprocess
import sys
import tomllib
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from fractions import Fraction
from importlib import metadata
from pathlib import Path

import pytest

import calc
from calc import add, core, divide

MESSAGE = "cannot divide by zero"

PACKAGE_DIR = Path(calc.__file__).resolve().parent
SOURCE_ROOT = PACKAGE_DIR.parent
PYPROJECT = SOURCE_ROOT / "pyproject.toml"
PACKAGE_SOURCES = sorted(PACKAGE_DIR.rglob("*.py"))

# Calls that must never appear in a tiny arithmetic helper: the package is a
# dependency, so importing it must not execute strings, touch the disk, the
# network, or spawn processes.
BANNED_CALLS = frozenset(
    {
        "eval", "exec", "compile", "__import__", "input", "open", "breakpoint",
        "system", "popen", "Popen", "run", "call", "check_call", "check_output",
        "spawn", "fork", "socket", "connect", "create_connection", "urlopen",
        "loads", "load", "import_module", "exec_module", "reload",
    }
)  # fmt: skip

# Roots a runtime dependency may import: stdlib-only, as the PR claims.
ALLOWED_IMPORT_ROOTS = frozenset(
    {
        "__future__", "calc", "decimal", "fractions", "math",
        "numbers", "operator", "statistics", "sys", "typing",
    }
)  # fmt: skip


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _called_names(tree: ast.Module):
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Name):
            yield func.id, node.lineno
        elif isinstance(func, ast.Attribute):
            yield func.attr, node.lineno


def _run_in_fresh_interpreter(code: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(SOURCE_ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    return subprocess.run(  # noqa: S603 - fixed argv, no shell, test-local code only
        [sys.executable, "-c", code],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


# ------------------------------------------------------- zero divisors, again


class IntZero(int):
    """``int`` subclass that is still numerically zero."""


class FloatZero(float):
    """``float`` subclass that is still numerically zero."""


class Code(enum.IntEnum):
    ZERO = 0
    ONE = 1


class Flags(enum.IntFlag):
    NONE = 0


@pytest.mark.parametrize(
    "zero",
    [
        pytest.param(IntZero(0), id="int-subclass-0"),
        pytest.param(IntZero(), id="int-subclass-default"),
        pytest.param(FloatZero(0.0), id="float-subclass-0.0"),
        pytest.param(FloatZero(-0.0), id="float-subclass-negative-0.0"),
        pytest.param(Code.ZERO, id="intenum-0"),
        pytest.param(Flags.NONE, id="intflag-0"),
    ],
)
def test_zero_subclass_and_enum_divisors_raise_value_error(zero):
    """The guard must catch zero whatever its concrete type is."""
    with pytest.raises(ValueError) as excinfo:
        divide(1, zero)
    assert str(excinfo.value) == MESSAGE
    assert excinfo.value.args == (MESSAGE,)


def test_enum_operands_behave_like_the_numbers_they_are():
    assert divide(Code.ONE, Code.ONE) == 1.0
    assert add(Code.ONE, Flags.NONE) == 1


def test_zero_divisor_raises_value_error_even_when_decimal_would_not():
    """With the trap disabled ``Decimal`` returns Infinity; calc must still refuse."""
    with decimal.localcontext() as ctx:
        ctx.traps[decimal.DivisionByZero] = False
        ctx.traps[decimal.InvalidOperation] = False
        assert Decimal(1) / Decimal(0) == Decimal("Infinity")  # context is really permissive
        with pytest.raises(ValueError) as excinfo:
            divide(Decimal(1), Decimal(0))
    assert str(excinfo.value) == MESSAGE


# --------------------------------------------------- big values / exactness


def test_huge_integers_stay_exact_or_are_reported_loudly():
    assert add(10**2000, 1) == 10**2000 + 1  # no float rounding on the way
    assert divide(10**300, 10**290) == 1e10  # quotient still fits a float
    assert divide(2**2000, 2**1999) == 2.0
    assert divide(10**308, 1) == 1e308


def test_quotient_without_float_representation_is_never_silently_wrong():
    """``10**309 / 1`` cannot be represented as a float.

    CPython raises ``OverflowError`` for ``int / int`` where float division would
    saturate to ``inf``. Either outcome is acceptable - a finite, wrong number is not.
    """
    try:
        result = divide(10**309, 1)
    except OverflowError:
        return
    assert math.isinf(result)


def test_exact_types_stay_exact_where_floats_would_round():
    quotient = divide(Fraction(10**100, 3), Fraction(10**99, 3))
    assert isinstance(quotient, Fraction)
    assert quotient == Fraction(10)

    # Decimal follows the current context (28 significant digits by default), so the
    # result is rounded - but it must stay a Decimal and stay accurate.
    third = divide(Decimal(1), Decimal(3))
    assert isinstance(third, Decimal)
    assert abs(third * 3 - 1) < Decimal("1e-27")


# ------------------------------------------------- no silent type coercion


@pytest.mark.parametrize(
    "a, b",
    [
        pytest.param("100", "1", id="str"),
        pytest.param("1", "2", id="str-shortest"),
        pytest.param(b"1", b"2", id="bytes"),
        pytest.param((1,), (2,), id="tuple"),
        pytest.param([1], [2], id="list"),
    ],
)
def test_add_never_silently_coerces_incompatible_operands_into_a_number(a, b):
    """``add`` is duck-typed (``a + b``).

    A loud ``TypeError`` and a same-type result are both fine; a silently coerced
    number (``add("100", "1") == 101``) would be a wrong answer nobody can see.
    """
    try:
        result = add(a, b)
    except TypeError:
        return
    assert type(result) is type(a)
    assert not isinstance(result, (int, float, complex))


@pytest.mark.parametrize("numerator", [None, "1", [1], {}, object()])
def test_zero_divisor_is_reported_before_operand_type_errors(numerator):
    """A zero divisor is the documented error, whatever the numerator is."""
    with pytest.raises(ValueError) as excinfo:
        divide(numerator, 0)
    assert str(excinfo.value) == MESSAGE


# ------------------------------------------------------------- call contract


def test_signature_is_two_required_positional_or_keyword_parameters():
    for func in (add, divide):
        params = list(inspect.signature(func).parameters.values())
        assert [p.name for p in params] == ["a", "b"]
        assert all(p.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD for p in params)
        assert all(p.default is inspect.Parameter.empty for p in params)


def test_unknown_or_missing_arguments_are_type_errors():
    with pytest.raises(TypeError):
        divide(1, c=2)
    with pytest.raises(TypeError):
        add(1, 2, c=3)
    with pytest.raises(TypeError):
        add(a=1)
    with pytest.raises(TypeError):
        divide(b=3)


# ------------------------------------------------------------------- purity


def test_operations_are_pure_and_do_not_mutate_their_arguments():
    left, right = [1], [2]
    assert add(left, right) == [1, 2]
    assert left == [1]
    assert right == [2]

    state_before = dict(vars(core))
    for _ in range(50):
        add(1, 2)
        divide(1, 3)
    assert dict(vars(core)) == state_before  # no caches or other module state


def test_concurrent_calls_return_consistent_results():
    args = [(i, 7) for i in range(1, 501)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda pair: divide(*pair), args))
    assert results == [i / 7 for i in range(1, 501)]


# ------------------------------------------- import safety / supply chain


def test_import_has_no_filesystem_side_effects(tmp_path):
    result = _run_in_fresh_interpreter("import calc; print(calc.__version__)", tmp_path)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == calc.__version__
    assert list(tmp_path.iterdir()) == []  # nothing written next to the caller


def test_import_pulls_in_nothing_but_the_package_itself(tmp_path):
    """Importing the package must not drag in extra machinery (or a third-party dep).

    ``__future__`` is allowed: ``from __future__ import annotations`` imports it
    only the first time, so whether it shows up depends on how the interpreter started.
    """
    code = (
        "import json, sys\n"
        "before = set(sys.modules)\n"
        "import calc\n"
        "new = sorted({name.split('.')[0] for name in set(sys.modules) - before})\n"
        "print(json.dumps(new))\n"
    )
    result = _run_in_fresh_interpreter(code, tmp_path)
    assert result.returncode == 0, result.stderr
    assert set(json.loads(result.stdout)) <= {"calc", "__future__"}


def test_readme_import_works_from_any_working_directory(tmp_path):
    """The README's ``from calc import add, divide`` must work without a special cwd."""
    code = "from calc import add, divide\nprint(add(1, 2), divide(6, 3))\n"
    result = _run_in_fresh_interpreter(code, tmp_path)
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["3", "2.0"]


def test_package_uses_no_dynamic_code_or_process_calls():
    problems = [
        f"{path.name}:{lineno} calls {name}()"
        for path in PACKAGE_SOURCES
        for name, lineno in _called_names(_parse(path))
        if name in BANNED_CALLS
    ]
    assert problems == []


def test_package_imports_only_stdlib_modules():
    problems = []
    for path in PACKAGE_SOURCES:
        for node in ast.walk(_parse(path)):
            if isinstance(node, ast.Import):
                roots = [alias.name.split(".")[0] for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level:  # relative import inside the package
                    continue
                roots = [(node.module or "").split(".")[0]]
            else:
                continue
            for root in roots:
                if root not in ALLOWED_IMPORT_ROOTS:
                    problems.append(f"{path.name} imports {root}")
    assert problems == []


def test_runtime_package_contains_only_reviewed_modules():
    """A new file in the installed package is new code to review, not a silent extra."""
    assert [path.name for path in PACKAGE_SOURCES] == [
        "__init__.py",
        "__main__.py",
        "core.py",
    ]


# ----------------------------------------------------- metadata / packaging


def test_declared_version_matches_the_source_and_the_installed_distribution():
    if not PYPROJECT.is_file():
        pytest.skip("calc is installed outside its source tree")
    with PYPROJECT.open("rb") as handle:
        project = tomllib.load(handle)["project"]
    assert project["name"] == PACKAGE_DIR.name
    assert project["version"] == calc.__version__
    try:
        installed = metadata.version(project["name"])
    except metadata.PackageNotFoundError:
        pytest.skip("calc is not installed as a distribution")
    assert installed == calc.__version__


def test_documented_error_is_stable_for_every_call_style():
    """The docstring promises ``ValueError`` for a zero divisor; the message is fixed."""
    doc = (divide.__doc__ or "").lower()
    assert "valueerror" in doc
    assert "zero" in doc
    for call in (lambda: divide(1, 0), lambda: divide(a=1, b=0), lambda: divide(b=0, a=1)):
        with pytest.raises(ValueError, match=f"^{MESSAGE}$"):
            call()
