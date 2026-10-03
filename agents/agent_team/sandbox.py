"""Run commands inside an agent's Docker sandbox via `docker exec`.

Everything the model asks for runs in the container, never on your laptop.
Arguments are always passed as lists (no host shell), and file contents go
through stdin so paths and text can't break out of quoting.
"""

from __future__ import annotations

import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass

WORKDIR = "/workspace/repo"

Runner = Callable[..., subprocess.CompletedProcess]


@dataclass(frozen=True)
class CommandResult:
    code: int
    output: str

    @property
    def ok(self) -> bool:
        return self.code == 0


class Sandbox:
    def __init__(self, container: str, *, timeout: int = 300, runner: Runner = subprocess.run):
        self.container = container
        self.timeout = timeout
        self._run = runner

    def exec(
        self,
        args: Sequence[str],
        *,
        stdin: str | bytes | None = None,
        workdir: str = WORKDIR,
        timeout: int | None = None,
    ) -> CommandResult:
        limit = timeout or self.timeout
        cmd = ["docker", "exec"]
        if stdin is not None:
            cmd.append("-i")
        # `timeout` inside the container really stops the process; the host-side
        # timeout below is only a backstop.
        cmd += ["-w", workdir, self.container, "timeout", str(limit), *args]
        binary = isinstance(stdin, bytes)  # e.g. a tar archive of the code
        try:
            proc = self._run(
                cmd,
                input=stdin,
                capture_output=True,
                text=not binary,
                timeout=limit + 15,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return CommandResult(124, f"command timed out after {limit}s")
        out, err = proc.stdout or "", proc.stderr or ""
        if binary:
            out = out.decode("utf-8", "replace") if isinstance(out, bytes) else out
            err = err.decode("utf-8", "replace") if isinstance(err, bytes) else err
        output = out + err
        if proc.returncode == 124:
            output += f"\n[command timed out after {limit}s]"
        return CommandResult(proc.returncode, output)

    def sh(self, command: str, **kwargs) -> CommandResult:
        return self.exec(["bash", "-lc", command], **kwargs)

    def read_file(self, path: str) -> CommandResult:
        return self.exec(["cat", "--", path])

    def write_file(self, path: str, content: str) -> CommandResult:
        script = 'mkdir -p "$(dirname -- "$1")" && cat > "$1"'
        return self.exec(["sh", "-c", script, "_", path], stdin=content)

    def is_running(self) -> bool:
        try:
            proc = self._run(
                ["docker", "inspect", "-f", "{{.State.Running}}", self.container],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return False
        return proc.returncode == 0 and proc.stdout.strip() == "true"
