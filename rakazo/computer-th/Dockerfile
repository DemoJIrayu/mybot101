# BotTeam: Thai fonts for bot desktops (Thai pages otherwise render as tofu boxes). Rebuild after changing the base tag.
FROM ghcr.io/elie222/rakazo/computer:v0.1.6
USER root
RUN apt-get update && apt-get install -y --no-install-recommends fonts-thai-tlwg && rm -rf /var/lib/apt/lists/* && fc-cache -f
USER 1000:1000
