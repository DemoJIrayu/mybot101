"""Tools the model can call. All file paths are confined to the repo in the sandbox."""

from __future__ import annotations

import posixpath
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from agent_team.sandbox import WORKDIR, Sandbox

MAX_OUTPUT = 12_000  # characters returned to the model per tool call


class ToolError(Exception):
    pass


@dataclass(frozen=True)
class Bug:
    title: str
    severity: str
    details: str
    file: str = ""


SEVERITIES = ("critical", "high", "medium", "low")

# Test-only write policy for the QA agent.
_TEST_DIRS = {"tests", "test", "__tests__", "e2e"}
_TEST_FILE = re.compile(
    r"^(test_.*\.py|.*_test\.py|conftest\.py"
    r"|.*\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)"
    r"|playwright\.config\.(ts|js|mjs|cjs)"
    r"|package\.json|package-lock\.json)$"
)


def is_test_path(rel_path: str) -> bool:
    """True for files the QA agent may create or edit (tests and test tooling only)."""
    parts = rel_path.strip("/").split("/")
    return bool(_TEST_DIRS.intersection(parts[:-1])) or bool(_TEST_FILE.match(parts[-1]))


class Finished(Exception):
    def __init__(self, summary: str):
        super().__init__(summary)
        self.summary = summary


def resolve_path(path: str) -> str:
    """Map a model-supplied path to an absolute path inside the repo, or refuse."""
    if not isinstance(path, str) or not path.strip():
        raise ToolError("path must be a non-empty string")
    full = posixpath.normpath(posixpath.join(WORKDIR, path.strip()))
    if full != WORKDIR and not full.startswith(WORKDIR + "/"):
        raise ToolError(f"path {path!r} is outside the repository")
    if ".git" in full[len(WORKDIR) :].split("/"):
        raise ToolError("the .git directory is off limits")
    return full


def truncate(text: str, limit: int = MAX_OUTPUT) -> str:
    if len(text) <= limit:
        return text
    half = limit // 2
    cut = len(text) - limit
    return f"{text[:half]}\n... [{cut} characters cut] ...\n{text[-half:]}"


def _fn(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        },
    }


_PATH = {"type": "string", "description": "Path relative to the repository root"}

TOOL_SPECS: list[dict[str, Any]] = [
    _fn(
        "list_files",
        "List files under a directory (git-tracked and new files, max 300).",
        {"path": {**_PATH, "default": "."}},
        [],
    ),
    _fn("read_file", "Read a text file.", {"path": _PATH}, ["path"]),
    _fn(
        "write_file",
        "Create or overwrite a text file with the full new content.",
        {"path": _PATH, "content": {"type": "string"}},
        ["path", "content"],
    ),
    _fn(
        "run_command",
        "Run a bash command in the repository root inside the sandbox, e.g. tests, "
        "linters, package installs. Returns exit code and output.",
        {
            "command": {"type": "string"},
            "timeout": {"type": "integer", "description": "Seconds, max 600", "default": 300},
        },
        ["command"],
    ),
    _fn(
        "finish",
        "Call when the task is done (or impossible). Summarise what changed and how it "
        "was verified.",
        {"summary": {"type": "string"}},
        ["summary"],
    ),
]


REPORT_BUG_SPEC = _fn(
    "report_bug",
    "Record a bug you found in the code under test. Call once per distinct bug, "
    "with steps or a failing test that shows it.",
    {
        "title": {"type": "string", "description": "One-line description"},
        "severity": {"type": "string", "enum": list(SEVERITIES)},
        "details": {
            "type": "string",
            "description": "What happens, what should happen, how to reproduce",
        },
        "file": {"type": "string", "description": "Main file involved, if known"},
    },
    ["title", "severity", "details"],
)


MAX_PLAN_TASKS = 5


@dataclass(frozen=True)
class PlanTask:
    title: str
    description: str
    acceptance: str


SUBMIT_PLAN_SPEC = _fn(
    "submit_plan",
    f"Submit the plan: 1 to {MAX_PLAN_TASKS} small tasks, in the order they must be done. "
    "This ends your planning.",
    {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short imperative title"},
                    "description": {
                        "type": "string",
                        "description": "What to build or change, and where (paths)",
                    },
                    "acceptance": {
                        "type": "string",
                        "description": "How we know it's done: tests, behaviour, commands",
                    },
                },
                "required": ["title", "description", "acceptance"],
            },
        }
    },
    ["tasks"],
)


