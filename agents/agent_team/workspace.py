"""Sandbox workspace helpers and change policies shared by the CLI and the Lead."""

from __future__ import annotations

from agent_team.sandbox import WORKDIR, Sandbox
from agent_team.tools import is_test_path

# Agents may not change their own guardrails or the pipeline that checks them.
PROTECTED_PREFIXES = (".github/", "infra/", "agents/")
_AGENT_GIT = ["git", "-c", "user.name=agent-team", "-c", "user.email=agent-team@localhost"]


def protected_changes(
    paths: list[str], protected: tuple[str, ...] = PROTECTED_PREFIXES
) -> list[str]:
    return [p for p in paths if p.startswith(protected)]


def disallowed_changes(
    role: str,
    paths: list[str],
    allow_protected: bool,
    protected: tuple[str, ...] = PROTECTED_PREFIXES,
) -> list[str]:
    """Paths this role must not change. QA's test-only rule can't be overridden."""
    blocked = [] if allow_protected else protected_changes(paths, protected)
    if role == "qa":
        blocked += [p for p in paths if not is_test_path(p) and p not in blocked]
    return blocked


def load_tree(sandbox: Sandbox, tree: bytes) -> None:
    """Give the sandbox a fresh copy of the code (a tar archive) as a local git repo.

    The repo has one local commit (the starting point), so agents' work shows up as a
    plain diff. It has no remote and no credentials: agents can't push anywhere.
    """
    steps = [
        (["rm", "-rf", WORKDIR], None),
        (["mkdir", "-p", WORKDIR], None),
        (["tar", "-x", "-f", "-", "-C", WORKDIR], tree),
        (["git", "init", "--quiet", "-b", "main", WORKDIR], None),
    ]
    for args, data in steps:
        res = sandbox.exec(args, stdin=data, workdir="/workspace", timeout=300)
        if not res.ok:
            raise RuntimeError(f"could not load the code into {sandbox.container}:\n{res.output}")
    commit_all(sandbox, "starting point")


def collect_diff(sandbox: Sandbox) -> tuple[list[str], str, str]:
    """Stage everything in the sandbox and return (changed paths, stat, full patch)."""
    sandbox.exec(["git", "add", "-A"])
    names = sandbox.exec(["git", "diff", "--cached", "--name-only"]).output.split()
    stat = sandbox.exec(["git", "diff", "--cached", "--stat"]).output
    patch = sandbox.exec(["git", "diff", "--cached", "--binary"]).output
    if patch and not patch.endswith("\n"):
        patch += "\n"
    return names, stat, patch


def apply_patch(sandbox: Sandbox, patch: str) -> None:
    """Apply a patch produced by collect_diff (possibly in another sandbox)."""
    if not patch.strip():
        return
    res = sandbox.exec(["git", "apply", "--whitespace=nowarn", "-"], stdin=patch)
    if not res.ok:
        raise RuntimeError(f"could not apply patch in {sandbox.container}:\n{res.output}")


def commit_all(sandbox: Sandbox, message: str) -> None:
    """Commit everything locally in the sandbox (never pushed) to get a clean baseline."""
    sandbox.exec(["git", "add", "-A"])
    res = sandbox.exec([*_AGENT_GIT, "commit", "--quiet", "--allow-empty", "-m", message])
    if not res.ok:
        raise RuntimeError(f"could not commit in {sandbox.container}:\n{res.output}")
