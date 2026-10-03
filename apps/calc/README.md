# calc

Tiny arithmetic helper package.

```python
from calc import add, divide

add(1, 2)     # 3
divide(6, 3)  # 2
divide(1, 0)  # raises ValueError
```

## Command line

```sh
cd apps/calc
python -m calc add 2 3      # 5
python -m calc divide 1 2   # 0.5
python -m calc divide 1 0   # error: cannot divide by zero (exit code 1)
```

Operands are read as integers when possible and as floats otherwise. A bad
COMMAND, argument count, or operand prints a usage message to stderr and exits
with code 2.

## Tests

```sh
cd apps/calc
python -m pytest
```
