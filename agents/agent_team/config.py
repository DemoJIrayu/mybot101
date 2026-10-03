"""Settings, read from the environment and infra/.env (never from code)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / "infra" / ".env"

# Which LiteLLM alias and sandbox each role uses.
ROLES = {
    "lead": {"model": "lead", "key_var": "LEAD_AGENT_KEY"},
    "dev": {"model": "worker", "key_var": "DEV_AGENT_KEY"},
    "qa": {"model": "worker", "key_var": "QA_AGENT_KEY"},
}


def load_env_file(path: Path = ENV_FILE) -> None:
    """Load KEY=VALUE lines into os.environ without overriding real env vars."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


@dataclass(frozen=True)
class Settings:
    role: str
    model: str
    api_key: str
    base_url: str
    sandbox: str
    repo_url: str
    max_steps: int


def settings_for(role: str) -> Settings:
    if role not in ROLES:
        raise ValueError(f"unknown role {role!r}; choose from {', '.join(ROLES)}")
    load_env_file()
    spec = ROLES[role]
    api_key = os.environ.get(spec["key_var"], "")
    if not api_key:
        raise RuntimeError(f"{spec['key_var']} is empty. Run: bash infra/create-agent-keys.sh")
    return Settings(
        role=role,
        model=os.environ.get(f"{role.upper()}_MODEL", spec["model"]),
        api_key=api_key,
        base_url=os.environ.get("LITELLM_URL", "http://127.0.0.1:4000/v1"),
        sandbox=os.environ.get(f"{role.upper()}_SANDBOX", f"agent-team-sandbox-{role}-1"),
        repo_url=os.environ.get("AGENT_REPO_URL", "https://github.com/DemoJIrayu/mybot101"),
        max_steps=int(os.environ.get("AGENT_MAX_STEPS", "30")),
    )
