# Agent sandbox: Python + Node/TypeScript + headless Playwright.
# Covers the project stack: Python, Node/TypeScript, Next.js.
FROM mcr.microsoft.com/playwright:v1.55.0-noble

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git curl jq ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir uv \
 && corepack enable

# Non-root user; the 'pwuser' account already exists in the Playwright image.
RUN mkdir -p /workspace && chown pwuser:pwuser /workspace
USER pwuser
WORKDIR /workspace

# Keep the container alive; the orchestrator (step 2) runs commands via `docker exec`.
CMD ["sleep", "infinity"]
