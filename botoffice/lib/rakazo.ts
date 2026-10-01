// Server-side Rakazo client for the 3D office. Signs in with the hidden owner account that the BotTeam app
// created (same bots as the app); the password and session cookie never reach the browser.
import { readFileSync } from "node:fs";
import path from "node:path";

const WEB = process.env.RAKAZO_URL ?? "http://127.0.0.1:5173";
const CRED = path.join(process.env.LOCALAPPDATA ?? "", "BotTeam", "owner.json");
let cookie = "";

async function login() {
  const { email, password } = JSON.parse(readFileSync(CRED, "utf8"));
  const res = await fetch(`${WEB}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: WEB },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`ล็อกอิน Rakazo ไม่ได้ (${res.status}) — เปิดแอป BotTeam ก่อนหนึ่งครั้ง`);
  cookie = res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
}

// oRPC: POST /rpc/<route> {"json": input} -> {"json": output}
export async function rpc<T = any>(route: string, input: unknown = {}, retry = true): Promise<T> {
  if (!cookie) await login();
  const res = await fetch(`${WEB}/rpc/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ json: input }),
    cache: "no-store",
  });
  if (res.status === 401 && retry) { cookie = ""; return rpc(route, input, false); }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.json?.message ?? `Rakazo ${res.status}`);
  return body?.json as T;
}

// threads.subscribe is an SSE stream of ProductEvents ("event: message" / "data: {json}")
export async function* subscribe(target: object, cursor: number, signal: AbortSignal): AsyncGenerator<any> {
  if (!cookie) await login();
  const res = await fetch(`${WEB}/rpc/threads/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ json: { ...target, cursor } }),
    signal,
  });
  if (res.status === 401) cookie = "";
  if (!res.ok || !res.body) throw new Error(`subscribe ${res.status}`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", ev = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line.startsWith("event: ")) ev = line.slice(7);
      else if (line.startsWith("data: ") && ev === "message") {
        const e = JSON.parse(line.slice(6))?.json;
        if (e) yield e;
      }
    }
  }
}
