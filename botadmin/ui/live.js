// Mission control (idea from Gemini Spark's live progress / Dots' always-on agents): every bot at once with its live
// Computer screen (view only, scaled down), what it is working on, and whether it waits for you. Click a card to open the chat.
"use strict";
(() => {
  const { $, esc, icon, avatar, toast, call, register, go, PALETTE } = App;
  const rk = (path, input) => call("rk", { path, input: input || {} });
  const colorIdx = c => { const i = PALETTE.findIndex(p => p[0] === c); return i < 0 ? null : i; };
  const PAUSED = /^waiting_(input|takeover)$/, BUSY = /^(queued|leased|running)$/;
  const STATE = { stopped: "ปิดอยู่ · เปิดเองเมื่อได้งาน", booting: "กำลังเปิด…", suspended: "พักอยู่", error: "ผิดพลาด" };

  // Always-on bot computers (ลุงจืด 2026-10-01: "เป็น vm ทำงานต่อเนื่อง"): Rakazo no longer suspends idle computers
  // (SANDBOX_IDLE_MS = 30 days in the compose override); this keeper boots any that are off after a restart or crash,
  // one at a time, and heartbeats the running ones. Runs app-wide every minute; switch on the mission-control wall.
  const alwaysOn = () => localStorage.getItem("bt.alwaysOn") !== "0";
  let keeping = null;
  function keepOn() {
    if (keeping) return keeping;
    return keeping = (async () => {
      if (!alwaysOn() || !App.store.snap?.rakazo?.health?.startsWith("พร้อม") || !App.chat.state.ready) return;
      for (const b of App.chat.state.bots) {
        const s = await rk("computer/status", { botId: b.id }).catch(() => null);
        if (!s) continue;
        if (s.state === "running") rk("computer/heartbeat", { botId: b.id }).catch(() => {});
        else if (/^(stopped|suspended|error)$/.test(s.state)) await rk("computer/boot", { botId: b.id }).catch(() => {}); // busy/boot errors: next minute
      }
    })().finally(() => { keeping = null; });
  }
  document.addEventListener("app:start", () => { setTimeout(keepOn, 8000); setInterval(keepOn, 60000); });

  register("live", view => {
    const bots = App.chat.state.bots, cols = bots.length <= 1 ? 1 : bots.length <= 4 ? 2 : 3; // every screen fits one page (9 = 3x3)
    view.innerHTML = `<div class="page"><div class="page-head"><div><h1>ห้องควบคุม</h1>
        <div class="sub">เห็นบอททุกตัวทำงานพร้อมกันแบบสด · จอแบบดูอย่างเดียว คลิกการ์ดเพื่อเข้าไปคุยหรือควบคุมเอง</div></div>
        <div class="grow"></div><div class="row" id="lv-sum" style="gap:8px"></div>
        <label class="row muted" style="gap:6px;font-size:13px" title="เปิดเครื่องบอททุกตัวค้างไว้ และเปิดให้ใหม่เองถ้าดับ"><span class="switch"><input type="checkbox" id="lv-keep"><span></span></span>เปิดค้างตลอด</label>
        <button class="btn" id="lv-boot">${icon("play")}เปิดจอทุกตัว</button></div>
      <div class="live-grid" style="--cols:${cols};--rows:${Math.ceil(bots.length / cols) || 1}">${bots.map((b, i) => `<div class="card live" data-id="${esc(b.id)}" style="animation-delay:${i * 60}ms">
        <div class="row">${avatar(b.name, { color: colorIdx(b.color), size: "sm" })}<div style="min-width:0;flex:1"><b>${esc(b.name)}</b>
          <div class="muted live-role">${esc(b.title || "")}</div></div><span class="chip" data-st>…</span></div>
        <div class="live-screen" data-screen><div class="live-ph muted">…</div></div>
        <div class="live-task" data-task></div></div>`).join("")
        || `<div class="empty"><div><h2>ยังไม่มีบอท</h2></div></div>`}</div></div>`;
    let alive = true, last = {}, links = [];
    const from = new Map(); // runId -> sender of a message_bot hand-off (read once from the recipient's thread)
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "live-links");
    view.querySelector(".live-grid")?.appendChild(svg);
    // curved animated arrow from the sender's card to the recipient's card, between the name rows
    function drawLinks() {
      const grid = view.querySelector(".live-grid");
      if (!grid) return;
      const gr = grid.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${gr.width} ${gr.height}`);
      svg.innerHTML = `<defs><linearGradient id="lk-grad" x1="0" x2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
        <marker id="lk-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#22d3ee"/></marker></defs>` +
        links.map(l => {
          const a = card(l.from)?.getBoundingClientRect(), b = card(l.to)?.getBoundingClientRect();
          if (!a || !b) return "";
          const x1 = a.left + a.width / 2 - gr.left, y1 = a.top + 30 - gr.top, x2 = b.left + b.width / 2 - gr.left, y2 = b.top + 30 - gr.top;
          const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - 40 - Math.min(90, Math.hypot(x2 - x1, y2 - y1) / 5);
          return `<path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" marker-end="url(#lk-head)"/><text x="${mx}" y="${(my + Math.min(y1, y2)) / 2}" text-anchor="middle">📨 ${esc(l.name)}</text>`;
        }).join("");
    }
    const card = id => view.querySelector(`.live[data-id="${id}"]`);
    // the iframe keeps the computer's own size and is scaled to the card, so noVNC never re-negotiates the screen
    const fit = el => {
      const f = $("iframe", el);
      if (!f) return;
      const w = +f.width || 1280, h = +f.height || 800, s = Math.min(el.clientWidth / w, el.clientHeight / h);
      f.style.transform = `translate(${(el.clientWidth - w * s) / 2}px, ${(el.clientHeight - h * s) / 2}px) scale(${s})`;
    };
    const ro = new ResizeObserver(entries => { entries.forEach(e => fit(e.target)); drawLinks(); });
    view.querySelectorAll("[data-screen]").forEach(el => ro.observe(el));

    async function tick() {
      const [active, statuses] = await Promise.all([
        rk("runs/list", { filter: "active" }).then(r => r.runs, () => []),
        Promise.all(bots.map(b => rk("computer/status", { botId: b.id }).catch(() => ({ botId: b.id, state: "error" })))),
      ]);
      if (!alive) return;
      // hand-offs in progress: recipient runs started by message_bot, sender read from the inbound block
      for (const r of active.filter(r => r.trigger === "bot_message" && !from.has(r.runId))) {
        const snap = await rk("threads/get", { botId: r.botId }).catch(() => null);
        const blk = snap && [...snap.messages].reverse().flatMap(m => m.blocks).find(x => x.kind === "bot_message_received");
        from.set(r.runId, blk ? { from: blk.fromBotId, name: blk.fromBotName } : null);
      }
      if (!alive) return;
      links = active.filter(r => from.get(r.runId)).map(r => ({ ...from.get(r.runId), to: r.botId, runId: r.runId }));
      let busy = 0, waiting = 0, screens = 0;
      for (const s of statuses) {
        const el = card(s.botId), b = bots.find(x => x.id === s.botId);
        if (!el) continue;
        const run = active.find(r => r.botId === s.botId && !r.groupId) || active.find(r => r.botId === s.botId);
        const st = !run ? ["ว่าง", ""] : PAUSED.test(run.status) ? ["รอคุณ", "warn"] : ["กำลังทำ", "good"];
        if (run && PAUSED.test(run.status)) waiting++; else if (run && BUSY.test(run.status)) busy++;
        const chip = $("[data-st]", el);
        chip.className = "chip " + st[1]; chip.innerHTML = (st[0] === "กำลังทำ" ? '<span class="dot good"></span>' : "") + st[0];
        el.classList.toggle("working", !!run && !PAUSED.test(run.status));
        el.classList.toggle("waiting", !!run && PAUSED.test(run.status));
        $("[data-task]", el).innerHTML = run
          ? `${icon("activity")}<span>${from.get(run.runId) ? `<b class="from">📨 จาก ${esc(from.get(run.runId).name)}</b> · ` : ""}${esc((run.groupName ? run.groupName + " · " : "") + (run.promptSnippet || ""))}</span>`
          : `<span class="muted">${esc(b?.preview || "ยังไม่มีงาน")}</span>`;
        const screen = $("[data-screen]", el), on = s.state === "running" && s.screenAvailable;
        if (on) screens++;
        if (on && last[s.botId] !== "on") {
          const r = await rk("computer/screenUrl", { botId: s.botId }).catch(() => ({ url: null }));
          if (!alive || !r.url) continue;
          screen.innerHTML = `<iframe src="${esc(new URL(r.url, "http://127.0.0.1:5173").href)}" width="${s.screenWidth}" height="${s.screenHeight}"
            sandbox="allow-scripts" tabindex="-1" title="${esc(b?.name || "")}"></iframe><span class="live-badge">LIVE</span>`;
          fit(screen);
          last[s.botId] = "on";
        } else if (!on && last[s.botId] !== s.state) {
          screen.innerHTML = `<div class="live-ph muted">${s.state === "booting" ? '<div class="typing"><i></i><i></i><i></i></div>' : icon("monitor")}<div>${esc(STATE[s.state] || s.state)}</div></div>`;
          last[s.botId] = s.state;
        }
      }
      drawLinks();
      $("#lv-sum", view).innerHTML = `${links.length ? `<span class="chip" style="color:var(--violet-soft)">ส่งงาน ${links.length}</span>` : ""}<span class="chip good">กำลังทำ ${busy}</span><span class="chip warn">รอคุณ ${waiting}</span><span class="chip">จอเปิด ${screens}/${bots.length}</span>`;
    }
    view.querySelectorAll(".live").forEach(el => el.onclick = () => go({ type: "bot", id: el.dataset.id }));
    $("#lv-boot", view).onclick = async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const idle = bots.filter(b => !/^(on|booting)$/.test(last[b.id] || ""));
      const res = await Promise.allSettled(idle.map(b => rk("computer/boot", { botId: b.id })));
      const bad = res.filter(r => r.status === "rejected").length;
      toast(bad ? `เปิดไม่สำเร็จ ${bad} เครื่อง` : `กำลังเปิดจอ ${idle.length} เครื่อง`, bad ? "bad" : "good");
      btn.disabled = false;
      tick();
    };
    tick();
    const timer = setInterval(tick, 4000);
    const keep = $("#lv-keep", view);
    keep.checked = alwaysOn();
    keep.onchange = () => { localStorage.setItem("bt.alwaysOn", keep.checked ? "1" : "0"); if (keep.checked) keepOn().then(tick); };
    App.live = { links: () => links }; // tests
    return () => { alive = false; clearInterval(timer); ro.disconnect(); };
  });
})();
