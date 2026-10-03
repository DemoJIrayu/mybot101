import pytest

from calc import add, divide


@pytest.mark.parametrize(
    "a, b, expected",
    [(1, 2, 3), (-1, 1, 0), (0, 0, 0), (1.5, 2.5, 4.0)],
)
def test_add(a, b, expected):
    assert add(a, b) == expected


@pytest.mark.parametrize(
    "a, b, expected",
    [(6, 3, 2), (-6, 3, -2), (1, 2, 0.5), (0, 5, 0)],
)
def test_divide(a, b, expected):
    assert divide(a, b) == expected


@pytest.mark.parametrize("a", [0, 1, -1, 2.5])
def test_divide_by_zero_raises_value_error(a):
    with pytest.raises(ValueError, match="divide by zero"):
        divide(a, 0)
