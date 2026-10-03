"""Tools the model can call. All file paths are confined to the repo in the sandbox."""

from __future__ import annotations

import posixpath
from typing import Any

from agent_team.sandbox import WORKDIR, Sandbox

MAX_OUTPUT = 12_000  # characters returned to the model per tool call


class ToolError(Exception):
    pass


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


class Toolbox:
    def __init__(self, sandbox: Sandbox):
        self.sandbox = sandbox

    def call(self, name: str, args: dict[str, Any]) -> str:
        """Run a tool. Returns text for the model; raises Finished on `finish`."""
        handler = getattr(self, f"_tool_{name}", None)
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

    def _tool_finish(self, summary: str) -> str:
        raise Finished(str(summary))


def _quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"
