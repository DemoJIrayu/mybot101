// One process-wide hub: polls Rakazo for bot state and follows live threads (working bots + all group rooms),
// turning raw ProductEvents into small Thai "activity" messages for every connected browser.
import { rpc, subscribe } from "./rakazo";

export type BotView = { id: string; name: string; title: string; color: string; sectionId: string | null; status: string; preview: string; working: boolean };
export type GroupView = { id: string; name: string; members: string[] };
export type Activity = {
  botId: string; groupId?: string; at: number;
  kind: "start" | "tool" | "say" | "ask" | "done" | "fail";
  emoji: string; label: string; detail?: string;
};
export type Snapshot = { type: "state"; bots: BotView[]; groups: GroupView[]; sections: { id: string; name: string }[]; error: string };
export type Msg = Snapshot | { type: "activity"; activity: Activity };

const RUNNING = /queued|leased|running|working|busy|thinking/;
const TOOLS: [RegExp, string, string][] = [
  [/^web_search/, "🔎", "ค้นเว็บ"], [/^web_fetch/, "📄", "อ่านหน้าเว็บ"], [/^browser_/, "🌐", "ท่องเว็บ"],
  [/^computer_observe/, "👀", "ดูหน้าจอ"], [/^computer_act/, "🖱️", "คลิกและพิมพ์"], [/^(shell|exec|run_command)/, "💻", "รันคำสั่ง"],
  [/^(write_file|edit_file|apply_patch)/, "📝", "เขียนไฟล์"], [/^(read_file|list_files|search_files|grep)/, "📖", "อ่านไฟล์"],
  [/^mcp|__/i, "🔌", "ใช้เครื่องมือ MCP"], [/memory|remember|scratchpad/, "🧠", "จดบันทึก"],
  [/spawn_bot|message_bot|delegate|team/, "🤖", "คุยกับบอทอื่น"], [/request_takeover/, "🙋", "ขอให้คนช่วย"],
  [/open_path|launch_app/, "🪟", "เปิดโปรแกรม"], [/image|draw/, "🎨", "ทำรูป"],
];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

class Hub {
  private bots = new Map<string, BotView>();
  private groups: GroupView[] = [];
  private sections: { id: string; name: string }[] = [];
  private listeners = new Set<(m: Msg) => void>();
  private follows = new Map<string, { ctrl: AbortController; seen: number }>();
  private detail = new Map<string, string>(); // botId -> latest activity note ("Reading page: …")
  private failedAt = new Map<string, number>();
  private running = false;
  private error = "";

  on(fn: (m: Msg) => void) {
    this.listeners.add(fn);
    if (!this.running) { this.running = true; void this.loop(); }
    return () => { this.listeners.delete(fn); };
  }

  snapshot(): Snapshot {
    return { type: "state", bots: [...this.bots.values()], groups: this.groups, sections: this.sections, error: this.error };
  }

  private emit(m: Msg) { for (const fn of this.listeners) fn(m); }
  private act(a: Omit<Activity, "at">) { this.emit({ type: "activity", activity: { ...a, at: Date.now() } }); }

  private async loop() {
    // ponytail: stops ~1 minute after the last browser tab closes; restarts on the next connection
    let quiet = 0;
    while (quiet < 30) {
      quiet = this.listeners.size ? 0 : quiet + 1;
      try { await this.poll(); }
      catch (e) {
        const msg = (e as Error).message || String(e);
        if (msg !== this.error) { this.error = msg; this.emit(this.snapshot()); }
      }
      await sleep(2000);
    }
    for (const f of this.follows.values()) f.ctrl.abort();
    this.follows.clear();
    this.running = false;
  }

