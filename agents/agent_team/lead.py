"""The Lead: plan a goal, run Dev on each task, have QA test the result, loop fixes, open a PR.

Approval model (option A): the human approves the plan once. After that the Lead runs
Dev and QA on its own and opens ONE pull request for the whole goal. The human still
reviews and merges that PR, and the DevSecOps pipeline checks it.

Everything an agent touches happens in its own sandbox. Changes move between sandboxes
as patches, and only the final, policy-checked patch ever reaches your machine.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from agent_team.agent import RunResult
from agent_team.github import PullRequest
from agent_team.qa import WRITE_RULE, build_qa_task, build_report
from agent_team.sandbox import Sandbox
from agent_team.status import NullBoard, StatusBoard
from agent_team.tools import Bug, PlanTask, Toolbox, is_test_path
from agent_team.workspace import (
    PROTECTED_PREFIXES,
    apply_patch,
    collect_diff,
    commit_all,
    disallowed_changes,
    load_tree,
)

RunAgent = Callable[[str, Toolbox, str], RunResult]

# Only these send work back to Dev; medium/low bugs are listed in the PR for a human.
BLOCKING_SEVERITIES = ("critical", "high")


def blocking(bugs: list[Bug]) -> list[Bug]:
    return [b for b in bugs if b.severity in BLOCKING_SEVERITIES]


@dataclass
class LeadOutcome:
    status: str  # pr_opened | aborted | no_plan | dev_incomplete | no_changes | blocked
    message: str
    plan: list[PlanTask] = field(default_factory=list)
    open_bugs: list[Bug] = field(default_factory=list)
    pr_url: str = ""
    run_dir: Path | None = None


def format_plan(goal: str, plan: list[PlanTask]) -> str:
    lines = [f"Goal: {goal}", ""]
    for i, task in enumerate(plan, 1):
        lines += [
            f"{i}. {task.title}",
            f"   What: {task.description}",
            f"   Done when: {task.acceptance}",
        ]
    return "\n".join(lines)


def dev_task_prompt(
    goal: str, plan: list[PlanTask], index: int, done: list[tuple[PlanTask, RunResult]]
) -> str:
    task = plan[index - 1]
    parts = [
        f"Overall goal: {goal}",
        f"You are doing task {index} of {len(plan)}: {task.title}",
        f"What to do:\n{task.description}",
        f"Acceptance criteria:\n{task.acceptance}",
    ]
    if done:
        earlier = "\n".join(f"- {t.title}: {r.summary.strip()[:600]}" for t, r in done)
        parts.append(f"Earlier tasks, already done in this same workspace:\n{earlier}")
    later = [t.title for t in plan[index:]]
    if later:
        parts.append("Later tasks (do NOT do these now): " + "; ".join(later))
    return "\n\n".join(parts)


def _bug_list(bugs: list[Bug]) -> str:
    return "\n".join(
        f"Bug {i} [{b.severity}] {b.title}"
        + (f" ({b.file})" if b.file else "")
        + f"\n   {b.details}"
        for i, b in enumerate(bugs, 1)
    )


def fix_prompt(goal: str, bugs: list[Bug]) -> str:
    return (
        f"QA tested the team's change for this goal: {goal}\n\n"
        f"QA found these blocking (critical/high) bugs:\n{_bug_list(bugs)}\n\n"
        "QA's tests are now in your workspace. Tests that expose these bugs are marked as "
        'expected failures (@pytest.mark.xfail(strict=True, reason="BUG: ...") or '
        "test.fail(...) in Playwright).\n"
        "1. Fix the application code so these bugs are gone.\n"
        "2. Remove the xfail / test.fail marker from each test whose bug you fixed, so it "
        "runs normally.\n"
        "3. Do not delete or weaken QA's tests. If you believe a report is wrong, leave the "
        "test as it is and explain why in your summary.\n"
        "4. Fix them simply and without weakening any safeguard (see your rules); if the "
        "right fix is to reject an input with a clear error, do that.\n"
        "5. Run the full test suite and the linter; both must pass. Then call finish with "
        "what you fixed."
    )


def retest_note(round_no: int, earlier: list[Bug]) -> str:
    if round_no == 0:
        return ""
    return (
        f"This is re-test round {round_no}. Bugs reported earlier, which Dev tried to fix:\n"
        f"{_bug_list(earlier)}\n\n"
        "Check each one is really fixed (its test passes with no xfail marker) and look for "
        "regressions. Don't duplicate tests that already exist; add only what's missing. "
        "Report a bug again only if it is still present."
    )


def summary_prompt(
    goal: str,
    plan: list[PlanTask],
    done: list[tuple[PlanTask, RunResult]],
    qa_report: str,
    stat: str,
    open_bugs: list[Bug],
) -> str:
    dev = "\n".join(f"- {t.title}: {r.summary.strip()[:800]}" for t, r in done)
    return (
        f"Goal: {goal}\n\nPlan:\n{format_plan(goal, plan)}\n\nDev results:\n{dev}\n\n"
        f"Final QA report:\n{qa_report}\n\nFiles changed:\n{stat}\n\n"
        f"Blocking (critical/high) bugs still open: {len(blocking(open_bugs))}; "
        f"minor (medium/low) bugs listed for a human: "
        f"{len(open_bugs) - len(blocking(open_bugs))}\n\n"
        "Write the pull request description in Markdown with these sections: "
        "'## Summary' (3-6 bullets of what changed), '## How it was verified' "
        "(tests and QA), '## Open issues' (open bugs or risks, or 'None'). End with "
        "exactly one line: 'Verdict: ready for review' or 'Verdict: needs human "
        "attention' (use the second if any bug is open or anything is unfinished). "
        "Be factual and brief; don't invent results."
    )


def fallback_summary(open_bugs: list[Bug]) -> str:
    verdict = "needs human attention" if blocking(open_bugs) else "ready for review"
    return (
        "## Summary\n\nSee the plan and QA report below.\n\n"
        f"## Open issues\n\n{_bug_list(open_bugs) or 'None'}\n\nVerdict: {verdict}\n"
    )


CONTINUE_NOTE = (
    "\n\nNOTE: a previous attempt at this task ran out of steps. Its unfinished work is "
    "already in this workspace as uncommitted changes (see `git status` and `git diff`). "
    "Don't start over: review what's there, finish the remaining parts, run the tests and "
    "the linter, then call finish."
)


@dataclass
class ResumeState:
    """What a stopped Lead run left behind, so a new run can carry on from there."""

    plan: list[PlanTask]
    start_task: int  # 1-based task to continue with
    done: list[tuple[str, str]] = field(default_factory=list)  # (title, Dev's summary)
    patch: str = ""  # Dev's unfinished work
    from_dir: str = ""
    repo: str = ""  # owner/repo the run was for ("" = the agent-team repo itself)


def parse_plan_md(text: str) -> tuple[str, list[PlanTask]]:
    """Read a plan.md written by format_plan() back into (goal, tasks)."""
    goal_match = re.search(r"^Goal: (.+)$", text, re.M)
    if not goal_match:
        raise ValueError("plan.md has no 'Goal:' line")
    tasks = []
    task_re = re.compile(
        r"^(\d+)\. (.+)\n"  # "1. Title"
        r"   What: (.*(?:\n(?!   Done when: ).*)*)\n"  # description, may span lines
        r"   Done when: (.*(?:\n(?!\d+\. ).*)*)",  # acceptance, until the next task
        re.M,
    )
    for m in task_re.finditer(text):
        tasks.append(PlanTask(m.group(2).strip(), m.group(3).strip(), m.group(4).strip()))
    if not tasks:
        raise ValueError("plan.md has no tasks")
    return goal_match.group(1).strip(), tasks


def load_resume(run_dir: Path, from_task: int | None = None) -> tuple[str, ResumeState]:
    """Load (goal, ResumeState) from a stopped run's folder (state.json or plan.md)."""
    run_dir = Path(run_dir)
    state_file = run_dir / "state.json"
    if state_file.is_file():
        state = json.loads(state_file.read_text(encoding="utf-8"))
        goal = state["goal"]
        plan = [PlanTask(**t) for t in state["plan"]]
        next_task = int(state.get("next_task", 1))
        done = [(d["title"], d["summary"]) for d in state.get("done", [])]
        repo = state.get("repo", "")
    elif (run_dir / "plan.md").is_file():
        goal, plan = parse_plan_md((run_dir / "plan.md").read_text(encoding="utf-8"))
        next_task, done, repo = 1, [], ""
    else:
        raise FileNotFoundError(f"no state.json or plan.md in {run_dir}")

    start = from_task or next_task
    if not 1 <= start <= len(plan):
        raise ValueError(f"task {start} doesn't exist; the plan has {len(plan)} task(s)")
    # Tasks before `start` count as done; keep real summaries where we have them.
    known = dict(done)
    done = [(t.title, known.get(t.title, "Done in an earlier run.")) for t in plan[: start - 1]]
    patch_file = run_dir / "partial.patch"
    patch = patch_file.read_text(encoding="utf-8") if patch_file.is_file() else ""
    return goal, ResumeState(plan, start, done, patch, str(run_dir), repo)


