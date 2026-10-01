@echo off
title Gemma 4 26B-A4B MoE (Thai + Thinking + Vision) - 2 slots - Web UI + API :8080
rem NOTE: keep this file ASCII-only + CRLF. Thai/emoji text makes cmd.exe misparse lines at random offsets.
rem Web UI: http://127.0.0.1:8080  |  OpenAI API: /v1/chat/completions  |  model: gemma4
rem Remote (Tailscale): http://<host>.<tailnet>.ts.net:8080/v1
rem
rem API KEYS (required): D:\localai\llm-api-key.txt, one key per line (# = comment)
rem   gemma-...  = admin/personal key (benchmarks, BotAdmin, Tailscale clients)
rem   rakazo-... = Rakazo bots only (Settings -> Models). Revoke = delete the line + restart.
rem
rem 2 slots for 2 Rakazo bots (measured 2026-09-29, desktop apps using 2.5GB VRAM):
rem   -np 2 -kvu -c 65536 (shared 64K), vision encoder on CPU (--no-mmproj-offload)
rem   1 request 83.7 t/s | 2 parallel 72.5 t/s each | VRAM peak 15.1/16.3GB | tool_calls OK | vision OK
rem   vision on GPU instead = VRAM overflow into system RAM, speed drops to 38 t/s
rem --reasoning-budget 4096 caps thinking then forces the answer (unlimited = code tasks loop forever)
rem Disable thinking per request: "chat_template_kwargs":{"enable_thinking":false}
rem KV cache must be q8_0 for BOTH k and v (mixing with f16 drops to 23 t/s)
rem --metrics = Prometheus /metrics (needs key), used by BotAdmin
rem --host 0.0.0.0 so Tailscale devices and WSL/Docker can connect (key required)
rem Check: python D:\localai\benchmarks\bots-check.py
cd /d D:\localai\llamacpp\bin
.\llama-server.exe --api-key-file "D:\localai\llm-api-key.txt" -m "D:\localai\models\gemma-4-26B-A4B-it-UD-IQ4_XS.gguf" --mmproj "D:\localai\models\mmproj-gemma-4-26B-A4B-it-F16.gguf" --no-mmproj-offload -ngl 999 --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 -np 2 -kvu -c 65536 -n 16384 --jinja --reasoning on --reasoning-budget 4096 --reasoning-budget-message "Okay, I have thought enough. Now I will write the final answer." --reasoning-format deepseek --temp 1.0 --top-p 0.95 --top-k 64 --alias gemma4 --metrics --host 0.0.0.0 --port 8080
pause