def parse_plan(tasks: Any) -> list[PlanTask]:
    if not isinstance(tasks, list) or not 1 <= len(tasks) <= MAX_PLAN_TASKS:
        raise ToolError(f"tasks must be a list of 1 to {MAX_PLAN_TASKS} items")
    plan = []
    for i, task in enumerate(tasks, 1):
        if not isinstance(task, dict):
            raise ToolError(f"task {i} must be an object")
        fields = {k: str(task.get(k, "")).strip() for k in ("title", "description", "acceptance")}
        missing = [k for k, v in fields.items() if not v]
        if missing:
            raise ToolError(f"task {i} is missing: {', '.join(missing)}")
        plan.append(PlanTask(**fields))
    return plan


class Toolbox:
    def __init__(
        self,
        sandbox: Sandbox,
        *,
        can_write: Callable[[str], bool] | None = None,
        write_rule: str = "",
        bug_reports: bool = False,
        planning: bool = False,
    ):
        self.sandbox = sandbox
        self.can_write = can_write
        self.write_rule = write_rule
        self.bug_reports = bug_reports
        self.bugs: list[Bug] = []
        self.planning = planning
        self.plan: list[PlanTask] = []

    @property
    def specs(self) -> list[dict[str, Any]]:
        extra = [REPORT_BUG_SPEC] if self.bug_reports else []
        if self.planning:
            # The planner submits a plan instead of calling finish.
            base = [s for s in TOOL_SPECS if s["function"]["name"] != "finish"]
            return base + [SUBMIT_PLAN_SPEC] + extra
        return TOOL_SPECS + extra

    def call(self, name: str, args: dict[str, Any]) -> str:
        """Run a tool. Returns text for the model; raises Finished on `finish`."""
        handler = getattr(self, f"_tool_{name}", None)
        if name == "report_bug" and not self.bug_reports:
            handler = None
        if name == "submit_plan" and not self.planning:
            handler = None
        if handler is None:
            return f"ERROR: unknown tool {name!r}"
        try:
            return truncate(handler(**args))
        except Finished:
            raise
        except ToolError as exc:
            return f"ERROR: {exc}"
        except TypeError as exc:
            return f"ERROR: bad arguments for {name}: {exc}"

    def _tool_list_files(self, path: str = ".") -> str:
        full = resolve_path(path)
        res = self.sandbox.sh(
            f"git ls-files --cached --others --exclude-standard -- {_quote(full)} | head -300"
        )
        return res.output or "(no files)"

    def _tool_read_file(self, path: str) -> str:
        res = self.sandbox.read_file(resolve_path(path))
        return res.output if res.ok else f"ERROR: {res.output.strip()}"

    def _tool_write_file(self, path: str, content: str) -> str:
        full = resolve_path(path)
        rel = full[len(WORKDIR) + 1 :]
        # Guidance only: run_command could still change other files, so the real
        # enforcement is the check on the final diff (see cli.py).
        if self.can_write is not None and not self.can_write(rel):
            raise ToolError(f"not allowed to write {rel!r}. {self.write_rule}".strip())
        res = self.sandbox.write_file(full, content)
        if not res.ok:
            return f"ERROR: {res.output.strip()}"
        return f"wrote {len(content)} characters to {full[len(WORKDIR) + 1 :]}"

    def _tool_run_command(self, command: str, timeout: int = 300) -> str:
        if not isinstance(command, str) or not command.strip():
            raise ToolError("command must be a non-empty string")
        timeout = max(5, min(int(timeout), 600))
        res = self.sandbox.sh(command, timeout=timeout)
        return f"exit code: {res.code}\n{res.output}"

    def _tool_report_bug(self, title: str, severity: str, details: str, file: str = "") -> str:
        severity = str(severity).lower()
        if severity not in SEVERITIES:
            raise ToolError(f"severity must be one of {', '.join(SEVERITIES)}")
        if not str(title).strip() or not str(details).strip():
            raise ToolError("title and details are required")
        self.bugs.append(Bug(str(title).strip(), severity, str(details).strip(), str(file)))
        return f"recorded bug #{len(self.bugs)}"

    def _tool_submit_plan(self, tasks: Any) -> str:
        self.plan = parse_plan(tasks)
        raise Finished(f"plan with {len(self.plan)} task(s) submitted")

    def _tool_finish(self, summary: str) -> str:
        raise Finished(str(summary))


def _quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"
