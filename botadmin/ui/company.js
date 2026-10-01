// Company layer of the work center (round 3; ideas from Meta Muse, OpenAI Dots, Lindy): who handed work to whom,
// skills taught by showing, the company knowledge every bot reads, approval rules, and backup / audit export.
// Everything is Rakazo's own data: bot_message blocks, skills/*, the user-scope MEMORY.md (injected into every bot's
// instructions, 32 KiB shared with the bot's own memory), approvalRules/*. Not export/bot: it reads the whole bot home (browser profile included)
// into the API's memory and ran Rakazo out of heap — files are covered by the full backup instead.
"use strict";
(() => {
  const { $, esc, icon, relTime, toast, modal, confirm, call, go } = App;
  const rk = (path, input) => call("rk", { path, input: input || {} });
  const { tabs, av, botOf, bots } = App.work;
  const at = (key, tab) => tabs.splice(tabs.findIndex(t => t[0] === key) + 1, 0, tab);
  const download = (name, text, type) => {
    const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement("a");
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local

  // ---------- team: bot-to-bot hand-offs (message_bot) + "give the CEO a goal" ----------
  const INTENT_TH = App.chat.INTENT_TH;
  async function team(body) {
    const list = bots();
    const [threads, active] = await Promise.all([
      Promise.all(list.map(b => rk("threads/get", { botId: b.id }).then(s => ({ b, msgs: s.messages }), () => ({ b, msgs: [] })))),
      rk("runs/list", { filter: "active" }).then(r => r.runs, () => []),
    ]);
    const hand = [];
    for (const { b, msgs } of threads) for (const m of msgs) for (const x of m.blocks)
      if (x.kind === "bot_message_sent") hand.push({ from: b.id, to: x.toBotId, toName: x.toBotName, text: x.text || "", intent: x.intent || "request", at: m.createdAt });
    hand.sort((a, c) => new Date(c.at) - new Date(a.at));
    const busy = new Set(active.filter(r => r.trigger === "bot_message").map(r => r.botId));
    const status = h => {
      if (h.intent === "result" || h.intent === "fyi" || h.intent === "status") return ["ส่งแล้ว", ""];
      const back = hand.find(x => x.from === h.to && x.to === h.from && x.intent === "result" && x.at > h.at);
      return back ? ["ได้ผลแล้ว", "good"] : busy.has(h.to) ? ["กำลังทำ", "warn"] : ["รับงานแล้ว", ""];
    };
    const ceo = list.find(b => b.name === "CEO");
    body.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="row" style="gap:10px;align-items:flex-start">${ceo ? av(ceo.id, ceo.name) : ""}
        <div style="flex:1;min-width:0"><b>มอบหมายงานผ่าน CEO</b><div class="muted" style="font-size:12.5px">CEO แตกงานให้ฝ่ายที่เกี่ยวข้องเอง (message_bot) รอผลจากทุกฝ่าย แล้วสรุปให้คุณ · เห็นการส่งงานสดที่ห้องควบคุม</div>
        <div class="row" style="gap:8px;margin-top:10px"><textarea class="input" id="tm-goal" rows="2" style="flex:1" placeholder="เช่น เตรียมโปรโมชั่นต้นเดือนหน้า: เช็คสต็อกสินค้าขายดี ลูกหนี้ค้าง และร่างโพสต์โปรโมชั่น"></textarea>
        <button class="btn primary" id="tm-send" ${ceo ? "" : "disabled"}>${icon("send")}ให้ CEO แจกงาน</button></div></div></div></div>
      <div class="row" style="margin-bottom:10px;gap:8px"><b>การส่งงานระหว่างบอท</b><span class="chip">${hand.length} ครั้ง</span>${busy.size ? `<span class="chip warn">กำลังทำ ${busy.size}</span>` : ""}</div>
      ${hand.length ? `<div class="card" style="padding:6px 0">${hand.slice(0, 60).map((h, i) => { const [st, cls] = status(h), f = botOf(h.from), t = botOf(h.to);
        return `<div class="hand" data-to="${esc(h.to)}" style="animation-delay:${Math.min(i, 12) * 30}ms">
          <div class="hand-who">${av(h.from, f?.name || "?")}<span class="hand-arrow">➜</span>${av(h.to, t?.name || h.toName)}</div>
          <div style="min-width:0;flex:1"><div><b>${esc(f?.name || "บอท")}</b> <span class="muted">${esc(INTENT_TH[h.intent] || h.intent)}ถึง</span> <b>${esc(t?.name || h.toName)}</b></div>
            <div class="muted hand-text">${esc(h.text.replace(/\s+/g, " ").slice(0, 220))}</div></div>
          <div style="text-align:right;flex:none"><span class="chip ${cls}">${st}</span><div class="muted" style="font-size:12px;margin-top:4px">${esc(relTime(h.at))}</div></div></div>`; }).join("")}</div>`
        : `<div class="empty" style="min-height:30vh"><div><div class="float" style="font-size:40px">📨</div><h2>ยังไม่มีการส่งงานระหว่างบอท</h2>
           <div class="muted">ลองมอบหมายงานผ่าน CEO ด้านบน หรือบอกบอทตัวไหนก็ได้ว่า "ส่งเรื่องนี้ให้ฝ่ายบัญชีช่วยดู"</div></div></div>`}`;
    body.querySelectorAll(".hand").forEach(el => el.onclick = () => go({ type: "bot", id: el.dataset.to }));
    const send = $("#tm-send", body), goalEl = $("#tm-goal", body);
    if (send) send.onclick = async () => {
      const goal = goalEl.value.trim();
      if (!goal) return toast("พิมพ์งานที่ต้องการก่อน", "warn");
      send.disabled = true;
      try {
        await rk("threads/send", { botId: ceo.id, text: `งานจากผู้บริหาร: ${goal}\n\nแตกงานนี้ให้ฝ่ายที่เกี่ยวข้องด้วย message_bot (intent=request) ฝ่ายละ 1 ข้อความ บอกสิ่งที่ต้องการให้ชัด รอผลจากทุกฝ่าย แล้วสรุปให้ผมสั้นๆ` });
        goalEl.value = "";
        toast("ส่งให้ CEO แล้ว — ดูการแจกงานได้ที่นี่หรือห้องควบคุม", "good");
      } catch (e) { toast("ส่งไม่สำเร็จ: " + e.message, "bad"); }
      send.disabled = false;
    };
    return JSON.stringify([hand.length, [...busy], hand.slice(0, 5).map(h => status(h)[0])]); // background refresh only when this changes
  }

  // ---------- skills taught by showing ----------
  const SKILL_ST = { recording: ["กำลังสอน", "warn"], drafting: ["กำลังสรุป", "warn"], draft: ["ร่าง", ""], saved: ["พร้อมใช้", "good"] };
  const GRID_NOTE = "พิกัด (x, y) ในขั้นตอนเป็นสเกล 0-1000 ของหน้าจอ";
  async function skills(body, refresh) {
    const list = bots();
    const all = (await Promise.all(list.map(b => rk("skills/list", { botId: b.id }).catch(() => [])))).flat()
      .sort((a, c) => new Date(c.updatedAt) - new Date(a.updatedAt));
    body.innerHTML = `<div class="row" style="margin-bottom:14px;gap:8px"><div class="muted grow">สอนบอทด้วยการทำให้ดู 1 รอบบนหน้าจอของบอท ระบบจดทุกคลิกและการพิมพ์เป็นขั้นตอน แล้วบอททำซ้ำเองได้</div>
        <select class="input" id="sk-bot" style="width:auto">${list.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select>
        <button class="btn primary" id="sk-new">🎓 สอนงานใหม่</button></div>
      ${all.length ? `<div class="grid g2">${all.map((s, i) => { const b = botOf(s.botId), [st, cls] = SKILL_ST[s.status] || [s.status, ""];
        return `<div class="card skill" data-id="${esc(s.id)}" style="animation-delay:${i * 40}ms">
          <div class="row">${av(s.botId, b?.name || "?")}<div style="min-width:0;flex:1"><b>${esc(s.name || s.goal)}</b>
            <div class="muted" style="font-size:12px">${esc(b?.name || "")} · ${s.playbook?.steps?.length || 0} ขั้นตอน · ${esc(relTime(s.updatedAt))}</div></div><span class="chip ${cls}">${st}</span></div>
          <div class="muted" style="margin-top:8px;font-size:13px">${esc(s.goal)}</div>
          <div class="row" style="gap:6px;margin-top:12px">${s.status === "saved" ? `<button class="btn sm primary" data-run>${icon("play")}สั่งทำ</button>` : ""}
            ${/^(draft|saved)$/.test(s.status) ? `<button class="btn sm" data-edit>${icon("edit")}${s.status === "draft" ? "ตรวจและบันทึก" : "แก้ขั้นตอน"}</button>` : ""}
            <span class="grow"></span><button class="btn sm ghost icon" data-del title="ลบ">${icon("trash")}</button></div></div>`; }).join("")}</div>`
        : `<div class="empty" style="min-height:30vh"><div><div class="float" style="font-size:40px">🎓</div><h2>ยังไม่มีทักษะที่สอน</h2>
           <div class="muted">เลือกบอทแล้วกด "สอนงานใหม่" — ทำงานให้ดูบนหน้าจอของบอท เช่น เปิดเว็บ ค้นข้อมูล กรอกฟอร์ม</div></div></div>`}`;
    const pick = $("#sk-bot", body);
    $("#sk-new", body).onclick = () => go({ type: "bot", id: pick.value, teach: true });
    body.querySelectorAll(".skill").forEach(card => {
      const s = all.find(x => x.id === card.dataset.id);
      const run = $("[data-run]", card), edit = $("[data-edit]", card);
      if (run) run.onclick = async () => {
        run.disabled = true;
        try { await rk("skills/testRun", { skillId: s.id }); toast(`${botOf(s.botId)?.name} เริ่มทำ "${s.name}" แล้ว`, "good"); go({ type: "bot", id: s.botId }); }
        catch (e) { toast("สั่งไม่สำเร็จ: " + e.message, "bad"); run.disabled = false; }
      };
      if (edit) edit.onclick = () => editDraft(s, {}, refresh);
      $("[data-del]", card).onclick = async () => {
        if (!await confirm({ title: `ลบทักษะ "${s.name || s.goal}"?`, body: "บอทจะทำงานนี้ตามขั้นตอนที่สอนไม่ได้อีก", ok: "ลบ", danger: true })) return;
        try { await rk("skills/remove", { skillId: s.id }); toast("ลบแล้ว", "good"); } catch (e) { toast(e.message, "bad"); }
        refresh();
      };
    });
  }
  // Recorded steps say "Click ... at (x, y)" in screen pixels, but bots here point on a 0..1000 grid
  // (RAKAZO_COMPUTER_COORDINATE_GRID=1000 hotfix), so pixels are converted once, marked by GRID_NOTE.
  // ponytail: every bot desktop is 1280x800 when the size is unknown (same assumption as the hotfix)
  function toGrid(steps, W = 1280, H = 800) {
    return steps.map(t => t.replace(/\((\d+),\s*(\d+)\)/g, (_, x, y) => `(${Math.round(x * 1000 / W)}, ${Math.round(y * 1000 / H)})`));
  }
  function editDraft(s, size = {}, refresh = () => {}) {
    const p = s.playbook || {}, fresh = !String(p.failureHandling || "").includes(GRID_NOTE);
    const steps = fresh ? toGrid(p.steps || [], size.W, size.H) : p.steps || [];
    const b = botOf(s.botId);
    const m = modal(`<h2>🎓 ทักษะของ ${esc(b?.name || "บอท")}</h2><div class="muted">ตรวจขั้นตอนที่จดได้ แก้ให้ชัดขึ้นได้ (1 บรรทัด = 1 ขั้นตอน) แล้วบันทึก</div>
      <div class="field"><label>ชื่อทักษะ (พิมพ์ชื่อนี้ในแชทพร้อมคำว่า run/use/do ก็เรียกใช้ได้)</label><input class="input" id="sd-name" value="${esc(s.name || s.goal.slice(0, 80))}"></div>
      <div class="field"><label>ใช้เมื่อไร</label><input class="input" id="sd-when" value="${esc(p.whenToUse || s.goal)}"></div>
      <div class="field"><label>ขั้นตอน (${steps.length})</label><textarea class="input mono" id="sd-steps" rows="10">${esc(steps.join("\n"))}</textarea></div>
      <div class="field"><label>ตรวจผลอย่างไร</label><input class="input" id="sd-check" value="${esc(p.howToCheck || "")}"></div>
      <div class="field"><label>ส่งอะไรกลับมา</label><input class="input" id="sd-ret" value="${esc(p.whatToReturn || "")}"></div>
      <div class="actions"><button class="btn ghost danger" id="sd-drop">ทิ้ง</button><span class="grow"></span><button class="btn ghost" id="sd-cancel">ปิด</button>
        <button class="btn primary" id="sd-ok">${icon("check")}บันทึกทักษะ</button></div>`, { wide: true });
    $("#sd-cancel", m.el).onclick = () => { m.close(); refresh(); };
    $("#sd-drop", m.el).onclick = async () => { m.close(); try { await rk("skills/remove", { skillId: s.id }); toast("ทิ้งแล้ว", "good"); } catch (e) { toast(e.message, "bad"); } refresh(); };
    $("#sd-ok", m.el).onclick = async e => {
      const btn = e.currentTarget, name = $("#sd-name", m.el).value.trim() || s.goal.slice(0, 80);
      const playbook = {
        whenToUse: $("#sd-when", m.el).value.trim(), inputs: p.inputs || [],
        steps: $("#sd-steps", m.el).value.split("\n").map(x => x.trim()).filter(Boolean),
        howToCheck: $("#sd-check", m.el).value.trim(), whatToReturn: $("#sd-ret", m.el).value.trim(),
        approvalBoundaries: p.approvalBoundaries || "", failureHandling: fresh ? `${p.failureHandling || ""}\n${GRID_NOTE} ดูหน้าจอก่อนทุกครั้ง ถ้าตำแหน่งไม่ตรงกับตอนสอนให้หาปุ่มหรือช่องที่ตรงกับเป้าหมายแทน`.trim() : p.failureHandling,
      };
      btn.disabled = true;
      try {
        await rk("skills/updateDraft", { skillId: s.id, name, playbook });
        if (s.status !== "saved") await rk("skills/save", { skillId: s.id, name });
        m.close();
        toast(`บันทึกทักษะ "${name}" แล้ว — สั่งทำได้ที่ศูนย์งาน › ทักษะ`, "good");
        go({ type: "work", tab: "skills" });
      } catch (err) { toast("บันทึกไม่สำเร็จ: " + err.message, "bad"); btn.disabled = false; }
    };
  }
  App.skills = { editDraft, toGrid };

  // ---------- company knowledge: the user-scope MEMORY.md every bot gets in its instructions ----------
  const BRAIN = [["ธุรกิจ", "บริษัททำอะไร ขายให้ใคร จุดเด่น"], ["สินค้าและบริการ", "รายการสินค้า ราคา เงื่อนไข สินค้าขายดี"],
    ["น้ำเสียงแบรนด์", "วิธีพูดกับลูกค้า คำที่ใช้ คำที่ห้ามใช้"], ["คำถามที่พบบ่อย", "คำถามที่ลูกค้าถามบ่อยพร้อมคำตอบ"], ["นโยบายบริษัท", "กฎภายใน การอนุมัติ เวลาทำการ"]];
  const BRAIN_TITLE = "# ความรู้บริษัท (บอททุกตัวใช้ร่วมกัน)";
  const MEMORY_CAP = 32768; // Rakazo MAX_AGENT_MEMORY_BYTES: bot memory + shared memory together
  const SAMPLE = {
    "ธุรกิจ": "บริษัท สาธิตการค้า จำกัด (ข้อมูลสมมติ) ขายส่งและขายปลีกปุ๋ย เมล็ดพันธุ์ และอุปกรณ์การเกษตร ให้ร้านเกษตรและสวนผักในภาคกลาง\nจุดเด่น: ส่งฟรีในรัศมี 50 กม. เมื่อซื้อครบ 5,000 บาท · ข้อมูลบัญชีและสต็อกจริงอยู่ในระบบบัญชีสาธิต (MCP)",
    "สินค้าและบริการ": "- P-001 ปุ๋ยอินทรีย์ 25 กก. 450 บาท (ขายดีอันดับ 1)\n- P-002 เมล็ดพันธุ์ข้าวโพด 10 กก. 890 บาท\n- P-003 สายยางรดน้ำ 20 ม. 350 บาท\n- P-004 เครื่องพ่นยาแบตเตอรี่ 16 ลิตร 2,490 บาท\n- P-005 ถุงมือยางทำสวน 45 บาท\n- P-006 กรรไกรตัดกิ่ง 290 บาท\nราคายังไม่รวม VAT 7%",
    "น้ำเสียงแบรนด์": "เป็นกันเองแต่สุภาพ ลงท้าย ครับ/ค่ะ เรียกลูกค้าว่า \"พี่\" ใช้คำง่าย ไม่ใช้ศัพท์เทคนิค ห้ามรับประกันผลผลิต ห้ามพูดถึงคู่แข่งในทางลบ",
    "คำถามที่พบบ่อย": "- ส่งของกี่วัน: 1-2 วันทำการในภาคกลาง\n- เครดิตเทอม: ลูกค้าประจำ 15-45 วันตามสัญญา ลูกค้าใหม่ชำระเงินสด\n- คืนสินค้า: ภายใน 7 วัน สภาพเดิมพร้อมใบเสร็จ",
    "นโยบายบริษัท": "- ส่วนลดเกิน 10% ต้องให้ CEO อนุมัติ\n- เวลาทำการ จันทร์-เสาร์ 08:00-17:00\n- ข้อมูลลูกค้าเป็นความลับตาม PDPA ห้ามส่งออกนอกบริษัท",
  };
  function parseBrain(content) {
    const parts = String(content || "").split(/^## +/m), head = parts.shift().replace(/^#.*\n?/, "").trim(), sec = new Map();
    for (const p of parts) { const nl = p.indexOf("\n"); sec.set((nl < 0 ? p : p.slice(0, nl)).trim(), nl < 0 ? "" : p.slice(nl + 1).trim()); }
    return { head, sec };
  }
  function brainText(head, sec) {
    return [BRAIN_TITLE, head, ...[...sec].filter(([, v]) => v.trim()).map(([k, v]) => `## ${k}\n${v.trim()}`)].filter(Boolean).join("\n\n") + "\n";
  }
  const bytes = s => new TextEncoder().encode(s).length;
  async function brain(body, refresh) {
    const docs = await rk("memory/list", {});
    const doc = docs.find(d => !d.botId && d.path === "MEMORY.md") || docs.find(d => !d.botId);
    if (!doc) { body.innerHTML = `<div class="muted" style="padding:24px">ไม่พบความจำร่วมของบัญชีนี้ใน Rakazo</div>`; return; }
    const { head, sec } = parseBrain(doc.content), docsIn = [...sec.keys()].filter(k => !BRAIN.some(([n]) => n === k));
    const botMax = Math.max(0, ...docs.filter(d => d.botId).map(d => bytes(d.content)));
    const used = bytes(doc.content) + botMax, pct = Math.min(100, Math.round(used * 100 / MEMORY_CAP));
    body.innerHTML = `<div class="row" style="margin-bottom:14px;gap:10px"><div class="muted grow">ข้อมูลบริษัทที่บอททั้ง ${bots().length} ตัวอ่านก่อนทำงานทุกครั้ง — แก้ที่นี่ที่เดียว ทุกฝ่ายรู้พร้อมกัน</div>
        <button class="btn sm ghost" id="br-sample">${icon("sparkles")}ใส่ตัวอย่าง</button><button class="btn sm" id="br-import">${icon("clip")}นำเข้าไฟล์ความรู้</button>
        <input type="file" id="br-file" hidden accept=".txt,.md,.csv,.json"><button class="btn primary" id="br-save">${icon("check")}บันทึก</button></div>
      <div class="card" style="margin-bottom:14px"><div class="row" style="gap:10px"><b>พื้นที่ความจำที่ใช้</b><span class="grow"></span>
        <span class="muted" style="font-size:12.5px">${(used / 1024).toFixed(1)} / 32 KB (ความรู้บริษัท + ความจำบอทที่มากที่สุด) · แก้ล่าสุด ${esc(relTime(doc.updatedAt))}</span></div>
        <div class="usage-bar" style="margin-top:8px"><span class="${pct > 85 ? "c" : "l"}" style="width:${pct}%"></span></div></div>
      <div class="grid g2">${BRAIN.map(([k, hint]) => `<div class="card"><b>${esc(k)}</b><div class="muted" style="font-size:12px;margin-bottom:8px">${esc(hint)}</div>
        <textarea class="input" data-sec="${esc(k)}" rows="6">${esc(sec.get(k) || "")}</textarea></div>`).join("")}
        <div class="card"><b>อื่นๆ</b><div class="muted" style="font-size:12px;margin-bottom:8px">อะไรก็ได้ที่อยากให้ทุกฝ่ายรู้</div><textarea class="input" data-sec="" rows="6">${esc(head)}</textarea></div></div>
      ${docsIn.length ? `<h3 class="sec-title" style="margin-top:20px">เอกสารความรู้<span>${docsIn.length}</span></h3>
        <div class="row" style="gap:8px;flex-wrap:wrap">${docsIn.map(k => `<span class="file-chip">📄 <b>${esc(k)}</b><span class="muted">${(bytes(sec.get(k)) / 1024).toFixed(1)} KB</span>
          <button class="btn ghost icon sm" data-drop="${esc(k)}" title="เอาออก">${icon("x")}</button></span>`).join("")}</div>` : ""}`;
    const fields = [...body.querySelectorAll("[data-sec]")], fileEl = $("#br-file", body);
    const collect = () => {
      const next = new Map(sec);
      fields.forEach(t => { if (t.dataset.sec) next.set(t.dataset.sec, t.value); });
      return { head: fields.find(t => !t.dataset.sec).value.trim(), sec: next };
    };
    const save = async (text, msg) => {
      if (bytes(text) + botMax > MEMORY_CAP) return toast("ยาวเกินพื้นที่ความจำ 32 KB — ย่อข้อความหรือเอาเอกสารบางไฟล์ออก", "bad");
      try { await rk("memory/update", { documentId: doc.id, content: text }); toast(msg, "good"); } catch (e) { toast("บันทึกไม่สำเร็จ: " + e.message, "bad"); }
      refresh();
    };
    $("#br-save", body).onclick = () => { const c = collect(); save(brainText(c.head, c.sec), "บันทึกความรู้บริษัทแล้ว บอททุกตัวใช้ได้ทันที"); };
    $("#br-sample", body).onclick = () => fields.forEach(t => { if (SAMPLE[t.dataset.sec] && !t.value.trim()) t.value = SAMPLE[t.dataset.sec]; });
    $("#br-import", body).onclick = () => fileEl.click();
    fileEl.onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 16384) return toast("ไฟล์ความรู้ต้องไม่เกิน 16 KB (พื้นที่ความจำรวม 32 KB) — ไฟล์ใหญ่ให้แนบในแชทแทน", "warn");
      const c = collect();
      c.sec.set(`เอกสาร: ${f.name.replace(/\s+/g, " ")}`, (await f.text()).trim());
      save(brainText(c.head, c.sec), `นำเข้า ${f.name} แล้ว`);
    };
    body.querySelectorAll("[data-drop]").forEach(x => x.onclick = () => { const c = collect(); c.sec.delete(x.dataset.drop); save(brainText(c.head, c.sec), "เอาเอกสารออกแล้ว"); });
  }

  // ---------- approval rules (Rakazo approvalRules: per account, apply to every bot; only "ask" or "always allow") ----------
  const RULES = [
    ["category", "purchase", "💳 ซื้อของ / จ่ายเงิน", "เครื่องมือที่เป็นการชำระเงิน สั่งซื้อ เช็คเอาต์"],
    ["category", "email", "✉️ ส่งอีเมล", "Gmail / Outlook และเครื่องมือส่งอีเมล"],
    ["tool", "mcp__demo-accounting__create_invoice", "🧾 ออกใบแจ้งหนี้", "ระบบบัญชีสาธิต"],
    ["tool", "mcp__demo-accounting__record_payment", "💰 บันทึกรับชำระเงิน", "ระบบบัญชีสาธิต"],
    ["tool", "mcp__demo-accounting__create_purchase", "📦 บันทึกซื้อสินค้าเข้า", "ระบบบัญชีสาธิต"],
    ["tool", "shell", "⌨️ รันคำสั่งใน Terminal", "บนเครื่องของบอทเอง"],
    ["tool", "computer_act", "🖱️ คลิก/พิมพ์บนหน้าจอ", "บนเครื่องของบอทเอง"],
    ["tool", "browser_act", "🌐 กดปุ่ม/กรอกฟอร์มบนเว็บ", "บนเครื่องของบอทเอง"],
    ["tool", "write_file", "📝 เขียนไฟล์", "ในเครื่องของบอท"],
    ["tool", "message_bot", "📨 ส่งงานให้บอทอื่น", "การแจกงานในทีม"],
    ["tool", "schedule_create", "⏰ ตั้งเวลางานเอง", "นัดกลับมาทำงานต่อ"],
    ["tool", "spawn_bot", "🤖 สร้างบอทใหม่", ""],
    ["tool", "archive_bot", "🗄️ เก็บ/ปิดบอท", ""],
    ["tool", "add_mcp_server", "🔌 เชื่อมระบบใหม่ (MCP)", ""],
  ];
  const RECOMMENDED = new Set(["purchase", "email", "mcp__demo-accounting__create_invoice", "mcp__demo-accounting__record_payment", "mcp__demo-accounting__create_purchase", "spawn_bot", "archive_bot", "add_mcp_server"]);
  const same = (r, kind, value) => r.matchKind === kind && r.matchValue.toLowerCase() === value.toLowerCase();
  async function setRule(kind, value, effect) { // effect: "" = no rule (Rakazo default); fresh list: the page may be stale
    for (const r of (await rk("approvalRules/list")).filter(x => same(x, kind, value))) await rk("approvalRules/remove", { id: r.id });
    if (effect) await rk("approvalRules/set", { effect, matchKind: kind, matchValue: value });
  }
  async function rules(body, refresh) {
    const all = await rk("approvalRules/list");
    const effectOf = (k, v) => { const m = all.filter(r => same(r, k, v)); return m.some(r => r.effect === "require_approval") ? "require_approval" : m.length ? "always_allow" : ""; };
    const other = all.filter(r => !RULES.some(([k, v]) => same(r, k, v)));
    const seg = (k, v) => { const e = effectOf(k, v); return `<div class="seg rule-seg" data-k="${esc(k)}" data-v="${esc(v)}">${[["", "ปกติ"], ["require_approval", "ต้องขออนุญาต"], ["always_allow", "อนุญาตเสมอ"]]
      .map(([x, t]) => `<button data-e="${x}" class="${e === x ? "on" : ""}">${t}</button>`).join("")}</div>`; };
    body.innerHTML = `<div class="row" style="margin-bottom:14px;gap:10px"><div class="muted grow">กำหนดว่าบอทต้องขออนุญาตคุณก่อนทำอะไร — บอทจะหยุดรอพร้อมปุ่ม อนุญาต/ปฏิเสธ (ดูได้ที่ รอคุณ)</div>
        <button class="btn" id="rl-rec">${icon("shield")}ใช้ชุดแนะนำ</button></div>
      <div class="card" style="padding:4px 0">${RULES.map(([k, v, t, d]) => `<div class="rule-row"><div style="min-width:0;flex:1"><b>${t}</b>${d ? `<div class="muted" style="font-size:12px">${esc(d)}</div>` : ""}</div>${seg(k, v)}</div>`).join("")}</div>
      ${other.length ? `<h3 class="sec-title" style="margin-top:20px">กฎอื่น<span>${other.length}</span></h3><div class="card" style="padding:4px 0">${other.map(r => `<div class="rule-row">
        <div style="min-width:0;flex:1"><b class="mono">${esc(r.matchValue)}</b><div class="muted" style="font-size:12px">${r.effect === "always_allow" ? "อนุญาตเสมอ" : "ต้องขออนุญาต"} · ${esc(r.matchKind)} · ${esc(relTime(r.createdAt))}</div></div>
        <button class="btn sm ghost icon" data-del="${esc(r.id)}" title="ลบกฎ">${icon("trash")}</button></div>`).join("")}</div>` : ""}
      <div class="muted" style="font-size:12px;margin-top:14px;line-height:1.7">• ปกติ = ใช้ค่าเริ่มต้นของ Rakazo (บอททำได้เลย) · กฎมีผลกับบอททุกตัว
        <br>• Rakazo ยังไม่มีโหมด "ห้ามทำ" — ถ้าต้องการห้ามจริง ตั้ง "ต้องขออนุญาต" แล้วกดปฏิเสธ หรือถอดระบบนั้นออกจากบอทที่หน้า MCP
        <br>• กด "อนุญาตเสมอ" บนการ์ดขออนุญาตในแชท = สร้างกฎใหม่ในรายการ "กฎอื่น"</div>`;
    body.querySelectorAll(".rule-seg").forEach(s => s.onclick = async e => {
      const btn = e.target.closest("button[data-e]");
      if (!btn || btn.classList.contains("on")) return;
      s.querySelectorAll("button").forEach(x => x.disabled = true);
      try { await setRule(s.dataset.k, s.dataset.v, btn.dataset.e); toast("บันทึกกฎแล้ว", "good"); } catch (err) { toast("บันทึกไม่สำเร็จ: " + err.message, "bad"); }
      refresh();
    });
    body.querySelectorAll("[data-del]").forEach(x => x.onclick = async () => { try { await rk("approvalRules/remove", { id: x.dataset.del }); } catch (e) { toast(e.message, "bad"); } refresh(); });
    $("#rl-rec", body).onclick = async e => {
      e.currentTarget.disabled = true;
      try {
        for (const [k, v] of RULES) if (RECOMMENDED.has(v)) await setRule(k, v, "require_approval");
        toast("ใช้ชุดแนะนำแล้ว: การเงิน อีเมล บัญชี และการสร้าง/ปิดบอท ต้องขออนุญาต", "good");
      } catch (err) { toast(err.message, "bad"); }
      refresh();
    };
  }

  // ---------- backup and audit export ----------
  async function companyExport() {
    const list = bots(), groups = App.chat.state.groups;
    const botData = b => Promise.all([
      rk("threads/get", { botId: b.id }).then(s => s.messages),
      rk("routines/list", { botId: b.id }),
      rk("artifacts/list", { botId: b.id }).then(a => a.map(x => ({ name: x.name, mimeType: x.mimeType, size: x.size, createdAt: x.createdAt }))),
    ]).then(([history, routines, files]) => ({ bot: b, routines, files, history }), e => ({ bot: { name: b.name }, error: e.message }));
    const [exports, rooms, memory, rulesList, servers, skillsAll] = await Promise.all([
      Promise.all(list.map(botData)),
      Promise.all(groups.map(g => rk("threads/get", { groupId: g.id }).then(s => ({ name: g.name, members: g.members.map(m => m.name), messages: s.messages }), e => ({ name: g.name, error: e.message })))),
      rk("memory/list", {}), rk("approvalRules/list"), rk("mcp/servers/list"),
      Promise.all(list.map(b => rk("skills/list", { botId: b.id }).catch(() => []))),
    ]);
    return {
      app: "BotTeam", version: 1, exportedAt: new Date().toISOString(),
      note: "ไม่มีรหัสผ่านหรือคีย์: การเชื่อมต่อ MCP เก็บแค่ชื่อและปลายทาง · ไฟล์เก็บแค่รายชื่อ (ตัวไฟล์อยู่ในสำรองทั้งระบบ)",
      companyKnowledge: memory.filter(d => !d.botId).map(d => ({ path: d.path, content: d.content })),
      bots: exports.map(x => ({ ...x, memory: memory.filter(d => d.botId === x.bot.id).map(d => ({ path: d.path, content: d.content })) })), groups: rooms, approvalRules: rulesList,
      mcpServers: servers.map(s => ({ slug: s.slug, name: s.name, transport: s.transport, endpoint: s.endpoint, enabled: s.enabled })),
      skills: skillsAll.flat().map(s => ({ bot: botOf(s.botId)?.name, name: s.name, goal: s.goal, status: s.status, playbook: s.playbook })),
    };
  }
  const csvCell = v => /[",\n\r]/.test(v = String(v ?? "")) ? `"${v.replace(/"/g, '""')}"` : v;
  function auditRows(where, messages) {
    const rows = [];
    for (const m of messages) {
      const who = m.role === "user" ? "ผู้ใช้" : m.role === "system" ? "ระบบ" : botOf(m.botId)?.name || "บอท";
      for (const x of m.blocks) {
        if (x.kind === "steps") for (const s of x.steps || []) rows.push([m.createdAt, where, who, "เครื่องมือ", s.label + (s.count > 1 ? ` ×${s.count}` : "")]);
        else if (x.kind === "ask") rows.push([m.createdAt, where, who, x.approvalEffectId ? "ขออนุญาต" : "ถาม", `${x.text || ""}${x.status === "answered" ? ` → ${x.answer}` : ""}`]);
        else if (x.kind === "file") rows.push([m.createdAt, where, who, "ไฟล์", x.name]);
        else if (x.kind === "bot_message_sent") rows.push([m.createdAt, where, who, "ส่งงาน", `→ ${x.toBotName}: ${x.text}`]);
        else if (x.kind === "bot_message_received") rows.push([m.createdAt, where, x.fromBotName, "ส่งงาน", `→ ${where}: ${x.text}`]);
        else { const t = App.chat.blockText(x); if (t) rows.push([m.createdAt, where, who, "ข้อความ", t.replace(/\s+/g, " ").slice(0, 500)]); }
      }
    }
    return rows;
  }
  async function auditCsv() {
    const failed = [], read = (name, target) => rk("threads/get", target).then(s => auditRows(name, s.messages), e => { failed.push(`${name}: ${e.message}`); return []; });
    const [dm, rooms] = await Promise.all([
      Promise.all(bots().map(b => read(b.name, { botId: b.id }))),
      Promise.all(App.chat.state.groups.map(g => read(g.name, { groupId: g.id }))),
    ]);
    if (failed.length) throw new Error("อ่านแชทไม่ได้ " + failed.length + " ห้อง: " + failed[0]);
    const rows = [...dm.flat(), ...rooms.flat()].sort((a, c) => a[0] < c[0] ? -1 : 1)
      .map(r => [new Date(r[0]).toLocaleString("th-TH", { hour12: false }), ...r.slice(1)]);
    return { count: rows.length, text: "﻿" + [["เวลา", "แชท", "ผู้กระทำ", "ประเภท", "รายละเอียด"], ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") };
  }
  async function backup(body, refresh) {
    const last = JSON.parse(localStorage.getItem("bt.lastBackup") || "null");
    body.innerHTML = `<div class="grid g2">
      <div class="card"><h3>${icon("download")}<span style="color:var(--text)">สำรองทั้งระบบ</span></h3>
        <div class="muted" style="font-size:13px">ฐานข้อมูล Rakazo ทั้งหมด (แชท ความจำ ทักษะ งานประจำ กฎ การเชื่อมต่อ) + ไฟล์ของบอท + ระบบบัญชีสาธิต → โฟลเดอร์ในเครื่องนี้ กู้คืนได้ตาม RUNBOOK</div>
        <div class="row" style="margin-top:14px;gap:8px"><button class="btn primary" id="bk-full">${icon("download")}สำรองตอนนี้</button>
          <span class="muted" id="bk-last" style="font-size:12.5px">${last ? `ล่าสุด ${esc(relTime(last.at))} · ${last.mb} MB` : "ยังไม่เคยสำรองจากแอป"}</span>
          ${last ? `<button class="btn sm ghost" id="bk-open">${icon("folder")}เปิดโฟลเดอร์</button>` : ""}</div></div>
      <div class="card"><h3>${icon("book")}<span style="color:var(--text)">ส่งออกข้อมูลบริษัท (JSON)</span></h3>
        <div class="muted" style="font-size:13px">บอททุกตัว (คำสั่ง ความจำ งานประจำ ไฟล์ แชท) ห้องประชุม ความรู้บริษัท ทักษะ และกฎ ในไฟล์เดียว อ่านได้ ย้ายระบบได้ — ไม่มีรหัสผ่านหรือคีย์</div>
        <div class="row" style="margin-top:14px"><button class="btn" id="bk-json">${icon("download")}ส่งออก JSON</button></div></div>
      <div class="card"><h3>${icon("activity")}<span style="color:var(--text)">บันทึกการทำงาน (Audit log)</span></h3>
        <div class="muted" style="font-size:13px">ทุกข้อความ ทุกเครื่องมือที่บอทใช้ การขออนุญาตและคำตอบ การส่งงานระหว่างบอท เรียงตามเวลา เปิดด้วย Excel ได้</div>
        <div class="row" style="margin-top:14px"><button class="btn" id="bk-csv">${icon("download")}ส่งออก CSV</button></div></div></div>`;
    const busy = async (btn, fn) => { btn.disabled = true; const t = btn.innerHTML; btn.innerHTML = '<span class="spin"></span>กำลังทำ…'; try { await fn(); } catch (e) { toast(e.message, "bad"); } btn.innerHTML = t; btn.disabled = false; };
    $("#bk-full", body).onclick = e => busy(e.currentTarget, async () => {
      const r = await call("rakazo.backup");
      localStorage.setItem("bt.lastBackup", JSON.stringify({ at: new Date().toISOString(), mb: r.mb, dir: r.dir }));
      toast(`สำรองแล้ว ${r.mb} MB → ${r.dir}`, "good");
      refresh();
    });
    $("#bk-open", body)?.addEventListener("click", () => call("open.folder", { path: last.dir }).catch(e => toast(e.message, "bad")));
    $("#bk-json", body).onclick = e => busy(e.currentTarget, async () => {
      const data = await companyExport();
      download(`botteam-export-${today()}.json`, JSON.stringify(data, null, 1), "application/json");
      toast(`ส่งออกแล้ว: บอท ${data.bots.length} ตัว ห้อง ${data.groups.length} ห้อง`, "good");
    });
    $("#bk-csv", body).onclick = e => busy(e.currentTarget, async () => {
      const r = await auditCsv();
      download(`botteam-audit-${today()}.csv`, r.text, "text/csv");
      toast(`ส่งออกแล้ว ${r.count} รายการ`, "good");
    });
  }

  at("activity", ["team", "share", "ส่งงาน", team]);
  at("routines", ["skills", "wand", "ทักษะ", skills]);
  at("skills", ["knowledge", "book", "ความรู้บริษัท", brain]);
  at("usage", ["rules", "shield", "กฎ", rules]);
  at("rules", ["backup", "download", "สำรอง", backup]);
  App.company = { companyExport, auditCsv, parseBrain, brainText }; // tests
})();
