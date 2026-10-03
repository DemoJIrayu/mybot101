"""Host-side GitHub helpers. They use YOUR `gh` login; agents never hold a token."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from agent_team.config import REPO_ROOT


@dataclass(frozen=True)
class PullRequest:
    number: int
    title: str
    body: str
    state: str  # OPEN, MERGED or CLOSED
    head: str
    base: str
    cross_repo: bool
    url: str

    @property
    def ref(self) -> str:
        """Short reference for reports: '#3', or 'this change' for unsubmitted work."""
        return f"#{self.number}" if self.number else "this change"

    @property
    def merged(self) -> bool:
        return self.state == "MERGED"

    def test_branch_target(self) -> str | None:
        """Where a follow-up PR with QA's tests should go, or None if it can't be opened.

        Merged PR -> its base (main), because the code now lives there.
        Open PR from this repo -> the PR's own branch, so the tests land with the change.
        Open PR from a fork, or a closed PR -> no follow-up PR (comment only).
        """
        if self.merged:
            return self.base
        if self.state == "OPEN" and not self.cross_repo:
            return self.head
        return None


def _gh(*args: str) -> str:
    return subprocess.run(
        ["gh", *args], cwd=REPO_ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()


def parse_pr(data: dict) -> PullRequest:
    return PullRequest(
        number=int(data["number"]),
        title=data.get("title", ""),
        body=data.get("body") or "",
        state=data.get("state", ""),
        head=data.get("headRefName", ""),
        base=data.get("baseRefName", "main"),
        cross_repo=bool(data.get("isCrossRepository", False)),
        url=data.get("url", ""),
    )


def get_pr(number: int) -> PullRequest:
    fields = "number,title,body,state,headRefName,baseRefName,isCrossRepository,url"
    return parse_pr(json.loads(_gh("pr", "view", str(number), "--json", fields)))


def comment_on_pr(number: int, body_file: Path) -> None:
    _gh("pr", "comment", str(number), "--body-file", str(body_file))


def create_pr(base: str, head: str, title: str, body: str) -> str:
    return _gh("pr", "create", "--base", base, "--head", head, "--title", title, "--body", body)
