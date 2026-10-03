"""The agent loop: model proposes tool calls, we run them in the sandbox, repeat."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from agent_team.tools import TOOL_SPECS, Finished, Toolbox

SYSTEM_PROMPTS = {
    "dev": """You are the Dev agent in a small software team. You work in a git repository
at /workspace/repo inside an isolated Linux sandbox with Python 3, Node.js 22, npm and uv.

How to work:
1. Explore first: list_files and read_file the parts relevant to the task.
2. Make focused changes with write_file (always the complete file content).
3. Verify: run the tests/linters with run_command. Add tests for new behaviour.
4. When done, call finish with a short summary: what changed, how you verified it,
   anything left undone.

Rules:
- Never put secrets, API keys or tokens in code or files.
- Do not edit .github/ or infra/; those are protected and changes will be rejected.
- Don't commit or push; a human reviews your diff and opens the pull request.
- Keep changes small and in the style of the existing code.
- Prefer standard libraries; justify any new dependency in your summary.""",
}

NUDGE = "Continue by calling a tool. If the task is complete, call finish with a summary."


@dataclass
class RunResult:
    finished: bool
    summary: str
    steps: int
    prompt_tokens: int = 0
    completion_tokens: int = 0
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
        log: Callable[[str], None] = print,
    ):
        self.client = client
        self.model = model
        self.toolbox = toolbox
        self.system_prompt = system_prompt
        self.max_steps = max_steps
        self.log = log

    def run(self, task: str) -> RunResult:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": task},
        ]
        result = RunResult(finished=False, summary="", steps=0)

        for step in range(1, self.max_steps + 1):
            result.steps = step
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=TOOL_SPECS,
                tool_choice="auto",
                temperature=0.2,
            )
            usage = getattr(response, "usage", None)
            if usage is not None:
                result.prompt_tokens += getattr(usage, "prompt_tokens", 0) or 0
                result.completion_tokens += getattr(usage, "completion_tokens", 0) or 0

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
