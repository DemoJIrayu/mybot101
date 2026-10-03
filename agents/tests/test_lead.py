"""End-to-end tests of the Lead flow with real git repos and scripted (fake) agents."""

import os
import subprocess

import pytest

from agent_team.agent import RunResult
from agent_team.lead import Orchestrator, dev_task_prompt, fix_prompt, format_plan
from agent_team.sandbox import Sandbox
from agent_team.tools import Bug, Finished, PlanTask, Toolbox, ToolError, parse_plan

GIT_ENV = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@t",
}


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True,
                   env={**os.environ, **GIT_ENV})  # fmt: skip


class LocalRunner:
    """Runs `docker exec ...` commands locally, mapping /workspace to a temp folder."""

    def __init__(self, root):
        self.root = str(root)

    def __call__(self, cmd, **kwargs):
        if cmd[:2] == ["docker", "inspect"]:
            return subprocess.CompletedProcess(cmd, 0, "true\n", "")
        i = cmd.index("-w")
        workdir, args = cmd[i + 1], cmd[i + 5 :]  # skip: -w DIR CONTAINER timeout N

        def m(s):
            return s.replace("/workspace", self.root)

        os.makedirs(self.root, exist_ok=True)
        cwd = m(workdir) if os.path.isdir(m(workdir)) else self.root
        return subprocess.run(
            [m(a) for a in args], cwd=cwd, input=kwargs.get("input"),
            capture_output=True, text=True, env={**os.environ, **GIT_ENV},
        )  # fmt: skip


@pytest.fixture
def origin(tmp_path):
    work = tmp_path / "seed"
    work.mkdir()
    _git(work, "init", "-q", "-b", "main")
    (work / "README.md").write_text("demo\n")
    _git(work, "add", ".")
    _git(work, "commit", "-qm", "init")
    bare = tmp_path / "origin.git"
    _git(tmp_path, "clone", "-q", "--bare", str(work), str(bare))
    return str(bare)


@pytest.fixture
def sandboxes(tmp_path):
    return {r: Sandbox(f"sbx-{r}", runner=LocalRunner(tmp_path / r)) for r in ("lead", "dev", "qa")}


PLAN = [
    {"title": "Add greet()", "description": "app/greet.py", "acceptance": "tests pass"},
    {"title": "Add shout()", "description": "app/greet.py", "acceptance": "tests pass"},
]


class Script:
    """Scripted agents. Records each task prompt so tests can inspect them."""

    def __init__(
        self, qa_bugs_per_round=(1, 0), dev_extra_files=(), qa_extra_files=(), severity="high"
    ):
        self.severity = severity
        self.prompts = []
        self.qa_round = 0
        self.qa_bugs_per_round = list(qa_bugs_per_round)
        self.dev_extra_files = dev_extra_files
        self.qa_extra_files = qa_extra_files

    def __call__(self, role, box: Toolbox, task: str) -> RunResult:
        self.prompts.append((role, task))
        try:
            if role == "lead":
                box.call("list_files", {"path": "."})
                assert box.call("write_file", {"path": "x.py", "content": "x"}).startswith("ERROR")
                box.call("submit_plan", {"tasks": PLAN})
            elif role == "dev" and task.startswith("QA tested"):
                box.call("write_file", {"path": "app/greet.py", "content": "def greet(n):\n"
                                        "    return f'hi {n}'\n\ndef shout(n):\n"
                                        "    return greet(n).upper()\n"})  # fmt: skip
                box.call("finish", {"summary": "fixed empty-name bug"})
            elif role == "dev":
                n = sum(1 for r, _ in self.prompts if r == "dev")
                body = "def greet(n):\n    return 'hi ' + n\n"
                if n >= 2:
                    body += "\ndef shout(n):\n    return greet(n).upper()\n"
                box.call("write_file", {"path": "app/greet.py", "content": body})
                for path in self.dev_extra_files:
                    box.call("write_file", {"path": path, "content": "x\n"})
                box.call("finish", {"summary": f"task {n} done"})
            elif role == "qa":
                self.qa_round += 1
                test_file = f"app/tests/test_qa_{self.qa_round}.py"
                box.call("write_file", {"path": test_file, "content": "def test_ok(): pass\n"})
                for path in self.qa_extra_files:
                    # Simulates a sneaky write through the shell, bypassing write_file.
                    box.sandbox.write_file(f"/workspace/repo/{path}", "hacked\n")
                for i in range(self.qa_bugs_per_round[self.qa_round - 1]):
                    box.call("report_bug", {"title": f"bug {i}", "severity": self.severity,
                                            "details": "greet(None) crashes"})  # fmt: skip
                box.call("finish", {"summary": f"qa round {self.qa_round}"})
        except Finished as done:
            return RunResult(True, done.summary, 3)
        return RunResult(False, "gave up", 30)


