"""Live status board: each agent reports what it's doing to runs/status.json.

The 3D office (office/) reads this file to move the bots around. It's a plain local
file, never committed (runs/ is in .gitignore), and holds no secrets: only the role,
its state, a short task label and timestamps.

States: idle, working, waiting (for a human approval), meeting (team handoff).
"""

from __future__ import annotations

import fcntl
import json
import os
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from agent_team.config import REPO_ROOT

STATES = ("idle", "working", "waiting", "meeting")
ROLES = ("lead", "dev", "qa")
MAX_EVENTS = 30
MAX_TASK_CHARS = 120
HEARTBEAT_EVERY = 5.0  # seconds; don't rewrite the file on every tiny step


def default_path() -> Path:
    return Path(os.environ.get("AGENT_STATUS_FILE", REPO_ROOT / "runs" / "status.json"))


def _short(text: str) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= MAX_TASK_CHARS else text[: MAX_TASK_CHARS - 1] + "…"


class StatusBoard:
    def __init__(self, path: Path | None = None, clock: Callable[[], float] = time.time):
        self.path = Path(path) if path else default_path()
        self.clock = clock
        self._last_beat: dict[str, float] = {}

    # -- file access (locked read-modify-write, atomic replace) ----------------

    def _empty(self) -> dict[str, Any]:
        now = self.clock()
        return {
            "version": 1,
            "updated": now,
            "agents": {
                r: {"state": "idle", "task": "", "since": now, "updated": now} for r in ROLES
            },
            "events": [],
        }

    def read(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("agents"), dict):
                return data
        except (OSError, ValueError):
            pass
        return self._empty()

    @contextmanager
    def _locked(self) -> Iterator[dict[str, Any]]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = self.path.with_suffix(".lock")
        with open(lock_path, "a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                data = self.read()
                yield data
                data["updated"] = self.clock()
                tmp = self.path.with_suffix(".tmp")
                tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
                os.replace(tmp, self.path)
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    # -- public API -------------------------------------------------------------

    def set(self, role: str, state: str, task: str = "") -> None:
        if role not in ROLES or state not in STATES:
            raise ValueError(f"bad status {role!r}/{state!r}")
        now = self.clock()
        with self._locked() as data:
            agents = data.setdefault("agents", {})
            prev = agents.get(role, {})
            changed = prev.get("state") != state or prev.get("task") != _short(task)
            agents[role] = {
                "state": state,
                "task": _short(task),
                "since": now if changed else prev.get("since", now),
                "updated": now,
                "pid": os.getpid(),
            }
            if changed:
                events = data.setdefault("events", [])
                events.append({"t": now, "role": role, "state": state, "task": _short(task)})
                del events[:-MAX_EVENTS]
        self._last_beat[role] = now

    def heartbeat(self, role: str) -> None:
        """Refresh the 'still alive' time of a running agent (throttled)."""
        now = self.clock()
        if now - self._last_beat.get(role, 0) < HEARTBEAT_EVERY:
            return
        with self._locked() as data:
            agent = data.setdefault("agents", {}).get(role)
            if agent is not None:
                agent["updated"] = now
        self._last_beat[role] = now

    @contextmanager
    def state(self, role: str, state: str, task: str = "") -> Iterator[None]:
        """Show `state` while the block runs, then go back to idle (also on errors)."""
        self.set(role, state, task)
        try:
            yield
        finally:
            self.set(role, "idle")

    def all_idle(self) -> None:
        for role in ROLES:
            self.set(role, "idle")


class NullBoard(StatusBoard):
    """Does nothing; used in tests and when status reporting is turned off."""

    def __init__(self) -> None:
        super().__init__(Path(os.devnull))

    def set(self, role: str, state: str, task: str = "") -> None:
        if role not in ROLES or state not in STATES:
            raise ValueError(f"bad status {role!r}/{state!r}")

    def heartbeat(self, role: str) -> None:
        pass
