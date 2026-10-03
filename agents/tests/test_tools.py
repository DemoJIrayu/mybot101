import subprocess

import pytest

from agent_team.sandbox import Sandbox
from agent_team.tools import Finished, Toolbox, ToolError, resolve_path, truncate


class FakeRunner:
    """Records docker commands instead of running them."""

    def __init__(self, stdout="", returncode=0):
        self.calls = []
        self.stdout = stdout
        self.returncode = returncode

    def __call__(self, cmd, **kwargs):
        self.calls.append((cmd, kwargs))
        return subprocess.CompletedProcess(cmd, self.returncode, self.stdout, "")


@pytest.mark.parametrize(
    "path, expected",
    [
        ("src/app.py", "/workspace/repo/src/app.py"),
        ("./README.md", "/workspace/repo/README.md"),
        (".", "/workspace/repo"),
        ("/workspace/repo/a.txt", "/workspace/repo/a.txt"),
        ("src/../b.py", "/workspace/repo/b.py"),
    ],
)
def test_resolve_path_inside_repo(path, expected):
    assert resolve_path(path) == expected


@pytest.mark.parametrize(
    "path", ["../etc/passwd", "/etc/passwd", "a/../../x", "", "/workspace/repository/x"]
)
def test_resolve_path_rejects_escape(path):
    with pytest.raises(ToolError):
        resolve_path(path)


@pytest.mark.parametrize("path", [".git/config", "sub/.git/hooks/pre-commit"])
def test_resolve_path_blocks_git_dir(path):
    with pytest.raises(ToolError):
        resolve_path(path)


def test_truncate_keeps_head_and_tail():
    text = "a" * 100 + "b" * 100
    out = truncate(text, limit=50)
    assert out.startswith("a" * 25) and out.endswith("b" * 25)
    assert "150 characters cut" in out


def test_write_file_sends_content_on_stdin_not_in_command():
    runner = FakeRunner()
    box = Toolbox(Sandbox("sbx", runner=runner))
    evil = "$(rm -rf /) `whoami` \"'"
    msg = box.call("write_file", {"path": "x.txt", "content": evil})
    assert "wrote" in msg
    cmd, kwargs = runner.calls[0]
    assert kwargs["input"] == evil
    assert all(evil not in part for part in cmd)
    assert cmd[-1] == "/workspace/repo/x.txt"


def test_tool_errors_are_returned_to_model():
    box = Toolbox(Sandbox("sbx", runner=FakeRunner()))
    assert box.call("read_file", {"path": "../../etc/shadow"}).startswith("ERROR")
    assert box.call("nope", {}).startswith("ERROR: unknown tool")
    assert box.call("read_file", {"wrong": 1}).startswith("ERROR: bad arguments")


def test_run_command_clamps_timeout_and_reports_exit_code():
    runner = FakeRunner(stdout="ok\n", returncode=3)
    box = Toolbox(Sandbox("sbx", runner=runner))
    out = box.call("run_command", {"command": "pytest", "timeout": 99999})
    assert out.startswith("exit code: 3")
    cmd, _ = runner.calls[0]
    assert cmd[cmd.index("timeout") + 1] == "600"


def test_finish_raises():
    box = Toolbox(Sandbox("sbx", runner=FakeRunner()))
    with pytest.raises(Finished) as exc:
        box.call("finish", {"summary": "done"})
    assert exc.value.summary == "done"
