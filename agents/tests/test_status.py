import json
import threading

import pytest

from agent_team.status import MAX_EVENTS, NullBoard, StatusBoard


class Clock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


def test_missing_file_reads_as_all_idle(tmp_path):
    board = StatusBoard(tmp_path / "status.json")
    data = board.read()
    assert {r: a["state"] for r, a in data["agents"].items()} == {
        "lead": "idle",
        "dev": "idle",
        "qa": "idle",
    }


def test_set_writes_state_task_and_event(tmp_path):
    clock = Clock()
    board = StatusBoard(tmp_path / "s.json", clock=clock)
    board.set("dev", "working", "งาน 1/2: " + "x" * 300)
    data = json.loads((tmp_path / "s.json").read_text())
    dev = data["agents"]["dev"]
    assert dev["state"] == "working" and dev["since"] == 1000.0
    assert len(dev["task"]) == 120 and dev["task"].endswith("…")
    assert data["events"][-1]["role"] == "dev" and data["events"][-1]["state"] == "working"


def test_since_only_changes_when_state_changes(tmp_path):
    clock = Clock()
    board = StatusBoard(tmp_path / "s.json", clock=clock)
    board.set("qa", "working", "t")
    clock.t = 1060
    board.set("qa", "working", "t")
    agent = board.read()["agents"]["qa"]
    assert agent["since"] == 1000 and agent["updated"] == 1060
    assert len(board.read()["events"]) == 1


def test_heartbeat_is_throttled(tmp_path):
    clock = Clock()
    board = StatusBoard(tmp_path / "s.json", clock=clock)
    board.set("lead", "working")
    clock.t = 1002
    board.heartbeat("lead")
    assert board.read()["agents"]["lead"]["updated"] == 1000
    clock.t = 1010
    board.heartbeat("lead")
    assert board.read()["agents"]["lead"]["updated"] == 1010


def test_state_context_returns_to_idle_even_on_error(tmp_path):
    board = StatusBoard(tmp_path / "s.json")
    with pytest.raises(RuntimeError), board.state("dev", "working", "boom"):
        assert board.read()["agents"]["dev"]["state"] == "working"
        raise RuntimeError
    assert board.read()["agents"]["dev"]["state"] == "idle"


def test_events_are_capped_and_bad_values_rejected(tmp_path):
    board = StatusBoard(tmp_path / "s.json")
    for i in range(MAX_EVENTS + 10):
        board.set("dev", "working", f"t{i}")
    assert len(board.read()["events"]) == MAX_EVENTS
    with pytest.raises(ValueError):
        board.set("dev", "sleeping")
    with pytest.raises(ValueError):
        board.set("ceo", "idle")
    with pytest.raises(ValueError):
        NullBoard().set("dev", "dancing")


def test_corrupt_file_is_recovered(tmp_path):
    path = tmp_path / "s.json"
    path.write_text("{not json")
    board = StatusBoard(path)
    board.set("qa", "waiting", "รออนุมัติ")
    assert board.read()["agents"]["qa"]["state"] == "waiting"


def test_concurrent_writers_do_not_lose_updates(tmp_path):
    path = tmp_path / "s.json"

    def worker(role):
        board = StatusBoard(path)
        for i in range(20):
            board.set(role, "working", f"{role}-{i}")

    threads = [threading.Thread(target=worker, args=(r,)) for r in ("lead", "dev", "qa")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    agents = StatusBoard(path).read()["agents"]
    assert {r: a["task"] for r, a in agents.items()} == {
        "lead": "lead-19",
        "dev": "dev-19",
        "qa": "qa-19",
    }
