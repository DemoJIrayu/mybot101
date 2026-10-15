"""The checks CI runs, run by the Lead in Dev's sandbox before it opens a pull request.

Mirrors the node and python jobs of .github/workflows/devsecops-reusable.yml: a clean
install, a dependency audit (high/critical fail, dev tools included, like GitHub's
dependency review), then lint, type-check, tests and build for every project folder. Catching a
failure here costs one Dev round; catching it in CI costs a broken PR.
"""

from __future__ import annotations

from dataclasses import dataclass

from agent_team.sandbox import Sandbox

TIMEOUT = 1800  # seconds, for all projects together
OUTPUT_TAIL = 6000  # characters of output kept for Dev and the PR

SCRIPT = r"""
set -u
fail=0
projects() {  # folders containing one of the given files, outside dependencies
  find . \( "$@" \) -not -path '*/node_modules/*' -not -path './.git/*' \
    -not -path '*/.venv*/*' -printf '%h\n' | sort -u
}
for dir in $(projects -name package.json); do
  # npm workspace member without its own lockfile: the root install covers it.
  if [ "$dir" != "." ] && [ ! -f "$dir/package-lock.json" ] && [ -f ./package-lock.json ]; then
    continue
  fi
  echo "=== $dir (Node: install, audit, lint, typecheck, test, build)"
  ( cd "$dir" \
    && if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
       else npm install --no-audit --no-fund; fi \
    && npm audit --audit-level=high \
    && npm run lint --if-present \
    && npm run typecheck --if-present \
    && npm test --if-present \
    && npm run build --if-present ) || { echo "FAILED: $dir"; fail=1; }
done
for dir in $(projects -name pyproject.toml -o -name requirements.txt); do
  echo "=== $dir (Python: install, ruff, pytest)"
  venv="/tmp/ci-venv$(echo "$dir" | tr '/.' '__')"
  ( cd "$dir" \
    && uv venv -q --allow-existing "$venv" && . "$venv/bin/activate" \
    && if [ -f pyproject.toml ]; then \
         uv pip install -q -e ".[dev]" 2>/dev/null || uv pip install -q -e .; fi \
    && if [ -f requirements.txt ]; then uv pip install -q -r requirements.txt; fi \
    && uv pip install -q ruff pytest \
    && ruff check . \
    && { pytest -q || [ $? -eq 5 ]; } ) || { echo "FAILED: $dir"; fail=1; }
done
exit $fail
"""


@dataclass(frozen=True)
class CheckResult:
    ok: bool
    output: str  # the end of the output, where failures show up


def run_ci_checks(sandbox: Sandbox) -> CheckResult:
    res = sandbox.exec(["bash", "-c", SCRIPT], timeout=TIMEOUT)
    return CheckResult(res.ok, res.output[-OUTPUT_TAIL:])


def ci_fix_prompt(goal: str, output: str) -> str:
    return (
        f"Overall goal: {goal}\n\n"
        "The Lead ran the same checks as CI on your work (clean install, then lint, "
        "type-check, tests and build in every project folder) and they FAIL. The end "
        "of the output:\n\n"
        f"```\n{output}\n```\n\n"
        "Fix the causes in the code or configuration. Don't skip, delete or weaken "
        "tests or lint rules to get green. For `npm audit` findings, upgrade to the newest "
        "fixed version that is at least 7 days old (`npm view <pkg> time`); for a "
        "vulnerable package pulled in by a dependency that has no fixed release, add an "
        "`overrides` entry in package.json. Re-run the failing command to confirm, then "
        "call finish with what you changed."
    )