def _orchestrator(tmp_path, origin, sandboxes, script, approve=True, **kw):
    calls = {}

    def open_pr(title, body, patch_file):
        calls["pr"] = (title, body, patch_file.read_text())
        return "https://github.com/o/r/pull/9"

    orch = Orchestrator(
        "Greeting helpers",
        sandboxes=sandboxes,
        repo_url=origin,
        run_agent=script,
        summarize=lambda prompt: (
            calls.setdefault("summary_prompt", prompt)
            and "## Summary\n- x\nVerdict: ready for review"
        ),
        approve=lambda plan: calls.setdefault("plan", plan) is not None and approve,
        open_pr=open_pr,
        runs_dir=tmp_path / "runs",
        log=lambda _: None,
        **kw,
    )
    return orch, calls


def test_full_flow_plan_dev_qa_fix_retest_pr(tmp_path, origin, sandboxes):
    script = Script(qa_bugs_per_round=(1, 0))
    orch, calls = _orchestrator(tmp_path, origin, sandboxes, script)
    out = orch.run()

    assert out.status == "pr_opened" and out.pr_url.endswith("/9") and not out.open_bugs
    assert [r for r, _ in script.prompts] == ["lead", "dev", "dev", "qa", "dev", "qa"]
    assert "1. Add greet()" in calls["plan"]

    # Task 2 sees task 1's summary; QA round 2 is told what was reported before.
    assert "task 1 done" in script.prompts[2][1]
    assert "re-test round 1" in script.prompts[5][1] and "bug 0" in script.prompts[5][1]

    title, body, patch = calls["pr"]
    assert title == "agent(lead): Greeting helpers"
    assert "Verdict: ready for review" in body and "Plan approved by a human" in body
    # The final patch has Dev's fixed code AND both rounds of QA tests.
    assert "return greet(n).upper()" in patch and "f'hi {n}'" in patch
    assert "app/tests/test_qa_1.py" in patch and "app/tests/test_qa_2.py" in patch
    assert (out.run_dir / "plan.md").exists() and (out.run_dir / "qa-round-2.md").exists()


def test_rejected_plan_changes_nothing(tmp_path, origin, sandboxes):
    script = Script()
    orch, calls = _orchestrator(tmp_path, origin, sandboxes, script, approve=False)
    out = orch.run()
    assert out.status == "aborted" and "pr" not in calls
    assert [r for r, _ in script.prompts] == ["lead"]


def test_bugs_left_after_last_round_still_open_pr_flagged(tmp_path, origin, sandboxes):
    script = Script(qa_bugs_per_round=(1, 1))
    orch, calls = _orchestrator(tmp_path, origin, sandboxes, script, max_fix_rounds=1)
    out = orch.run()
    assert out.status == "pr_opened" and len(out.open_bugs) == 1
    assert "Blocking (critical/high) bugs still open: 1" in calls["summary_prompt"]


def test_protected_paths_block_the_pr(tmp_path, origin, sandboxes):
    script = Script(qa_bugs_per_round=(0,), dev_extra_files=(".github/workflows/x.yml",))
    orch, calls = _orchestrator(tmp_path, origin, sandboxes, script)
    out = orch.run()
    assert out.status == "blocked" and "pr" not in calls
    assert ".github/workflows/x.yml" in out.message


