# Agent Team rebuild — setup guide

Rebuilding the BotTeam demo into a 3-agent **AI dev & QA team** (Lead, Dev, QA)
with a DevSecOps pipeline, sized for a 16 GB Windows laptop.

- **Stack:** Python, Node/TypeScript, Next.js
- **Models:** DeepSeek V4-Pro (Lead), Qwen3-Coder via OpenRouter (Dev), DeepSeek Flash (QA)
- **Legacy:** `botadmin/`, `botoffice/`, `rakazo/` are the original demo. Kept for reference,
  security-scanned by CI, but not built or tested.

```
Windows (16 GB)
└─ WSL2 Ubuntu 24.04  (capped at 8 GB)
   └─ Docker Engine
      ├─ litellm      127.0.0.1:4000  model router + $ budget cap
      │    ├─ lead        -> DeepSeek V4-Pro                       (Lead)
      │    ├─ coder-or    -> Qwen3-Coder via OpenRouter -> Flash   (Dev)
      │    └─ worker      -> DeepSeek Flash -> V4-Pro              (QA)
      ├─ postgres                       spend + key tracking
      └─ sandbox-lead / -dev / -qa      on demand, no keys, no LAN, internet only
agents/ (runs in WSL) ── docker exec ──> sandbox      LLM calls ──> litellm
GitHub Actions: gitleaks · Semgrep · CodeQL · Trivy · dependency review · tests
```

## Planned layout

```
agents/      Python — Lead, Dev and QA agents                  (steps 2, 4, 5 done)
office/      Next.js — 3D office: live view of the agents        (step 8, done)
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
3. **Keys:** create a DeepSeek key and top up a small prepaid balance (your hard limit).
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

## Step 2 — the Dev agent

How it works:

1. The agent gets a **fresh clone** of `main` inside its sandbox.
2. It reads, writes and runs tests **only inside the sandbox** (`docker exec`). The
   sandbox holds no keys and can't reach your LAN, LiteLLM or Postgres.
3. You see the diff. If it touches `.github/`, `infra/` or `agents/` it's refused
   (agents can't weaken their own guardrails).
4. Only if you answer `y`, the patch goes to a new `agent/dev-…` branch, is pushed with
   **your** `gh` login, and a PR is opened. The pipeline checks it before merge.

Setup (once):

```bash
cd ~/mybot101/infra
docker compose up -d                                # applies the new networks
docker compose --profile sandbox up -d --build      # first build ~5–10 min
sudo bash wsl/lan-block.sh                          # rerun after each WSL restart
cd .. && bash infra/create-agent-keys.sh            # per-agent keys + budgets

sudo apt install -y python3-venv
cd agents && python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]" && pytest -q
```

Run a task (from `agents/`, with the venv active):

```bash
python -m agent_team dev "Create a Python package in apps/calc with add(a, b) and \
  divide(a, b) (raise ValueError on divide by zero), plus pytest tests. Run the tests."
