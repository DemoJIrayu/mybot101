import copy
import json
from types import SimpleNamespace as NS

from agent_team.agent import Agent
from agent_team.cli import protected_changes


def _call(id_, name, args):
    return NS(id=id_, function=NS(name=name, arguments=json.dumps(args)))


def _response(content=None, tool_calls=None):
    return NS(
        choices=[NS(message=NS(content=content, tool_calls=tool_calls))],
        usage=NS(prompt_tokens=10, completion_tokens=5),
    )


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []
        self.chat = NS(completions=NS(create=self._create))

    def _create(self, **kwargs):
        # Snapshot: the agent keeps appending to the same list after the call.
        self.requests.append(copy.deepcopy(kwargs))
        return self.responses.pop(0)


class FakeToolbox:
    specs = []

    def __init__(self):
        self.calls = []

    def call(self, name, args):
        from agent_team.tools import Finished

        self.calls.append((name, args))
        if name == "finish":
            raise Finished(args["summary"])
        return "ok"


def test_agent_runs_tools_then_finishes():
    client = FakeClient(
        [
            _response(tool_calls=[_call("1", "write_file", {"path": "a.py", "content": "x=1"})]),
            _response(
                content="All good", tool_calls=[_call("2", "finish", {"summary": "added a.py"})]
            ),
        ]
    )
    box = FakeToolbox()
    result = Agent(client, "worker", box, "sys", log=lambda _: None).run("do it")

    assert result.finished and result.summary == "added a.py"
    assert result.steps == 2
    assert result.prompt_tokens == 20 and result.completion_tokens == 10
    assert [c[0] for c in box.calls] == ["write_file", "finish"]
    # The tool result was sent back to the model with the right id.
    second = client.requests[1]["messages"]
    assert second[-1] == {"role": "tool", "tool_call_id": "1", "content": "ok"}


def test_agent_nudges_when_no_tool_call_and_stops_at_limit():
    client = FakeClient([_response(content="thinking...") for _ in range(3)])
    result = Agent(client, "worker", FakeToolbox(), "sys", max_steps=3, log=lambda _: None).run("t")
    assert not result.finished and result.steps == 3
    assert "limit of 3 steps" in result.summary


def test_bad_json_arguments_are_reported_back():
    bad = NS(id="1", function=NS(name="read_file", arguments="{not json"))
    client = FakeClient(
        [
            _response(tool_calls=[bad]),
            _response(tool_calls=[_call("2", "finish", {"summary": "x"})]),
        ]
    )
    box = FakeToolbox()
    Agent(client, "worker", box, "sys", log=lambda _: None).run("t")
    tool_msg = client.requests[1]["messages"][-1]
    assert tool_msg["content"].startswith("ERROR: could not parse")
    assert box.calls == [("finish", {"summary": "x"})]


def test_protected_paths_are_detected():
    paths = ["web/app.ts", ".github/workflows/ci.yml", "infra/x", "agents/agent_team/cli.py"]
    assert protected_changes(paths) == paths[1:]


def test_old_tool_outputs_are_trimmed_but_recent_kept():
    from agent_team.agent import compact_history

    msgs = [{"role": "system", "content": "s"}]
    for i in range(10):
        msgs.append({"role": "assistant", "content": ""})
        msgs.append({"role": "tool", "tool_call_id": str(i), "content": f"{i}" + "x" * 5000})
    assert compact_history(msgs, keep_recent=3, threshold=1000)
    tools = [m for m in msgs if m["role"] == "tool"]
    assert all(m["content"].endswith("[trimmed]") for m in tools[:7])
    assert all(len(m["content"]) == 5001 for m in tools[7:])
    assert tools[0]["content"].startswith("0xxx") and tools[0]["tool_call_id"] == "0"
    before = tools[0]["content"]
    assert not compact_history(msgs, keep_recent=3, threshold=1000)  # idempotent
    assert tools[0]["content"] == before


def test_agent_stops_when_token_budget_is_spent():
    client = FakeClient([_response(content="hmm") for _ in range(5)])  # 15 tokens each
    agent = Agent(client, "worker", FakeToolbox(), "sys", max_tokens=40, log=lambda _: None)
    result = agent.run("t")
    assert not result.finished and result.steps == 4
    assert "budget of 40" in result.summary
    assert len(client.requests) == 3


def test_small_history_is_left_alone_to_keep_cache_prefix_stable():
    from agent_team.agent import compact_history

    msgs = [{"role": "tool", "tool_call_id": str(i), "content": "x" * 5000} for i in range(10)]
    snapshot = copy.deepcopy(msgs)
    assert not compact_history(msgs, keep_recent=3, threshold=60_000)
    assert msgs == snapshot


def test_cached_tokens_do_not_count_against_budget():
    def cached_response(cached):
        r = _response(content="hmm")
        r.usage = NS(
            prompt_tokens=1000,
            completion_tokens=10,
            prompt_tokens_details=NS(cached_tokens=cached),
        )
        return r

    client = FakeClient([cached_response(990) for _ in range(5)])
    agent = Agent(client, "worker", FakeToolbox(), "sys", max_steps=3, max_tokens=100)
    agent.log = lambda _: None
    result = agent.run("t")
    # 3 steps x (10 uncached + 10 out) = 60 new tokens: under the 100 budget.
    assert result.steps == 3 and "limit of 3 steps" in result.summary
    assert result.cached_tokens == 2970 and result.new_tokens == 60
    assert "cached 2970, new 60" in result.usage_line()


def test_deepseek_cache_field_is_understood():
    from agent_team.agent import _cached_tokens

    assert _cached_tokens(NS(prompt_cache_hit_tokens=42)) == 42
    assert _cached_tokens(NS(prompt_tokens_details=NS(cached_tokens=None))) == 0


def test_env_file_reader_handles_comments_and_quotes(tmp_path, monkeypatch):
    from agent_team.config import load_env_file

    env = tmp_path / ".env"
    env.write_text(
        '# comment\nA_KEY=sk-abc   # note\nB_KEY="quoted"\nC_KEY=\n  # indented comment\n'
    )
    for k in ("A_KEY", "B_KEY", "C_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("B_KEY", "from-real-env")
    load_env_file(env)
    import os

    assert os.environ["A_KEY"] == "sk-abc"
    assert os.environ["B_KEY"] == "from-real-env"  # real env wins
    assert os.environ["C_KEY"] == ""
