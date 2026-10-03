"""Safety checks a repository must pass before the agents may change it."""

from __future__ import annotations

import subprocess
from collections.abc import Callable

from agent_team.repos import Target

REUSABLE_WORKFLOW = "DemoJIrayu/mybot101/.github/workflows/devsecops-reusable.yml"

Runner = Callable[[list[str]], subprocess.CompletedProcess]


def _run(args: list[str]) -> subprocess.CompletedProcess:
    # Safe: an argument list (no shell); repo names come from the checked allowlist.
    return subprocess.run(  # nosemgrep: dangerous-subprocess-use-audit
        args, capture_output=True, text=True, check=False
    )


def preflight(target: Target, branch: str, run: Runner = _run) -> list[str]:
    """Return what's missing (empty list = safe to go). Doesn't change anything."""
    problems: list[str] = []
    if target.require_ci:
        found = run(
            [
                "git", "-C", str(target.local_dir), "grep", "-q", "-F", REUSABLE_WORKFLOW,
                f"origin/{branch}", "--", ".github/workflows",
            ]
        )  # fmt: skip
        if found.returncode != 0:
            problems.append(
                f"No CI: .github/workflows/ on '{branch}' doesn't call {REUSABLE_WORKFLOW}. "
                "Add the devsecops.yml from docs/onboarding/ (see docs/AGENT-TEAM.md)."
            )
    if target.require_branch_protection:
        res = run(["gh", "api", f"repos/{target.name}/branches/{branch}/protection"])
        if res.returncode != 0:
            detail = (res.stderr or res.stdout).strip().splitlines()[-1:] or [""]
            hint = (
                " Private repos need GitHub Pro for branch protection; if that's not an option, "
                "set require_branch_protection = false for it in infra/repos.toml."
                if "Upgrade" in detail[0] or "403" in detail[0]
                else ""
            )
            problems.append(
                f"'{branch}' isn't protected ({detail[0][:120]}). Run: "
                f"bash .github/scripts/protect-main.sh {target.name}.{hint}"
            )
    return problems
