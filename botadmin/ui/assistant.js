// Round 4, the "executive assistant" layer (ideas from Gemini Daily Brief + Live→Spark, Grok Chief-of-Staff and
// "@grok is this true?", OpenAI Dots event triggers + corrections, Meta Muse personas and its "Allow Always" lesson):
// morning brief, one decision card for everything waiting, speak a plan, fact check by another bot, event triggers,
// persona studio, and corrections that become approval rules. Data stays in Rakazo; app-only settings in localStorage.
"use strict";
(() => {
  const { $, esc, icon, relTime, toast, modal, confirm, call, go, store, PALETTE } = App;
  const rk = (path, input) => call("rk", { path, input: input || {} });
  const { tabs, av, botOf, bots } = App.work;
  const at = (key, tab) => tabs.splice(tabs.findIndex(t => t[0] === key) + 1, 0, tab);
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ready = () => !!(store.snap?.rakazo.health.startsWith("พร้อม") && App.chat.state.ready);
  const byName = n => bots().find(b => b.name === n);
  const ceo = () => byName("CEO") || bots()[0];
  const colorIdx = c => { const i = PALETTE.findIndex(p => p[0] === c); return i < 0 ? null : i; };
  const today = () => new Date().toLocaleDateString("sv-SE");
  const hhmm = () => new Date().toTimeString().slice(0, 5);
  const textOf = m => (m.blocks || []).filter(b => b.kind === "text").map(b => b.text).join("\n").trim();
  const changed = new Set(); // views to re-render when background work finishes
  const emit = () => changed.forEach(fn => fn());
  // satang (integer, as a string from the host) -> "1,234.50": string math only, never float
  const baht = s => { const d = String(s).replace(/^-/, "").padStart(3, "0"); return (String(s).startsWith("-") ? "-" : "") + d.slice(0, -2).replace(/\B(?=(\d{3})+$)/g, ",") + "." + d.slice(-2); };
  // the local model answers JSON inside the text; take the outermost {...}
  async function askJson(system, prompt, maxTokens = 1200) {
    const { text } = await call("llm.ask", { system, prompt, maxTokens });
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    if (s < 0 || e < s) throw new Error("โมเดลตอบไม่เป็น JSON");
    return JSON.parse(text.slice(s, e + 1));
  }

  // send a message to a bot and wait for that bot's reply (the whole exchange is in its chat as usual)
  async function askBot(botId, text, ms = 900000) {
    const before = new Set((await rk("threads/get", { botId })).messages.map(m => m.id));
    await rk("threads/send", { botId, text });
    const t0 = Date.now();
    await sleep(3000);
    while (Date.now() - t0 < ms) {
      const [snap, act] = await Promise.all([rk("threads/get", { botId }), rk("runs/list", { filter: "active" })]);
      const reply = snap.messages.filter(m => !before.has(m.id) && m.role !== "user").map(textOf).filter(Boolean);
      if (reply.length && !act.runs.some(r => r.botId === botId && !r.groupId)) return reply.join("\n\n");
      await sleep(3000);
    }
    throw new Error("รอคำตอบนานเกินไป");
  }

  // ---------- 1. morning brief (Gemini Daily Brief): the CEO bot reads the book + what is waiting, ranks by company goals ----------
  const BRIEF = "bt.brief"; // { on, time, last: { at, text, by }, day }
  const RUN_TH = { completed: "เสร็จ", failed: "ล้มเหลว", cancelled: "ยกเลิก", running: "กำลังทำ", queued: "รอคิว", waiting_input: "รอคำตอบ", waiting_takeover: "รอให้ช่วย" };
  let briefing = null;
  function makeBrief() {
    if (briefing) return briefing;
    const c = ceo();
    if (!c) return Promise.reject(new Error("ไม่มีบอท CEO"));
    briefing = (async () => {
      const [act, rec] = await Promise.all([rk("runs/list", { filter: "active" }), rk("runs/list", { filter: "recent" })]);
      const line = r => `- ${r.botName}${r.groupName ? ` (${r.groupName})` : ""}: ${(r.promptSnippet || "").replace(/\s+/g, " ").slice(0, 140)}`;
      const wait = act.runs.filter(r => /^waiting_/.test(r.status));
      const reply = await askBot(c.id, `📋 สรุปงานตอนเช้า (แอปขอ ${new Date().toLocaleString("th-TH")})
ข้อมูลจากระบบ:
เรื่องที่รอผู้บริหารตัดสินใจ (${wait.length}):
${wait.map(line).join("\n") || "- ไม่มี"}
งานล่าสุดของทีม:
${rec.runs.slice(0, 12).map(r => `${line(r)} [${RUN_TH[r.status] || r.status}]`).join("\n") || "- ไม่มี"}

ช่วยทำสรุปเช้าให้ผู้บริหาร:
1) ใช้ mcp__demo-accounting__get_ar_aging และ mcp__demo-accounting__get_sales_summary ดึงลูกหนี้ค้างชำระและยอดขาย ตัวเลขต้องมาจากระบบเท่านั้น ห้ามแต่ง
2) จัดลำดับความสำคัญตามเป้าหมายในความรู้บริษัท
3) ตอบภาษาไทยไม่เกิน 12 บรรทัด หัวข้อ: 📊 ตัวเลขสำคัญ / ⚡ เรื่องที่ต้องตัดสินใจ / 👥 งานของทีม / ✅ แนะนำให้ทำวันนี้
งานนี้ห้ามส่งงานต่อ ห้ามสร้างหรือแก้ข้อมูลใด ๆ`);
      lsSet(BRIEF, { ...ls(BRIEF, {}), last: { at: new Date().toISOString(), text: reply, by: c.name }, day: today() });
      call("notify", { title: "BotTeam · สรุปงานเช้าพร้อมแล้ว", body: reply.replace(/[#*_`>|]/g, "").slice(0, 160), route: { type: "work", tab: "brief" } }).catch(() => {});
      return reply;
    })().finally(() => { briefing = null; emit(); });
    emit();
    return briefing;
  }
  // scheduled: once a day, within 2 hours after the set time (the app has to be open; it usually is)
  setInterval(() => {
    const b = ls(BRIEF, {}), t = b.time || "08:00", now = hhmm();
    const [h, m] = t.split(":").map(Number), late = `${String(Math.min(23, h + 2)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    if (b.on && ready() && !briefing && b.day !== today() && now >= t && now <= late) makeBrief().catch(e => toast("สรุปเช้าไม่สำเร็จ: " + e.message, "bad"));
  }, 30000);

  async function brief(body, refresh) {
    const b = ls(BRIEF, {}), c = ceo();
    body.innerHTML = `<div class="card brief"><div class="row" style="gap:12px;align-items:flex-start">${c ? av(c.id, c.name, "") : ""}
        <div style="flex:1;min-width:0"><h3 style="margin:0">☀️ สรุปงานเช้า</h3>
          <div class="muted" style="font-size:12.5px">${esc(c?.name || "CEO")} ดึงตัวเลขจากระบบบัญชี ดูเรื่องที่รอคุณและงานของทีม แล้วจัดลำดับตามเป้าหมายบริษัท</div></div>
        <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <label class="row" style="gap:6px;cursor:pointer"><input type="checkbox" id="bf-on" ${b.on ? "checked" : ""}>ทุกวันเวลา</label>
          <input class="input" type="time" id="bf-time" value="${esc(b.time || "08:00")}" style="width:120px">
          <button class="btn" id="bf-say" ${b.last ? "" : "disabled"}>🔊 ฟัง</button>
          <button class="btn primary" id="bf-now" ${briefing || !c ? "disabled" : ""}>${briefing ? '<span class="spin"></span>กำลังสรุป…' : icon("sparkles") + "สรุปตอนนี้"}</button></div></div>
        <div class="brief-text" id="bf-text">${b.last ? App.chat.md(b.last.text) + `<div class="muted" style="font-size:12px;margin-top:10px">${esc(b.last.by)} · ${esc(relTime(b.last.at))}</div>`
          : `<div class="muted">ยังไม่มีสรุป — กด "สรุปตอนนี้" หรือเปิด "ทุกวันเวลา"</div>`}</div></div>
      <h3 class="sec-title" style="margin-top:20px">เรื่องที่รอคุณ</h3><div id="bf-inbox"></div>`;
    const save = () => lsSet(BRIEF, { ...ls(BRIEF, {}), on: $("#bf-on", body).checked, time: $("#bf-time", body).value || "08:00" });
    $("#bf-on", body).onchange = save; $("#bf-time", body).onchange = save;
    $("#bf-say", body).onclick = () => App.voice.speak(ls(BRIEF, {}).last?.text || "", c?.id);
    $("#bf-now", body).onclick = () => {
      makeBrief().then(text => { App.voice.speak(text, c?.id); toast("สรุปงานเช้าพร้อมแล้ว", "good"); }, e => toast("สรุปไม่สำเร็จ: " + e.message, "bad"));
      refresh();
    };
    await App.work.inbox($("#bf-inbox", body), refresh);
    return JSON.stringify([b.last?.at, !!briefing]);
  }

  // ---------- 2. one decision card for everything waiting (Grok Chief-of-Staff) ----------
  const digests = new Map(); // signature -> Promise<{ headline, items }>
  const REC = { allow: ["แนะนำ: อนุญาต", "good"], deny: ["แนะนำ: ปฏิเสธ", "bad"], answer: ["ต้องตอบเอง", "warn"], help: ["ต้องช่วยบนจอ", "warn"] };
  function digest(items, el, root, answer) {
    const list = items.map(({ r, block }, i) => ({
      i, bot: r.botName, kind: !block ? "รอคุณ" : block.kind !== "ask" ? "ขอให้ช่วยบนหน้าจอ" : block.approvalEffectId ? "ขออนุมัติ" : "ถามคำถาม",
      text: [block?.text && App.chat.th(block.text), block?.detail && App.chat.th(block.detail)].filter(Boolean).join(" · ").replace(/\s+/g, " ").slice(0, 300) || r.promptSnippet || "",
      actions: (block?.actions || []).map(a => a.id),
    }));
    const sig = items.map(x => x.r.runId).join();
    if (!digests.has(sig)) digests.set(sig, askJson(
      `คุณคือผู้ช่วยผู้บริหาร (Chief of Staff) ของบริษัท สรุปเรื่องที่บอทรอผู้บริหารให้ตัดสินใจได้ในครั้งเดียว
ตอบ JSON อย่างเดียว: {"headline":"สรุปภาพรวม 1 ประโยค","items":[{"i":เลขลำดับ,"summary":"สรุปไม่เกิน 80 ตัวอักษร","recommend":"allow|deny|answer|help","reason":"เหตุผลสั้นๆ"}]}
recommend: allow = ควรอนุญาต, deny = ควรปฏิเสธ (เสี่ยงเรื่องเงิน ข้อมูลส่วนตัว ไม่ชัดเจน หรือไม่จำเป็น), answer = ต้องพิมพ์ตอบเอง, help = ต้องไปช่วยบนหน้าจอ`,
      JSON.stringify(list)).catch(e => ({ error: e.message })));
    const draw = res => {
      if (!el.isConnected && !root.isConnected) return;
      const rows = res.items || [];
      const doable = rows.filter(x => /^(allow|deny)$/.test(x.recommend) && list[x.i]?.actions.includes(x.recommend));
      el.innerHTML = `<div class="card digest"><div class="row" style="gap:10px"><b>🧭 สรุปจากผู้ช่วย · ${items.length} เรื่อง</b><span class="grow"></span>
          ${doable.length ? `<button class="btn sm primary" data-dg-all>${icon("check")}ทำตามคำแนะนำ (${doable.length})</button>` : ""}</div>
        <div class="muted" style="margin:4px 0 8px">${esc(res.error ? "สรุปอัตโนมัติไม่สำเร็จ (โมเดลไม่ว่าง) — ตอบทีละการ์ดด้านล่างได้ตามปกติ" : res.headline || "")}</div>
        ${rows.filter(x => list[x.i]).map(x => { const [t, cls] = REC[x.recommend] || ["", ""], it = items[x.i];
          return `<div class="dg-row">${av(it.r.botId, it.r.botName)}<div style="flex:1;min-width:0"><b>${esc(it.r.botName)}</b> <span class="muted">${esc(list[x.i].kind)}</span>
            <div>${esc(x.summary || "")}</div><div class="muted" style="font-size:12px">${esc(x.reason || "")}</div></div>
            ${t ? `<span class="chip ${cls}">${t}</span>` : ""}</div>`; }).join("")}</div>`;
      const all = $("[data-dg-all]", el);
      if (all) all.onclick = async () => {
        const ok = await confirm({ title: `ทำตามคำแนะนำ ${doable.length} เรื่อง?`, ok: "ยืนยัน",
          body: doable.map(x => `${items[x.i].r.botName}: ${x.recommend === "allow" ? "อนุญาตครั้งนี้" : "ปฏิเสธ"} — ${x.summary || ""}`).join("\n") });
        if (!ok) return;
        for (const x of doable) {
          const btn = root.querySelector(`[data-answer="${x.recommend}"][data-i="${x.i}"]`);
          if (btn && !btn.disabled) await answer(x.i, x.recommend, btn);
        }
      };
    };
    el.innerHTML = `<div class="card digest"><b>🧭 สรุปจากผู้ช่วย · ${items.length} เรื่อง</b><div class="muted"><span class="spin"></span> กำลังอ่านทุกเรื่องและเตรียมคำแนะนำ…</div></div>`;
    digests.get(sig).then(draw);
  }

  // ---------- 3. speak (or type) a messy plan -> plan card -> CEO hands out one-off work, repeats become routines ----------
  const REPEAT = [["none", "ครั้งเดียว"], ["daily", "ทุกวัน"], ["weekdays", "จันทร์–ศุกร์"], ["weekly", "ทุกสัปดาห์"]];
  const CRON = (repeat, time) => { const [h, m] = (/^\d\d:\d\d$/.test(time) ? time : "08:00").split(":").map(Number); return `${m} ${h} * * ${repeat === "daily" ? "*" : repeat === "weekdays" ? "1-5" : new Date().getDay()}`; };
  async function makePlan(said) {
    const roster = bots().map(b => `${b.name}${b.title ? ` (${b.title.replace(/^\p{Extended_Pictographic}\S*\s*/u, "")})` : ""}`).join(", ");
    const res = await askJson(`แปลงคำพูดของผู้บริหาร (อาจวกวน ไม่เรียง) เป็นแผนงานที่ชัดเจน แยกเป็นงานย่อย มอบให้บอทที่เหมาะที่สุดจากรายชื่อนี้เท่านั้น: ${roster}
ตอบ JSON อย่างเดียว: {"summary":"สรุปแผน 1 ประโยค","tasks":[{"title":"สิ่งที่ต้องทำ ชัดเจน","bot":"ชื่อบอทตามรายชื่อ","due":"กำหนดส่งเป็นคำพูด หรือ \\"\\"","repeat":"none|daily|weekdays|weekly","time":"HH:MM สำหรับงานทำซ้ำ หรือ \\"\\""}]}`, said, 1500);
    const tasks = (res.tasks || []).filter(t => t && t.title).map(t => ({ title: String(t.title).slice(0, 300), botId: (byName(t.bot) || ceo())?.id,
      due: String(t.due || "").slice(0, 60), repeat: REPEAT.some(([k]) => k === t.repeat) ? t.repeat : "none", time: /^\d\d:\d\d$/.test(t.time) ? t.time : "08:00" }));
    if (!tasks.length) throw new Error("ไม่พบงานในสิ่งที่พูด ลองพูดให้ชัดขึ้นว่าอยากให้ใครทำอะไร");
    return { summary: String(res.summary || ""), tasks };
  }
  function planCard(said, plan) {
    const m = modal(`<h2>🗂 แผนงานจากที่คุณพูด</h2><div class="muted" style="margin-bottom:6px">${esc(plan.summary)}</div>
      <details class="muted" style="font-size:12.5px;margin-bottom:10px"><summary>สิ่งที่พูด</summary>${esc(said)}</details>
      <div class="plan-rows">${plan.tasks.map((t, i) => `<div class="plan-row" data-row="${i}"><input type="checkbox" checked data-k="on">
        <input class="input" data-k="title" value="${esc(t.title)}" style="flex:2;min-width:180px">
        <select class="input" data-k="bot" style="width:150px">${bots().map(b => `<option value="${esc(b.id)}" ${b.id === t.botId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
        <input class="input" data-k="due" value="${esc(t.due)}" placeholder="กำหนดส่ง" style="width:120px">
        <select class="input" data-k="repeat" style="width:120px">${REPEAT.map(([k, v]) => `<option value="${k}" ${k === t.repeat ? "selected" : ""}>${v}</option>`).join("")}</select>
        <input class="input" type="time" data-k="time" value="${esc(t.time)}" style="width:105px"></div>`).join("")}</div>
      <div class="muted" style="font-size:12px;margin-top:8px">งานครั้งเดียว → CEO ส่งงานให้แต่ละฝ่าย (เห็นลูกศรที่ห้องควบคุม) · งานทำซ้ำ → ตั้งเป็นงานประจำของบอทนั้น</div>
      <div class="actions"><button class="btn ghost" id="pl-cancel">ยกเลิก</button><button class="btn primary" id="pl-ok">${icon("check")}อนุมัติแผน</button></div>`, { wide: true });
    const sync = () => m.el.querySelectorAll(".plan-row").forEach(r => { $('[data-k="time"]', r).hidden = $('[data-k="repeat"]', r).value === "none"; });
    m.el.querySelectorAll('[data-k="repeat"]').forEach(s => s.onchange = sync); sync();
    $("#pl-cancel", m.el).onclick = m.close;
    $("#pl-ok", m.el).onclick = async e => {
      const rows = [...m.el.querySelectorAll(".plan-row")].map(r => Object.fromEntries([...r.querySelectorAll("[data-k]")].map(x => [x.dataset.k, x.type === "checkbox" ? x.checked : x.value.trim()])))
        .filter(r => r.on && r.title);
      if (!rows.length) return toast("เลือกอย่างน้อย 1 งาน", "warn");
      const btn = e.currentTarget; btn.disabled = true; // currentTarget is null after the await
      try { const r = await approvePlan(rows); m.close(); toast(`อนุมัติแล้ว: ส่งงาน ${r.once} งาน · งานประจำ ${r.routines} งาน`, "good"); go({ type: "work", tab: "team" }); }
      catch (err) { toast("ไม่สำเร็จ: " + err.message, "bad"); btn.disabled = false; }
    };
    return m;
  }
  async function approvePlan(rows, leadId) { // lead = who hands out the one-off work (CEO; tests use a test bot)
    const repeat = rows.filter(r => r.repeat !== "none"), once = rows.filter(r => r.repeat === "none"), c = (leadId && botOf(leadId)) || ceo();
    for (const r of repeat) await rk("routines/create", { botId: r.bot, notify: true, name: r.title.slice(0, 80), prompt: r.title, crons: [CRON(r.repeat, r.time)], timezone: "Asia/Bangkok", active: true });
    if (once.length) await rk("threads/send", { botId: c.id, text: `แผนงานที่ผู้บริหารอนุมัติแล้ว:\n${once.map((r, i) => `${i + 1}) ถึง "${botOf(r.bot)?.name}": ${r.title}${r.due ? ` (กำหนด: ${r.due})` : ""}`).join("\n")}\n\nส่งงานแต่ละข้อให้บอทที่ระบุด้วย message_bot (intent=request) ข้อละ 1 ข้อความ ข้อที่ระบุถึง "${c.name}" ให้ทำเอง ติดตามผลจนครบ แล้วสรุปให้ผมสั้นๆ` });
    return { once: once.length, routines: repeat.length };
  }
  async function planFrom(said) {
    said = String(said || "").trim();
    if (!said) throw new Error("พูดหรือพิมพ์สิ่งที่อยากให้ทีมทำก่อน");
    return planCard(said, await makePlan(said));
  }

  // ---------- 4. fact check: another bot checks a claim against the accounting system + company knowledge ----------
  const VER = "bt.verify"; // msgId -> { state, verdict, text, by, at }
  const VERDICT = { "ถูกต้อง": ["✅", "good"], "ไม่ถูกต้อง": ["❌", "bad"], "ตรวจไม่ได้": ["❓", "warn"] };
  const verifier = () => byName(ls("bt.verifier", "ฝ่ายบัญชี")) || byName("ฝ่ายบัญชี") || ceo();
  function verifyBadge(msgId) {
    const v = ls(VER, {})[msgId];
    if (!v) return "";
    if (v.state === "checking") return `<span class="vbadge warn" data-vbadge="${esc(msgId)}"><span class="spin"></span>${esc(v.by)} กำลังตรวจ…</span>`;
    const [e, cls] = VERDICT[v.verdict] || ["❓", "warn"];
    return `<button class="vbadge ${cls}" data-vbadge="${esc(msgId)}" data-vshow="${esc(msgId)}" title="ดูหลักฐาน">${e} ${esc(v.by)}: ${esc(v.verdict || "ตรวจไม่ได้")}</button>`;
  }
  const paintBadge = id => document.querySelectorAll(`[data-vbadge="${CSS.escape(id)}"]`).forEach(x => { x.outerHTML = verifyBadge(id); });
  const putVer = (id, v) => { const all = ls(VER, {}); all[id] = v; lsSet(VER, all); paintBadge(id); };
  async function verify({ msgId, text, botName, at, verifierId }) {
    const v = verifierId ? botOf(verifierId) : verifier();
    if (!v) throw new Error("ไม่มีบอทสำหรับตรวจ");
    putVer(msgId, { state: "checking", by: v.name, at: new Date().toISOString() });
    try {
      const reply = await askBot(v.id, `🔎 ขอให้ตรวจข้อเท็จจริง (จากแอป)
ข้อความของ ${botName} เมื่อ ${new Date(at || Date.now()).toLocaleString("th-TH")}:
"""${String(text).slice(0, 2500)}"""

ตรวจกับระบบบัญชีสาธิต (mcp__demo-accounting__*) และความรู้บริษัท ห้ามเดา ห้ามแก้ข้อมูล
บรรทัดแรกต้องเป็น "ผลตรวจ: ถูกต้อง" หรือ "ผลตรวจ: ไม่ถูกต้อง" หรือ "ผลตรวจ: ตรวจไม่ได้"
จากนั้นบอกหลักฐานสั้นๆ (ตัวเลข/รายการที่ใช้ตรวจ)`);
      const verdict = (/ผลตรวจ\s*[:：]?\s*\**\s*(ไม่ถูกต้อง|ถูกต้อง|ตรวจไม่ได้)/.exec(reply) || [])[1] || "ตรวจไม่ได้";
      putVer(msgId, { state: "done", verdict, text: reply, by: v.name, at: new Date().toISOString() });
      return verdict;
    } catch (e) { putVer(msgId, { state: "done", verdict: "ตรวจไม่ได้", text: e.message, by: v.name, at: new Date().toISOString() }); throw e; }
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-vshow]");
    if (!b) return;
    const v = ls(VER, {})[b.dataset.vshow];
    if (!v) return;
    const m = modal(`<h2>${(VERDICT[v.verdict] || ["❓"])[0]} ผลตรวจโดย ${esc(v.by)}</h2><div class="brief-text">${App.chat.md(v.text || "")}</div>
      <div class="muted" style="font-size:12px;margin-top:8px">${esc(relTime(v.at))}</div><div class="actions"><button class="btn primary" data-x>ปิด</button></div>`);
    $("[data-x]", m.el).onclick = m.close;
  });

  // ---------- 5. event triggers (Dots / Grok automations): accounting book + a watched folder -> a bot looks, read-only ----------
  const TRIG = "bt.triggers", TLOG = "bt.triggerLog";
  const EVENTS = { invoice: ["🧾", "มีใบแจ้งหนี้ใหม่", /^ขายสินค้า/], payment: ["💰", "ได้รับชำระเงิน", /^รับชำระจาก/], purchase: ["📦", "ซื้อสินค้าเข้า", /^ซื้อสินค้าจาก/], file: ["📥", "มีไฟล์ใหม่ในโฟลเดอร์ inbox", null] };
  const PRESETS = [["invoice", "ฝ่ายบัญชี", "ตรวจว่าใบแจ้งหนี้ถูกต้อง (ราคา VAT ยอดรวม เครดิตเทอม) แล้วรายงานสั้นๆ"],
    ["payment", "ฝ่ายขาย", "ร่างข้อความขอบคุณลูกค้า (ยังไม่ต้องส่ง) และบอกยอดค้างที่เหลือของลูกค้ารายนี้"],
    ["purchase", "ฝ่ายคลังสินค้า", "ตรวจสต็อกหลังรับของ และแจ้งถ้ามีสินค้าใกล้หมด"],
    ["file", "CEO", "สรุปเอกสารสั้นๆ และบอกว่าควรส่งให้ฝ่ายไหนดำเนินการต่อ"]];
  const ATTACH = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json" };
  const kindOf = ev => Object.keys(EVENTS).find(k => EVENTS[k][2]?.test(ev.memo));
  const describe = ev => `${ev.ref} · ${ev.memo} · ยอด ${baht(ev.amount)} บาท · วันที่ ${ev.date} (${ev.id})`;
  let cursor = null, seenFiles = null, ticking = false;
  const logFire = x => { const l = ls(TLOG, []); l.unshift({ at: new Date().toISOString(), ...x }); lsSet(TLOG, l.slice(0, 30)); emit(); };
  async function fire(t, detail, file, test) {
    const b = botOf(t.botId), [e, label] = EVENTS[t.event];
    if (!b) return;
    try {
      const ids = [];
      if (file) {
        const mime = ATTACH[(file.name.split(".").pop() || "").toLowerCase()];
        if (!mime) throw new Error("ชนิดไฟล์ไม่รองรับ: " + file.name);
        const f = await call("inbox.read", { name: file.name });
        ids.push((await rk("artifacts/create", { botId: b.id, name: f.name, mimeType: mime, contentBase64: f.base64 })).id);
      }
      await rk("threads/send", { botId: b.id, ...(ids.length ? { artifactIds: ids } : {}), text: `⚡ เหตุการณ์อัตโนมัติ${test ? " (ทดสอบ)" : ""}: ${e} ${label}
${detail}
โหมดเฝ้าดู: อ่านและตรวจได้ แต่ห้ามสร้าง แก้ หรือส่งอะไรเอง — ถ้าควรทำอะไรต่อ ให้เสนอเป็นข้อๆ เพื่อให้ผู้บริหารอนุมัติ
งานที่ต้องทำ: ${t.note}` });
      logFire({ event: t.event, bot: b.name, detail, ok: true, test: !!test });
    } catch (err) { logFire({ event: t.event, bot: b.name, detail, ok: false, error: err.message, test: !!test }); }
  }
  async function tick() {
    const list = ls(TRIG, []).filter(t => t.on);
    if (ticking || !list.length || !ready()) return false; // false = skipped (tests wait for a real look)
    ticking = true;
    try {
      if (list.some(t => t.event !== "file")) {
        const r = await call("acct.events", { after: cursor ?? 0 });
        if (cursor !== null) for (const ev of r.events) { const k = kindOf(ev); for (const t of list.filter(x => x.event === k)) await fire(t, describe(ev)); }
        cursor = r.last; // first look starts from now: history is never replayed
      }
      if (list.some(t => t.event === "file")) {
        const files = await call("inbox.list"), key = f => f.name + "|" + f.at;
        if (seenFiles) for (const f of files.filter(f => !seenFiles.has(key(f))))
          for (const t of list.filter(x => x.event === "file")) await fire(t, `ไฟล์: ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB) ในโฟลเดอร์ inbox`, f);
        seenFiles = new Set(files.map(key));
      }
    } catch { /* WSL/Rakazo busy: next tick */ }
    ticking = false;
    return true;
  }
  document.addEventListener("app:start", () => setInterval(tick, 10000));
  async function testFire(t) {
    if (t.event === "file") {
      const f = (await call("inbox.list")).sort((a, b) => b.at - a.at)[0];
      if (!f) throw new Error("ยังไม่มีไฟล์ในโฟลเดอร์ inbox — วางไฟล์สักไฟล์ก่อน");
      return fire(t, `ไฟล์: ${f.name} ในโฟลเดอร์ inbox`, f, true);
    }
    const ev = (await call("acct.events", { after: 0 })).events.filter(x => kindOf(x) === t.event).pop();
    if (!ev) throw new Error("ยังไม่มีรายการประเภทนี้ในระบบบัญชี");
    return fire(t, describe(ev), null, true);
  }
  async function triggers(body, refresh) {
    const list = ls(TRIG, []), log = ls(TLOG, []);
    const save = l => { lsSet(TRIG, l); refresh(); };
    body.innerHTML = `<div class="row" style="margin-bottom:14px;gap:10px"><div class="muted grow">ให้บอทตื่นมาดูเองเมื่อมีเหตุการณ์ — โหมดเฝ้าดู: บอทอ่านและเสนอสิ่งที่ควรทำ ไม่สร้าง/แก้/ส่งเอง
        (ถ้าเปิดกฎอนุมัติไว้ การเขียนจะเด้งการ์ดขออนุญาตเสมอ) · ตรวจทุก 10 วินาที ขณะเปิดแอป</div>
        <button class="btn" id="tg-folder">${icon("folder")}เปิดโฟลเดอร์ inbox</button></div>
      <div class="card" style="padding:4px 0">${list.length ? list.map((t, i) => { const [e, label] = EVENTS[t.event] || ["?", t.event], b = botOf(t.botId);
        return `<div class="rule-row"><span style="font-size:22px">${e}</span><div style="min-width:0;flex:1"><b>${esc(label)}</b> → ${b ? av(b.id, b.name) : ""} <b>${esc(b?.name || "(ไม่มีบอท)")}</b>
          <div class="muted" style="font-size:12px">${esc(t.note)}</div></div>
          <label class="row" style="gap:6px;cursor:pointer"><input type="checkbox" data-on="${i}" ${t.on ? "checked" : ""}>เปิด</label>
          <button class="btn sm" data-test="${i}">ทดสอบ</button><button class="btn sm ghost icon" data-del="${i}" title="ลบ">${icon("trash")}</button></div>`; }).join("")
        : `<div class="muted" style="padding:16px">ยังไม่มีทริกเกอร์ — เพิ่มจากตัวอย่างด้านล่าง</div>`}</div>
      <h3 class="sec-title" style="margin-top:20px">เพิ่มจากตัวอย่าง</h3><div class="row" style="gap:8px;flex-wrap:wrap">${PRESETS.map(([ev, bn, note], i) =>
        `<button class="btn" data-preset="${i}" ${byName(bn) || ev === "file" ? "" : "disabled"}>${EVENTS[ev][0]} ${esc(EVENTS[ev][1])} → ${esc(bn)}</button>`).join("")}</div>
      <h3 class="sec-title" style="margin-top:20px">เกิดขึ้นล่าสุด<span>${log.length}</span></h3>
      <div class="card" style="padding:4px 0">${log.length ? log.slice(0, 20).map(x => `<div class="act-row"><span class="dot ${x.ok ? "good" : "bad"}"></span>
        <div style="min-width:0;flex:1"><b>${esc((EVENTS[x.event] || [""])[0])} ${esc(x.bot)}</b>${x.test ? ' <span class="chip">ทดสอบ</span>' : ""}<div class="muted act-snippet">${esc(x.error || x.detail)}</div></div>
        <span class="muted" style="font-size:12px">${esc(relTime(x.at))}</span></div>`).join("") : `<div class="muted" style="padding:16px">ยังไม่มีเหตุการณ์</div>`}</div>`;
    body.querySelectorAll("[data-on]").forEach(x => x.onchange = () => { list[x.dataset.on].on = x.checked; save(list); });
    body.querySelectorAll("[data-del]").forEach(x => x.onclick = () => { list.splice(+x.dataset.del, 1); save(list); });
    body.querySelectorAll("[data-test]").forEach(x => x.onclick = async () => {
      x.disabled = true;
      try { await testFire(list[x.dataset.test]); toast("ส่งเหตุการณ์ทดสอบให้บอทแล้ว", "good"); } catch (e) { toast(e.message, "bad"); }
      refresh();
    });
    body.querySelectorAll("[data-preset]").forEach(x => x.onclick = () => {
      const [event, bn, note] = PRESETS[x.dataset.preset], b = byName(bn) || ceo();
      save([...list, { id: Date.now().toString(36), event, botId: b.id, note, on: true }]);
    });
    $("#tg-folder", body).onclick = async () => { await call("inbox.list"); call("open.folder", { path: "D:\\localai\\inbox" }).catch(e => toast(e.message, "bad")); };
    return JSON.stringify([log[0]?.at, list.length]);
  }

  // ---------- 6. persona studio (Meta Muse): emoji + colour + one-line title + personality + voice, and a shareable card ----------
  const EMOJI_RE = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u;
  const EMOJIS = ["🦁", "🐯", "🦊", "🐼", "🐨", "🐸", "🦉", "🐙", "🦄", "🐝", "🤖", "👩‍💼", "👨‍💼", "🧑‍💻", "👩‍🔬", "🧙", "🦸", "🕵️", "💼", "📊", "🧾", "📦", "🛒", "🎯"];
  const MOODS = ["สุภาพ เป็นทางการ", "เป็นกันเอง อบอุ่น", "ตลก ขี้เล่น แต่ทำงานจริงจัง", "มืออาชีพ กระชับ ตรงประเด็น", "ใจเย็น ละเอียดรอบคอบ"];
  const P_START = "## บุคลิก (ตั้งจากสตูดิโอตัวตน)", P_END = "## จบบุคลิก";
  const P_RE = /\n*## บุคลิก \(ตั้งจากสตูดิโอตัวตน\)\n[\s\S]*?\n## จบบุคลิก\n?/;
  const splitTitle = t => { const m = EMOJI_RE.exec(t || ""); return { emoji: m ? m[1] : "", title: m ? t.slice(m[0].length) : t || "" }; };
  const personaOf = b => ((b.instructions || "").match(P_RE)?.[0] || "").replace(P_START, "").replace(P_END, "").trim();
  const voiceOf = id => ls("bt.voice." + id, { pitch: 1, rate: 1 });
  App.persona = { emojiOf: name => splitTitle(bots().find(b => b.name === name)?.title).emoji, voiceOf };
  function personaEditor(b, done) {
    const cur = splitTitle(b.title), v = voiceOf(b.id);
    let emoji = cur.emoji, color = colorIdx(b.color) ?? 0;
    const m = modal(`<h2>🎭 ตัวตนของ ${esc(b.name)}</h2>
      <div class="row" style="gap:14px;align-items:center"><div id="ps-av"></div><div class="muted" style="font-size:12.5px">แสดงทุกที่ในแอป ห้องควบคุม และออฟฟิศ 3D</div></div>
      <div class="field"><label>ชื่อ</label><input class="input" id="ps-name" maxlength="40" value="${esc(b.name)}"></div>
      <div class="field"><label>อีโมจิ</label><div class="emoji-pick">${EMOJIS.map(e => `<button class="${e === emoji ? "on" : ""}" data-e="${e}">${e}</button>`).join("")}<button data-e="">ไม่ใช้</button></div></div>
      <div class="field"><label>สี</label><div class="row" style="gap:8px">${PALETTE.map((p, i) => `<button class="swatch ${i === color ? "on" : ""}" data-c="${i}" style="background:linear-gradient(145deg,${p[0]},${p[1]})"></button>`).join("")}</div></div>
      <div class="field"><label>ตำแหน่ง / คำโปรย</label><input class="input" id="ps-title" maxlength="60" value="${esc(cur.title)}" placeholder="เช่น นักขายสายฮา ปิดดีลไว"></div>
      <div class="field"><label>บุคลิก (บอทใช้ในทุกคำตอบ)</label><div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px">${MOODS.map(x => `<button class="chip" data-mood="${esc(x)}" style="cursor:pointer">${esc(x)}</button>`).join("")}</div>
        <textarea class="input" id="ps-mood" rows="3" maxlength="400" placeholder="เช่น พูดจาเป็นกันเอง ใช้คำว่า 'ค่ะ' ชอบสรุปเป็นข้อๆ">${esc(personaOf(b))}</textarea></div>
      <div class="field"><label>เสียงพูด (อ่านออกเสียงในแอป)</label><div class="row" style="gap:8px">
        <select class="input" id="ps-pitch" style="width:140px">${[[0.8, "เสียงต่ำ"], [1, "เสียงปกติ"], [1.25, "เสียงสูง"]].map(([x, t]) => `<option value="${x}" ${+v.pitch === x ? "selected" : ""}>${t}</option>`).join("")}</select>
        <select class="input" id="ps-rate" style="width:140px">${[[0.85, "พูดช้า"], [1, "พูดปกติ"], [1.2, "พูดเร็ว"]].map(([x, t]) => `<option value="${x}" ${+v.rate === x ? "selected" : ""}>${t}</option>`).join("")}</select>
        <button class="btn" id="ps-try">🔊 ลองฟัง</button></div></div>
      <div class="actions"><button class="btn ghost" id="ps-cancel">ยกเลิก</button><button class="btn primary" id="ps-ok">${icon("check")}บันทึก</button></div>`);
    const nameEl = $("#ps-name", m.el), redraw = () => { $("#ps-av", m.el).innerHTML = App.avatar(nameEl.value || "?", { color, size: "lg", emoji }); };
    nameEl.oninput = redraw; redraw();
    m.el.querySelectorAll("[data-e]").forEach(x => x.onclick = () => { emoji = x.dataset.e; m.el.querySelectorAll("[data-e]").forEach(y => y.classList.toggle("on", y === x)); redraw(); });
    m.el.querySelectorAll("[data-c]").forEach(x => x.onclick = () => { color = +x.dataset.c; m.el.querySelectorAll("[data-c]").forEach(y => y.classList.toggle("on", y === x)); redraw(); });
    m.el.querySelectorAll("[data-mood]").forEach(x => x.onclick = () => { $("#ps-mood", m.el).value = x.dataset.mood; });
    const voice = () => ({ pitch: +$("#ps-pitch", m.el).value, rate: +$("#ps-rate", m.el).value });
    $("#ps-try", m.el).onclick = () => App.voice.speak(`สวัสดีครับ ผม${nameEl.value} ${$("#ps-title", m.el).value}`, null, voice());
    $("#ps-cancel", m.el).onclick = m.close;
    $("#ps-ok", m.el).onclick = async e => {
      const name = nameEl.value.trim(), title = $("#ps-title", m.el).value.trim(), mood = $("#ps-mood", m.el).value.trim();
      if (!name) return toast("ใส่ชื่อบอท", "warn");
      const btn = e.currentTarget; btn.disabled = true; // currentTarget is null after the await
      try { await savePersona(b, { name, emoji, color, title, mood, ...voice() }); m.close(); toast("บันทึกตัวตนแล้ว", "good"); done(); }
      catch (err) { toast("บันทึกไม่สำเร็จ: " + err.message, "bad"); btn.disabled = false; }
    };
    return m;
  }
  async function savePersona(b, p) {
    const base = (b.instructions || "").replace(P_RE, "").trimEnd();
    await rk("bots/update", { botId: b.id, name: p.name, color: PALETTE[p.color][0], title: ((p.emoji ? p.emoji + " " : "") + p.title).trim(),
      instructions: p.mood ? `${base}\n\n${P_START}\n${p.mood}\n${P_END}` : base });
    lsSet("bt.voice." + b.id, { pitch: p.pitch ?? 1, rate: p.rate ?? 1 });
    await App.chat.load();
  }
  // shareable bot card (PNG): canvas, Thai text wrapped on word boundaries
  function cardPng(b) {
    const W = 900, H = 1200, cv = Object.assign(document.createElement("canvas"), { width: W, height: H }), g = cv.getContext("2d");
    const [c1, c2] = PALETTE[colorIdx(b.color) ?? 0], { emoji, title } = splitTitle(b.title), font = '"Leelawadee UI","Segoe UI",Tahoma,sans-serif';
    const [panel, ink, sub, body, foot] = document.documentElement.dataset.theme === "light" // card follows the app theme
      ? ["rgba(255,255,255,.94)", "#14162b", "#555a7a", "#30344f", "#8a8fb0"] : ["rgba(17,17,20,.94)", "#ededed", "#a3a3ad", "#c9c9d1", "#6f6f78"];
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, c1); bg.addColorStop(1, c2); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = panel; g.beginPath(); g.roundRect(60, 60, W - 120, H - 120, 48); g.fill();
    g.fillStyle = bg; g.beginPath(); g.arc(W / 2, 330, 150, 0, Math.PI * 2); g.fill();
    g.textAlign = "center"; g.textBaseline = "middle"; g.font = `150px ${font}`; g.fillStyle = "#fff";
    g.fillText(emoji || (b.name.match(/[ก-ฮA-Za-z0-9]/) || ["?"])[0], W / 2, 340);
    g.fillStyle = ink; g.font = `bold 68px ${font}`; g.fillText(b.name, W / 2, 570);
    g.fillStyle = sub; g.font = `36px ${font}`; g.fillText(title.slice(0, 40), W / 2, 640);
    const words = [...new Intl.Segmenter("th", { granularity: "word" }).segment(personaOf(b) || "พร้อมทำงานให้ทีม")].map(s => s.segment);
    g.font = `32px ${font}`; g.fillStyle = body;
    let line = "", y = 740;
    for (const w of words) { if (g.measureText(line + w).width > W - 220 && line) { g.fillText(line.trim(), W / 2, y); y += 50; line = ""; if (y > 960) break; } line += w; }
    if (line && y <= 960) g.fillText(line.trim(), W / 2, y);
    g.fillStyle = foot; g.font = `26px ${font}`; g.fillText("BotTeam · ทีม AI ที่ทำงานในเครื่อง", W / 2, H - 120);
    return cv.toDataURL("image/png");
  }
  async function persona(body, refresh) {
    body.innerHTML = `<div class="muted" style="margin-bottom:14px">ตั้งหน้าตา นิสัย และเสียงของบอทแต่ละตัว — แสดงในแชท ห้องควบคุม ออฟฟิศ 3D และส่งออกเป็นการ์ดไว้แชร์ได้</div>
      <div class="persona-grid">${bots().map(b => { const { title } = splitTitle(b.title);
        return `<div class="card persona-card"><div class="row" style="gap:12px">${App.avatar(b.name, { color: colorIdx(b.color), size: "lg" })}
          <div style="min-width:0;flex:1"><b>${esc(b.name)}</b><div class="muted" style="font-size:12.5px">${esc(title)}</div></div></div>
          <div class="muted persona-mood">${esc(personaOf(b) || "ยังไม่ได้ตั้งบุคลิก")}</div>
          <div class="row" style="gap:6px;margin-top:10px"><button class="btn sm primary" data-edit="${esc(b.id)}">🎭 แก้ตัวตน</button>
            <button class="btn sm" data-card="${esc(b.id)}">📇 การ์ด</button><button class="btn sm ghost" data-hear="${esc(b.id)}">🔊</button></div></div>`; }).join("")}</div>`;
    body.querySelectorAll("[data-edit]").forEach(x => x.onclick = () => personaEditor(botOf(x.dataset.edit), refresh));
    body.querySelectorAll("[data-hear]").forEach(x => x.onclick = () => { const b = botOf(x.dataset.hear); App.voice.speak(`สวัสดีครับ ผม${b.name} ${splitTitle(b.title).title}`, b.id); });
    body.querySelectorAll("[data-card]").forEach(x => x.onclick = () => {
      const b = botOf(x.dataset.card), a = document.createElement("a");
      a.href = cardPng(b); a.download = `bot-${b.name}.png`; a.click();
    });
  }

  // ---------- 7. corrections become rules (Dots) + "always allow" asks first (the Muse Marketplace lesson) ----------
  const toolOfLabel = label => String(label).replace(/ ×\d+$/, "").toLowerCase().replace(/ /g, "_"); // inverse of Rakazo humanizeToolName
  const CORRECTION = /(ต่อไป|คราวหน้า|ครั้งหน้า|จากนี้|หลังจากนี้|ทีหลัง).*(ถาม|ขออนุญาต|ให้ดู|ให้ตรวจ|อย่า|ห้าม)|(อย่า|ห้าม).*(เอง|โดยไม่ถาม|ก่อนถาม)/;
  const KEYWORDS = [[/อีเมล|email/i, "email"], [/ซื้อ|จ่ายเงิน|ชำระ/, "purchase"], [/ใบแจ้งหนี้|invoice/i, "mcp__demo-accounting__create_invoice"],
    [/รับชำระ|รับเงิน/, "mcp__demo-accounting__record_payment"], [/ไฟล์/, "write_file"], [/คำสั่ง|terminal|shell/i, "shell"], [/ส่งงาน|บอทอื่น/, "message_bot"], [/ตั้งเวลา|นัด/, "schedule_create"]];
  async function correction(text, recent, bar) {
    if (!bar || !CORRECTION.test(text)) return null;
    const RULES = App.company.RULES, lastRun = [...recent].reverse().find(m => m.author !== "me" && m.tools?.length)?.tools || [];
    const used = lastRun.map(t => toolOfLabel(t.label)), byValue = v => RULES.find(r => r[1].toLowerCase() === v.toLowerCase());
    const pick = [...used.filter(byValue), ...KEYWORDS.filter(([re]) => re.test(text)).map(([, v]) => v)].map(byValue).filter(Boolean);
    const rules = await rk("approvalRules/list");
    const rule = pick.find(r => !rules.some(x => x.matchValue.toLowerCase() === r[1].toLowerCase() && x.effect === "require_approval"));
    if (!rule) return null;
    bar.innerHTML = `<span>💡</span><span class="grow">ตั้งเป็นกฎเลยไหม: ให้ <b>${rule[2]}</b> ต้องขออนุญาตก่อนทุกครั้ง (มีผลกับบอททุกตัว)</span>
      <button class="btn sm primary" data-sg="yes">${icon("shield")}ตั้งกฎ</button><button class="btn ghost sm" data-sg="no">ไม่ต้อง</button>`;
    bar.hidden = false;
    bar.querySelector('[data-sg="no"]').onclick = () => { bar.hidden = true; };
    bar.querySelector('[data-sg="yes"]').onclick = async () => {
      try { await App.company.setRule(rule[0], rule[1], "require_approval"); toast(`ตั้งกฎแล้ว: ${rule[2]} ต้องขออนุญาต`, "good"); bar.hidden = true; }
      catch (e) { toast("ตั้งกฎไม่สำเร็จ: " + e.message, "bad"); }
    };
    return rule[1];
  }
  const confirmAlways = detail => confirm({ title: "อนุญาตเสมอ?", ok: "อนุญาตเสมอ", danger: true,
    body: `${detail ? App.chat.th(detail) + "\n\n" : ""}เครื่องมือนี้จะไม่ถามอีกเลย สำหรับบอททุกตัว จนกว่าคุณจะเปลี่ยนที่ ศูนย์งาน → กฎ\nถ้าไม่แน่ใจ เลือก "อนุญาตครั้งนี้" แทน` });

  at("inbox", ["brief", "sun", "สรุปเช้า", brief]);
  at("rules", ["triggers", "bolt", "ทริกเกอร์", triggers]);
  at("skills", ["persona", "smile", "ตัวตนบอท", persona]);
  const onChange = fn => { changed.add(fn); return () => changed.delete(fn); };
  App.assistant = { askBot, makeBrief, digest, planFrom, makePlan, approvePlan, verify, verifyBadge, tick, testFire, savePersona, cardPng, correction, confirmAlways, onChange, baht };
})();