  private async poll() {
    const boot = await rpc<any>("bootstrap");
    let changed = !!this.error;
    this.error = "";
    const next = new Map<string, BotView>();
    for (const b of boot.bots ?? []) {
      const v: BotView = {
        id: b.id, name: b.name, title: clip(b.title || b.description, 80), color: b.color || "#6d7cff",
        sectionId: b.sectionId ?? null, status: b.status || "idle", preview: clip(typeof b.preview === "string" ? b.preview : "", 140),
        working: RUNNING.test(b.status || ""),
      };
      const old = this.bots.get(v.id);
      if (!old || JSON.stringify(old) !== JSON.stringify(v)) changed = true;
      // start/finish come from the poll so they are never duplicated or missed between subscriptions
      if (old && !old.working && v.working) this.act({ botId: v.id, kind: "start", emoji: "🚀", label: "เริ่มทำงาน" });
      if (old && old.working && !v.working && Date.now() - (this.failedAt.get(v.id) ?? 0) > 15000)
        this.act({ botId: v.id, kind: "done", emoji: "🎉", label: "เสร็จแล้ว!", detail: v.preview });
      next.set(v.id, v);
    }
    if (next.size !== this.bots.size) changed = true;
    this.bots = next;
    const groups: GroupView[] = (boot.groups ?? []).map((g: any) => ({ id: g.id, name: g.name, members: (g.members ?? []).map((m: any) => m.botId) }));
    const sections = (boot.botSections ?? []).filter((s: any) => [...next.values()].some(b => b.sectionId === s.id)).map((s: any) => ({ id: s.id, name: s.name }));
    if (JSON.stringify([groups, sections]) !== JSON.stringify([this.groups, this.sections])) changed = true;
    this.groups = groups;
    this.sections = sections;
    if (changed) this.emit(this.snapshot());

    const now = Date.now();
    for (const v of next.values()) if (v.working) this.follow(`bot:${v.id}`, { botId: v.id }, now);
    for (const g of groups) this.follow(`group:${g.id}`, { groupId: g.id }, now);
    for (const [key, f] of this.follows)
      if (now - f.seen > 120_000) { f.ctrl.abort(); this.follows.delete(key); }
  }

  private follow(key: string, target: { botId?: string; groupId?: string }, now: number) {
    const f = this.follows.get(key);
    if (f) { f.seen = now; return; }
    const ctrl = new AbortController();
    this.follows.set(key, { ctrl, seen: now });
    void (async () => {
      let cursor = (await rpc<any>("threads/get", target)).cursor ?? 0;
      while (!ctrl.signal.aborted) {
        try {
          for await (const e of subscribe(target, cursor, ctrl.signal)) {
            cursor = Math.max(cursor, e.seq ?? cursor);
            this.onEvent(e, target.groupId);
          }
        } catch { /* API restart or abort: retry below */ }
        if (!ctrl.signal.aborted) await sleep(2000);
      }
    })().catch(() => this.follows.delete(key));
  }

  private onEvent(e: any, groupId?: string) {
    const p = e.payload ?? {}, botId: string | undefined = e.botId;
    if (!botId) return;
    switch (e.type) {
      case "thread.progress":
        if (p.activity && p.text) this.detail.set(botId, clip(p.text, 120));
        break;
      case "agent.tool.called": {
        const [, emoji, label] = TOOLS.find(([re]) => re.test(p.name ?? "")) ?? [null, "🛠️", "ใช้เครื่องมือ"];
        this.act({ botId, groupId, kind: "tool", emoji, label, detail: this.detail.get(botId) });
        this.detail.delete(botId);
        break;
      }
      case "thread.message.created": {
        if (p.role !== "bot") break;
        const blocks: any[] = p.blocks ?? [];
        const text = clip(blocks.map(b => b.text ?? "").join(" "), 240);
        if (blocks.some(b => b.kind === "ask" && b.status !== "answered"))
          this.act({ botId, groupId, kind: "ask", emoji: "✋", label: "ขออนุมัติหน่อย", detail: text });
        else if (text) this.act({ botId, groupId, kind: "say", emoji: "💬", label: text });
        break;
      }
      case "run.waiting_input":
        this.act({ botId, groupId, kind: "ask", emoji: "✋", label: "รอคำตอบจากลุงจืด" });
        break;
      case "run.failed":
        this.failedAt.set(botId, Date.now());
        this.act({ botId, groupId, kind: "fail", emoji: "💦", label: "งานล้มเหลว", detail: clip(p.error, 120) });
        break;
    }
  }
}

// survive Next dev hot reloads
const g = globalThis as unknown as { __botOfficeHub?: Hub };
export const hub = (g.__botOfficeHub ??= new Hub());
