# calc

Tiny arithmetic helper package.

```python
from calc import add, divide

add(1, 2)     # 3
divide(6, 3)  # 2
divide(1, 0)  # raises ValueError
```

## Tests

```sh
cd apps/calc
python -m pytest
```