def test_qa_changes_to_app_code_are_discarded(tmp_path, origin, sandboxes):
    script = Script(qa_bugs_per_round=(0,), qa_extra_files=("app/greet.py",))
    orch, calls = _orchestrator(tmp_path, origin, sandboxes, script)
    out = orch.run()
    assert out.status == "pr_opened"
    patch = calls["pr"][2]
    assert "hacked" not in patch and "test_qa_1.py" not in patch


def test_unfinished_dev_task_stops_without_pr(tmp_path, origin, sandboxes):
    def run_agent(role, box, task):
        if role == "lead":
            try:
                box.call("submit_plan", {"tasks": PLAN})
            except Finished as done:
                return RunResult(True, done.summary, 1)
        return RunResult(False, "Stopped after reaching the limit of 30 steps.", 30)

    orch, calls = _orchestrator(tmp_path, origin, sandboxes, run_agent)
    out = orch.run()
    assert out.status == "dev_incomplete" and "pr" not in calls
    assert (out.run_dir / "partial.patch").exists()


# ---- plan parsing and prompts -------------------------------------------------


def test_parse_plan_validates():
    assert parse_plan(PLAN)[0] == PlanTask("Add greet()", "app/greet.py", "tests pass")
    for bad in ([], [{}] * 6, "x", [{"title": "t", "description": "", "acceptance": "a"}]):
        with pytest.raises(ToolError):
            parse_plan(bad)


def test_submit_plan_only_for_planner():
    box = Toolbox(Sandbox("s", runner=LocalRunner("/tmp")))
    assert box.call("submit_plan", {"tasks": PLAN}).startswith("ERROR: unknown tool")
    planner = Toolbox(Sandbox("s", runner=LocalRunner("/tmp")), planning=True)
    names = [s["function"]["name"] for s in planner.specs]
    assert "submit_plan" in names and "finish" not in names


def test_prompts():
    plan = parse_plan(PLAN)
    text = dev_task_prompt("Goal", plan, 1, [])
    assert "task 1 of 2" in text and "do NOT do these now): Add shout()" in text
    assert "Remove the xfail" in fix_prompt("Goal", [Bug("b", "high", "d", "f.py")])
    assert format_plan("G", plan).startswith("Goal: G\n\n1. Add greet()")


def test_minor_bugs_do_not_send_work_back_to_dev(tmp_path, origin, sandboxes):
    script = Script(qa_bugs_per_round=(2,), severity="medium")
    orch, calls = _orchestrator(tmp_path, origin, sandboxes, script)
    out = orch.run()
    assert [r for r, _ in script.prompts] == ["lead", "dev", "dev", "qa"]  # no fix round
    assert out.status == "pr_opened" and len(out.open_bugs) == 2
    assert "blocking" not in out.message
    assert "minor (medium/low) bugs listed for a human: 2" in calls["summary_prompt"]


def test_fix_prompt_lists_only_blocking_bugs_with_safe_numbering():
    from agent_team.lead import blocking

    bugs = [Bug("crash", "critical", "d"), Bug("ugly", "low", "d"), Bug("wrong", "high", "d")]
    must = blocking(bugs)
    assert [b.title for b in must] == ["crash", "wrong"]
    text = fix_prompt("G", must)
    assert "Bug 1 [critical] crash" in text and "Bug 2 [high] wrong" in text
    assert "#1" not in text and "ugly" not in text


def test_lead_flow_reports_live_status_for_the_office(tmp_path, origin, sandboxes):
    from agent_team.status import StatusBoard

    board = StatusBoard(tmp_path / "status.json")
    script = Script(qa_bugs_per_round=(1, 0))
    orch, _ = _orchestrator(tmp_path, origin, sandboxes, script, board=board)
    assert orch.run().status == "pr_opened"
    events = [(e["role"], e["state"]) for e in board.read()["events"]]
    for expected in [
        ("lead", "working"),
        ("lead", "waiting"),
        ("dev", "working"),
        ("qa", "working"),
        ("dev", "meeting"),
        ("lead", "meeting"),
    ]:
        assert expected in events, expected
    # Plan approval comes before any Dev work.
    assert events.index(("lead", "waiting")) < events.index(("dev", "working"))
    # Everyone is idle when the run is over.
    assert {a["state"] for a in board.read()["agents"].values()} == {"idle"}


