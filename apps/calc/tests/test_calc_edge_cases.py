"""QA edge-case tests for ``calc.add`` / ``calc.divide``.

``test_calc.py`` (written with the change) covers the happy path. This file pokes at
the parts a caller can actually break:

* zero divisors of every numeric type Python ships (int, float, -0.0, Decimal,
  Fraction, complex, bool) must raise ``ValueError`` and never ``ZeroDivisionError``;
* non-numeric operands must fail loudly (``TypeError``), never be coerced/evaluated;
* NaN / infinities / denormals / huge values behave like IEEE-754 arithmetic;
* exact types (``Decimal``, ``Fraction``) are preserved instead of being flattened;
* the documented public API (exports, version, README examples) is real.
"""

from __future__ import annotations

import math
from decimal import Decimal
from fractions import Fraction
from importlib import metadata
from pathlib import Path

import pytest

import calc
from calc import add, core, divide

MESSAGE = "cannot divide by zero"

ZERO_LIKE = [
    pytest.param(0, id="int-0"),
    pytest.param(0.0, id="float-0.0"),
    pytest.param(-0.0, id="float-negative-0.0"),
    pytest.param(Decimal("0"), id="decimal-0"),
    pytest.param(Decimal("-0.0"), id="decimal-negative-0.0"),
    pytest.param(Decimal("0E+7"), id="decimal-0E+7"),
    pytest.param(Fraction(0, 7), id="fraction-0"),
    pytest.param(0j, id="complex-0j"),
    pytest.param(complex(-0.0, 0.0), id="complex-negative-zero"),
    pytest.param(False, id="bool-false"),
]

NON_NUMERIC = [
    pytest.param(None, id="none"),
    pytest.param("1", id="str"),
    pytest.param(b"1", id="bytes"),
    pytest.param([1], id="list"),
    pytest.param({"a": 1}, id="dict"),
    pytest.param((1,), id="tuple"),
    pytest.param(object(), id="object"),
]


# --------------------------------------------------------------------------- zero


@pytest.mark.parametrize("zero", ZERO_LIKE)
def test_every_kind_of_zero_divisor_raises_value_error(zero):
    with pytest.raises(ValueError) as excinfo:
        divide(1, zero)
    assert str(excinfo.value) == MESSAGE
    assert excinfo.value.args == (MESSAGE,)
    assert not isinstance(excinfo.value, ZeroDivisionError)


@pytest.mark.parametrize(
    "numerator",
    [0, 1, -1, 2**70, 0.0, -2.5, float("nan"), float("inf"), float("-inf")],
)
def test_zero_divisor_never_leaks_zerodivisionerror(numerator):
    """No numerator (including NaN/inf) may slip past the guard."""
    try:
        divide(numerator, 0)
    except ValueError as exc:
        assert str(exc) == MESSAGE
    except ZeroDivisionError as exc:  # pragma: no cover - regression guard
        pytest.fail(f"ZeroDivisionError leaked instead of ValueError: {exc!r}")
    else:  # pragma: no cover - regression guard
        pytest.fail("divide() by zero returned instead of raising ValueError")


def test_zero_divisor_check_runs_before_any_arithmetic():
    """``Decimal`` division by zero raises InvalidOperation; the guard must win."""
    with pytest.raises(ValueError, match=f"^{MESSAGE}$"):
        divide(Decimal(1), Decimal(0))


# --------------------------------------------------------------------- bad types


@pytest.mark.parametrize("other", NON_NUMERIC)
def test_add_rejects_non_numeric_operands(other):
    with pytest.raises(TypeError):
        add(1, other)


@pytest.mark.parametrize("other", NON_NUMERIC)
def test_divide_rejects_non_numeric_operands(other):
    with pytest.raises(TypeError):
        divide(1, other)


def test_string_divisor_is_a_type_error_not_a_silent_zero():
    """The string "0" is not the number zero: fail loudly, never coerce silently."""
    with pytest.raises(TypeError):
        divide(1, "0")
    with pytest.raises(TypeError):
        divide("6", "3")


def test_operands_are_never_evaluated_as_code():
    """Tiny hardened check: a hostile string operand must not be executed."""
    payloads = [
        "__import__('os').system('id')",
        "1); __import__('os').system('id'); (",
        "0; rm -rf /",
    ]
    for payload in payloads:
        with pytest.raises(TypeError):
            add(payload, 1)
        with pytest.raises(TypeError):
            divide(1, payload)
    source = Path(core.__file__).read_text(encoding="utf-8")
    for dangerous in ("eval(", "exec(", "os.system", "subprocess", "__import__("):
        assert dangerous not in source


