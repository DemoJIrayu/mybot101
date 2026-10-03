import subprocess

import pytest

from agent_team.agent import RunResult
from agent_team.cli import disallowed_changes
from agent_team.github import parse_pr
from agent_team.qa import build_qa_task, build_report, prepare_pr_workspace
from agent_team.sandbox import Sandbox
from agent_team.tools import Bug, Toolbox, is_test_path


def _pr(**overrides):
    data = {
        "number": 3,
        "title": "Add calc",
        "body": "adds add/divide",
        "state": "OPEN",
        "headRefName": "agent/dev-1",
        "baseRefName": "main",
        "isCrossRepository": False,
        "url": "https://github.com/o/r/pull/3",
    }
    data.update(overrides)
    return parse_pr(data)


class FakeRunner:
    def __init__(self, returncode=0, stdout=""):
        self.calls = []
        self.returncode = returncode
        self.stdout = stdout

    def __call__(self, cmd, **kwargs):
        self.calls.append(cmd)
        return subprocess.CompletedProcess(cmd, self.returncode, self.stdout, "")


# ---- write policy -------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "apps/calc/tests/test_calc.py",
        "apps/calc/tests/helpers.py",
        "test_root.py",
        "pkg/foo_test.py",
        "apps/calc/conftest.py",
        "web/src/button.test.tsx",
        "web/e2e/home.spec.ts",
        "web/__tests__/util.js",
        "web/playwright.config.ts",
        "web/package.json",
        "web/package-lock.json",
    ],
)
def test_test_files_are_allowed(path):
    assert is_test_path(path)


@pytest.mark.parametrize(
    "path",
    [
        "apps/calc/calc/core.py",
        "web/src/app/page.tsx",
        "apps/calc/pyproject.toml",
        "testing.py",
        "contest.py",
        "web/next.config.js",
        "README.md",
    ],
)
def test_app_files_are_not_allowed(path):
    assert not is_test_path(path)


def test_qa_toolbox_refuses_app_code_but_writes_tests():
    runner = FakeRunner()
    box = Toolbox(Sandbox("sbx", runner=runner), can_write=is_test_path, write_rule="tests only")
    refused = box.call("write_file", {"path": "apps/calc/calc/core.py", "content": "x"})
    assert refused.startswith("ERROR: not allowed") and "tests only" in refused
    assert runner.calls == []
    ok = box.call("write_file", {"path": "apps/calc/tests/test_x.py", "content": "x"})
    assert ok.startswith("wrote")


def test_diff_level_policy_catches_writes_made_via_shell():
    paths = ["apps/calc/tests/test_more.py", "apps/calc/calc/core.py", "infra/x.yml"]
    assert disallowed_changes("qa", paths, allow_protected=False) == [
        "infra/x.yml",
        "apps/calc/calc/core.py",
    ]
    # --allow-protected never lets QA change application code.
    assert disallowed_changes("qa", paths, allow_protected=True) == [
        "apps/calc/calc/core.py",
        "infra/x.yml",
    ]
    assert disallowed_changes("dev", paths, allow_protected=False) == ["infra/x.yml"]


# ---- report_bug tool ----------------------------------------------------------


def test_report_bug_records_and_validates():
    box = Toolbox(Sandbox("sbx", runner=FakeRunner()), bug_reports=True)
    assert any(s["function"]["name"] == "report_bug" for s in box.specs)
    out = box.call(
        "report_bug", {"title": "divide(1, 0.0) passes", "severity": "HIGH", "details": "d"}
    )
    assert out == "recorded bug #1"
    assert box.bugs == [Bug("divide(1, 0.0) passes", "high", "d", "")]
    assert box.call("report_bug", {"title": "x", "severity": "meh", "details": "d"}).startswith(
        "ERROR"
    )
    assert box.call("report_bug", {"title": " ", "severity": "low", "details": "d"}).startswith(
        "ERROR"
    )


def test_report_bug_unavailable_to_dev():
    box = Toolbox(Sandbox("sbx", runner=FakeRunner()))
    assert all(s["function"]["name"] != "report_bug" for s in box.specs)
    out = box.call("report_bug", {"title": "t", "severity": "low", "details": "d"})
    assert out.startswith("ERROR: unknown tool")


# ---- pull request handling ----------------------------------------------------


@pytest.mark.parametrize(
    "overrides, target",
    [
        ({"state": "MERGED"}, "main"),
        ({"state": "OPEN"}, "agent/dev-1"),
        ({"state": "OPEN", "isCrossRepository": True}, None),
        ({"state": "CLOSED"}, None),
    ],
)
def test_follow_up_pr_target(overrides, target):
    assert _pr(**overrides).test_branch_target() == target


def test_merged_pr_checks_out_base_and_diffs_pr():
    runner = FakeRunner(stdout="diff output")
    stat, diff = prepare_pr_workspace(Sandbox("sbx", runner=runner), "URL", _pr(state="MERGED"))
    cmds = [c[c.index("timeout") + 2 :] for c in runner.calls]
    fetch = next(c for c in cmds if c[:2] == ["git", "fetch"])
    assert "+refs/pull/3/head:refs/heads/pr-3" in fetch
    assert ["git", "checkout", "--quiet", "--detach", "origin/main"] in cmds
    assert ["git", "diff", "origin/main...pr-3"] in cmds
    assert stat == diff == "diff output"


def test_open_pr_checks_out_pr_head():
    runner = FakeRunner()
    prepare_pr_workspace(Sandbox("sbx", runner=runner), "URL", _pr())
    cmds = [c[c.index("timeout") + 2 :] for c in runner.calls]
    assert ["git", "checkout", "--quiet", "--detach", "pr-3"] in cmds


def test_workspace_failure_is_raised():
    with pytest.raises(RuntimeError, match="failed in the sandbox"):
        prepare_pr_workspace(Sandbox("sbx", runner=FakeRunner(returncode=1)), "URL", _pr())


def test_qa_task_includes_pr_and_truncates_huge_diff():
    task = build_qa_task(_pr(), "1 file changed", "+" * 50_000, "focus on floats")
    assert "#3: Add calc" in task and "focus on floats" in task
    assert "diff truncated" in task and len(task) < 45_000


def test_report_orders_bugs_by_severity_and_escapes_pipes():
    result = RunResult(finished=True, summary="Risk: medium", steps=9, prompt_tokens=1)
    bugs = [
        Bug("minor | thing", "low", "details low", ""),
        Bug("crash on str", "critical", "details crit", "calc/core.py"),
    ]
    report = build_report(_pr(), result, bugs, " tests/test_more.py | 20 +\n")
    assert report.index("crash on str") < report.index("minor \\| thing")
    assert "🔴 critical" in report and "`calc/core.py`" in report
    assert "Bugs found: 2" in report and "test_more.py" in report and "Risk: medium" in report


def test_report_flags_unfinished_run():
    result = RunResult(finished=False, summary="Stopped after 40 steps.", steps=40)
    report = build_report(_pr(), result, [], "")
    assert "did not finish" in report and "No bugs reported." in report
