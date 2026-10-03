# calc

Tiny arithmetic helper package.

```python
from calc import add, divide

add(1, 2)  # 3
divide(6, 3)  # 2
divide(1, 0)  # raises ValueError
```

## Command line

```sh
cd apps/calc
python -m calc add 2 3        # 5
python -m calc divide 6 3     # 2.0
python -m calc add -1e5 1     # -99999.0
python -m calc divide 1 0     # error on stderr, exit code 1
```

Invalid input (unknown operation, malformed number, wrong number of arguments,
division by zero) prints a message on stderr and exits with code 1.

Operands and results are exact: integers stay integers however many digits they
have, and a result that no float can represent (such as `10**400 / 1`) is reported
as an error instead of being guessed at.

## Tests

```sh
cd apps/calc
python -m pytest
```