class Orchestrator:
    def __init__(
        self,
        goal: str,
        *,
        sandboxes: dict[str, Sandbox],
        tree: bytes,
        run_agent: RunAgent,
        summarize: Callable[[str], str],
        approve: Callable[[str], bool],
        open_pr: Callable[[str, str, Path], str],
        runs_dir: Path,
        max_fix_rounds: int = 2,
        log: Callable[[str], None] = print,
        board: StatusBoard | None = None,
        resume: ResumeState | None = None,
        protected: tuple[str, ...] = PROTECTED_PREFIXES,
        repo: str = "",
    ):
        self.goal = goal.strip()
        self.sb = sandboxes
        self.tree = tree  # the code to work on, as a tar archive (no .git, no credentials)
        self.protected = protected
        self.repo = repo
        self.tag = f"[{repo.split('/')[-1]}] " if repo else ""
        self.run_agent = run_agent
        self.summarize = summarize
        self.approve = approve
        self.open_pr = open_pr
        self.max_fix_rounds = max(0, max_fix_rounds)
        self.log = log
        self.board = board or NullBoard()
        self.resume = resume
        suffix = f"-{repo.split('/')[-1]}" if repo else ""
        self.run_dir = runs_dir / f"{time.strftime('%Y%m%d-%H%M%S')}-lead{suffix}"

    def _save(self, name: str, text: str) -> Path:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        path = self.run_dir / name
        path.write_text(text, encoding="utf-8")
        return path

    def _save_state(self, plan: list[PlanTask], next_task: int, done) -> None:
        state = {
            "goal": self.goal,
            "plan": [t.__dict__ for t in plan],
            "next_task": next_task,
            "repo": self.repo,
            "done": [{"title": t.title, "summary": r.summary} for t, r in done],
        }
        self._save("state.json", json.dumps(state, ensure_ascii=False, indent=1))

    def _outcome(self, status: str, message: str, **kw) -> LeadOutcome:
        self.log(f"\n■ {message}")
        return LeadOutcome(status, message, run_dir=self.run_dir, **kw)

    # -- phases ---------------------------------------------------------------

    def plan(self) -> tuple[list[PlanTask], RunResult]:
        self.log("▶ Lead is planning ...")
        load_tree(self.sb["lead"], self.tree)
        box = Toolbox(
            self.sb["lead"],
            can_write=lambda _path: False,
            write_rule="The Lead only plans; Dev writes the code.",
            planning=True,
        )
        with self.board.state("lead", "working", f"{self.tag}วางแผน: {self.goal}"):
            result = self.run_agent("lead", box, f"Goal: {self.goal}")
        return box.plan, result

    def run_qa(
        self, stat: str, patch: str, plan_text: str, round_no: int, earlier: list[Bug]
    ) -> tuple[Toolbox, RunResult, str, str]:
        """QA tests the dev patch in its own sandbox. Returns (toolbox, result, stat, patch)."""
        qa_sb = self.sb["qa"]
        load_tree(qa_sb, self.tree)
        apply_patch(qa_sb, patch)
        commit_all(qa_sb, "team change under test")
        change = PullRequest(0, self.goal, plan_text, "OPEN", "", "main", False, "")
        task = build_qa_task(change, stat, patch, retest_note(round_no, earlier))
        box = Toolbox(qa_sb, can_write=is_test_path, write_rule=WRITE_RULE, bug_reports=True)
        label = f"{self.tag}ทดสอบรอบ {round_no + 1}: {self.goal}"
        with self.board.state("qa", "working", label):
            result = self.run_agent("qa", box, task)
        names, qa_stat, qa_patch = collect_diff(qa_sb)
        blocked = disallowed_changes("qa", names, False, self.protected)
        if blocked:
            self.log(
                "⛔ QA changed non-test files; its changes are discarded: " + ", ".join(blocked)
            )
            return box, result, "", ""
        return box, result, qa_stat, qa_patch

    # -- main flow ------------------------------------------------------------

    def run(self) -> LeadOutcome:
        try:
            return self._run()
        finally:
            self.board.all_idle()

    def _meeting(self, topic: str) -> None:
        for role in ("lead", "dev", "qa"):
            self.board.set(role, "meeting", topic)

    def _run(self) -> LeadOutcome:
        resume = self.resume
        if resume is None:
            plan, lead_result = self.plan()
            if not plan:
                return self._outcome("no_plan", f"The Lead produced no plan: {lead_result.summary}")
            plan_text = format_plan(self.goal, plan)
            self._save("plan.md", plan_text + "\n")
            self.board.set("lead", "waiting", "รออนุมัติแผนงาน")
            approved = self.approve(plan_text)
            self.board.set("lead", "idle")
            if not approved:
                return self._outcome(
                    "aborted", "Plan not approved; nothing was changed.", plan=plan
                )
            start = 1
            done: list[tuple[PlanTask, RunResult]] = []
        else:
            # The plan was already approved in the earlier run: no planning, no approval.
            plan = resume.plan
            plan_text = format_plan(self.goal, plan)
            self._save("plan.md", plan_text + "\n")
            start = resume.start_task
            done = [(PlanTask(t, "", ""), RunResult(True, s, 0)) for t, s in resume.done]
            self.log(
                f"▶ Resuming {resume.from_dir or 'earlier run'}: approved plan, "
                f"continuing at task {start}/{len(plan)}"
                + (" with the unfinished work restored" if resume.patch.strip() else "")
            )
        self._save_state(plan, start, done)

        dev_sb = self.sb["dev"]
        load_tree(dev_sb, self.tree)
        if resume is not None:
            apply_patch(dev_sb, resume.patch)
        for i in range(start, len(plan) + 1):
            task = plan[i - 1]
            self.log(f"\n▶ Dev task {i}/{len(plan)}: {task.title}")
            prompt = dev_task_prompt(self.goal, plan, i, done)
            if resume is not None and i == start and resume.patch.strip():
                prompt += CONTINUE_NOTE
            with self.board.state("dev", "working", f"{self.tag}งาน {i}/{len(plan)}: {task.title}"):
                result = self.run_agent("dev", Toolbox(dev_sb), prompt)
            if not result.finished:
                _, _, patch = collect_diff(dev_sb)
                self._save("partial.patch", patch)
                self._save_state(plan, i, done)
                return self._outcome(
                    "dev_incomplete",
                    f"Dev didn't finish task {i} ({result.summary}). No PR opened; partial "
                    f"work saved in {self.run_dir / 'partial.patch'}. Continue with: "
                    f"python -m agent_team lead --resume {self.run_dir}",
                    plan=plan,
                )
            done.append((task, result))
            self._save_state(plan, i + 1, done)

        report, bugs, earlier = "", [], []
        for round_no in range(self.max_fix_rounds + 1):
            names, stat, patch = collect_diff(dev_sb)
            if not names:
                return self._outcome("no_changes", "Dev made no changes.", plan=plan)
            self.log(f"\n▶ QA round {round_no + 1}")
            qa_box, qa_result, qa_stat, qa_patch = self.run_qa(
                stat, patch, plan_text, round_no, earlier
            )
            change = PullRequest(0, self.goal, "", "OPEN", "", "main", False, "")
            report = build_report(change, qa_result, qa_box.bugs, qa_stat)
            self._save(f"qa-round-{round_no + 1}.md", report)
            apply_patch(dev_sb, qa_patch)  # QA's tests become part of the change
            bugs = qa_box.bugs
            must_fix = blocking(bugs)
            if not must_fix:
                minor = f" ({len(bugs)} minor issue(s) listed in the PR)" if bugs else ""
                self.log(f"✓ QA found no blocking bugs{minor}")
                break
            if round_no == self.max_fix_rounds:
                self.log(
                    f"⚠️  {len(must_fix)} blocking bug(s) still open after {round_no} fix round(s)"
                )
                break
            self.log(f"\n▶ Dev fixing {len(must_fix)} blocking bug(s) (round {round_no + 1})")
            self._meeting(f"QA ส่งบั๊ก {len(must_fix)} ข้อให้ Dev")
            self.board.set("lead", "idle")
            self.board.set("qa", "idle")
            with self.board.state("dev", "working", f"{self.tag}แก้บั๊กรอบ {round_no + 1}"):
                fix = self.run_agent("dev", Toolbox(dev_sb), fix_prompt(self.goal, must_fix))
            done.append((PlanTask(f"Fix QA round {round_no + 1}", "", ""), fix))
            earlier = must_fix

        names, stat, patch = collect_diff(dev_sb)
        blocked = disallowed_changes("dev", names, False, self.protected)
        patch_file = self._save("final.patch", patch)
        if blocked:
            return self._outcome(
                "blocked",
                "The change touches protected paths, so no PR was opened: " + ", ".join(blocked),
                plan=plan,
                open_bugs=bugs,
            )

        self._meeting("สรุปงานก่อนเปิด PR")
        try:
            description = self.summarize(
                summary_prompt(self.goal, plan, done, report, stat, bugs)
            ).strip()
        except Exception as exc:  # the PR still matters more than a nice description
            self.log(f"(summary failed: {exc}; using a plain description)")
            description = ""
        description = description or fallback_summary(bugs)
        body = (
            f"{description}\n\n<details><summary>Plan approved by a human</summary>\n\n"
            f"```\n{plan_text}\n```\n</details>\n\n{report}\n"
            "_Generated by the Lead, Dev and QA agents. Review before merging._"
        )
        self._save("pr-body.md", body)
        title = f"agent(lead): {self.goal.splitlines()[0]}"[:72]
        url = self.open_pr(title, body, patch_file)
        status_note = f" with {len(blocking(bugs))} blocking bug(s) open" if blocking(bugs) else ""
        return self._outcome(
            "pr_opened", f"Pull request opened{status_note}: {url}", plan=plan,
            open_bugs=bugs, pr_url=url,
        )  # fmt: skip
