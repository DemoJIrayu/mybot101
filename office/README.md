# ออฟฟิศบอท (3D office)

A live 3D view of the agent team. Each bot walks to the zone for what it's really doing:

| State | Where the bot goes |
|---|---|
| กำลังทำงาน (working) | its desk; the screen lights up and the camera follows it |
| รออนุมัติ (waiting for you) | the red approval sign, with a pulsing "!" |
| ประชุม (meeting / handoff) | the round table |
| ว่าง (idle) | wanders around the sofa corner |

The sky and lights follow the real time in Bangkok (sunrise ~06:10, sunset ~18:20; lamps
and stars at night). The theme icon in the corner of the card cycles **ตามระบบ → สว่าง → มืด**;
the default follows Windows' light/dark setting.

## Run

```bash
cd ~/mybot101/office
npm ci
npm run build && npm start        # http://127.0.0.1:3300 (local only)
```

Open http://127.0.0.1:3300 in your Windows browser (WSL forwards localhost).
No agents running yet? Open http://127.0.0.1:3300/?demo=1 for a scripted demo.
`?hour=21` previews the lighting at another Bangkok hour.

## Where the status comes from

The agents write `runs/status.json` (see `agents/agent_team/status.py`); the page polls
`/api/status` every 2 seconds. A bot that stops reporting for 15 minutes (12 hours while
waiting for you) is shown as idle. Override the file with `OFFICE_STATUS_FILE=/path`.

## Checks

```bash
npm run lint && npm run typecheck && npm test   # unit tests (Vitest)
npm run e2e                                     # browser tests (Playwright)
```
