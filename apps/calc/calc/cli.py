"""Command line interface for ``calc``.

    python -m calc add 2 3        # prints 5
    python -m calc divide 1 0     # prints an error on stderr, exits 1

Every failure (zero divisor, unknown operation, malformed number, wrong number of
arguments) is reported on stderr and exits with status 1.

Operands and results are exact: integers stay integers however long they are, and
a result that has no float representation is reported instead of guessed at.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable, Sequence
from typing import NoReturn, TypeVar

from calc.core import add, divide

OPERATIONS: dict[str, Callable[[float, float], float]] = {"add": add, "divide": divide}

_T = TypeVar("_T")


def _without_digit_limit(convert: Callable[[], _T]) -> _T:
    """Run ``convert`` with the interpreter's int/str digit limit lifted.

    CPython refuses to convert ints of more than ``sys.get_int_max_str_digits()``
    digits (4300 by default) to or from strings.  ``calc`` promises exact answers,
    so a long operand must still be parsed as an int - ``int()`` failing on it must
    not be mistaken for "not an integer" - and a long exact result must still be
    printed.  The limit is restored before returning.
    """
    limit = sys.get_int_max_str_digits()
    if not limit:
        return convert()
    sys.set_int_max_str_digits(0)  # 0 means "no limit"
    try:
        return convert()
    finally:
        sys.set_int_max_str_digits(limit)


class _ParserExit(Exception):
    """``argparse`` stopped the parse; ``main`` turns this into a return value.

    ``argparse`` normally reports help and usage errors by calling ``sys.exit``,
    which raises ``SystemExit`` and would kill an embedder that called ``main``.
    ``main`` promises to *return* the exit code, so the status travels as this
    ordinary exception instead (``except Exception`` can catch it).
    """

    def __init__(self, status: int) -> None:
        super().__init__(status)
        self.status = status


class _Parser(argparse.ArgumentParser):
    """``argparse`` that reports usage errors with exit code 1 instead of 2.

    It also keeps ``argparse`` from guessing which tokens are option strings: only
    the options this parser defines (``-h``/``--help``) are options, everything else
    is an operand.  ``argparse`` otherwise decides that *before* ``type`` runs, with
    a heuristic that only recognises ``-123``/``-1.5``, so operands such as
    ``-1e5``, ``-1.5e3`` or ``-inf`` were rejected as a missing argument.
    """

    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        self.exit(1, f"{self.prog}: error: {message}\n")

    def exit(self, status: int = 0, message: str | None = None) -> NoReturn:
        """Report the status by raising instead of calling ``sys.exit``."""
        if message:
            self._print_message(message, sys.stderr)
        raise _ParserExit(status)

    def _parse_optional(self, arg_string: str):
        if arg_string in self._option_string_actions:
            return super()._parse_optional(arg_string)
        return None


def _number(text: str) -> int | float:
    """Parse ``text`` as an int when possible, otherwise as a float.

    Keeping integers integral is what makes ``add 2 3`` print ``5``, not ``5.0``.
    The int attempt runs without the interpreter's digit limit, so an operand that
    is merely too long is still an exact integer instead of falling through to
    ``float``, which would round it and saturate huge values to ``inf``.
    """
    try:
        return _without_digit_limit(lambda: int(text))
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid number: {text!r}") from None


def build_parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="python -m calc", description="Tiny arithmetic helper.")
    parser.add_argument("operation", choices=sorted(OPERATIONS), help="add or divide")
    parser.add_argument("a", type=_number, help="first operand")
    parser.add_argument("b", type=_number, help="second operand")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the CLI; return the exit code (0 on success, 1 on any error)."""
    try:
        args = build_parser().parse_args(argv)
    except _ParserExit as exc:
        # ``--help`` asks for 0, a usage error for 1; either way the parser has
        # already written the help text or the error message to the right stream.
        return exc.status
    # ValueError covers a zero divisor and malformed operands; OverflowError is
    # raised by exact division (``10**400 / 1``) that no float can represent.
    try:
        result = OPERATIONS[args.operation](args.a, args.b)
        print(_without_digit_limit(lambda: str(result)))
    except (ValueError, OverflowError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
