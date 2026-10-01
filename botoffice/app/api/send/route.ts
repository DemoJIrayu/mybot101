import { guard } from "@/lib/guard";
import { rpc } from "@/lib/rakazo";

// Send a chat message to one bot from the office (same as typing in the BotTeam app).
export async function POST(req: Request) {
  const denied = guard(req, true);
  if (denied) return denied;
  const { botId, text } = await req.json().catch(() => ({}));
  if (typeof botId !== "string" || !/^[a-z0-9]{8,40}$/i.test(botId) || typeof text !== "string" || !text.trim() || text.length > 4000)
    return Response.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  try {
    await rpc("threads/send", { botId, text: text.trim(), clientNonce: `office-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
