// Work center (ideas from OpenAI Dots / Meta Muse): everything waiting for you across bots, what the team did,
// scheduled routines, and what each bot remembers. All data is Rakazo's own (runs, threads, routines, memory).
"use strict";
(() => {
  const { $, esc, icon, avatar, relTime, toast, modal, confirm, call, register, go, route, renderSide, store, onSnapshot, PALETTE } = App;
  const rk = (path, input) => call("rk", { path, input: input || {} });
  const bots = () => App.chat.state.bots;
  const botOf = id => bots().find(b => b.id === id);
  const colorIdx = c => { const i = PALETTE.findIndex(p => p[0] === c); return i < 0 ? null : i; };
  const av = (id, name, size = "sm") => avatar(name, { color: colorIdx(botOf(id)?.color), size });
  const PAUSED = /^waiting_(input|takeover)$/;
  const targetOf = r => r.groupId ? { groupId: r.groupId } : { botId: r.botId };
  const openChat = r => go(r.groupId ? { type: "group", id: r.groupId } : { type: "bot", id: r.botId });

  // ---------- waiting badge (sidebar) + a toast when a bot starts waiting for you ----------
  let waiting = [], seen = null;
  const listeners = new Set();
  async function poll() {
    if (!store.snap || !store.snap.rakazo.health.startsWith("พร้อม")) return;
    try {
      const rows = (await rk("runs/list", { filter: "active" })).runs.filter(r => PAUSED.test(r.status));
      const cur = route() || {};
      for (const r of rows) {
        if (!seen || seen.has(r.runId)) continue;
        const what = `${r.botName} ${r.status === "waiting_takeover" ? "ขอให้ช่วยบนหน้าจอ" : "รอคำตอบจากคุณ"}`;
        // Windows notification; the host shows it only while the app is in the background or minimized
        call("notify", { title: "BotTeam · มีบอทรอคุณ", body: what + (r.promptSnippet ? "\n" + r.promptSnippet.slice(0, 80) : ""), route: { type: r.groupId ? "group" : "bot", id: r.groupId || r.botId } }).catch(() => {});
        if (!(cur.id === (r.groupId || r.botId)) && cur.type !== "work") toast(what + " · ดูที่ศูนย์งาน", "warn");
      }
      seen = new Set(rows.map(r => r.runId));
      const sig = r => r.map(x => x.runId).join();
      const changed = sig(rows) !== sig(waiting);
      waiting = rows;
      store.waiting = rows.length;
      if (changed) { renderSide(); listeners.forEach(fn => fn()); }
    } catch { /* Rakazo restarting: next tick */ }
  }

  // ---------- 1. inbox: approvals, questions and screen-help requests from every bot ----------
  async function inbox(body, refresh) {
    const threads = new Map(); // one threads/get per chat, even with several waiting runs in it
    const items = await Promise.all(waiting.map(async r => {
      const key = JSON.stringify(targetOf(r));
      if (!threads.has(key)) threads.set(key, rk("threads/get", targetOf(r)).catch(() => null));
      const snap = await threads.get(key);
      const m = snap && [...snap.messages].reverse().find(x => x.runId === r.runId && (x.blocks || []).some(b =>
        (b.kind === "ask" && b.status !== "answered") || (b.kind === "computer" && b.state === "Needs you")));
      const block = m && m.blocks.find(b => b.kind === "ask" || b.kind === "computer");
      return { r, m, block };
    }));
    body.innerHTML = items.length ? `<div class="inbox">${items.map(({ r, m, block }, i) => {
      const ask = block && block.kind === "ask", acts = ask ? block.actions || [] : [];
      const kind = !block ? "รอคุณ" : !ask ? "ขอให้ช่วยบนหน้าจอ" : block.approvalEffectId ? "ขออนุมัติ" : "ถามคุณ";
      const actions = !block ? ""
        : !ask ? `<button class="btn primary sm" data-open="${i}">${icon("monitor")}ไปช่วยบนหน้าจอ</button>`
        : acts.length ? acts.map(x => `<button class="btn sm ${x.id === "allow" ? "primary" : x.id === "deny" ? "danger" : ""}" data-answer="${esc(x.id)}" data-i="${i}">${esc(App.chat.th(x.label))}</button>`).join("")
        : `<input class="input" data-reply-text="${i}" placeholder="พิมพ์คำตอบ แล้วกด Enter" style="flex:1"><button class="btn primary sm" data-reply="${i}">${icon("send")}ส่ง</button>`;
      return `<div class="card inbox-card ${!ask && block ? "take" : ""}" style="animation-delay:${i * 50}ms">
        <div class="row">${av(r.botId, r.botName)}<div style="min-width:0"><b>${esc(r.botName)}</b>${r.groupName ? `<span class="muted"> · ${esc(r.groupName)}</span>` : ""}
          <div class="muted" style="font-size:12px">${esc(kind)} · ${esc(relTime(r.updatedAt))}</div></div><span class="grow"></span>
          <button class="btn ghost sm" data-chat="${i}">${icon("chat")}เปิดแชท</button></div>
        <div class="inbox-text">${App.chat.md(block ? block.text || "" : r.promptSnippet)}</div>
        ${ask && block.detail ? `<pre class="inbox-detail">${esc(App.chat.th(block.detail))}</pre>` : ""}
        ${actions ? `<div class="row inbox-actions">${actions}</div>` : ""}</div>`;
    }).join("")}</div>`
      : `<div class="empty" style="min-height:40vh"><div><div class="float" style="font-size:44px">🎉</div><h2>ไม่มีงานรอคุณ</h2>
         <div class="muted">เมื่อบอทต้องการอนุมัติ ถามคำถาม หรือขอให้ช่วยบนหน้าจอ จะมาอยู่ที่นี่ และมีตัวเลขเตือนที่แถบซ้าย</div></div></div>`;
    const answer = async (i, text, btn) => {
      const { r, m } = items[i];
      btn.closest(".card").querySelectorAll("button,input").forEach(x => x.disabled = true);
      try {
        await rk("threads/answer", { ...targetOf(r), runId: r.runId, messageId: m.id, answer: text });
        toast(`ส่งคำตอบให้ ${r.botName} แล้ว บอททำงานต่อ`, "good");
        await poll(); refresh();
      } catch (e) { toast("ตอบไม่สำเร็จ: " + e.message, "bad"); btn.closest(".card").querySelectorAll("button,input").forEach(x => x.disabled = false); }
    };
    body.querySelectorAll("[data-chat],[data-open]").forEach(b => b.onclick = () => openChat(items[b.dataset.chat ?? b.dataset.open].r));
    body.querySelectorAll("[data-answer]").forEach(b => b.onclick = () => answer(+b.dataset.i, b.dataset.answer, b));
    body.querySelectorAll("[data-reply]").forEach(b => {
      const input = $(`[data-reply-text="${b.dataset.reply}"]`, body);
      const send = () => input.value.trim() && answer(+b.dataset.reply, input.value.trim(), b);
      b.onclick = send;
      input.onkeydown = e => { if (e.key === "Enter" && !e.isComposing) send(); };
    });
  }

  // ---------- 4. activity: what every bot did, newest first ----------
  const STATUS = { queued: ["รอคิว", ""], leased: ["เริ่มงาน", "warn"], running: ["กำลังทำ", "warn"], waiting_input: ["รอคำตอบ", "warn"],
    waiting_takeover: ["รอให้ช่วย", "warn"], completed: ["เสร็จ", "good"], failed: ["ล้มเหลว", "bad"], cancelled: ["ยกเลิก", ""] };
  const TRIGGER = { user: "คุณสั่ง", routine: "งานประจำ", resume: "ทำต่อ", follow_up: "ติดตามงาน", reaction: "รีแอคชัน", spawn: "งานย่อย",
    skill: "สกิล", bot_message: "บอทคุยกัน", webhook: "webhook", messaging: "แชทภายนอก", cloud_agent: "cloud agent" };
  const snippetTh = s => s.replace(/^Update from (.+?):/, "อัปเดตจาก $1:").replace(/^(.+?) asked:/, "$1 ถาม:")
    .replace(/^Message from another agent$/, "ข้อความจากบอทอื่น");
  async function activity(body) {
    const [a, rec] = await Promise.all([rk("runs/list", { filter: "active" }), rk("runs/list", { filter: "recent" })]);
    const rows = [...a.runs, ...rec.runs].sort((x, y) => new Date(y.updatedAt) - new Date(x.updatedAt));
    const count = st => rows.filter(r => st.test(r.status)).length;
    body.innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <span class="chip warn">กำลังทำ ${count(/^(queued|leased|running)$/)}</span><span class="chip warn">รอคุณ ${count(PAUSED)}</span>
        <span class="chip good">เสร็จ ${count(/^completed$/)}</span><span class="chip bad">ล้มเหลว ${count(/^failed$/)}</span>
        <span class="grow"></span><span class="muted" style="font-size:12px">งานที่กำลังทำ + 20 งานล่าสุด</span></div>
      <div class="card" style="padding:6px 0">${rows.map((r, i) => {
        const [label, tone] = STATUS[r.status] || [r.status, ""];
        return `<div class="act-row" data-i="${i}" style="animation-delay:${Math.min(i, 15) * 30}ms">
          <span class="dot ${tone}"></span>${av(r.botId, r.botName)}
          <div style="min-width:0;flex:1"><div><b>${esc(r.botName)}</b>${r.groupName ? `<span class="muted"> ใน ${esc(r.groupName)}</span>` : ""}
            <span class="chip" style="height:20px;margin-left:6px">${esc(TRIGGER[r.trigger] || r.trigger)}</span></div>
            <div class="muted act-snippet">${esc(snippetTh(r.promptSnippet || ""))}</div></div>
          <div style="text-align:right;white-space:nowrap"><div class="chip ${tone}" style="height:22px">${esc(label)}</div>
            <div class="muted" style="font-size:11.5px;margin-top:4px">${esc(relTime(r.updatedAt))}</div></div></div>`;
      }).join("") || `<div class="muted" style="padding:18px">ยังไม่มีกิจกรรม</div>`}</div>`;
    body.querySelectorAll(".act-row").forEach(el => el.onclick = () => openChat(rows[+el.dataset.i]));
    return rows.map(r => r.runId + r.status).join();
  }

  // ---------- 2. routines: scheduled work per bot (Rakazo routines, Bangkok time) ----------
  const TZ = "Asia/Bangkok";
  const DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const pad = n => String(n).padStart(2, "0");
  function cronTh(cron) {
    const m = /^(\d+) (\d+|\*) \* \* (\*|1-5|\d)$/.exec(cron.trim());
    if (!m) return cron;
    if (m[2] === "*") return m[1] === "0" && m[3] === "*" ? "ทุกชั่วโมง" : cron;
    const t = `${pad(m[2])}:${pad(m[1])}`;
    return m[3] === "*" ? `ทุกวัน ${t}` : m[3] === "1-5" ? `จันทร์–ศุกร์ ${t}` : `ทุกวัน${DAYS[+m[3] % 7]} ${t}`;
  }
  const when = ts => ts ? new Date(ts).toLocaleString("th-TH", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "—";
  // quick starts for the demo company; matched by bot name
  const TEMPLATES = [
    ["CEO", "สรุปงานเช้า", "สรุปสถานะงานของทีมจากแชทเมื่อวาน แล้วตั้ง 3 เรื่องสำคัญที่ทีมต้องทำวันนี้ สั้น กระชับ", "weekdays", "08:00"],
    ["ฝ่ายขาย", "รายงานยอดขายเย็น", "สรุปงานขายและลูกค้าที่คุยวันนี้ พร้อมงานที่ต้องตามต่อพรุ่งนี้", "weekdays", "17:30"],
    ["ฝ่ายบัญชี", "สรุปรายรับรายจ่ายรายสัปดาห์", "สรุปรายรับรายจ่ายที่ทีมคุยกันสัปดาห์นี้ และรายการที่ยังขาดเอกสาร", "weekly:5", "16:00"],
    ["ฝ่ายจัดซื้อ", "ทบทวนของที่ต้องสั่งซื้อ", "ทบทวนรายการที่ทีมขอให้ซื้อสัปดาห์นี้ จัดลำดับความสำคัญ และสิ่งที่ต้องเปรียบเทียบราคา", "weekly:1", "10:00"],
    ["ฝ่ายบุคคล", "ทบทวนงานบุคคลรายสัปดาห์", "สรุปงานบุคคลที่ค้างอยู่ (รับสมัคร วันลา อบรม) และสิ่งที่ต้องทำสัปดาห์หน้า", "weekly:5", "15:00"],
    ["ฝ่ายการตลาด", "ไอเดียคอนเทนต์ประจำสัปดาห์", "เสนอไอเดียโพสต์โซเชียล 5 ชิ้นสำหรับสัปดาห์นี้ พร้อมข้อความและช่วงเวลาที่ควรโพสต์ ร่างไว้ให้อนุมัติ", "weekly:1", "09:00"],
    ["ฝ่ายบริการลูกค้า", "สรุปเรื่องลูกค้าประจำวัน", "สรุปคำถามและเรื่องร้องเรียนของลูกค้าที่คุยกันวันนี้ เรื่องที่ต้องส่งต่อฝ่ายอื่น และคำตอบที่ควรเพิ่มในคำถามที่พบบ่อย", "weekdays", "17:00"],
    ["ฝ่ายคลังสินค้า", "เช็คสินค้าใกล้หมด", "ทบทวนสินค้าที่ทีมพูดถึงว่าใกล้หมดหรือขายดี แล้วสรุปรายการที่ควรแจ้งฝ่ายจัดซื้อ", "weekdays", "09:00"],
    ["ฝ่ายไอที", "เช็คลิสต์ความปลอดภัยรายสัปดาห์", "ทำเช็คลิสต์ความปลอดภัยไอทีประจำสัปดาห์สำหรับ SME (สำรองข้อมูล อัปเดตระบบ สิทธิ์ผู้ใช้) และสิ่งที่ควรทำสัปดาห์นี้", "weekly:5", "14:00"],
  ];
  function cronOf(freq, time, custom) {
    const [h, m] = (time || "08:00").split(":").map(Number);
    if (freq === "hourly") return "0 * * * *";
    if (freq === "custom") return custom.trim();
    return `${m} ${h} * * ${freq === "daily" ? "*" : freq === "weekdays" ? "1-5" : freq.split(":")[1]}`;
  }
  function freqOf(cron) {
    const m = /^(\d+) (\d+|\*) \* \* (\*|1-5|\d)$/.exec((cron || "").trim());
    if (!m) return { freq: cron ? "custom" : "weekdays", time: "08:00" };
    if (m[2] === "*") return { freq: m[1] === "0" && m[3] === "*" ? "hourly" : "custom", time: "08:00" };
    return { freq: m[3] === "*" ? "daily" : m[3] === "1-5" ? "weekdays" : "weekly:" + m[3], time: `${pad(m[2])}:${pad(m[1])}` };
  }
  async function routines(body, refresh) {
    const all = (await Promise.all(bots().map(b => rk("routines/list", { botId: b.id }).catch(() => [])))).flat();
    const unused = TEMPLATES.filter(([n, title]) => bots().some(b => b.name === n) && !all.some(x => x.name === title));
    body.innerHTML = `<div class="row" style="margin-bottom:14px"><div class="muted">บอททำงานเองตามเวลาที่ตั้ง (เวลาไทย) ผลงานจะอยู่ในแชทของบอทตัวนั้น</div>
        <span class="grow"></span><button class="btn primary" id="r-new">${icon("plus")}ตั้งงานประจำ</button></div>
      ${unused.length ? `<div class="tpl-row">${unused.map(([n, title, , f, t], i) => `<button class="tpl-chip" data-tpl="${i}">${av(bots().find(b => b.name === n).id, n)}
        <span><b>${esc(title)}</b><br><span class="muted">${esc(n)} · ${esc(cronTh(cronOf(f, t)))}</span></span></button>`).join("")}</div>` : ""}
      ${all.length ? `<div class="grid g2">${all.map((x, i) => {
        const b = botOf(x.botId);
        return `<div class="card routine ${x.active ? "" : "off"}" data-id="${esc(x.id)}" style="animation-delay:${i * 40}ms">
          <div class="row">${av(x.botId, b ? b.name : "?")}<div style="min-width:0;flex:1"><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">${esc(b ? b.name : "")}</div></div>
            <label class="switch" title="เปิด/ปิด"><input type="checkbox" data-active ${x.active ? "checked" : ""}><span></span></label></div>
          <div class="routine-when">${icon("clock")}${esc(x.crons.map(cronTh).join(", ") || "ไม่มีเวลา")}</div>
          <div class="muted routine-prompt">${esc(x.prompt)}</div>
          <div class="row" style="margin-top:10px;font-size:12px"><span class="muted">รอบถัดไป: <b class="next">${x.active ? esc(when(x.nextRunAt)) : "ปิดอยู่"}</b>${x.lastRunAt ? ` · ล่าสุด ${esc(relTime(x.lastRunAt))}` : ""}</span>
            <span class="grow"></span><button class="btn sm" data-test>${icon("play")}รันเลย</button>
            <button class="btn sm ghost icon" data-edit title="แก้ไข">${icon("edit")}</button><button class="btn sm ghost icon" data-del title="ลบ">${icon("trash")}</button></div></div>`;
      }).join("")}</div>`
        : `<div class="empty" style="min-height:30vh"><div><div class="float" style="font-size:44px">⏰</div><h2>ยังไม่มีงานประจำ</h2>
           <div class="muted">ให้บอททำงานเองทุกวัน เช่น สรุปงานตอนเช้า รายงานยอดตอนเย็น — เลือกจากตัวอย่างด้านบนได้เลย</div></div></div>`}`;
    $("#r-new", body).onclick = () => routineForm(null, refresh);
    body.querySelectorAll("[data-tpl]").forEach(el => el.onclick = () => {
      const [n, name, prompt, f, t] = unused[+el.dataset.tpl];
      routineForm({ botId: bots().find(b => b.name === n).id, name, prompt, crons: [cronOf(f, t)], active: true }, refresh);
    });
    body.querySelectorAll(".routine").forEach(card => {
      const x = all.find(r => r.id === card.dataset.id);
      $("[data-active]", card).onchange = async e => {
        try { await rk("routines/update", { routineId: x.id, active: e.target.checked }); toast(e.target.checked ? `เปิด "${x.name}" แล้ว` : `ปิด "${x.name}" แล้ว`, "good"); }
        catch (err) { toast("เปลี่ยนไม่สำเร็จ: " + err.message, "bad"); }
        refresh();
      };
      $("[data-test]", card).onclick = async e => {
        const btn = e.currentTarget; // currentTarget is null after the await
        btn.disabled = true;
        try { await rk("routines/testRun", { routineId: x.id, clientNonce: "ui-" + Date.now() }); toast(`${botOf(x.botId)?.name || "บอท"} เริ่มทำ "${x.name}" แล้ว · ดูผลในแชท`, "good"); }
        catch (err) { toast("รันไม่สำเร็จ: " + err.message, "bad"); }
        btn.disabled = false;
      };
      $("[data-edit]", card).onclick = () => routineForm(x, refresh);
      $("[data-del]", card).onclick = async () => {
        if (!await confirm({ title: `ลบงานประจำ "${x.name}"?`, body: "บอทจะไม่ทำงานนี้ตามเวลาอีก", ok: "ลบ", danger: true })) return;
        try { await rk("routines/remove", { routineId: x.id }); toast("ลบแล้ว", "good"); } catch (err) { toast("ลบไม่สำเร็จ: " + err.message, "bad"); }
        refresh();
      };
    });
  }
  function routineForm(x, refresh) {
    const editing = !!(x && x.id), init = x || { botId: bots()[0]?.id, name: "", prompt: "", crons: [], active: true };
    const f = freqOf(init.crons[0]);
    let botId = init.botId;
    const FREQ = [["weekdays", "จันทร์–ศุกร์"], ["daily", "ทุกวัน"], ...DAYS.map((d, i) => ["weekly:" + i, "ทุกวัน" + d]), ["hourly", "ทุกชั่วโมง"], ["custom", "กำหนดเอง (cron)"]];
    const m = modal(`<h2>${editing ? "แก้ไขงานประจำ" : "ตั้งงานประจำ"}</h2>
      <div class="field"><label>บอท</label><div class="pick">${bots().map(b => `<div class="opt ${b.id === botId ? "on" : ""}" data-bot="${esc(b.id)}">${av(b.id, b.name)}${esc(b.name)}</div>`).join("")}</div></div>
      <div class="field"><label>ชื่องาน</label><input class="input" id="rf-name" maxlength="80" value="${esc(init.name)}" placeholder="เช่น สรุปงานเช้า"></div>
      <div class="field"><label>ให้บอททำอะไร</label><textarea class="input" id="rf-prompt" rows="4" placeholder="เช่น สรุปสถานะงานของทีมเมื่อวาน แล้วตั้ง 3 เรื่องที่ต้องทำวันนี้">${esc(init.prompt)}</textarea></div>
      <div class="field"><label>เมื่อไหร่ (เวลาไทย)</label><div class="row" style="gap:8px">
        <select class="input" id="rf-freq" style="flex:1">${FREQ.map(([v, t]) => `<option value="${v}" ${v === f.freq ? "selected" : ""}>${t}</option>`).join("")}</select>
        <input class="input" id="rf-time" type="time" value="${f.time}" style="width:130px">
        <input class="input mono" id="rf-cron" placeholder="0 8 * * 1-5" value="${f.freq === "custom" ? esc(init.crons[0] || "") : ""}" style="width:170px"></div></div>
      <label class="row" style="margin-top:14px;gap:8px;cursor:pointer"><input type="checkbox" id="rf-active" ${init.active ? "checked" : ""}>เปิดใช้งานทันที</label>
      <div class="actions"><button class="btn ghost" id="rf-cancel">ยกเลิก</button><button class="btn primary" id="rf-ok">${icon("check")}${editing ? "บันทึก" : "ตั้งงาน"}</button></div>`);
    const freq = $("#rf-freq", m.el), time = $("#rf-time", m.el), cron = $("#rf-cron", m.el);
    const sync = () => { time.hidden = /^(hourly|custom)$/.test(freq.value); cron.hidden = freq.value !== "custom"; };
    freq.onchange = sync; sync();
    m.el.querySelectorAll("[data-bot]").forEach(o => o.onclick = () => {
      if (editing) return toast("ย้ายงานไปบอทอื่นไม่ได้ ลบแล้วตั้งใหม่แทน", "warn");
      botId = o.dataset.bot; m.el.querySelectorAll("[data-bot]").forEach(z => z.classList.toggle("on", z === o));
    });
    $("#rf-cancel", m.el).onclick = m.close;
    $("#rf-ok", m.el).onclick = async e => {
      const name = $("#rf-name", m.el).value.trim(), prompt = $("#rf-prompt", m.el).value.trim(), c = cronOf(freq.value, time.value, cron.value);
      if (!botId || !name || !prompt || !c) return toast("ใส่บอท ชื่องาน สิ่งที่ต้องทำ และเวลาให้ครบ", "warn");
      const btn = e.currentTarget; btn.disabled = true;
      const body = { name, prompt, crons: [c], timezone: TZ, active: $("#rf-active", m.el).checked };
      try {
        await rk(editing ? "routines/update" : "routines/create", editing ? { routineId: x.id, ...body } : { botId, notify: true, ...body });
        toast(editing ? "บันทึกแล้ว" : `ตั้งงาน "${name}" แล้ว`, "good"); m.close(); refresh();
      } catch (err) { toast("บันทึกไม่สำเร็จ: " + err.message, "bad"); btn.disabled = false; }
    };
  }

  // ---------- 3. memory: what each bot remembers (Rakazo MEMORY.md per bot); add, edit or forget ----------
  const isEmptyMemory = c => !c.replace(/^#.*$/m, "").trim();
  async function memory(body, refresh) {
    const docs = await rk("memory/list", {});
    const list = bots().map(b => ({ b, doc: docs.find(d => d.botId === b.id && d.path === "MEMORY.md") })).filter(x => x.doc);
    const shared = docs.filter(d => !d.botId);
    body.innerHTML = `<div class="muted" style="margin-bottom:14px">บอทจำสิ่งที่คุณบอก (เช่น "จำไว้ว่า…") และใช้ในทุกงานถัดไป · เพิ่ม แก้ หรือสั่งลืมได้ที่นี่</div>
      <div class="grid g2">${list.map(({ b, doc }, i) => `<div class="card memory" data-doc="${esc(doc.id)}" style="animation-delay:${i * 40}ms">
        <div class="row">${av(b.id, b.name)}<div style="min-width:0;flex:1"><b>${esc(b.name)}</b>
          <div class="muted" style="font-size:12px">แก้ล่าสุด ${esc(relTime(doc.updatedAt))} · ครั้งที่ ${doc.revision}</div></div>
          <button class="btn sm ghost icon" data-edit title="แก้ไข">${icon("edit")}</button><button class="btn sm ghost icon" data-forget title="ลืมทั้งหมด">${icon("trash")}</button></div>
        <div class="memory-body">${isEmptyMemory(doc.content) ? `<div class="muted">ยังไม่มีอะไรในความจำ</div>` : App.chat.md(doc.content.replace(/^#.*\n?/, ""))}</div>
        <div class="row" style="gap:8px;margin-top:10px"><input class="input" data-add placeholder="ให้ ${esc(b.name)} จำว่า…" style="flex:1">
          <button class="btn sm" data-add-btn>${icon("plus")}จำ</button></div></div>`).join("")}</div>
      ${shared.length ? `<h3 class="sec-title" style="margin-top:22px">ความจำร่วม<span>${shared.length}</span></h3>${shared.map(d => `<div class="card"><div class="muted mono" style="font-size:12px">${esc(d.path)}</div><div class="memory-body">${App.chat.md(d.content)}</div></div>`).join("")}` : ""}`;
    const save = async (doc, content, msg) => {
      try { await rk("memory/update", { documentId: doc.id, content }); toast(msg, "good"); } catch (e) { toast("บันทึกไม่สำเร็จ: " + e.message, "bad"); }
      refresh();
    };
    body.querySelectorAll(".memory").forEach(card => {
      const { b, doc } = list.find(x => x.doc.id === card.dataset.doc), input = $("[data-add]", card);
      const add = () => { const t = input.value.trim().replace(/\s+/g, " "); if (t) save(doc, doc.content.replace(/\s*$/, "\n") + "- " + t + "\n", `${b.name} จำแล้ว`); };
      $("[data-add-btn]", card).onclick = add;
      input.onkeydown = e => { if (e.key === "Enter" && !e.isComposing) add(); };
      $("[data-forget]", card).onclick = async () => {
        if (!await confirm({ title: `ให้ ${b.name} ลืมทั้งหมด?`, body: "ความจำของบอทตัวนี้จะถูกล้าง (แชทเดิมยังอยู่)", ok: "ลืมทั้งหมด", danger: true })) return;
        save(doc, `# ${b.name}\n`, `${b.name} ลืมแล้ว`);
      };
      $("[data-edit]", card).onclick = () => {
        const m = modal(`<h2>ความจำของ ${esc(b.name)}</h2><div class="muted">Markdown · ลบบรรทัดที่ไม่ต้องการ = สั่งให้ลืมเรื่องนั้น</div>
          <textarea class="input mono" id="mf-text" rows="14" style="margin-top:14px">${esc(doc.content)}</textarea>
          <div class="actions"><button class="btn ghost" id="mf-cancel">ยกเลิก</button><button class="btn primary" id="mf-ok">${icon("check")}บันทึก</button></div>`, { wide: true });
        $("#mf-cancel", m.el).onclick = m.close;
        $("#mf-ok", m.el).onclick = () => { m.close(); save(doc, $("#mf-text", m.el).value, "บันทึกความจำแล้ว"); };
      };
    });
  }

  // ---------- 5. files the bots produced (Rakazo artifacts) with an in-app preview ----------
  const kb = n => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";
  const fileIcon = m => /^image\//.test(m) ? "🖼️" : /markdown/.test(m) ? "📝" : /pdf/.test(m) ? "📕" : /csv|sheet|excel/.test(m) ? "📊" : /json|javascript|html|x-/.test(m) ? "🧩" : "📄";
  const isText = m => /^text\/|json|xml|javascript|csv|markdown|yaml/.test(m);
  async function files(body) {
    // artifacts/list only returns a bot's own chat; files made in group rooms are found in the rooms' file blocks
    const groups = App.chat.state.groups;
    const [own, rooms] = await Promise.all([
      Promise.all(bots().map(b => rk("artifacts/list", { botId: b.id }).catch(() => []))),
      Promise.all(groups.map(g => rk("threads/get", { groupId: g.id }).then(s => s.messages.flatMap(m => m.blocks.filter(b => b.kind === "file" && b.artifactId)
        .map(b => ({ id: b.artifactId, botId: m.botId, groupId: g.id, name: b.name, mimeType: b.mimeType, size: b.size || 0, createdAt: m.createdAt })))), () => []))]);
    const seen = new Set(), all = [...own.flat(), ...rooms.flat()].filter(a => !seen.has(a.id) && seen.add(a.id))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    body.innerHTML = all.length ? `<div class="muted" style="margin-bottom:14px">เอกสารและไฟล์ที่บอทสร้างหรือส่งให้ในแชท · คลิกเพื่อเปิดดู</div>
      <div class="files">${all.map((a, i) => { const b = botOf(a.botId); return `<div class="card file" data-i="${i}" style="animation-delay:${Math.min(i, 12) * 40}ms">
        <div class="file-ic">${fileIcon(a.mimeType)}</div><div class="file-name" title="${esc(a.name)}">${esc(a.name)}</div>
        <div class="row muted" style="font-size:12px;margin-top:8px;gap:6px">${b ? av(b.id, b.name) + esc(b.name) : ""}${a.groupId ? " · ห้องรวม" : ""}<span class="grow"></span>${esc(kb(a.size))} · ${esc(relTime(a.createdAt))}</div></div>`; }).join("")}</div>`
      : `<div class="empty" style="min-height:40vh"><div><div class="float" style="font-size:44px">🗂️</div><h2>ยังไม่มีผลงาน</h2>
         <div class="muted">ลองสั่งบอท เช่น "ร่างแผนการตลาด 90 วัน แล้วส่งเป็นไฟล์ให้ผม"</div></div></div>`;
    body.querySelectorAll(".file").forEach(el => el.onclick = () => preview(all[+el.dataset.i]));
  }
  async function preview(a) {
    const m = modal(`<div class="row"><h2 style="margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis">${fileIcon(a.mimeType)} ${esc(a.name)}</h2><span class="grow"></span>
        <button class="btn sm" id="fp-save">${icon("external")}บันทึกไฟล์</button><button class="btn ghost icon sm" id="fp-x">${icon("x")}</button></div>
      <div class="muted" style="font-size:12px;margin-top:4px"><span id="fp-meta">${esc(botOf(a.botId)?.name || "")}</span></div>
      <div class="file-view" id="fp-body"><div class="typing"><i></i><i></i><i></i></div></div>`, { wide: true });
    $("#fp-x", m.el).onclick = m.close;
    try {
      const full = await rk("artifacts/get", { ...(a.groupId ? { groupId: a.groupId } : { botId: a.botId }), artifactId: a.id });
      a = { ...a, mimeType: full.mimeType || a.mimeType, size: full.size || a.size }; // search hits only know the name
      $("#fp-meta", m.el).textContent = [botOf(a.botId)?.name, kb(a.size), a.mimeType].filter(Boolean).join(" · ");
      const bytes = Uint8Array.from(atob(full.contentBase64), ch => ch.charCodeAt(0)), view = $("#fp-body", m.el);
      if (/^image\//.test(a.mimeType)) view.innerHTML = `<img src="data:${esc(a.mimeType)};base64,${full.contentBase64}" alt="">`;
      else if (isText(a.mimeType)) { const t = new TextDecoder().decode(bytes); view.innerHTML = /markdown/.test(a.mimeType) ? `<div class="md">${App.chat.md(t)}</div>` : `<pre>${esc(t)}</pre>`; }
      else view.innerHTML = `<div class="muted" style="padding:24px;text-align:center">เปิดดูในแอปไม่ได้ กด "บันทึกไฟล์" เพื่อเปิดด้วยโปรแกรมในเครื่อง</div>`;
      $("#fp-save", m.el).onclick = () => { // WebView2 shows its own save/download UI
        const url = URL.createObjectURL(new Blob([bytes], { type: a.mimeType })), link = document.createElement("a");
        link.href = url; link.download = a.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
    } catch (e) { $("#fp-body", m.el).innerHTML = `<div class="muted" style="padding:24px">${esc(e.message)}</div>`; }
  }

  // ---------- 6. usage and cost per bot (Rakazo usage records) ----------
  // DeepSeek official price per 1M tokens (api-docs.deepseek.com/quick_start/pricing, checked 2026-09-30), deepseek-flash, in
  // nano-USD per token so sums stay integers. Records do not split cache hits, so input is billed as cache miss = an upper bound.
  // Peak = 01-04 and 06-10 UTC Mon-Fri (Chinese public holidays not handled: those hours are really off-peak, estimate stays high).
  const DS_PRICE = { off: { in: 150, out: 600 }, peak: { in: 300, out: 1200 } };
  const isPeak = d => { const h = d.getUTCHours(), w = d.getUTCDay(); return w >= 1 && w <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10)); };
  const usd = nano => "$" + (nano / 1e9).toFixed(nano < 1e7 ? 4 : 2); // display only
  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);
  // ponytail: Rakazo's usage/list returns only the latest 100 model calls; all-time totals come from usage/summary.
  // Upgrade path if the per-bot window is too short: aggregate in the host from the usage_records table.
  async function usage(body) {
    const [recs, sum] = await Promise.all([rk("usage/list"), rk("usage/summary")]);
    const per = new Map(), tot = { local: 0, cloud: 0, nano: 0 };
    for (const r of recs) {
      const at = new Date(r.createdAt), cloud = r.provider === "deepseek", tokens = r.inputTokens + r.outputTokens;
      const p = cloud ? DS_PRICE[isPeak(at) ? "peak" : "off"] : null, nano = p ? r.inputTokens * p.in + r.outputTokens * p.out : 0;
      const row = per.get(r.botId) || { local: 0, cloud: 0, nano: 0, calls: 0 };
      row[cloud ? "cloud" : "local"] += tokens; row.nano += nano; row.calls++;
      per.set(r.botId, row);
      tot[cloud ? "cloud" : "local"] += tokens; tot.nano += nano;
    }
    const rows = [...per].map(([id, x]) => ({ id, b: botOf(id), ...x })).sort((a, b) => (b.local + b.cloud) - (a.local + a.cloud));
    const max = Math.max(1, ...rows.map(r => r.local + r.cloud));
    const since = recs.length ? relTime(recs[recs.length - 1].createdAt) : "";
    body.innerHTML = `<div class="grid g4" style="margin-bottom:16px">
        <div class="card"><div class="muted">เรียกโมเดลทั้งหมด</div><div class="big">${fmt(sum.runs)}</div><div class="muted" style="font-size:12px">ครั้ง ตั้งแต่เริ่มใช้</div></div>
        <div class="card"><div class="muted">token ทั้งหมด</div><div class="big">${fmt(sum.inputTokens + sum.outputTokens)}</div><div class="muted" style="font-size:12px">อ่าน ${fmt(sum.inputTokens)} · เขียน ${fmt(sum.outputTokens)}</div></div>
        <div class="card"><div class="muted">100 ครั้งล่าสุด</div><div class="big">${fmt(tot.local + tot.cloud)}</div><div class="muted" style="font-size:12px">🖥 Local ${fmt(tot.local)} · ⚡ DeepSeek ${fmt(tot.cloud)}</div></div>
        <div class="card"><div class="muted">ค่า DeepSeek 100 ครั้งล่าสุด</div><div class="big">${usd(tot.nano)}</div><div class="muted" style="font-size:12px">ประมาณการ ไม่เกินนี้ · Local ไม่มีค่า API</div></div></div>
      <div class="card"><div class="row" style="margin-bottom:6px"><b>แยกตามบอท</b><span class="grow"></span><span class="muted" style="font-size:12px">100 ครั้งล่าสุด${since ? " (ตั้งแต่ " + esc(since) + ")" : ""}</span></div>
        ${rows.length ? rows.map((r, i) => `<div class="usage-row" style="animation-delay:${i * 40}ms">
          ${av(r.id, r.b ? r.b.name : "?")}<div style="width:130px;min-width:0"><b>${esc(r.b ? r.b.name : "บอทที่เก็บแล้ว")}</b><div class="muted" style="font-size:12px">${r.calls} ครั้ง</div></div>
          <div class="usage-bar"><span class="l" style="width:${100 * r.local / max}%"></span><span class="c" style="width:${100 * r.cloud / max}%"></span></div>
          <div class="usage-num"><div>${fmt(r.local + r.cloud)} token</div><div class="muted" style="font-size:12px">${r.nano ? usd(r.nano) : "ฟรี"}</div></div></div>`).join("")
        : `<div class="muted" style="padding:10px">ยังไม่มีการใช้งาน</div>`}
        <div class="row muted" style="font-size:12px;margin-top:12px;gap:14px"><span><i class="lg l"></i>Local</span><span><i class="lg c"></i>DeepSeek</span><span class="grow"></span>
          <span>ราคาทางการ DeepSeek (แยกช่วงเร่งด่วน/ปกติ) คิดแบบ cache miss = ตัวเลขสูงสุด</span></div></div>`;
  }

  // ---------- 7. search every chat, file and routine from the sidebar search box ----------
  let searchQ = "", searchHits = null, searchTimer = null;
  const KIND = { conversation: "💬", message: "💬", file: "📄", link: "🔗", routine: "⏰" };
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mark = (text, q) => esc(text).replace(new RegExp(reEsc(esc(q)), "gi"), m => "<mark>" + m + "</mark>");
  App.sideSections.push({
    render(q) {
      if (q.length < 2) { searchQ = ""; searchHits = null; return ""; }
      if (q !== searchQ) {
        searchQ = q; searchHits = null; clearTimeout(searchTimer);
        searchTimer = setTimeout(() => rk("search/query", { q }).then(r => { if (q === searchQ) { searchHits = r.hits; renderSide(); } }, () => {}), 250);
      }
      const hits = searchHits;
      return `<div class="side-label">ค้นหาในแชททั้งหมด</div>${!hits ? `<div class="muted" style="padding:6px 12px;font-size:12.5px">กำลังค้นหา…</div>`
        : !hits.length ? `<div class="muted" style="padding:6px 12px;font-size:12.5px">ไม่พบ "${esc(q)}"</div>`
        : hits.map((h, i) => { const who = h.groupName || h.botName || "", file = h.kind === "file";
            return `<div class="item hit" data-hit="${i}"><div class="av sm hit-ic">${KIND[h.kind] || "•"}</div><div style="min-width:0">
            <div class="name">${file ? mark(h.title, q) : esc(who || h.title)}</div><div class="snippet">${file ? esc(who) : mark(h.snippet || h.title, q)}</div></div></div>`; }).join("")}`;
    },
    bind(root) {
      root.querySelectorAll("[data-hit]").forEach(el => el.onclick = () => {
        const h = searchHits[+el.dataset.hit];
        if (h.kind === "file" && h.artifactId) preview({ id: h.artifactId, name: h.title, mimeType: (h.snippet || "").split(" · ")[0], size: 0, botId: h.botId, groupId: h.groupId || null });
        else if (h.kind === "routine") go({ type: "work", tab: "routines" });
        else if (h.groupId) go({ type: "group", id: h.groupId });
        else if (h.botId) go({ type: "bot", id: h.botId });
        else if (h.kind === "file") go({ type: "work", tab: "files" });
      });
    },
  });

  // ---------- page ----------
  const TABS = [["inbox", "inbox", "รอคุณ", inbox], ["activity", "activity", "กิจกรรม", activity], ["routines", "clock", "งานประจำ", routines], ["memory", "brain", "ความจำ", memory],
    ["files", "folder", "ผลงาน", files], ["usage", "coin", "ค่าใช้จ่าย", usage]];
  register("work", (view, r) => {
    let tab = r.tab || (store.waiting ? "inbox" : "activity"), alive = true, sig = "";
    view.innerHTML = `<div class="page"><div class="page-head"><div><h1>ศูนย์งาน</h1>
        <div class="sub">งานที่รอคุณ การส่งงานในทีม งานประจำ ทักษะ ความรู้บริษัท กฎ และข้อมูลสำรอง</div></div></div>
      <div class="seg" id="w-tabs"><div class="thumb"></div>${TABS.map(([k, ic, t]) => `<button data-tab="${k}">${icon(ic)}${t}<span class="tab-n" data-n="${k}"></span></button>`).join("")}</div>
      <div id="w-body" style="margin-top:18px"><div class="card skeleton" style="height:140px"></div></div></div>`;
    const seg = $("#w-tabs", view), body = $("#w-body", view);
    const moveThumb = () => { const on = $("button.on", seg), t = $(".thumb", seg); if (on) { t.style.left = on.offsetLeft + "px"; t.style.width = on.offsetWidth + "px"; } };
    const badge = () => { const n = $('[data-n="inbox"]', seg); n.textContent = waiting.length ? waiting.length : ""; moveThumb(); };
    // render off-screen, then swap in: no flicker, and background refreshes never clobber an answer being typed
    async function render(force) {
      const want = tab, fn = TABS.find(t => t[0] === tab)[3];
      if (!force && tab === "inbox" && sig === "inbox:" + waiting.map(w => w.runId).join()) return;
      if (!force && !/^(inbox|activity|team)$/.test(tab)) return; // no background refresh while editing or reading
      const tmp = document.createElement("div");
      try {
        const s = await fn(tmp, () => render(true));
        if (!alive || want !== tab) return;
        const next = tab === "inbox" ? "inbox:" + waiting.map(w => w.runId).join() : tab + ":" + (s || Math.random());
        if (!force && next === sig) return;
        if (document.activeElement && body.contains(document.activeElement) && !force) return; // user is typing an answer
        sig = next;
        body.replaceChildren(...tmp.childNodes);
      } catch (e) { if (alive && want === tab) body.innerHTML = `<div class="muted" style="padding:24px">${esc(e.message)}</div>`; }
    }
    seg.addEventListener("click", e => {
      const b = e.target.closest("button[data-tab]");
      if (!b || b.dataset.tab === tab) return;
      tab = b.dataset.tab; sig = "";
      seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      moveThumb();
      body.innerHTML = `<div class="card skeleton" style="height:140px"></div>`;
      render(true);
    });
    $(`[data-tab="${tab}"]`, seg).classList.add("on");
    requestAnimationFrame(badge);
    render(true);
    const onWaiting = () => { badge(); if (tab === "inbox") render(); };
    listeners.add(onWaiting);
    const timer = setInterval(() => { if (tab === "activity" || tab === "team") render(); }, 5000);
    return () => { alive = false; listeners.delete(onWaiting); clearInterval(timer); };
  });

  document.addEventListener("app:start", () => { poll(); setInterval(poll, 5000); onSnapshot(() => { if (store.waiting === undefined) poll(); }); });
  // company.js adds its tabs (team, skills, knowledge, rules, backup) and reuses the helpers
  App.work = { poll, preview, tabs: TABS, av, botOf, bots, fileIcon, kb };
})();
