// MCP view: connect MCP servers (remote streamable HTTP / SSE) to Rakazo and choose which bots may use them.
"use strict";
(() => {
  const { $, esc, icon, avatar, toast, modal, confirm, call, register, PALETTE } = App;
  const rk = (path, input) => call("rk", { path, input: input || {} });
  const colorIdx = c => { const i = PALETTE.findIndex(p => p[0] === c); return i < 0 ? null : i; };
  // Rakazo slugs are [a-z0-9_-]; Thai names fall back to a random slug
  const slugOf = name => (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "mcp") + "-" + Math.random().toString(36).slice(2, 6);

  register("mcp", view => {
    view.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>MCP</h1><div class="sub">เชื่อมเครื่องมือภายนอกผ่าน Model Context Protocol แล้วเลือกบอทที่ใช้ได้</div></div>
        <div class="grow"></div><button class="btn primary" id="mcp-add">${icon("plus")}เพิ่ม MCP</button></div>
      <div id="mcp-list"><div class="card skeleton" style="height:120px"></div></div></div>`;
    $("#mcp-add", view).onclick = () => addServer(render);

    let alive = true;
    async function render() {
      try {
        const [servers, links, boot] = await Promise.all([rk("mcp/servers/list"), rk("mcp/assignments/all"), rk("bootstrap")]);
        if (!alive) return;
        const bots = boot.bots, list = $("#mcp-list", view);
        list.innerHTML = servers.length ? `<div class="grid g2">${servers.map((s, i) => {
          const users = links.filter(l => l.serverId === s.id).map(l => bots.find(b => b.id === l.botId)).filter(Boolean);
          return `<div class="card" style="animation-delay:${i * 50}ms">
            <h3>${icon("cpu")}<span style="color:var(--text);font-size:15px">${esc(s.name)}</span><span class="grow"></span>
              <span class="chip ${s.enabled ? "good" : ""}">${s.enabled ? "เปิดใช้" : "ปิด"}</span><span class="chip">${esc(s.transport)}</span></h3>
            <div class="mono muted" style="font-size:12.5px;word-break:break-all">${esc(s.endpoint || s.command || "")}</div>
            ${s.description ? `<div class="muted" style="margin-top:6px">${esc(s.description)}</div>` : ""}
            <div class="row" style="margin-top:14px"><div class="stack">${users.slice(0, 6).map(b => avatar(b.name, { color: colorIdx(b.color), size: "sm" })).join("")}</div>
              <span class="muted" style="font-size:12.5px">${users.length ? `${users.length} บอทใช้ได้` : "ยังไม่มีบอทใช้"}</span><span class="grow" style="flex:1"></span>
              <button class="btn sm" data-assign="${esc(s.id)}">${icon("users")}เลือกบอท</button>
              <button class="btn sm ghost icon" data-del="${esc(s.id)}" title="ลบ">${icon("trash")}</button></div></div>`;
        }).join("")}</div>`
          : `<div class="empty" style="min-height:40vh"><div><div class="float" style="font-size:44px">🔌</div><h2>ยังไม่มี MCP</h2>
             <div class="muted">เพิ่ม MCP server (URL แบบ Streamable HTTP หรือ SSE) เช่น https://mcp.deepwiki.com/mcp</div></div></div>`;
        list.querySelectorAll("[data-assign]").forEach(b => b.onclick = () => assign(servers.find(s => s.id === b.dataset.assign), bots, links, render));
        list.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
          const s = servers.find(x => x.id === b.dataset.del);
          if (!await confirm({ title: `ลบ MCP ${s.name}?`, body: "บอทจะใช้เครื่องมือจาก server นี้ไม่ได้อีก", ok: "ลบ", danger: true })) return;
          try { await rk("mcp/servers/remove", { id: s.id }); toast("ลบแล้ว", "good"); render(); } catch (e) { toast("ลบไม่สำเร็จ: " + e.message, "bad"); }
        });
      } catch (e) { $("#mcp-list", view).innerHTML = `<div class="card muted">โหลดรายการ MCP ไม่ได้: ${esc(e.message)}</div>`; }
    }
    render();
    return () => { alive = false; };
  });

  function addServer(done) {
    const m = modal(`<h2>เพิ่ม MCP server</h2><div class="muted">ระบบตรวจ URL ก่อนเชื่อม (บล็อกที่อยู่ภายในเครือข่ายเพื่อความปลอดภัย)</div>
      <div class="field"><label>ชื่อ</label><input class="input" id="m-name" maxlength="120" placeholder="เช่น DeepWiki"></div>
      <div class="field"><label>URL</label><input class="input mono" id="m-url" placeholder="https://www.bcaccount.com/mcp"></div>
      <div class="field"><label>Token (ถ้ามี)</label><input class="input" id="m-token" type="password" autocomplete="off" placeholder="ส่งเป็น Authorization: Bearer … เก็บแบบเข้ารหัสใน Rakazo"></div>
      <div class="field"><label>คำอธิบาย</label><input class="input" id="m-desc" maxlength="2000" placeholder="ใช้ทำอะไร (บอทเห็นข้อความนี้)"></div>
      <div class="actions"><button class="btn ghost" id="m-cancel">ยกเลิก</button><button class="btn primary" id="m-ok">${icon("plus")}เชื่อมต่อ</button></div>`);
    $("#m-name", m.el).focus();
    $("#m-cancel", m.el).onclick = m.close;
    $("#m-ok", m.el).onclick = async e => {
      const name = $("#m-name", m.el).value.trim(), url = $("#m-url", m.el).value.trim(), token = $("#m-token", m.el).value.trim();
      if (!name || !/^https?:\/\//.test(url)) { toast("ใส่ชื่อและ URL ที่ขึ้นต้นด้วย http(s)://", "warn"); return; }
      const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>กำลังเชื่อม…';
      try {
        await rk("mcp/servers/create", {
          slug: slugOf(name), name, description: $("#m-desc", m.el).value.trim(), enabled: true,
          transport: /\/sse\/?$/.test(url) ? "sse" : "streamable_http", endpoint: url, headers: {}, ...(token ? { secret: token } : {}),
        });
        m.close(); toast(`เชื่อม ${name} แล้ว — กด "เลือกบอท" เพื่อให้บอทใช้`, "good"); done();
      } catch (err) { toast("เชื่อมไม่สำเร็จ: " + err.message, "bad"); btn.disabled = false; btn.innerHTML = `${icon("plus")}เชื่อมต่อ`; }
    };
  }

  function assign(server, bots, links, done) {
    const on = new Set(links.filter(l => l.serverId === server.id).map(l => l.botId));
    const m = modal(`<h2>บอทที่ใช้ ${esc(server.name)} ได้</h2><div class="muted">เลือกเฉพาะบอทที่ต้องใช้จริง (เครื่องมือยิ่งน้อย บอทยิ่งเลือกถูกและเร็ว)</div>
      <div class="field"><input class="input" id="a-q" placeholder="ค้นหาบอท"></div>
      <div class="pick" id="a-list" style="max-height:46vh;overflow:auto">${bots.map(b => `<div class="opt ${on.has(b.id) ? "on" : ""}" data-id="${esc(b.id)}">${avatar(b.name, { color: colorIdx(b.color), size: "sm" })}${esc(b.name)}</div>`).join("")}</div>
      <div class="actions"><button class="btn ghost" id="a-cancel">ยกเลิก</button><button class="btn primary" id="a-ok">${icon("check")}บันทึก</button></div>`, { wide: true });
    m.el.querySelectorAll(".opt").forEach(o => o.onclick = () => o.classList.toggle("on"));
    $("#a-q", m.el).oninput = e => m.el.querySelectorAll(".opt").forEach(o => { o.hidden = !o.textContent.toLowerCase().includes(e.target.value.trim().toLowerCase()); });
    $("#a-cancel", m.el).onclick = m.close;
    $("#a-ok", m.el).onclick = async e => {
      const want = new Set([...m.el.querySelectorAll(".opt.on")].map(o => o.dataset.id));
      const changed = bots.filter(b => want.has(b.id) !== on.has(b.id));
      const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>กำลังบันทึก…';
      try {
        // replace is per bot: keep the bot's other servers, add/remove this one
        for (const b of changed) {
          const others = links.filter(l => l.botId === b.id && l.serverId !== server.id)
            .map(l => ({ serverId: l.serverId, allowAllTools: l.allowAllTools, allowedTools: l.allowedTools }));
          await rk("mcp/assignments/replace", { botId: b.id, assignments: want.has(b.id) ? [...others, { serverId: server.id, allowAllTools: true, allowedTools: [] }] : others });
        }
        m.close(); toast(`บันทึกแล้ว (${want.size} บอท)`, "good"); done();
      } catch (err) { toast("บันทึกไม่สำเร็จ: " + err.message, "bad"); btn.disabled = false; btn.innerHTML = `${icon("check")}บันทึก`; }
    };
  }
})();
