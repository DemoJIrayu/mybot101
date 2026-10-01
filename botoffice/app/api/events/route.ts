import { guard } from "@/lib/guard";
import { hub, type Msg } from "@/lib/hub";

export const dynamic = "force-dynamic";

// Server-sent events: one "state" snapshot, then state changes and live activities.
export function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const enc = new TextEncoder();
  let off = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(ctrl) {
      const send = (m: Msg) => { try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(m)}\n\n`)); } catch { off(); } };
      send(hub.snapshot());
      off = hub.on(send);
      ping = setInterval(() => { try { ctrl.enqueue(enc.encode(": ping\n\n")); } catch { off(); } }, 15000);
      req.signal.addEventListener("abort", () => { off(); clearInterval(ping); try { ctrl.close(); } catch {} });
    },
    cancel() { off(); clearInterval(ping); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" } });
}
