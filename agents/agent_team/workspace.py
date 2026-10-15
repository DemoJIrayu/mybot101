"""Sandbox workspace helpers and change policies shared by the CLI and the Lead."""

from __future__ import annotations

from agent_team.sandbox import WORKDIR, Sandbox
from agent_team.tools import is_test_path

# Agents may not change their own guardrails or the pipeline that checks them.
PROTECTED_PREFIXES = (".github/", "infra/", "agents/")
_AGENT_GIT = ["git", "-c", "user.name=agent-team", "-c", "user.email=agent-team@localhost"]

# Never part of a change, whatever .gitignore says: build output, installed packages,
# caches, local env files, and files other AI tools drop into a repo (for example
# `prisma init` adding agent "skills"). Git pathspec globs; "**/" also matches the root.
LEFT_OUT = (
    "**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "**/coverage/**",
    "**/.turbo/**", "**/*.tsbuildinfo", "**/*.map", "**/__pycache__/**",
    "**/.pytest_cache/**", "**/.ruff_cache/**", "**/.venv*/**",
    "**/.env", "**/.env.local", "**/.env.*.local",
    ".agents/**", ".claude/**", ".windsurf/**", ".cursor/**", ".codex/**", ".gemini/**",
    ".kiro/**", "**/skills-lock.json",
)  # fmt: skip


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
    """Stage the agents' work and return (changed paths, stat, full patch).

    Files matching LEFT_OUT are never staged; see left_out() to list them.
    """
    sandbox.exec(["git", "add", "-A", "--", ".", *(f":(exclude,glob){g}" for g in LEFT_OUT)])
    # Also unstage any that an earlier `git add` picked up.
    sandbox.exec(["git", "reset", "--quiet", "--", *(f":(glob){g}" for g in LEFT_OUT)])
    names = sandbox.exec(["git", "diff", "--cached", "--name-only"]).output.split()
    stat = sandbox.exec(["git", "diff", "--cached", "--stat"]).output
    patch = sandbox.exec(["git", "diff", "--cached", "--binary"]).output
    if patch and not patch.endswith("\n"):
        patch += "\n"
    return names, stat, patch


def left_out(sandbox: Sandbox) -> list[str]:
    """New or changed files that collect_diff leaves out (build output, AI-tool files...)."""
    res = sandbox.exec(
        ["git", "ls-files", "--others", "--modified", "--exclude-standard", "--",
         *(f":(glob){g}" for g in LEFT_OUT)]
    )  # fmt: skip
    return sorted(set(res.output.split())) if res.ok else []


def revert_paths(sandbox: Sandbox, paths: list[str]) -> None:
    """Undo the agents' changes to these paths (back to the last local commit)."""
    if not paths:
        return
    sandbox.exec(["git", "reset", "--quiet", "--", *paths])
    for path in paths:
        if sandbox.exec(["git", "cat-file", "-e", f"HEAD:{path}"]).ok:
            sandbox.exec(["git", "checkout", "--quiet", "HEAD", "--", path])
        else:  # a new file
            sandbox.exec(["rm", "-f", "--", path])


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
