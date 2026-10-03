# Agent sandbox: Python + Node/TypeScript + headless Playwright.
# Covers the project stack: Python, Node/TypeScript, Next.js.
# Pinned to an exact release tag. To pin the digest too (stronger), on your machine run:
#   docker pull mcr.microsoft.com/playwright:v1.55.0-noble
#   docker inspect --format '{{index .RepoDigests 0}}' mcr.microsoft.com/playwright:v1.55.0-noble
# and replace the FROM line with the printed name@sha256:... value.
# nosemgrep: dockerfile-source-not-pinned
FROM mcr.microsoft.com/playwright:v1.55.0-noble

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1

# npm 11.10+ so agents' installs respect .npmrc min-release-age (supply-chain safety).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git curl jq ripgrep \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir uv \
 && corepack enable \
 && npm install -g npm@11.20.0

# Non-root user; the 'pwuser' account already exists in the Playwright image.
RUN mkdir -p /workspace && chown pwuser:pwuser /workspace
USER pwuser
# Never install npm package versions published less than 7 days ago (supply chain).
RUN npm config set min-release-age 7
WORKDIR /workspace

# Keep the container alive; the orchestrator (step 2) runs commands via `docker exec`.
CMD ["sleep", "infinity"]