# ---- resume a stopped run -----------------------------------------------------


def _stops_mid_task_1(role, box, task):
    """Lead plans; Dev writes half of task 1, then runs out of steps."""
    try:
        if role == "lead":
            box.call("submit_plan", {"tasks": PLAN})
        box.call("write_file", {"path": "app/greet.py", "content": "def greet(n):  # WIP\n"})
    except Finished as done:
        return RunResult(True, done.summary, 1)
    return RunResult(False, "Stopped after reaching the limit of 30 steps.", 30)


def test_resume_continues_without_replanning(tmp_path, origin, sandboxes):
    from agent_team.lead import CONTINUE_NOTE, load_resume

    first, _ = _orchestrator(tmp_path, origin, sandboxes, _stops_mid_task_1)
    out = first.run()
    assert out.status == "dev_incomplete" and "--resume" in out.message
    assert "# WIP" in (out.run_dir / "partial.patch").read_text()

    goal, resume = load_resume(out.run_dir)
    assert goal == "Greeting helpers" and resume.start_task == 1 and "# WIP" in resume.patch

    script = Script(qa_bugs_per_round=(0,))
    approvals = []
    second, calls = _orchestrator(tmp_path, origin, sandboxes, script, resume=resume)
    second.approve = lambda plan: approvals.append(plan) or True
    result = second.run()

    assert result.status == "pr_opened"
    assert [r for r, _ in script.prompts] == ["dev", "dev", "qa"]  # no Lead planning
    assert approvals == []  # the plan was already approved
    assert script.prompts[0][1].endswith(CONTINUE_NOTE)  # Dev told to continue, not restart
    assert CONTINUE_NOTE not in script.prompts[1][1]


def test_resume_from_task_2_counts_task_1_as_done(tmp_path, origin, sandboxes):
    from agent_team.lead import load_resume

    first, _ = _orchestrator(tmp_path, origin, sandboxes, _stops_mid_task_1)
    run_dir = first.run().run_dir
    _, resume = load_resume(run_dir, from_task=2)
    assert resume.start_task == 2 and resume.done[0][0] == "Add greet()"

    script = Script(qa_bugs_per_round=(0,))
    second, _ = _orchestrator(tmp_path, origin, sandboxes, script, resume=resume)
    assert second.run().status == "pr_opened"
    dev_prompt = script.prompts[0][1]
    assert "task 2 of 2" in dev_prompt and "Earlier tasks, already done" in dev_prompt


def test_resume_from_an_older_run_with_only_plan_md(tmp_path):
    from agent_team.lead import load_resume

    run_dir = tmp_path / "old-run"
    run_dir.mkdir()
    plan = [
        PlanTask(
            "Scaffold web/", "Create a Next.js app\nin web/ with TypeScript", "npm test passes"
        ),
        PlanTask("Add form", "page.tsx with a form", "Playwright test\ncovers the form"),
    ]
    (run_dir / "plan.md").write_text(format_plan("Build the calc page", plan) + "\n")
    (run_dir / "partial.patch").write_text("diff --git a/x b/x\n")

    goal, resume = load_resume(run_dir)
    assert goal == "Build the calc page" and resume.plan == plan
    assert resume.start_task == 1 and resume.patch.startswith("diff --git")
    with pytest.raises(ValueError):
        load_resume(run_dir, from_task=3)
    with pytest.raises(FileNotFoundError):
        load_resume(tmp_path / "missing")


def test_dev_is_shown_working_in_the_office_during_its_tasks(tmp_path, origin, sandboxes):
    from agent_team.status import StatusBoard

    board = StatusBoard(tmp_path / "status.json")
    script = Script(qa_bugs_per_round=(0,))
    orch, _ = _orchestrator(tmp_path, origin, sandboxes, script, board=board)
    orch.run()
    events = [(e["role"], e["state"], e["task"]) for e in board.read()["events"]]
    assert ("dev", "working", "งาน 1/2: Add greet()") in events
    assert ("dev", "working", "งาน 2/2: Add shout()") in events
