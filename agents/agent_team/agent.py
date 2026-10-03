"""The agent loop: model proposes tool calls, we run them in the sandbox, repeat."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from agent_team.tools import Finished, Toolbox

SYSTEM_PROMPTS = {
    "lead": """You are the Lead of a small software team with a Dev agent and a QA agent.
You turn a goal into a short plan. You don't write code yourself. You can look around
the git repository at /workspace/repo (list_files, read_file, run_command) to
understand where things live, but keep exploration short (at most ~8 tool calls).

Then call submit_plan with 1-5 tasks, in the order they must be done. Each task:
- is small enough for the Dev agent to finish in one sitting (one feature, one module),
- builds on the previous tasks (they share one workspace),
- names the paths to create or change,
- has concrete acceptance criteria (tests to add, commands that must pass, behaviour).

Prefer fewer, well-scoped tasks. Never plan changes to .github/, infra/ or agents/;
those are protected. QA testing happens automatically after the Dev tasks, so don't
plan separate QA tasks, but do ask Dev for unit tests in each task.""",
    "dev": """You are the Dev agent in a small software team. You work in a git repository
at /workspace/repo inside an isolated Linux sandbox with Python 3, Node.js 22, npm and uv.

How to work:
1. Explore first: list_files and read_file the parts relevant to the task.
2. Make focused changes with write_file (always the complete file content).
3. Verify: run the tests AND the project's linter with run_command (Python:
   `ruff check .`; Node: `npm run lint`). CI fails on lint errors, so fix them.
   Add tests for new behaviour.
4. When done, call finish with a short summary: what changed, how you verified it,
   anything left undone.

Rules:
- Never put secrets, API keys or tokens in code or files.
- Do not edit .github/ or infra/; those are protected and changes will be rejected.
- Don't commit or push; a human reviews your diff and opens the pull request.
- Keep changes small and in the style of the existing code.
- Prefer standard libraries; justify any new dependency in your summary.""",
    "qa": """You are the QA agent in a small software team. Your job is to find bugs in a
change and protect it with tests. You work in a git repository at /workspace/repo inside
an isolated Linux sandbox with Python 3, Node.js 22, npm, uv and Playwright browsers.

