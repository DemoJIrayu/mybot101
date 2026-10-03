"""QA-specific steps: check out a pull request in the sandbox, brief the agent, write the report."""

from __future__ import annotations

from agent_team.agent import RunResult
from agent_team.github import PullRequest
from agent_team.sandbox import WORKDIR, Sandbox
from agent_team.tools import SEVERITIES, Bug

MAX_DIFF_CHARS = 40_000
WRITE_RULE = (
    "The QA agent may only create or edit test files (tests/, test_*.py, conftest.py, "
    "*.test.ts, *.spec.ts, e2e/, playwright config, package.json). Report bugs in "
    "application code with report_bug instead of fixing them."
)


def _must(res, what: str) -> str:
    if not res.ok:
        raise RuntimeError(f"{what} failed in the sandbox:\n{res.output}")
    return res.output


def prepare_pr_workspace(sandbox: Sandbox, repo_url: str, pr: PullRequest) -> tuple[str, str]:
    """Clone the repo, fetch the PR and check out the code to test.

    Merged PR: test the current base branch (the change is already in it).
    Open PR: test the PR's own head commit.
    Returns (diff stat, diff) of what the PR changed.
    """
    pr_ref = f"pr-{pr.number}"
    _must(sandbox.exec(["rm", "-rf", WORKDIR], workdir="/workspace"), "cleanup")
    _must(
        sandbox.exec(
            ["git", "clone", "--quiet", "--filter=blob:none", repo_url, WORKDIR],
            workdir="/workspace",
            timeout=300,
        ),
        "git clone",
    )
    _must(
        sandbox.exec(
            [
                "git", "fetch", "--quiet", "origin",
                f"+refs/heads/{pr.base}:refs/remotes/origin/{pr.base}",
                f"+refs/pull/{pr.number}/head:refs/heads/{pr_ref}",
            ],
            timeout=300,
        ),
        f"fetching PR #{pr.number}",
    )  # fmt: skip
    target = f"origin/{pr.base}" if pr.merged else pr_ref
    _must(sandbox.exec(["git", "checkout", "--quiet", "--detach", target]), "checkout")

    span = f"origin/{pr.base}...{pr_ref}"
    stat = _must(sandbox.exec(["git", "diff", "--stat", span]), "git diff --stat")
    diff = _must(sandbox.exec(["git", "diff", span]), "git diff")
    return stat, diff


def build_qa_task(pr: PullRequest, stat: str, diff: str, extra: str = "") -> str:
    if len(diff) > MAX_DIFF_CHARS:
        diff = (
            diff[:MAX_DIFF_CHARS]
            + f"\n... [diff truncated; {len(diff) - MAX_DIFF_CHARS} more characters. "
            "Use read_file to see the rest.]"
        )
    if not pr.number:
        where = "The checkout contains the team's change, committed on top of main."
    elif pr.merged:
        where = f"This PR is already merged; the checkout is the current {pr.base} branch."
    else:
        where = "The checkout is the PR's head commit."
    subject = f"pull request #{pr.number}" if pr.number else "this change"
    parts = [
        f"Test {subject}: {pr.title}",
        where,
        f"Description:\n{pr.body.strip() or '(none)'}",
        f"Files changed:\n{stat.strip()}",
        f"Diff:\n```diff\n{diff}\n```",
    ]
    if extra.strip():
        parts.append(f"Extra instructions from the human:\n{extra.strip()}")
    return "\n\n".join(parts)


_ICON = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "⚪"}


def build_report(pr: PullRequest, result: RunResult, bugs: list[Bug], tests_stat: str) -> str:
    ordered = sorted(bugs, key=lambda b: SEVERITIES.index(b.severity))
    lines = [f"## 🧪 QA report for {pr.ref}: {pr.title}", ""]
    if not result.finished:
        lines += [f"> ⚠️ The QA agent did not finish: {result.summary}", ""]

    lines.append(f"### Bugs found: {len(bugs)}")
    if ordered:
        lines += ["", "| Bug | Severity | Description | File |", "|---|---|---|---|"]
        for i, bug in enumerate(ordered, 1):
            title = bug.title.replace("|", "\\|")
            file = f"`{bug.file}`" if bug.file else ""
            lines.append(f"| {i} | {_ICON[bug.severity]} {bug.severity} | {title} | {file} |")
        lines.append("")
        for i, bug in enumerate(ordered, 1):
            lines += [
                "<details>",
                f"<summary>Bug {i}: {bug.title}</summary>",
                "",
                bug.details,
                "",
                "</details>",
            ]
    else:
        lines += ["", "No bugs reported."]

    lines += ["", "### Tests added", ""]
    lines.append(f"```\n{tests_stat.strip()}\n```" if tests_stat.strip() else "None.")
    lines += ["", "### QA summary", "", result.summary.strip() or "(none)", ""]
    lines.append(f"<sub>QA agent · {result.steps} steps · {result.usage_line()}</sub>")
    return "\n".join(lines) + "\n"
