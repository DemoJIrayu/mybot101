# Agent Team rebuild — setup guide

Rebuilding the BotTeam demo into a 3-agent **AI dev & QA team** (Lead, Dev, QA)
with a DevSecOps pipeline, sized for a 16 GB Windows laptop.

- **Stack:** Python, Node/TypeScript, Next.js
- **Models:** DeepSeek (Lead) + Qwen3-Coder free on OpenRouter (Dev, QA), DeepSeek as fallback
- **Legacy:** `botadmin/`, `botoffice/`, `rakazo/` are the original demo. Kept for reference,
  security-scanned by CI, but not built or tested.

```
Windows (16 GB)
└─ WSL2 Ubuntu 24.04  (capped at 8 GB)
   └─ Docker Engine
      ├─ litellm      127.0.0.1:4000  model router + $ budget cap
      │    ├─ lead        -> DeepSeek
      │    └─ worker      -> Qwen3-Coder :free  -> falls back to DeepSeek
      ├─ postgres                       spend + key tracking
      └─ sandbox-lead / -dev / -qa      on demand, no LAN access
GitHub Actions: gitleaks · Semgrep · CodeQL · Trivy · dependency review · tests
```

## Planned layout

```
agents/      Python — orchestrator + Lead/Dev/QA agents      (step 2)
web/         Next.js — dashboard to watch and approve agents (later)
infra/       WSL, Docker, LiteLLM, sandbox image              (step 1, done)
.github/     DevSecOps pipeline                               (step 3, done)
```

## Step 1 — local setup

1. **Windows:** copy `infra/windows/.wslconfig` to `C:\Users\<you>\.wslconfig`. In PowerShell:
   `wsl --install -d Ubuntu-24.04` (skip if installed), then `wsl --shutdown`.
2. **Ubuntu:** clone inside the Linux filesystem (fast), not under `/mnt/c`:
   ```bash
   git clone https://github.com/DemoJIrayu/mybot101 ~/mybot101 && cd ~/mybot101
   bash infra/wsl/setup-docker.sh
   ```
   Reopen Ubuntu, then `docker run --rm hello-world`.
3. **Keys:** create a DeepSeek key and an OpenRouter key; set a monthly spend limit in both.
   ```bash
   cd infra && cp .env.example .env && nano .env     # secrets: openssl rand -hex 24
   ```
4. **Start and test the router:**
   ```bash
   docker compose up -d
   source .env
   curl -s localhost:4000/v1/chat/completions -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"worker","messages":[{"role":"user","content":"Write hello world in Python"}]}' \
     | jq -r '.choices[0].message.content'
   ```
   Repeat with `"model":"lead"` to test DeepSeek.
5. **Sandboxes (when needed):**
   ```bash
   docker compose --profile sandbox up -d --build
   sudo bash wsl/lan-block.sh
   docker compose --profile sandbox stop      # when idle, to free RAM
   ```

## Step 3 — CI pipeline

`.github/workflows/devsecops.yml` runs on every push, PR and weekly.

| Check | Scope | Blocks merge? |
|---|---|---|
| gitleaks (secrets, full history) | whole repo | yes |
| Semgrep | report: whole repo · gate: new code | yes, on ERROR in new code |
| CodeQL (Python, JS/TS) | whole repo | alerts only |
| Trivy (deps, Dockerfiles, compose) | report: whole repo · gate: new code | yes, HIGH/CRITICAL in new code |
| Dependency review | PRs | yes, on HIGH |
| Python / Node / Next.js / Playwright | new code only | yes |

Expect the first run to show **alerts on the legacy code** in the Security tab. That's
useful information, not a broken pipeline.

**GitHub settings to turn on:**
- Settings → Code security: Dependabot alerts, secret scanning, push protection
- Settings → Branches → `main`: require a PR and the `devsecops` checks to pass

Agents will work on branches and open PRs; they never push to `main`.

## Budget rules

- `infra/litellm/config.yaml` → `max_budget`: hard monthly cap for all agents (default $10).
- Free-model availability changes; if `worker` keeps falling back, check
  https://openrouter.ai/models?max_price=0 and update the model ID.
- Provider keys live only in the LiteLLM container; agents get their own LiteLLM keys.