```

Free sandboxes when done: `cd infra && docker compose --profile sandbox stop`.

## Step 4 — the QA agent

Point it at a pull request; it tests that change in its own sandbox.

```bash
cd ~/mybot101/agents && . .venv/bin/activate
python -m agent_team qa --pr 3
python -m agent_team qa --pr 3 "Focus on float and type edge cases"   # optional focus
```

What it does:

1. Fetches the PR into `sandbox-qa`. **Open PR:** tests the PR's head. **Merged PR:** tests
   current `main`.
2. Reads the diff, runs the existing tests, then writes **new** tests for edge cases,
   invalid input, errors and security-relevant behaviour. Python → pytest; Next.js →
   Playwright e2e (`@playwright/test@1.55.0`, matching the sandbox browsers).
3. Tests that expose a real bug stay in as **expected failures**
   (`xfail(strict=True)` / `test.fail()`) and each bug is recorded with severity.
   CI stays green, and when Dev fixes the bug the strict xfail turns red as a
   reminder to remove the marker.
4. Writes a report to `runs/…-qa-prN.md` and asks you two things:
   - open a PR with the new tests (into `main` for merged PRs, into the PR's branch for
     open ones);
   - post the report as a comment on the PR.

Guardrails: QA may only change test files (tests/, test_*.py, *.test.ts, *.spec.ts, e2e/,
playwright config, package.json). This is checked on the final diff, so it can't be
bypassed through shell commands, and `--allow-protected` doesn't override it.

## Step 5 — the Lead agent

Give it one bigger goal; it runs the whole team and opens one PR.

```bash
cd ~/mybot101/infra && docker compose --profile sandbox up -d   # all 3 sandboxes
cd ../agents && . .venv/bin/activate
python -m agent_team lead "Add a CLI to apps/calc: 'python -m calc add 2 3' prints 5"
python -m agent_team lead "..." --fix-rounds 1      # fewer QA→Dev fix loops
```

1. **Plan:** the Lead (DeepSeek V4-Pro) looks around the repo in `sandbox-lead` and
   proposes 1–5 small tasks with acceptance criteria. It can't write files.
2. **You approve the plan once** (`y`). Saying no stops everything; nothing is changed.
3. **Dev** does the tasks one by one in `sandbox-dev` (one shared workspace).
4. **QA** gets the combined change as a patch in `sandbox-qa`, adds tests and reports
   bugs. Its tests are copied back into Dev's workspace.
5. If QA found **critical or high** bugs, **Dev fixes them** and QA re-tests (up to
   `--fix-rounds`, default 2). Medium/low bugs don't loop; they're listed in the PR for
   you to judge. Weakening a safeguard (disabled limits, skipped validation or TLS checks,
   overridden private library APIs) always counts as high.
6. The Lead writes the PR description (summary, verification, open issues, verdict) and
   **opens one PR** with your `gh` login. You review and merge it; the pipeline checks it.

Test budget: QA adds at most 15 tests in the first round and 5 per re-test round, in one
`tests/test_<module>_qa.py` file per module (extended, never a new file per round).

**Resume a stopped run** (e.g. Dev hit its step limit) without re-planning:

```bash
python -m agent_team lead --resume runs/<time>-lead                  # continue where it stopped
python -m agent_team lead --resume runs/<time>-lead --max-steps 60   # give Dev more steps
python -m agent_team lead --resume runs/<time>-lead --from-task 2    # skip to a later task
```

The approved plan is reused (no planning, no approval), Dev's unfinished work
(`partial.patch`) is restored into a fresh workspace, and Dev is told to finish it rather
than start over. Each run keeps `plan.md`, `state.json` and, if stopped, `partial.patch`.

Stops without a PR when: the plan is rejected, a Dev task doesn't finish (partial patch
saved), or the change touches `.github/`, `infra/` or `agents/`. Everything from a run
(plan, QA reports, final patch, PR body) is saved in `runs/<time>-lead/`.

## Step 8 — the 3D office

```bash
cd ~/mybot101/office && npm ci && npm run build && npm start   # http://127.0.0.1:3300
```

The agents write their live state to `runs/status.json`: working, waiting for your
approval, meeting (handoffs between Lead, Dev and QA) or idle. The office shows each bot
walking to the matching zone, lights and sky follow Bangkok time, the camera follows the
bot that's working, and the theme icon on the card switches system / light / dark.
Try it without agents: http://127.0.0.1:3300/?demo=1. Details: `office/README.md`.

## Step 10 — working on other repositories

The agents can work on any repo listed in `infra/repos.toml` (today: mybot101,
Anne-AIChatbot, YourNorst). They still never hold a GitHub token:

1. Your machine clones the repo with your `gh` login into `~/agent-repos/<owner>/<repo>`
   (works for private repos) and gives the sandboxes a plain copy of the files
   (a tar archive: no `.git`, no remote, no credentials).
2. Before any work, a **safety check** refuses repos that don't call the shared
   DevSecOps pipeline or whose default branch isn't protected.
3. Each repo has its own protected paths (`.github/`, `infra/`, `deploy/` by default).
4. PRs are opened in that repo, branched from exactly the commit the agents worked on.

**Onboard a repo once** (you run this; agents may never change `.github/`):

```bash
bash infra/onboard-repo.sh DemoJIrayu/Anne-AIChatbot     # opens a PR adding the pipeline
gh pr merge --repo DemoJIrayu/Anne-AIChatbot --squash --delete-branch <branch>
bash .github/scripts/protect-main.sh DemoJIrayu/Anne-AIChatbot
```

For **private repos without GitHub Advanced Security** (YourNorst's template sets
`code_scanning: false`): CodeQL and dependency review are off, `npm audit` blocks instead,
and protect it with `--no-code-scanning`. Branch protection on private repos needs GitHub
Pro; without it, set `require_branch_protection = false` for that repo in `repos.toml`.

**Use it:**

```bash
python -m agent_team lead --repo DemoJIrayu/Anne-AIChatbot "Scaffold backend/ (Node + TypeScript) and frontend/ (Next.js)"
python -m agent_team qa   --repo DemoJIrayu/YourNorst --pr 12
python -m agent_team lead --resume runs/<time>-lead-Anne-AIChatbot     # repo remembered
```

**Test databases** for integration tests: `cd infra && docker compose --profile databases up -d`
starts Postgres, MySQL, MongoDB and Redis on the sandbox network only (in-memory, no
ports on your machine; ~1.3 GB RAM, stop them when idle). Sandboxes and CI both get
`DATABASE_URL`, `MYSQL_URL`, `MONGODB_URI`, `REDIS_URL`; CI starts only the ones each
repo's workflow asks for, with random passwords.

## Step 3 — CI pipeline

`.github/workflows/devsecops.yml` runs on every push, PR and weekly. Its jobs live in
`devsecops-reusable.yml`, which the other repos call too.

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
- Settings → Code security: Dependency graph, Dependabot alerts, secret scanning, push protection
- Protect `main` (PR + passing checks required, also for admins):
  `bash .github/scripts/protect-main.sh`

Agents will work on branches and open PRs; they never push to `main`.

## Choosing models

Two places, both reviewed through PRs (except `.env`, which stays on your machine):

| What | Where |
|---|---|
| Alias → provider model, and fallbacks | `infra/litellm/config.yaml` |
| Agent → alias (defaults) | `agents/agent_team/config.py` (`ROLES`) |
| Agent → alias (this machine only) | `infra/.env`: `LEAD_MODEL`, `DEV_MODEL`, `QA_MODEL` |
| Which aliases each agent's key may use, and its budget | `infra/create-agent-keys.sh` |

After changing aliases: `bash infra/create-agent-keys.sh` (updates existing keys) and
`cd infra && docker compose restart litellm`. Check which model really answered with
`/spend/logs` (see below). OpenRouter forwards code to third-party providers: in
openrouter.ai → Settings → Privacy, turn off providers that may train on your inputs.

## Budget rules

- **Per run:** each agent stops at a budget of *new* tokens: uncached input plus output
  (Dev 300k, QA 400k, Lead 200k; override with `AGENT_MAX_TOKENS`). Cached input is ~50×
  cheaper on DeepSeek, so it isn't counted. When a conversation passes ~30k tokens,
  older tool outputs are shortened in one go (last 6 kept), so the cached start of the
  conversation stays stable between compactions.
- **Monthly per agent (LiteLLM keys):** Lead $5, Dev $5 (Qwen3-Coder costs more than
  Flash: $0.22 in / $1.80 out per 1M tokens), QA $2.
- **Check spend per agent:**
  `source infra/.env && curl -s localhost:4000/key/info -H "Authorization: Bearer $QA_AGENT_KEY" | jq .info.spend`

- `infra/litellm/config.yaml` → `max_budget`: hard monthly cap for all agents (default $10).
- Provider keys live only in the LiteLLM container; agents get their own LiteLLM keys.
