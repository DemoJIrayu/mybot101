// Bots, chat, groups, new-agent flow, computer panel.
// The host ("rk" op) is an authenticated proxy to Rakazo's oRPC API, so objects here are Rakazo's own:
//   Bot {id,name,title,description,instructions,color,preview,status,updatedAt,computerMode}
//   Group {id,name,members:[{botId,name,color,status}],preview,updatedAt}
//   ThreadMessage {id,role,blocks,botId,runId,createdAt}; live events from "rk.subscribe" (threads.subscribe).
"use strict";
(() => {
  const { $, esc, icon, avatar, relTime, toast, modal, call, subscribe, register, go, route, renderSide, sideSections, PALETTE } = App;
  const rk = (path, input) => call("rk", { path, input: input || {} });
  const state = { bots: [], groups: [], sections: [], ready: false, error: "" };
  const collapsed = new Set(JSON.parse(localStorage.getItem("bt.collapsed") || "[]"));
  // Thai text-to-speech with the Windows voice (Microsoft Pattara, offline); markdown/links stripped, long replies cut
  App.voice = {
    speak(text, botId, voice) {
      const s = window.speechSynthesis;
      const plain = String(text).replace(/```[\s\S]*?```/g, " ").replace(/https?:\/\/\S+/g, " ลิงก์ ").replace(/[*_#>`|~[\]()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
      if (!s || !plain) return;
      s.cancel();
      const u = new SpeechSynthesisUtterance(plain);
      u.lang = "th-TH"; u.voice = s.getVoices().find(v => v.lang === "th-TH") || null;
      const v = voice || (botId && App.persona?.voiceOf(botId)); // persona studio: pitch / speed per bot
      if (v) { u.pitch = v.pitch || 1; u.rate = v.rate || 1; }
      s.speak(u);
      App.voice.last = plain;
    },
    stop() { window.speechSynthesis?.cancel(); },
    // 🎤 toggle on any button: 1st click records (max 60 s), 2nd click stops; resolves the local whisper transcript.
    // The 2nd click returns null - the promise from the 1st click carries the text.
    listen(btn, label = "🎤") {
      if (btn._rec) { btn._rec.stop(); return null; }
      return new Promise(async (resolve, reject) => {
        let stream;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return reject(new Error("เปิดไมค์ไม่ได้: " + e.message)); }
        call("stt.warm").catch(() => {});
        App.voice.stop();
        const chunks = [], started = Date.now(), rec = btn._rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        rec.ondataavailable = e => e.data.size && chunks.push(e.data);
        const tick = setInterval(() => { btn.textContent = "⏺ " + Math.round((Date.now() - started) / 1000) + "s"; if (Date.now() - started > 60000) rec.stop(); }, 250);
        btn.classList.add("rec");
        rec.onstop = async () => {
          clearInterval(tick); stream.getTracks().forEach(t => t.stop()); btn._rec = null;
          btn.classList.remove("rec"); btn.textContent = "…"; btn.disabled = true;
          try {
            const b64 = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => fail(r.error); r.readAsDataURL(new Blob(chunks, { type: "audio/webm" })); });
            resolve((await call("stt", { audio: b64 })).text || "");
          } catch (e) { reject(e); }
          finally { btn.textContent = label; btn.disabled = false; }
        };
        rec.start(250);
      });
    },
  };
  window.speechSynthesis?.getVoices(); // voices load lazily; ask early so the Thai one is there on first use

  async function load() {
    try {
      const r = await rk("bootstrap");
      Object.assign(state, { bots: r.bots, groups: r.groups, sections: r.botSections || [], ready: true, error: "" });
    } catch (e) { Object.assign(state, { ready: true, error: e.message }); }
    renderSide();
  }
  const bot = id => state.bots.find(b => b.id === id);
  const RUNNING = /queued|leased|running|working|busy|thinking/;
  const PAUSED = /^waiting_(input|takeover)$/;
  const isWorking = b => !!b && (b.working ?? RUNNING.test(b.status || ""));
  const roleOf = b => b.title || b.description || (b.instructions || "").split("\n")[0];
  const colorIdx = c => { const i = PALETTE.findIndex(p => p[0] === c); return i < 0 ? null : i; };
  // bots grouped by Rakazo bot section (unknown/no section -> "บอท"), in section order
  function sectioned(bots) {
    const known = [...state.sections].sort((a, b) => a.position - b.position);
    const ids = new Set(known.map(x => x.id));
    return [{ id: "", name: "บอท" }, ...known]
      .map(sec => ({ ...sec, bots: bots.filter(b => (ids.has(b.sectionId) ? b.sectionId : "") === sec.id) }))
      .filter(sec => sec.bots.length);
  }
  const avatarOf = (b, size, live = true) => avatar(b ? b.name : "?", { color: b && colorIdx(b.color), size, state: live && isWorking(b) ? "working" : "" });

  // ---------- sidebar sections ----------
  sideSections.push({
    render(q) {
      if (!state.ready) return `<div class="side-label">บอท</div>${[0, 1, 2].map(() =>
        `<div class="item"><div class="av skeleton"></div><div><div class="skeleton" style="height:12px;width:60%"></div>
         <div class="skeleton" style="height:10px;width:85%;margin-top:6px"></div></div></div>`).join("")}`;
      if (state.error) return `<div class="side-label">บอท</div><div class="muted" style="padding:6px 12px;font-size:12.5px">${esc(state.error)}</div>`;
      const cur = route() || {}, match = x => !q || x.name.toLowerCase().includes(q);
      const bots = state.bots.filter(match), groups = state.groups.filter(match);
      const row = (x, av, type, working, i) => `
        <div class="item ${cur.type === type && cur.id === x.id ? "active" : ""}" data-type="${type}" data-id="${esc(x.id)}" style="animation-delay:${i * 35}ms">
          ${av}<div style="min-width:0"><div class="name">${esc(x.name)}</div>
          <div class="snippet">${working ? '<span class="shimmer-text">กำลังทำงาน…</span>' : esc(x.preview || (type === "bot" ? roleOf(x) : ""))}</div></div>
          <div class="time">${esc(relTime(x.updatedAt))}</div></div>`;
      const secs = sectioned(bots);
      return (secs.map(sec => {
        const open = q || !collapsed.has(sec.id);
        return `<div class="side-label sec ${open ? "" : "shut"}" data-sec="${esc(sec.id)}">${icon("chevron")}<span class="grow">${esc(sec.name)}</span>${sec.bots.length}</div>
          ${open ? sec.bots.map((b, i) => row(b, avatarOf(b), "bot", isWorking(b), i)).join("") : ""}`;
      }).join("") || `<div class="side-label">บอท</div><div class="muted" style="padding:6px 12px;font-size:12.5px">${q ? "ไม่พบบอทชื่อนี้" : "ยังไม่มีบอท กด + เพื่อสร้าง"}</div>`) + `
        <div class="side-label row">ห้องรวม · ${state.groups.length}<span class="grow"></span>
          <button class="btn ghost icon sm" id="newGroup" title="สร้างห้องรวม">${icon("plus")}</button></div>
        ${groups.map((g, i) => row(g, `<div class="stack">${g.members.slice(0, 3).map(m => avatarOf(bot(m.botId) || m, "sm")).join("")}</div>`,
          "group", g.members.some(m => isWorking(bot(m.botId))), i)).join("")}`;
    },
    bind(root) {
      root.querySelectorAll(".item[data-id]").forEach(el => el.onclick = () => go({ type: el.dataset.type, id: el.dataset.id }));
      root.querySelectorAll("[data-sec]").forEach(el => el.onclick = () => {
        const id = el.dataset.sec;
        collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
        localStorage.setItem("bt.collapsed", JSON.stringify([...collapsed]));
        renderSide();
      });
      const ng = $("#newGroup", root);
      if (ng) ng.onclick = e => { e.stopPropagation(); newGroup(); };
    },
  });

  // ---------- markdown (escape first, then a small safe subset) ----------
  function md(src) {
    const blocks = [];
    let s = esc(src).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, code) => { blocks.push(`<pre><code>${code}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/^#{1,4}\s+(.*)$/gm, "<b>$1</b>")
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    const out = [];
    let list = null;
    for (const line of s.split("\n")) {
      const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
      if (li) { (list = list || []).push(`<li>${li[1]}</li>`); continue; }
      if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
      if (line.trim()) out.push(`<p>${line}</p>`);
    }
    if (list) out.push(`<ul>${list.join("")}</ul>`);
    return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
  }

  const INTENT_TH = { request: "มอบหมายงาน", result: "ส่งผลงาน", question: "ถาม", status: "อัปเดต", fyi: "แจ้งให้ทราบ" };
  // Rakazo blocks -> plain text (approval asks render as their own card)
  function blockText(b) {
    switch (b.kind) {
      case "text": return b.text;
      case "card": return b.lines.map(l => `**${l.k}:** ${l.v}`).join("\n");
      case "ask": return b.approvalEffectId || b.actions?.length ? "" : [b.text, b.detail].filter(Boolean).join("\n");
      case "choice": return [b.question, ...b.options.map(o => `- ${o.letter}. ${o.label}`)].join("\n");
      case "image": return "[รูปภาพ]";
      case "file": return b.artifactId ? "" : `[ไฟล์: ${b.name || ""}]`; // artifacts render as a chip that opens the preview
      // bot-to-bot work (message_bot): the sender's copy and the recipient's inbound message
      case "bot_message_sent": return `📨 **${INTENT_TH[b.intent] || "ส่งงาน"} → ${b.toBotName}**\n\n${b.text}`;
      case "bot_message_received": return `📨 **${INTENT_TH[b.intent] || "งาน"}จาก ${b.fromBotName}**\n\n${b.text}`;
      default: return b.text || "";
    }
  }
  // a finished run keeps a "steps" block ({steps:[{label,count}], durationMs}); show it like live steps
  const stepsOf = m => m.blocks.filter(b => b.kind === "steps").flatMap(b =>
    (b.steps || []).map(x => ({ label: x.count > 1 ? `${x.label} ×${x.count}` : x.label, count: x.count || 1, done: true })));
  const ASK_TH = { "Allow once": "อนุญาตครั้งนี้", "Always allow this tool": "อนุญาตเสมอ", "Deny": "ปฏิเสธ", "Create space": "สร้างพื้นที่", "Cancel": "ยกเลิก",
    allow: "อนุญาต", always: "อนุญาตเสมอ", deny: "ปฏิเสธ" };
  const th = x => ASK_TH[x] || String(x ?? "").replace(/^Review before /, "กฎอนุมัติ: ตรวจก่อนใช้ ");
  const toMsg = m => ({
    id: m.id, runId: m.runId, at: m.createdAt, tools: stepsOf(m),
    ms: m.blocks.find(b => b.kind === "steps")?.durationMs,
    // work handed over by another bot arrives as a "user" message: show it as that bot talking
    author: m.blocks.find(b => b.kind === "bot_message_received")?.fromBotId || (m.role === "user" ? "me" : m.role === "system" ? "system" : m.botId),
    text: m.blocks.map(blockText).filter(Boolean).join("\n\n"),
    ask: m.blocks.find(b => b.kind === "ask" && (b.approvalEffectId || b.actions?.length)), // free-text asks stay text: typing answers them
    files: m.blocks.filter(b => b.kind === "file" && b.artifactId),
  });

  // ---------- conversation view (bot or group) ----------
  function conversation(view, { kind, id }) {
    const g = kind === "group" ? state.groups.find(x => x.id === id) : null;
    const b = kind === "bot" ? bot(id) : null;
    if (!b && !g) { go({ type: "home" }); return; }
    const target = b ? { botId: id } : { groupId: id };
    const title = (b || g).name;
    const members = () => (g ? g.members.map(m => bot(m.botId) || m) : [bot(id) || b]);
    view.innerHTML = `
      <div class="chat"><div class="chat-main">
        <div class="chat-head">${b ? avatarOf(b, "lg") : `<div class="stack">${members().slice(0, 4).map(m => avatarOf(m)).join("")}</div>`}
          <div class="who-box"><div class="title">${esc(title)}</div><div class="status" id="c-status"></div></div>
          ${b ? `<button class="btn sm" id="c-computer">${icon("monitor")}Computer</button>` : ""}
          ${b?.computerMode === "dedicated" ? `<button class="btn sm" id="c-term" title="เปิด shell ใน Linux ของบอทตัวนี้">${icon("terminal")}Terminal</button>` : ""}
          <button class="btn ghost icon" id="c-web" title="เปิดใน Rakazo (ตั้งค่า, routines, memory)">${icon("external")}</button>
          <button class="btn ghost icon" id="c-more" title="${b ? "ลบบอท" : "ลบห้อง"}">${icon("trash")}</button></div>
        <div class="msgs" id="msgs"><div class="msgs-inner" id="msgs-inner"><div class="empty" style="min-height:40vh"><div class="typing"><i></i><i></i><i></i></div></div></div></div>
        <div class="composer-wrap"><div class="help-bar" id="c-sugg" hidden></div><div class="help-bar" id="c-help" hidden><span>🖐</span><span class="grow" id="c-help-text"></span>
          <button class="btn sm" id="c-help-take">ช่วยบนหน้าจอ</button><button class="btn sm primary" id="c-help-done">${icon("play")}ให้บอททำต่อ</button>
          <button class="btn ghost sm" id="c-help-skip">ข้าม</button></div><div class="attach-row" id="c-att" hidden></div><div class="composer"><textarea id="c-input" rows="1" placeholder="${b ? "สั่งงาน " + esc(title) + "…" : "พิมพ์ @ชื่อบอท หรือ @everyone เพื่อเรียกบอทในห้อง…"}"></textarea>
          <button class="btn ghost icon" id="c-attach" title="แนบไฟล์ให้บอท (รูป PDF TXT MD CSV JSON ≤10 MB, ครั้งละ 4 ไฟล์)">${icon("clip")}</button>
          <input type="file" id="c-file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.md,.csv,.json">
          <button class="btn ghost icon" id="c-mic" title="พูดสั่งงาน (คลิกเริ่ม คลิกอีกครั้งเพื่อส่ง) · บอทจะอ่านคำตอบให้ฟัง">🎤</button>
          <button class="btn ghost icon" id="c-stop" title="หยุดบอท" hidden>${icon("stop")}</button>
          <button class="btn primary" id="c-send" disabled title="ส่ง (Enter)">${icon("send")}</button></div>
          <div class="hint">Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่ · ${b ? "บอททำงานบน Computer ของตัวเองใน Rakazo" : "ไม่ระบุ @ = บอทตัวแรกในห้องตอบ"}</div></div>
      </div><div class="computer" id="computer"></div></div>`;

    const inner = $("#msgs-inner", view), box = $("#msgs", view), input = $("#c-input", view), send = $("#c-send", view);
    const msgs = new Map(); // id -> message (UI shape)
    let order = [], alive = true, unsub = null;
    const running = new Map(); // runId -> botId
    const waiting = new Set(); // runIds paused on an approval ask
    const helping = new Map(); // runId -> botId paused on request_takeover (the user must do a step on the bot's screen)
    const namesOf = ids => [...new Set(ids)].map(x => bot(x)?.name).filter(Boolean).join(", ") || "บอท";

    function status() {
      const working = members().filter(isWorking);
      $("#c-stop", view).hidden = !running.size;
      $("#c-help", view).hidden = !helping.size;
      if (helping.size) $("#c-help-text", view).textContent = `${namesOf(helping.values())} ขอให้คุณช่วยบนหน้าจอ (เช่น ล็อกอิน/CAPTCHA) เสร็จแล้วกด "ให้บอททำต่อ"`;
      $("#c-status", view).innerHTML = helping.size
        ? `<span class="dot warn"></span>${esc(namesOf(helping.values()))} รอให้คุณช่วยบนหน้าจอ Computer`
        : waiting.size
        ? `<span class="dot warn"></span>${esc([...waiting].map(r => bot(running.get(r))?.name).filter(Boolean).join(", ") || "บอท")} รออนุมัติจากคุณ`
        : working.length
        ? `<span class="dot good"></span><span class="shimmer-text">${esc(working.map(m => m.name).join(", "))} กำลังทำงาน…</span>`
        : g ? `<span class="dot"></span>${members().length} บอท · ${esc(members().map(m => m.name).join(", "))}`
            : `<span class="dot"></span>${esc(roleOf(b) || "พร้อมรับงาน")}`;
    }
    function setWorking(botId, on) {
      const x = bot(botId);
      if (x) x.working = on;
      status(); renderSide();
    }

    const nearBottom = () => box.scrollTop + box.clientHeight >= box.scrollHeight - 80;
    function bubbleHtml(m, prev) {
      if (m.author === "system") return m.text ? `<div class="day" data-id="${esc(m.id)}">${esc(m.text)}</div>` : `<i data-id="${esc(m.id)}"></i>`;
      const mine = m.author === "me", who = mine ? null : bot(m.author) || (g && g.members.find(x => x.botId === m.author));
      const cont = prev && prev.author === m.author && !prev.ask && (new Date(m.at) - new Date(prev.at)) < 120000;
      const tools = stepsHtml(m);
      const body = m.text ? `<div class="bubble">${md(m.text)}</div>`
        : m.pending && !m.ask ? `<div class="bubble"><div class="typing" style="padding:4px 2px"><i></i><i></i><i></i></div></div>` : "";
      const a = m.ask;
      const ask = !a ? "" : `<div class="approval"><div style="font-weight:600">${icon("sparkles")} ${(a.actions || []).some(x => x.id === "allow") ? "ขออนุญาต" : "บอทถาม"}</div><div style="margin-top:6px">${md(th(a.text))}</div>
        ${a.detail ? `<pre style="white-space:pre-wrap;margin:8px 0 0">${esc(th(a.detail))}</pre>` : ""}
        <div class="row">${a.status === "answered" ? `<span class="muted">ตอบแล้ว: ${esc(th(a.actions?.find(x => x.id === a.answer)?.label || a.answer || ""))}</span>`
          : (a.actions || []).map(x => `<button class="btn sm ${x.id === "allow" ? "primary" : x.id === "deny" ? "danger" : ""}" data-answer="${esc(x.id)}" data-msg="${esc(m.id)}">${esc(th(x.label))}</button>`).join("")}</div></div>`;
      return `<div class="msg ${mine ? "me" : "bot"} ${cont ? "cont" : ""}" data-id="${esc(m.id)}">
        ${mine ? "" : avatarOf(who, "sm", false)}
        <div class="col">${g && !mine && !cont ? `<div class="who" style="color:var(--muted)">${esc(who ? who.name : "บอท")}</div>` : ""}
          ${tools}${body}${(m.files || []).map((f, i) => `<button class="file-chip" data-file="${esc(m.id)}" data-fi="${i}">📎 <b>${esc(f.name)}</b><span class="muted">${f.size ? Math.max(1, Math.round(f.size / 1024)) + " KB" : ""}</span></button>`).join("")}${ask}${cont || m.pending ? "" : `<div class="meta">${esc(relTime(m.at))}${!mine && m.text ? `<button class="say" data-say="${esc(m.id)}" title="อ่านออกเสียง">🔊</button><button class="say" data-verify="${esc(m.id)}" title="ให้บอทอื่นตรวจข้อเท็จจริง">🔎</button>${App.assistant?.verifyBadge(m.id) || ""}` : ""}</div>`}</div></div>`;
    }
    // tool activity collapses into one "steps" block: latest step while running, "N steps" when done
    function stepsHtml(m) {
      const t = m.tools || [];
      if (!t.length) return "";
      const busy = t.some(x => !x.done), last = t[t.length - 1];
      return `<details class="steps" ${m.stepsOpen ? "open" : ""} data-steps="${esc(m.id)}"><summary>${busy ? '<span class="spin"></span>' : icon("check")}
        <span class="label">${esc(busy ? last.label : `ทำไป ${t.reduce((n, x) => n + (x.count || 1), 0)} ขั้นตอน${m.ms ? ` · ${Math.round(m.ms / 1000)} วินาที` : ""}`)}</span>${icon("chevron")}</summary>
        <div class="list">${t.map(x => `<div class="${x.error ? "err" : ""}">${x.done ? icon(x.error ? "x" : "check") : '<span class="spin"></span>'}<span>${esc(x.label)}</span>${x.tool && x.tool !== x.label ? `<code>${esc(x.tool)}</code>` : ""}</div>`).join("")}</div></details>`;
    }
    function renderAll() {
      if (!order.length) {
        const s = b ? ["แนะนำตัวหน่อย", "เปิด www.bcaccount.com แล้วถ่ายภาพหน้าจอ", "รัน uname -a ใน terminal", "สรุปข่าวเทคโนโลยีวันนี้"]
                    : ["@everyone แนะนำตัวทีละคน", "@everyone ประชุมวางแผนเพิ่มยอดขายเดือนหน้า แต่ละฝ่ายเสนอ 3 ข้อ"];
        inner.innerHTML = `<div class="empty"><div><div class="float">${b ? avatarOf(b, "xl") : `<div class="stack">${members().map(m => avatarOf(m, "lg")).join("")}</div>`}</div>
          <h2>${b ? "เริ่มงานกับ " + esc(b.name) : esc(g.name)}</h2><div class="muted">${esc(b ? roleOf(b) : "ห้องรวมของ " + members().map(m => m.name).join(", "))}</div>
          <div class="suggest">${s.map((t, i) => `<button style="animation-delay:${i * 60}ms">${esc(t)}</button>`).join("")}</div></div></div>`;
        inner.querySelectorAll(".suggest button").forEach(btn => btn.onclick = () => { input.value = btn.textContent; autosize(); input.focus(); });
        return;
      }
      inner.innerHTML = order.map((id, i) => bubbleHtml(msgs.get(id), msgs.get(order[i - 1]))).join("");
      box.scrollTop = box.scrollHeight;
    }
    function upsert(m) {
      const stick = nearBottom(), isNew = !msgs.has(m.id);
      msgs.set(m.id, Object.assign(msgs.get(m.id) || {}, m));
      if (isNew) {
        // the server copy of my message replaces the optimistic one
        const temp = m.author === "me" && order.find(x => x.startsWith("tmp-") && msgs.get(x).text === m.text);
        if (temp) remove(temp);
        if (!order.length) inner.innerHTML = "";
        order.push(m.id);
        inner.insertAdjacentHTML("beforeend", bubbleHtml(msgs.get(m.id), msgs.get(order[order.length - 2])));
      } else {
        const el = inner.querySelector(`[data-id="${CSS.escape(m.id)}"]`), i = order.indexOf(m.id);
        if (el) { const t = document.createElement("div"); t.innerHTML = bubbleHtml(msgs.get(m.id), msgs.get(order[i - 1])); const n = t.firstElementChild; n.style.animation = "none"; el.replaceWith(n); }
      }
      if (stick || m.author === "me") box.scrollTop = box.scrollHeight;
    }
    function remove(id) {
      if (!msgs.delete(id)) return;
      order = order.filter(x => x !== id);
      inner.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
    }
    const liveId = runId => "progress:" + runId;
    function live(e) {
      const lid = liveId(e.runId);
      if (!msgs.has(lid)) upsert({ id: lid, author: e.botId, text: "", pending: true, tools: [], at: e.createdAt });
      return msgs.get(lid);
    }

    function onEvent(e) {
      const p = e.payload || {};
      // a paused run still reports its paused tool call (agent.tool.* outcome "paused"); only run.started means it resumed
      if (waiting.has(e.runId)) {
        if (e.type === "run.started") { waiting.delete(e.runId); status(); }
        else if (e.type.startsWith("agent.tool.") || e.type === "thread.progress") return;
      }
      switch (e.type) {
        case "run.waiting_input": {
          waiting.add(e.runId);
          const l = msgs.get(liveId(e.runId)); // no typing dots under the approval card
          if (l && !l.text && !l.tools.length) remove(l.id); else if (l) upsert({ id: l.id, pending: false });
          status();
          break;
        }
        case "computer.takeover.requested": {
          helping.set(e.runId || "takeover:" + e.botId, e.botId);
          const l = msgs.get(liveId(e.runId)); // no typing dots while the bot waits for the user
          if (l && !l.text && !l.tools.length) remove(l.id); else if (l) upsert({ id: l.id, pending: false });
          status();
          break;
        }
        case "computer.takeover.released": for (const [r, x] of helping) if (x === e.botId) helping.delete(r); status(); break;
        case "run.started": helping.delete(e.runId); running.set(e.runId, e.botId); live(e); setWorking(e.botId, true); break;
        case "thread.progress": {
          const l = live(e);
          if (p.activity) l.tools.push({ label: p.text, done: false });
          else if (p.delta != null) l.text += p.delta;
          else if (p.text != null) l.text = p.text;
          upsert({ id: l.id, pending: !l.text });
          break;
        }
        case "agent.tool.called": {
          // the activity note ("Reading page: …") usually precedes its tool call; merge them into one step
          const l = live(e), last = l.tools[l.tools.length - 1];
          if (last && !last.tool && !last.done) Object.assign(last, { tool: p.name, id: p.executionId });
          else l.tools.push({ label: p.name, tool: p.name, id: p.executionId, done: false });
          upsert({ id: l.id });
          break;
        }
        case "agent.tool.completed": {
          const l = msgs.get(liveId(e.runId)), t = l && l.tools.find(x => x.id === p.executionId);
          if (t) { t.done = true; t.error = p.outcome === "error"; upsert({ id: l.id }); }
          break;
        }
        case "thread.message.created": case "thread.message.updated": {
          const m = toMsg({ id: p.messageId, role: p.role, blocks: p.blocks, botId: e.botId, runId: e.runId, createdAt: e.createdAt });
          const l = e.runId && p.role === "bot" ? msgs.get(liveId(e.runId)) : null;
          if (l) { if (l.tools.length) m.tools = l.tools.map(t => ({ ...t, done: true })); remove(l.id); }
          if (msgs.has(m.id)) delete m.at; // keep original timestamp on edits
          upsert(m);
          break;
        }
        case "run.completed": case "run.failed": case "run.cancelled": {
          const l = msgs.get(liveId(e.runId));
          if (l) l.tools.forEach(t => { t.done = true; });
          if (l && (l.text || l.tools.length)) upsert({ id: l.id, pending: false }); else remove(liveId(e.runId));
          if (speakRun && e.type === "run.completed") { // answer to a spoken message: read the bot's last reply aloud
            const last = [...msgs.values()].filter(x => x.runId === e.runId && x.text && x.author !== "me").pop() || (l?.text ? l : null);
            if (last) { speakRun = false; App.voice.speak(last.text, last.author); }
          }
          running.delete(e.runId); waiting.delete(e.runId); helping.delete(e.runId);
          if (![...running.values()].includes(e.botId)) setWorking(e.botId, false);
          if (e.type === "run.failed") upsert({ id: "fail:" + e.runId, author: "system", text: "งานล้มเหลว: " + (p.error || "ไม่ทราบสาเหตุ"), at: e.createdAt });
          break;
        }
        case "thread.cleared": msgs.clear(); order = []; renderAll(); break;
        case "computer.status": if (panel.classList.contains("open")) computerStatus(p.status); break;
      }
    }

    (async () => {
      try {
        const snap = await rk("threads/get", target);
        if (!alive) return;
        snap.messages.forEach(m => { const x = toMsg(m); msgs.set(x.id, x); order.push(x.id); });
        renderAll();
        for (const r of [snap.run, ...(snap.activeRuns || [])].filter(Boolean)) {
          if (!RUNNING.test(r.status) && !PAUSED.test(r.status)) continue;
          running.set(r.id, r.botId);
          if (r.status === "waiting_input") waiting.add(r.id);
          else if (r.status === "waiting_takeover") helping.set(r.id, r.botId);
          else live({ runId: r.id, botId: r.botId, createdAt: r.updatedAt || new Date().toISOString() });
          setWorking(r.botId, true);
        }
        unsub = subscribe("rk.subscribe", { target, cursor: snap.cursor }, m => {
          if (m.error) toast("การเชื่อมต่อสดขาด: " + m.error, "warn");
          else if (m.event) onEvent(m.event);
        });
      } catch (e) { inner.innerHTML = `<div class="empty"><div class="muted">โหลดข้อความไม่ได้: ${esc(e.message)}</div></div>`; }
    })();
    status();

    inner.addEventListener("toggle", e => {
      const m = e.target.dataset && msgs.get(e.target.dataset.steps);
      if (m) m.stepsOpen = e.target.open;
    }, true);
    inner.addEventListener("click", async e => {
      const file = e.target.closest("[data-file]");
      if (file) {
        const m = msgs.get(file.dataset.file), f = m.files[+file.dataset.fi];
        return App.work.preview({ id: f.artifactId, name: f.name, mimeType: f.mimeType, size: f.size || 0, botId: g ? m.author : id, groupId: g ? g.id : null });
      }
      const btn = e.target.closest("[data-answer]");
      if (!btn) return;
      const m = msgs.get(btn.dataset.msg), row = btn.closest(".row");
      if (btn.dataset.answer === "always" && !(await App.assistant.confirmAlways(m.ask?.detail))) return;
      row.querySelectorAll("button").forEach(x => x.disabled = true);
      try { await rk("threads/answer", { ...target, runId: m.runId, messageId: m.id, answer: btn.dataset.answer }); }
      catch (err) { toast("ตอบไม่สำเร็จ: " + err.message, "bad"); row.querySelectorAll("button").forEach(x => x.disabled = false); }
    });

    function autosize() { input.style.height = "auto"; input.style.height = Math.min(220, input.scrollHeight) + "px"; send.disabled = !input.value.trim() && !attached.length; }
    // attachments: Rakazo stores each file (artifacts/create) and the message carries their ids; images go to the model,
    // other files land on the bot's computer under attachments/ for read_file/shell
    const ATTACH_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf",
      txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json" };
    const attached = [], attRow = $("#c-att", view), fileInput = $("#c-file", view);
    const drawAttached = () => {
      attRow.hidden = !attached.length;
      attRow.innerHTML = attached.map((f, i) => `<span class="file-chip">📎 <b>${esc(f.name)}</b><span class="muted">${Math.max(1, Math.round(f.size / 1024))} KB</span><button class="btn ghost icon sm" data-unattach="${i}" title="เอาออก">${icon("x")}</button></span>`).join("");
      autosize();
    };
    attRow.addEventListener("click", e => { const x = e.target.closest("[data-unattach]"); if (x) { attached.splice(+x.dataset.unattach, 1); drawAttached(); } });
    $("#c-attach", view).onclick = () => fileInput.click();
    fileInput.onchange = () => {
      for (const file of fileInput.files) {
        const mimeType = ATTACH_TYPES[(file.name.split(".").pop() || "").toLowerCase()];
        if (!mimeType) toast(`${file.name}: รองรับเฉพาะรูป PDF TXT MD CSV JSON`, "warn");
        else if (file.size > 10 * 1048576) toast(`${file.name}: ใหญ่เกิน 10 MB`, "warn");
        else if (attached.length >= 4) toast("แนบได้ครั้งละ 4 ไฟล์", "warn");
        else attached.push({ file, name: file.name, size: file.size, mimeType });
      }
      fileInput.value = ""; drawAttached(); input.focus();
    };
    const base64Of = blob => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => fail(r.error); r.readAsDataURL(blob); });
    input.addEventListener("input", autosize);
    input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); } });
    send.onclick = doSend;
    // voice: 🎤 records, local whisper (host) turns it into text and sends it; the reply to a spoken message is read aloud
    const mic = $("#c-mic", view);
    let speakRun = false;
    mic.onclick = async () => {
      const heard = App.voice.listen(mic);
      if (!heard) return; // second click: stopped, the first click's promise sends
      mic.title = "คลิกเพื่อหยุดและส่ง";
      try {
        const text = await heard;
        if (!text) toast("ไม่ได้ยินเสียงพูด ลองใหม่อีกครั้ง", "warn");
        else { input.value = text; autosize(); speakRun = true; await doSend(); }
      } catch (e) { toast(e.message, "bad"); }
      finally { mic.title = "พูดสั่งงาน"; }
    };
    inner.addEventListener("click", e => {
      const say = e.target.closest("[data-say]");
      if (say) { const m = msgs.get(say.dataset.say); App.voice.speak(m?.text || "", m?.author); }
      const ver = e.target.closest("[data-verify]");
      if (ver) {
        const m = msgs.get(ver.dataset.verify);
        App.assistant.verify({ msgId: m.id, text: m.text, botName: bot(m.author)?.name || "บอท", at: m.at })
          .then(v => toast("ผลตรวจ: " + v, v === "ถูกต้อง" ? "good" : "warn"), err => toast("ตรวจไม่สำเร็จ: " + err.message, "bad"));
      }
    });
    async function sendText(text, files = []) {
      const nonce = "tmp-" + Date.now();
      upsert({ id: nonce, author: "me", text, files: files.map(a => ({ artifactId: a.id, name: a.name, size: a.size, mimeType: a.mimeType })), at: new Date().toISOString() });
      try { await rk("threads/send", { ...target, ...(text ? { text } : {}), ...(files.length ? { artifactIds: files.map(a => a.id) } : {}), clientNonce: nonce }); }
      catch (e) { remove(nonce); throw e; }
    }
    async function doSend() {
      const text = input.value.trim(), files = attached.splice(0);
      if (!text && !files.length) return;
      input.value = ""; drawAttached();
      if (helping.size || waiting.size) { // bot paused on a takeover/ask: typing continues the task (files wait for the next message)
        if (files.length) { attached.push(...files); drawAttached(); }
        return cont("done", text);
      }
      try {
        const uploaded = [];
        for (const f of files) uploaded.push(await rk("artifacts/create", { ...target, name: f.name, mimeType: f.mimeType, contentBase64: await base64Of(f.file) }));
        await sendText(text, uploaded);
        if (!g && text) App.assistant?.correction(text, [...msgs.values()], $("#c-sugg", view)).catch(() => {});
      } catch (e) { toast("ส่งไม่สำเร็จ: " + e.message, "bad"); input.value = text; attached.push(...files); drawAttached(); }
    }
    $("#c-stop", view).onclick = () => rk("threads/stop", target).then(resync, e => toast("หยุดไม่สำเร็จ: " + e.message, "bad"));
    // a missed run.completed (stream hiccup) leaves a ghost "working…" and a Stop that stops nothing:
    // while anything looks busy, re-read the thread and close runs the server no longer has
    async function resync() {
      if (!running.size) return;
      const snap = await rk("threads/get", target).catch(() => null);
      if (!alive || !snap) return;
      snap.messages.forEach(m => { if (!msgs.has(m.id)) upsert(toMsg(m)); });
      const act = [snap.run, ...(snap.activeRuns || [])].filter(r => r && (RUNNING.test(r.status) || PAUSED.test(r.status)));
      const active = new Set(act.map(r => r.id));
      for (const [runId, botId] of [...running]) if (!active.has(runId)) onEvent({ type: "run.completed", runId, botId });
      for (const r of act) if (r.status === "waiting_takeover" && !helping.has(r.id)) helping.set(r.id, r.botId);
      status();
    }
    const resyncTimer = setInterval(resync, 15000);

    // request_takeover: the user does the step on the bot's screen, then lets the bot go on (or skip that step).
    // Rakazo v0.1.6 never resumed the paused run after takeover/release here (tested twice), so: hand the screen back,
    // stop the paused run and continue in a new run - it sees the whole chat and the same screen. A pending ask
    // (threads/send refuses while it waits) takes the same path, so typing a reply always works.
    async function cont(reason, text) {
      const botId = [...helping.values()][0] || running.get([...waiting][0]) || b?.id, name = bot(botId)?.name || "";
      try {
        if (b && control) {
          control = false;
          await rk("computer/release", { botId, reason });
          const t = $("#pc-take", panel); if (t) t.textContent = "ควบคุมเอง";
        }
        await rk("threads/stop", target);
        for (let i = 0; i < 20; i++) { // the paused ask must be gone before a new message is accepted
          const snap = await rk("threads/get", target);
          if (![snap.run, ...(snap.activeRuns || [])].some(r => r && PAUSED.test(r.status))) break;
          await new Promise(r => setTimeout(r, 500));
        }
        helping.clear(); waiting.clear(); status();
        await sendText((g && name && !/^@/.test(text || "") ? `@${name} ` : "") + (text ||
          (reason === "done" ? "ผมทำขั้นตอนบนหน้าจอเสร็จแล้ว ดูหน้าจอแล้วทำงานเดิมต่อให้จบ" : "ข้ามขั้นตอนนั้นไป ทำส่วนที่เหลือของงานต่อ")));
      } catch (e) { toast("ให้บอททำต่อไม่สำเร็จ: " + e.message, "bad"); resync(); }
    }
    $("#c-help-done", view).onclick = () => cont("done");
    $("#c-help-skip", view).onclick = () => cont("skipped");
    $("#c-help-take", view).onclick = async () => {
      const botId = [...helping.values()][0];
      if (!b) return go({ type: "bot", id: botId }); // the screen lives in the bot's own chat
      if (!panel.classList.contains("open")) await openComputer();
      if (!control) $("#pc-take", panel)?.click();
    };
    setTimeout(() => input.focus(), 100);

    // ---------- computer panel (noVNC iframe from computer.screenUrl; the URL carries its own signed capability) ----------
    const panel = $("#computer", view);
    let heartbeat = null, control = false;
    async function computerStatus(s) {
      try { await showComputer(s); }
      catch (err) {
        const screen = $("#pc-screen", panel);
        if (!screen) return;
        delete screen.dataset.mode;
        screen.innerHTML = `<div style="text-align:center"><div class="muted" style="margin-bottom:14px">${esc(err.message)}</div><button class="btn" id="pc-retry">${icon("refresh")}ลองใหม่</button></div>`;
        $("#pc-retry", panel).onclick = () => rk("computer/status", { botId: id }).then(computerStatus, computerStatus.bind(null, { state: "error" }));
      }
    }
    async function showComputer(s) {
      const screen = $("#pc-screen", panel), st = $("#pc-state", panel);
      if (!screen || teach) return; // the teaching screen is managed by startTeach
      const label = { stopped: "ปิดอยู่", booting: "กำลังเปิด…", running: "ทำงาน", suspended: "พักอยู่", error: "ผิดพลาด" }[s.state] || s.state;
      st.innerHTML = `<span class="dot ${s.state === "running" ? "good" : s.state === "error" ? "bad" : "warn"}"></span>${esc(label)}${s.controlHolder === "user" ? " · คุณควบคุมอยู่" : s.controlHolder === "bot" ? " · บอทใช้งานอยู่" : ""}`;
      $("#pc-take", panel).hidden = s.state !== "running";
      if (s.state === "running" && s.screenAvailable) {
        if (screen.dataset.mode === (control ? "control" : "view")) return;
        const r = await rk("computer/screenUrl", { botId: id });
        if (!r.url) return;
        screen.dataset.mode = control ? "control" : "view";
        screen.innerHTML = `<iframe src="${esc(new URL(r.url, "http://127.0.0.1:5173").href)}" sandbox="allow-scripts allow-pointer-lock" title="computer"></iframe>`;
      } else if (s.state !== "booting") {
        delete screen.dataset.mode;
        screen.innerHTML = `<div style="text-align:center"><div class="muted" style="margin-bottom:14px">Computer ${esc(label)}</div>
          <button class="btn primary" id="pc-boot">${icon("play")}เปิด Computer</button></div>`;
        $("#pc-boot", panel).onclick = async ev => {
          ev.currentTarget.disabled = true;
          screen.innerHTML = `<div class="typing"><i></i><i></i><i></i></div>`;
          computerStatus(await rk("computer/boot", { botId: id }).catch(err => { toast("เปิด Computer ไม่สำเร็จ: " + err.message, "bad"); return { state: "error" }; }));
        };
      } else screen.innerHTML = `<div class="typing"><i></i><i></i><i></i></div>`;
    }
    async function openComputer() {
      if (panel.classList.toggle("open")) {
        panel.innerHTML = `<div class="bar-top">${icon("monitor")}<b>Computer</b><span class="muted" id="pc-state" style="display:flex;align-items:center;gap:6px"></span>
          <span style="flex:1"></span><button class="btn sm" id="pc-teach" title="ทำให้บอทดู 1 รอบ แล้วบอททำซ้ำเองได้">🎓 สอนงาน</button><button class="btn sm" id="pc-take" hidden>ควบคุมเอง</button><button class="btn ghost icon sm" id="pc-x">${icon("x")}</button></div>
          <div class="screen" id="pc-screen"><div class="typing"><i></i><i></i><i></i></div></div>`;
        $("#pc-x", panel).onclick = openComputer;
        $("#pc-teach", panel).onclick = () => startTeach();
        $("#pc-take", panel).onclick = async ev => {
          const btn = ev.currentTarget;
          if (control && helping.size) return cont("done"); // "คืนให้บอท" after helping = continue the task
          try {
            if (control) await rk("computer/release", { botId: id, reason: "done" }); else await rk("computer/takeover", { botId: id });
            control = !control;
            btn.textContent = control ? "คืนให้บอท" : "ควบคุมเอง";
            computerStatus(await rk("computer/status", { botId: id }));
          } catch (err) { toast(err.message, "bad"); }
        };
        heartbeat = setInterval(() => rk("computer/heartbeat", { botId: id }).catch(() => {}), 60000);
        try { computerStatus(await rk("computer/status", { botId: id })); } catch (e) { $("#pc-screen", panel).innerHTML = `<div class="muted" style="padding:24px">${esc(e.message)}</div>`; }
      } else closeComputer();
    }
    function closeComputer() {
      if (teach) return toast("กำลังสอนงานอยู่ กด “จบการสอน” หรือ “ยกเลิก” ก่อน", "warn");
      clearInterval(heartbeat);
      if (control) { control = false; rk("computer/release", { botId: id, reason: "done" }).catch(() => {}); }
      panel.classList.remove("open");
      setTimeout(() => { if (!panel.classList.contains("open")) panel.innerHTML = ""; }, 450);
    }

    // ---------- teach by showing (Rakazo taught skills) ----------
    // skills/start hands the screen to the user; every click/key/scroll goes through computer.input so Rakazo records it,
    // skills/stop turns the recording into a playbook (literal steps). The screen is shown at its native size and scaled,
    // so overlay coordinates map exactly onto screen pixels.
    const TEACH_KEYS = new Set(["Enter", "Backspace", "Escape", "Tab", "Delete", "Home", "End", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
    let teach = null;
    async function startTeach(goalText) {
      if (!b || teach) return;
      const goal = goalText || await new Promise(done => {
        const m = modal(`<h2>🎓 สอนงานให้ ${esc(b.name)}</h2>
          <div class="muted">ทำให้ดูบนหน้าจอของบอท 1 รอบ (ไม่เกิน 10 นาที) ระบบจดทุกคลิกและการพิมพ์ แล้วแปลงเป็นขั้นตอนที่บอททำซ้ำเองได้</div>
          <textarea class="input" id="tg-goal" rows="3" style="margin-top:14px" placeholder="เช่น เปิดเว็บกรมสรรพากรแล้วค้นหาอัตราภาษีมูลค่าเพิ่ม"></textarea>
          <div class="muted" style="font-size:12px;margin-top:8px">ระหว่างสอน บอทจะหยุดงานที่ทำอยู่ · อย่าพิมพ์รหัสผ่านหรือข้อมูลลับ</div>
          <div class="actions"><button class="btn ghost" id="tg-cancel">ยกเลิก</button><button class="btn primary" id="tg-ok">${icon("play")}เริ่มสอน</button></div>`);
        $("#tg-cancel", m.el).onclick = () => { m.close(); done(""); };
        $("#tg-ok", m.el).onclick = () => { const v = $("#tg-goal", m.el).value.trim(); if (v.length < 4) return toast("บอกเป้าหมายของงานก่อน", "warn"); m.close(); done(v); };
        setTimeout(() => $("#tg-goal", m.el)?.focus(), 50);
      });
      if (!goal) return;
      if (!panel.classList.contains("open")) await openComputer();
      const screen = $("#pc-screen", panel);
      teach = { goal };
      screen.dataset.mode = "teach";
      screen.innerHTML = `<div class="typing"><i></i><i></i><i></i></div>`;
      try {
        teach.skill = await rk("skills/start", { botId: id, goal });
        let st;
        for (let i = 0; i < 120 && teach; i++) { // skills/start boots a stopped computer
          st = await rk("computer/status", { botId: id });
          if (st.state === "running" && st.screenAvailable) break;
          await new Promise(r => setTimeout(r, 1000));
        }
        const r = await rk("computer/screenUrl", { botId: id });
        if (!teach || !r.url) throw new Error("เปิดหน้าจอไม่ได้");
        const W = st.screenWidth || 1280, H = st.screenHeight || 800;
        Object.assign(teach, { W, H, chain: Promise.resolve(), count: 0 });
        screen.innerHTML = `<div class="teach-bar"><span class="rec-dot"></span><b>กำลังสอน</b><span class="muted grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(goal)}</span>
            <span class="mono" id="tg-left"></span><span class="chip" id="tg-n">0 การกระทำ</span><button class="btn sm ghost" id="tg-abort">ยกเลิก</button><button class="btn sm primary" id="tg-stop">${icon("check")}จบการสอน</button></div>
          <div class="teach-stage"><iframe src="${esc(new URL(r.url, "http://127.0.0.1:5173").href)}" width="${W}" height="${H}" sandbox="allow-scripts" tabindex="-1" title="teach"></iframe>
          <div class="teach-ov" tabindex="0" title="คลิกและพิมพ์ตรงนี้ = ทำบนหน้าจอของบอท"></div></div>`;
        const stage = $(".teach-stage", screen), frame = $("iframe", stage), ov = $(".teach-ov", stage);
        const fit = () => { const k = Math.min(stage.clientWidth / W, stage.clientHeight / H); frame.style.transform = `translate(${(stage.clientWidth - W * k) / 2}px, ${(stage.clientHeight - H * k) / 2}px) scale(${k})`; };
        teach.ro = new ResizeObserver(fit); teach.ro.observe(stage); fit();
        const at = e => { const q = frame.getBoundingClientRect(); return { x: Math.max(0, Math.min(W - 1, Math.round((e.clientX - q.left) * W / q.width))), y: Math.max(0, Math.min(H - 1, Math.round((e.clientY - q.top) * H / q.height))) }; };
        const raw = (kind, payload) => { teach.chain = teach.chain.then(() => rk("computer/input", { botId: id, kind, payload })).catch(err => toast("ส่งไปหน้าจอไม่สำเร็จ: " + err.message, "bad")); };
        const send = (kind, payload) => { $("#tg-n", screen).textContent = ++teach.count + " การกระทำ"; raw(kind, payload); };
        let moved = false, lastMove = 0;
        ov.onpointerdown = e => { e.preventDefault(); ov.focus(); ov.setPointerCapture(e.pointerId); moved = false; send("pointer", { ...at(e), button: e.button === 2 ? "right" : "left", type: "down" }); };
        ov.onpointermove = e => { if (!e.buttons || Date.now() - lastMove < 60) return; lastMove = Date.now(); moved = true; raw("pointer", { ...at(e), button: "left", type: "move" }); };
        ov.onpointerup = e => { e.preventDefault(); if (moved) raw("pointer", { ...at(e), button: "left", type: "move" }); raw("pointer", { ...at(e), button: e.button === 2 ? "right" : "left", type: "up" }); };
        ov.oncontextmenu = e => e.preventDefault();
        ov.addEventListener("wheel", e => { e.preventDefault(); send("scroll", { direction: e.deltaY < 0 ? "up" : "down", amount: Math.min(20, Math.max(1, Math.round(Math.abs(e.deltaY) / 80) || 1)) }); }, { passive: false });
        ov.onkeydown = e => { if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return; if (e.key.length === 1 || TEACH_KEYS.has(e.key)) { e.preventDefault(); send("key", { key: e.key }); } };
        ov.focus();
        const until = Date.parse(teach.skill.expiresAt) || Date.now() + 600000;
        teach.timer = setInterval(() => {
          const left = Math.max(0, until - Date.now());
          $("#tg-left", screen).textContent = Math.floor(left / 60000) + ":" + String(Math.floor(left / 1000) % 60).padStart(2, "0");
          if (!left) finishTeach(true);
        }, 500);
        $("#tg-stop", screen).onclick = () => finishTeach(true);
        $("#tg-abort", screen).onclick = () => finishTeach(false);
      } catch (e) {
        toast("เริ่มสอนไม่สำเร็จ: " + e.message, "bad");
        if (teach?.skill) rk("skills/stop", { skillId: teach.skill.id }).then(x => rk("skills/remove", { skillId: x.id })).catch(() => {});
        endTeach();
      }
    }
    function endTeach() {
      if (teach) { clearInterval(teach.timer); teach.ro?.disconnect(); }
      teach = null;
      const screen = $("#pc-screen", panel);
      if (screen) { delete screen.dataset.mode; screen.innerHTML = `<div class="typing"><i></i><i></i><i></i></div>`; }
      rk("computer/status", { botId: id }).then(computerStatus, () => {});
    }
    async function finishTeach(keep) {
      if (!teach || teach.finishing) return;
      teach.finishing = true;
      const t = teach;
      clearInterval(t.timer);
      try {
        await t.chain;
        let skill = t.skill && await rk("skills/stop", { skillId: t.skill.id });
        for (let i = 0; i < 30 && skill && !/^(draft|saved)$/.test(skill.status); i++) { await new Promise(r => setTimeout(r, 500)); skill = await rk("skills/get", { skillId: t.skill.id }); }
        endTeach();
        if (!keep) { if (skill) await rk("skills/remove", { skillId: skill.id }); return toast("ยกเลิกการสอนแล้ว", "good"); }
        App.skills.editDraft(skill, { W: t.W, H: t.H });
      } catch (e) { toast("จบการสอนไม่สำเร็จ: " + e.message, "bad"); endTeach(); }
    }
    if (b && route().teach) setTimeout(() => startTeach(), 300); // "สอนงานใหม่" from the skills tab
    App.chat.teaching = () => teach; // tests
    if (b) $("#c-computer", view).onclick = openComputer;
    const term = $("#c-term", view);
    if (term) term.onclick = async () => {
      term.disabled = true;
      try { await call("bot.terminal", { botId: id, name: b.name }); } catch (e) { toast("เปิด Terminal ไม่สำเร็จ: " + e.message, "bad"); }
      term.disabled = false;
    };
    $("#c-web", view).onclick = () => call("rakazo.web", { path: (g ? "/app/g/" : "/app/") + id }).catch(e => toast(e.message, "bad"));

    $("#c-more", view).onclick = async () => {
      const ok = await App.confirm({ title: b ? `ลบบอท ${b.name}?` : `ลบห้อง ${g.name}?`,
        body: b ? "บอทจะถูกเก็บเข้าคลัง (archive) กู้คืนได้ใน Rakazo" : "ห้องจะถูกเก็บเข้าคลัง บอทยังอยู่", ok: "ลบ", danger: true });
      if (!ok) return;
      try { await rk(b ? "bots/archive" : "groups/archive", b ? { botId: id } : { groupId: id }); toast("ลบแล้ว", "good"); await load(); go({ type: "home" }); }
      catch (e) { toast("ลบไม่สำเร็จ: " + e.message, "bad"); }
    };
    return () => { alive = false; clearInterval(resyncTimer); if (unsub) unsub(); if (panel.classList.contains("open")) closeComputer(); };
  }

  // ---------- new agent ----------
  const TEMPLATES = [
    ["🔎", "นักวิจัยเว็บ", "ค้นเว็บ อ่านหลายแหล่ง สรุปพร้อมลิงก์อ้างอิง", "คุณคือนักวิจัย ค้นข้อมูลจากเว็บด้วย browser ของคุณ อ่านหลายแหล่ง แล้วสรุปเป็นภาษาไทยกระชับพร้อมลิงก์อ้างอิงทุกข้อ ถ้าไม่แน่ใจให้บอกตรงๆ"],
    ["📈", "นักวิเคราะห์ตลาด", "ติดตามข่าวและราคา สรุปภาพรวม ไม่ส่งคำสั่งซื้อขาย", "คุณคือนักวิเคราะห์ตลาด ติดตามข่าวและราคาจากเว็บ สรุปแนวโน้มและความเสี่ยงเป็นภาษาไทย ห้ามส่งคำสั่งซื้อขายหรือแนะนำการลงทุนเฉพาะบุคคล"],
    ["🧪", "นักทดสอบเว็บ", "เปิดเว็บ ลอง flow จริง รายงานบั๊กพร้อมภาพหน้าจอ", "คุณคือ QA เปิดเว็บด้วย browser ทดลองใช้งานตามที่สั่ง จดขั้นตอน ถ่ายภาพหน้าจอเมื่อเจอปัญหา และรายงานบั๊กเป็นข้อๆ ภาษาไทย"],
    ["💻", "นักพัฒนา", "เขียนและรันโค้ดใน terminal ของตัวเอง", "คุณคือนักพัฒนาซอฟต์แวร์ เขียนและรันโค้ดใน terminal ของคุณ ทดสอบก่อนตอบเสมอ อธิบายผลเป็นภาษาไทยสั้นๆ"],
    ["✍️", "นักเขียนคอนเทนต์", "ร่างโพสต์ บทความ แคปชันภาษาไทย", "คุณคือนักเขียนคอนเทนต์ภาษาไทย ร่างโพสต์ บทความ และแคปชันตามโจทย์ ให้ตัวเลือก 2-3 แบบเสมอ"],
    ["🗂️", "ผู้ช่วยจัดการงาน", "จดงาน วางแผน แตกงานเป็นขั้นตอน", "คุณคือผู้ช่วยจัดการงาน ช่วยแตกงานเป็นขั้นตอน วางแผนเวลา และติดตามสิ่งที่ค้าง ตอบเป็นภาษาไทย"],
  ];
  function newAgent() {
    const m = modal(`<h2>สร้างบอทใหม่</h2><div class="muted">เลือกงานให้บอท หรือสร้างเอง — บอททุกตัวใช้โมเดลตามโหมดที่เลือกมุมซ้ายล่าง (Local / DeepSeek)</div>
      <div class="tpl-grid">${TEMPLATES.map((t, i) => `<button class="tpl" data-i="${i}" style="animation-delay:${i * 40}ms"><div class="emoji">${t[0]}</div>
        <div class="t">${esc(t[1])}</div><div class="d">${esc(t[2])}</div></button>`).join("")}
        <button class="tpl" data-i="-1" style="animation-delay:${TEMPLATES.length * 40}ms"><div class="emoji">✨</div><div class="t">สร้างเอง</div><div class="d">ตั้งชื่อและหน้าที่เอง</div></button></div>`, { wide: true });
    m.el.addEventListener("click", function pick(e) {
      const t = e.target.closest(".tpl");
      if (!t) return;
      m.el.removeEventListener("click", pick);
      const tpl = TEMPLATES[+t.dataset.i];
      form(m, tpl ? { name: tpl[1], title: tpl[2], role: tpl[3] } : { name: "", title: "", role: "" });
    });
  }
  function form(m, init) {
    let color = Math.floor(Math.random() * PALETTE.length), dedicated = true;
    m.el.classList.remove("wide");
    m.el.innerHTML = `<h2>ตั้งค่าบอท</h2>
      <div class="row" style="margin-top:14px"><div id="f-av">${avatar(init.name || "?", { color, size: "lg" })}</div>
        <div class="swatches">${PALETTE.map((p, i) => `<div class="swatch ${i === color ? "on" : ""}" data-c="${i}" style="background:linear-gradient(145deg,${p[0]},${p[1]})"></div>`).join("")}</div></div>
      <div class="field"><label>ชื่อบอท</label><input class="input" id="f-name" maxlength="80" value="${esc(init.name)}" placeholder="เช่น Bot A"></div>
      <div class="field"><label>หน้าที่ / คำสั่งประจำ</label><textarea class="input" id="f-role" rows="5" maxlength="20000" placeholder="บอกว่าบอทต้องทำอะไร ตอบภาษาอะไร ห้ามทำอะไร">${esc(init.role)}</textarea></div>
      <div class="field"><label>Computer</label><div class="pick">
        <div class="opt on" data-mode="dedicated">${icon("monitor")}ส่วนตัว (แยกไฟล์จากบอทอื่น)</div>
        <div class="opt" data-mode="team">${icon("users")}ใช้ร่วมกับทีม</div></div></div>
      <div class="actions"><button class="btn ghost" id="f-back">ย้อนกลับ</button><button class="btn primary" id="f-ok">${icon("sparkles")}สร้างบอท</button></div>`;
    const name = $("#f-name", m.el), redraw = () => { $("#f-av", m.el).innerHTML = avatar(name.value || "?", { color, size: "lg" }); };
    m.el.querySelectorAll(".swatch").forEach(s => s.onclick = () => {
      color = +s.dataset.c; m.el.querySelectorAll(".swatch").forEach(x => x.classList.toggle("on", x === s)); redraw();
    });
    m.el.querySelectorAll("[data-mode]").forEach(o => o.onclick = () => {
      dedicated = o.dataset.mode === "dedicated"; m.el.querySelectorAll("[data-mode]").forEach(x => x.classList.toggle("on", x === o));
    });
    name.oninput = redraw;
    name.focus();
    $("#f-back", m.el).onclick = () => { m.close(); newAgent(); };
    $("#f-ok", m.el).onclick = async e => {
      const n = name.value.trim(), role = $("#f-role", m.el).value.trim();
      if (!n) { name.focus(); toast("ใส่ชื่อบอทก่อน", "warn"); return; }
      const btn = e.currentTarget;
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span>กำลังสร้าง…';
      try {
        const created = await rk("bots/create", { name: n, title: init.title, description: "", instructions: role,
          color: PALETTE[color][0], computerMode: dedicated ? "dedicated" : "team" });
        await load();
        m.el.innerHTML = `<div class="born">${avatar(n, { color, size: "xl" })}<h2>${esc(n)} พร้อมทำงาน</h2>
          <div class="muted">Computer ของบอทจะเปิดเองเมื่อได้งานแรก</div>
          <div class="actions" style="justify-content:center"><button class="btn primary" id="f-go">${icon("chat")}เริ่มคุย</button></div></div>`;
        $("#f-go", m.el).onclick = () => { m.close(); go({ type: "bot", id: created.id }); };
      } catch (err) { toast("สร้างบอทไม่สำเร็จ: " + err.message, "bad"); btn.disabled = false; btn.innerHTML = `${icon("sparkles")}สร้างบอท`; }
    };
  }

  // ---------- new group ----------
  function newGroup() {
    if (state.bots.length < 2) { toast("ต้องมีบอทอย่างน้อย 2 ตัวก่อน", "warn"); return; }
    const picked = new Set();
    const m = modal(`<h2>สร้างห้องรวม</h2><div class="muted">ใส่ 2–6 บอทในห้องเดียว เรียกด้วย @ชื่อ หรือ @everyone</div>
      <div class="field"><label>ชื่อห้อง</label><input class="input" id="g-name" maxlength="80" placeholder="เช่น ทีมวิจัย"></div>
      <div class="field"><label>สมาชิก</label><div class="pick">${state.bots.map(b => `<div class="opt" data-id="${esc(b.id)}">${avatarOf(b, "sm")}${esc(b.name)}</div>`).join("")}</div></div>
      <div class="actions"><button class="btn ghost" id="g-cancel">ยกเลิก</button><button class="btn primary" id="g-ok">${icon("users")}สร้างห้อง</button></div>`);
    m.el.querySelectorAll(".opt").forEach(o => o.onclick = () => { o.classList.toggle("on") ? picked.add(o.dataset.id) : picked.delete(o.dataset.id); });
    $("#g-name", m.el).focus();
    $("#g-cancel", m.el).onclick = m.close;
    $("#g-ok", m.el).onclick = async e => {
      const n = $("#g-name", m.el).value.trim();
      if (!n || picked.size < 2 || picked.size > 6) { toast("ใส่ชื่อห้องและเลือกบอท 2–6 ตัว", "warn"); return; }
      const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>กำลังสร้าง…';
      try { const g = await rk("groups/create", { name: n, botIds: [...picked] }); await load(); m.close(); go({ type: "group", id: g.id }); }
      catch (err) { toast("สร้างห้องไม่สำเร็จ: " + err.message, "bad"); btn.disabled = false; btn.innerHTML = `${icon("users")}สร้างห้อง`; }
    };
  }

  // ---------- home ----------
  register("home", view => {
    view.innerHTML = `<div class="page"><div class="hero"><h1>ทีมบอทของคุณ</h1>
      <div class="muted" style="margin-top:8px">บอทแต่ละตัวมี Computer ของตัวเอง · สลับสมอง Local / DeepSeek ได้ที่มุมซ้ายล่าง</div>
      <div style="margin-top:20px"><button class="btn primary" id="h-new">${icon("plus")}สร้างบอทใหม่</button></div></div>
      ${sectioned(state.bots).map((sec, s) => `<h3 class="sec-title" style="animation-delay:${s * 60}ms">${esc(sec.name)}<span>${sec.bots.length}</span></h3>
      <div class="cards">${sec.bots.map((b, i) => `<div class="card bot-card" data-id="${esc(b.id)}" style="animation-delay:${Math.min(i, 12) * 40}ms">
        <div class="row">${avatarOf(b, "lg")}<div style="min-width:0"><div class="name">${esc(b.name)}</div>
        <div class="muted" style="font-size:12px">${isWorking(b) ? '<span class="shimmer-text">กำลังทำงาน…</span>' : esc(relTime(b.updatedAt) || "ว่าง")}</div></div></div>
        <div class="role">${esc(roleOf(b))}</div></div>`).join("")}</div>`).join("")}</div>`;
    $("#h-new", view).onclick = newAgent;
    view.querySelectorAll(".bot-card").forEach(c => c.onclick = () => go({ type: "bot", id: c.dataset.id }));
  });
  register("bot", (view, r) => conversation(view, { kind: "bot", id: r.id }));
  register("group", (view, r) => conversation(view, { kind: "group", id: r.id }));

  document.addEventListener("app:start", () => {
    $("#newAgent").onclick = newAgent;
    document.addEventListener("app:services", () => load().then(() => { if ((route() || {}).type === "home") go({ type: "home" }); }));
    load().then(() => { if ((route() || {}).type === "home") go({ type: "home" }); });
    // ponytail: sidebar polls bootstrap every 15s; the open chat is live via threads.subscribe
    setInterval(() => { if (!document.querySelector(".scrim")) load(); }, 15000);
  });
  App.chat = { load, state, md, th, blockText, INTENT_TH };
})();