def test_wrong_arity_is_a_type_error():
    with pytest.raises(TypeError):
        divide(1)  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        add(1, 2, 3)  # type: ignore[call-arg]


# ----------------------------------------------------------- float special cases


def test_nan_divisor_is_not_treated_as_zero():
    assert math.isnan(divide(1, float("nan")))
    assert math.isnan(divide(float("nan"), float("nan")))


def test_infinity_divisors():
    assert divide(1, float("inf")) == 0.0
    assert math.isnan(divide(float("inf"), float("inf")))
    negative = divide(1.0, float("-inf"))
    assert negative == 0.0
    assert math.copysign(1.0, negative) == -1.0


def test_denormal_divisor_overflows_to_infinity_like_ieee_754():
    assert math.isinf(divide(1.0, 5e-324))


def test_negative_zero_result_keeps_its_sign():
    divided = divide(0.0, -5)
    assert divided == 0.0
    assert math.copysign(1.0, divided) == -1.0


def test_huge_values_do_not_crash_add_and_stay_exact():
    assert add(10**400, 10**400) == 2 * 10**400
    assert add(10**100, -(10**100)) == 0
    assert add(2.0**1023, 2.0**1023) == float("inf")


# --------------------------------------------------------------- numeric niceties


def test_true_division_not_floor_division():
    assert divide(7, 2) == 3.5
    assert divide(-7, 2) == -3.5
    assert divide(1, 3) == 1 / 3
    assert isinstance(divide(6, 3), float)


@pytest.mark.parametrize(
    "zero_numerator, divisor",
    [
        (0, 1),
        (0, -1),
        (-0.0, 0.5),
        (0, Decimal(3)),
        (Decimal(0), Decimal(3)),
        (0, Fraction(1, 3)),
        (Fraction(0, 1), Fraction(1, 3)),
    ],
)
def test_zero_numerator_is_zero(zero_numerator, divisor):
    assert divide(zero_numerator, divisor) == 0


def test_exact_decimal_and_fraction_types_are_preserved():
    assert add(Decimal("0.1"), Decimal("0.2")) == Decimal("0.3")
    assert divide(Decimal(1), Decimal(4)) == Decimal("0.25")
    assert str(divide(Decimal(1), Decimal(4))) == "0.25"

    exact = divide(Fraction(1, 3), Fraction(1, 6))
    assert isinstance(exact, Fraction)
    assert exact == 2


def test_mixed_numeric_types():
    assert add(1, 0.5) == 1.5
    assert divide(1, Decimal(4)) == Decimal("0.25")
    assert divide(Fraction(1, 2), 2) == Fraction(1, 4)


def test_bools_are_integers_not_gotchas():
    assert add(True, True) == 2
    assert divide(True, True) == 1.0


@pytest.mark.parametrize("value", [0, 7, -3, 1.5, Decimal("0.1"), Fraction(2, 5)])
def test_add_identity_and_commutativity(value):
    assert add(value, 0) == value
    assert add(value, 3) == add(3, value)


def test_keyword_arguments_and_message_are_stable():
    assert add(a=1, b=2) == 3
    assert divide(a=6, b=3) == 2
    with pytest.raises(ValueError, match=f"^{MESSAGE}$"):
        divide(a=1, b=0)
    with pytest.raises(ValueError, match=f"^{MESSAGE}$"):
        divide(b=0, a=1)


# ---------------------------------------------------------------- packaging / API


def test_public_api_surface():
    assert calc.__all__ == ["add", "divide"]
    assert all(callable(getattr(calc, name)) for name in calc.__all__)
    assert calc.add is core.add
    assert calc.divide is core.divide


def test_declared_version_matches_distribution_metadata():
    try:
        installed = metadata.version("calc")
    except metadata.PackageNotFoundError:  # running from a source checkout
        pytest.skip("calc is not installed as a distribution")
    assert calc.__version__ == installed


def test_readme_examples_are_accurate():
    assert add(1, 2) == 3
    assert divide(6, 3) == 2
    with pytest.raises(ValueError, match=f"^{MESSAGE}$"):
        divide(1, 0)
