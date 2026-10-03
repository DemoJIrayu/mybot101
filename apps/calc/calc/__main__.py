"""Command-line entry point: ``python -m calc <add|divide> <a> <b>``."""

from __future__ import annotations

import sys

from calc.core import add, divide

OPERATIONS = {"add": add, "divide": divide}
USAGE = "usage: python -m calc <add|divide> <a> <b>"


def _parse_operand(text: str) -> int | float:
    """Return ``text`` as an ``int`` when it is one, otherwise as a ``float``.

    Raises:
        ValueError: if ``text`` is not a number.
    """
    try:
        return int(text)
    except ValueError:
        return float(text)


def main(argv: list[str] | None = None) -> int:
    """Run the CLI for ``argv`` (defaults to ``sys.argv[1:]``) and return an exit code."""
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 3 or args[0] not in OPERATIONS:
        print(USAGE, file=sys.stderr)
        return 2

    command, first, second = args
    try:
        a = _parse_operand(first)
        b = _parse_operand(second)
    except ValueError:
        print(f"calc: operands must be numbers: {first!r}, {second!r}", file=sys.stderr)
        print(USAGE, file=sys.stderr)
        return 2

    try:
        result = OPERATIONS[command](a, b)
    except ValueError as error:
        print(f"calc: {error}", file=sys.stderr)
        return 1

    print(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
