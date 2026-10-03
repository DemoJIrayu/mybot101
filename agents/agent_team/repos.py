"""Which repositories the agents may work on, and the host-side git work for each.

Agents never get Git credentials. Your machine clones each repo with your `gh` login
into ~/agent-repos/<owner>/<repo>, hands the agents a plain copy of the files (a tar
archive, no .git, no tokens), and later turns their patch into a branch and a pull
request in that clone. Repos that aren't listed in infra/repos.toml are refused.
"""

from __future__ import annotations

import os
import subprocess
import tomllib
from dataclasses import dataclass
from pathlib import Path

from agent_team.config import REPO_ROOT

REPOS_FILE = REPO_ROOT / "infra" / "repos.toml"
SELF_REPO = "DemoJIrayu/mybot101"


def repos_dir() -> Path:
    return Path(os.environ.get("AGENT_REPOS_DIR", Path.home() / "agent-repos"))


@dataclass(frozen=True)
class Target:
    name: str  # owner/repo, as written in repos.toml
    protected: tuple[str, ...]  # path prefixes agents must never change
    is_self: bool = False  # the agent-team repo itself (works in REPO_ROOT)
    require_ci: bool = True  # the repo must call the shared DevSecOps workflow
    require_branch_protection: bool = True

    @property
    def short(self) -> str:
        return self.name.split("/", 1)[1]

    @property
    def local_dir(self) -> Path:
        return REPO_ROOT if self.is_self else repos_dir() / self.name


class RepoError(RuntimeError):
    pass


def load_targets(path: Path = REPOS_FILE) -> dict[str, Target]:
    """Read the allowlist. Keys are lower-case owner/repo for case-insensitive lookup."""
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        data = {}
    targets: dict[str, Target] = {}
    for name, cfg in (data.get("repos") or {}).items():
        if name.count("/") != 1 or not all(name.split("/")):
            raise RepoError(f"{path}: '{name}' must look like owner/repo")
        protected = tuple(str(p) for p in cfg.get("protected", [".github/", "infra/"]))
        is_self = name.lower() == SELF_REPO.lower()
        targets[name.lower()] = Target(
            name=name,
            protected=protected,
            is_self=is_self,
            require_ci=bool(cfg.get("require_ci", not is_self)),
            require_branch_protection=bool(cfg.get("require_branch_protection", not is_self)),
        )
    # The agent-team repo is always available, with its own guardrails protected.
    targets.setdefault(
        SELF_REPO.lower(),
        Target(SELF_REPO, (".github/", "infra/", "agents/"), True, False, False),
    )
    return targets


def get_target(name: str | None, path: Path = REPOS_FILE) -> Target:
    targets = load_targets(path)
    key = (name or SELF_REPO).strip().removeprefix("https://github.com/").rstrip("/").lower()
    key = key.removesuffix(".git")
    if key not in targets:
        allowed = ", ".join(t.name for t in targets.values())
        raise RepoError(
            f"'{name}' isn't in infra/repos.toml, so the agents may not touch it. "
            f"Allowed: {allowed}"
        )
    return targets[key]


# ---------------------------------------------------------------- host git (your login)


def _run(args: list[str], cwd: Path | None = None, binary: bool = False):
    proc = subprocess.run(args, cwd=cwd, capture_output=True, text=not binary, check=False)
    if proc.returncode != 0:
        err = proc.stderr.decode() if binary else proc.stderr
        raise RepoError(f"{' '.join(args[:4])}… failed: {err.strip()[:500]}")
    return proc.stdout


def git(target: Target, *args: str) -> str:
    return _run(["git", "-C", str(target.local_dir), *args]).strip()


def ensure_clone(target: Target) -> None:
    """Clone (first time) or fetch the repo on your machine, using your gh login."""
    d = target.local_dir
    if not (d / ".git").exists():
        d.parent.mkdir(parents=True, exist_ok=True)
        _run(["gh", "repo", "clone", target.name, str(d), "--", "--quiet"])
    git(target, "fetch", "--quiet", "--prune", "origin")


def default_branch(target: Target) -> str:
    try:
        ref = git(target, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
        return ref.removeprefix("origin/")
    except RepoError:
        git(target, "remote", "set-head", "origin", "--auto")
        return git(target, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").removeprefix(
            "origin/"
        )


def archive(target: Target, ref: str) -> bytes:
    """The files at `ref` as a tar archive (no .git, no credentials)."""
    return _run(["git", "-C", str(target.local_dir), "archive", "--format=tar", ref], binary=True)


def fetch_pr(target: Target, number: int, base: str) -> str:
    """Fetch a pull request's head into a local ref and return that ref's name."""
    ref = f"refs/agent/pr-{number}"
    git(
        target,
        "fetch",
        "--quiet",
        "origin",
        f"+refs/pull/{number}/head:{ref}",
        f"+refs/heads/{base}:refs/remotes/origin/{base}",
    )
    return ref