How to work:
1. Read the change you are given, then read_file the surrounding code it touches.
2. Run the project's existing tests first and note the result.
3. Write NEW tests that go beyond the happy path: boundaries, empty/invalid input,
   wrong types, error handling, large values, and security-relevant behaviour
   (injection, path traversal, unsafe input) where it applies.
   - Python: pytest, in the project's tests/ folder (test_*.py).
   - Node/TypeScript: the project's own test runner (*.test.ts).
   - Next.js pages and UI: Playwright end-to-end tests in e2e/*.spec.ts.
     Install exactly `@playwright/test@1.55.0` (matches the browsers in this sandbox)
     and use a playwright.config.ts with a webServer that builds and starts the app.
   Aim for the 10-25 most valuable tests, not exhaustive coverage. Skip tests of plain
   language behaviour (e.g. how Python's + works) and tests that grep source code.
4. A test that exposes a REAL bug stays in, marked as an expected failure so the
   suite still passes and the bug is tracked:
   - Python: @pytest.mark.xfail(strict=True, reason="BUG: <short description>")
   - Playwright: test.fail(true, "BUG: <short description>")
   Then call report_bug for it.
5. Run the full test suite again. It must pass (expected failures count as passing).
   Also run the project's linter on your test files (Python: `ruff check .`; Node:
   `npm run lint`); CI fails on lint errors. In tests, a seeded `random.Random(...)`
   is fine: mark that line `# noqa: S311`. Don't silence other rules without a reason.
6. Call finish with: tests added, final test result, bugs found, and your overall
   risk assessment of the change (low / medium / high) with one line of reasoning.

Rules:
- Only create or edit test files (tests/, test_*.py, conftest.py, *.test.ts, *.spec.ts,
  e2e/, playwright config, package.json for test dependencies). Never change
  application code: report bugs instead, the Dev agent fixes them.
- Don't report style preferences as bugs. Only report behaviour that is wrong,
  unsafe or crashes, and give a way to reproduce it.
- Never put secrets, API keys or tokens in files. Don't commit or push.""",
}

NUDGE = "Continue by calling a tool. If the task is complete, call finish with a summary."

# Every step re-sends the whole conversation. Providers like DeepSeek cache the
# unchanged start of it and bill those tokens ~50x cheaper, so we must NOT edit old
# messages on every step (that breaks the cache). Instead, only when the conversation
# grows past a threshold, shrink all but the most recent tool outputs in one go;
# afterwards the start is stable again and caching resumes.
COMPACT_AT_CHARS = 120_000  # ~30k tokens
KEEP_RECENT_TOOL_OUTPUTS = 6
TRIMMED_HEAD = 400


def history_chars(messages: list[dict[str, Any]]) -> int:
    return sum(len(m.get("content") or "") for m in messages)


def compact_history(
    messages: list[dict[str, Any]],
    keep_recent: int = KEEP_RECENT_TOOL_OUTPUTS,
    threshold: int = COMPACT_AT_CHARS,
) -> bool:
    """If the history is over `threshold` characters, shorten old tool outputs in place.

    Returns True when it compacted.
    """
    if history_chars(messages) < threshold:
        return False
    tool_idx = [i for i, m in enumerate(messages) if m.get("role") == "tool"]
    changed = False
    for i in tool_idx[:-keep_recent] if keep_recent else tool_idx:
        content = messages[i]["content"]
        if len(content) > TRIMMED_HEAD + 100 and not content.endswith("[trimmed]"):
            cut = len(content) - TRIMMED_HEAD
            messages[i]["content"] = (
                f"{content[:TRIMMED_HEAD]}\n... [{cut} older characters removed to save "
                "tokens; re-run the tool if you need them again] [trimmed]"
            )
            changed = True
    return changed


def _cached_tokens(usage: Any) -> int:
    """Prompt tokens served from the provider's cache (OpenAI or DeepSeek field names)."""
    details = getattr(usage, "prompt_tokens_details", None)
    cached = getattr(details, "cached_tokens", None) if details is not None else None
    if cached is None:
        cached = getattr(usage, "prompt_cache_hit_tokens", 0)
    return int(cached or 0)


@dataclass
class RunResult:
    finished: bool
    summary: str
    steps: int
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0

    @property
    def new_tokens(self) -> int:
        """Tokens billed at full price: uncached input plus output."""
        return self.prompt_tokens - self.cached_tokens + self.completion_tokens

    def usage_line(self) -> str:
        return (
            f"tokens in/out {self.prompt_tokens}/{self.completion_tokens} "
            f"(cached {self.cached_tokens}, new {self.new_tokens})"
        )

    tool_calls: list[str] = field(default_factory=list)


class Agent:
    def __init__(
        self,
        client: Any,
        model: str,
        toolbox: Toolbox,
        system_prompt: str,
        *,
        max_steps: int = 30,
        max_tokens: int = 0,
        log: Callable[[str], None] = print,
    ):
        self.client = client
        self.model = model
        self.toolbox = toolbox
        self.system_prompt = system_prompt
        self.max_steps = max_steps
        self.max_tokens = max_tokens  # 0 = no cap
        self.log = log

    def run(self, task: str) -> RunResult:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": task},
        ]
        result = RunResult(finished=False, summary="", steps=0)

        for step in range(1, self.max_steps + 1):
            result.steps = step
            used = result.new_tokens
            if self.max_tokens and used >= self.max_tokens:
                result.summary = (
                    f"Stopped: used {used} new (uncached) tokens, over this run's budget "
                    f"of {self.max_tokens}."
                )
                self.log(f"⚠️  {result.summary}")
                return result
            if compact_history(messages):
                self.log(f"[{step}] 🗜  shortened older tool outputs to save tokens")
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=self.toolbox.specs,
                tool_choice="auto",
                temperature=0.2,
            )
            usage = getattr(response, "usage", None)
            if usage is not None:
                result.prompt_tokens += getattr(usage, "prompt_tokens", 0) or 0
                result.completion_tokens += getattr(usage, "completion_tokens", 0) or 0
                result.cached_tokens += _cached_tokens(usage)

            msg = response.choices[0].message
            tool_calls = list(msg.tool_calls or [])
            if msg.content:
                self.log(f"[{step}] 💬 {msg.content.strip()[:300]}")

            messages.append(_assistant_message(msg.content, tool_calls))
            if not tool_calls:
                messages.append({"role": "user", "content": NUDGE})
                continue

            for call in tool_calls:
                name = call.function.name
                result.tool_calls.append(name)
                try:
                    args = json.loads(call.function.arguments or "{}")
                    if not isinstance(args, dict):
                        raise ValueError("arguments must be a JSON object")
                except ValueError as exc:
                    output = f"ERROR: could not parse arguments as JSON: {exc}"
                else:
                    self.log(f"[{step}] 🔧 {name} {_preview(args)}")
                    try:
                        output = self.toolbox.call(name, args)
                    except Finished as done:
                        result.finished = True
                        result.summary = done.summary
                        self.log(f"[{step}] ✅ finished")
                        return result
                messages.append({"role": "tool", "tool_call_id": call.id, "content": output})

        result.summary = f"Stopped after reaching the limit of {self.max_steps} steps."
        self.log(f"⚠️  {result.summary}")
        return result


def _assistant_message(content: str | None, tool_calls: list[Any]) -> dict[str, Any]:
    message: dict[str, Any] = {"role": "assistant", "content": content or ""}
    if tool_calls:
        message["tool_calls"] = [
            {
                "id": c.id,
                "type": "function",
                "function": {"name": c.function.name, "arguments": c.function.arguments},
            }
            for c in tool_calls
        ]
    return message


def _preview(args: dict[str, Any]) -> str:
    shown = {
        k: (v if not isinstance(v, str) or len(v) < 80 else v[:77] + "...")
        for k, v in args.items()
        if k != "content"
    }
    if "content" in args:
        shown["content"] = f"<{len(str(args['content']))} chars>"
    return json.dumps(shown, ensure_ascii=False)
