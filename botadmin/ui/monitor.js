// Monitor view: live gauges, sparklines, LLM + Rakazo control, logs.
"use strict";
(() => {
  const { $, esc, icon, animateNumber, onSnapshot, store, call, confirm, act, register } = App;
  const C = 2 * Math.PI * 34; // ring circumference (r=34)

  const gauge = (id, label) => `
    <div class="card"><h3>${label}</h3>
      <div class="gauge">
        <svg class="ring" viewBox="0 0 84 84"><circle class="track" cx="42" cy="42" r="34"/>
          <circle class="val" id="${id}-ring" cx="42" cy="42" r="34" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
        <div><div class="big"><span id="${id}-v">0</span><small>%</small></div><div class="muted num" id="${id}-sub">&nbsp;</div></div>
      </div></div>`;

  function setGauge(id, pct, sub) {
    const ring = $(`#${id}-ring`);
    if (!ring) return;
    ring.style.strokeDashoffset = C * (1 - Math.min(100, Math.max(0, pct)) / 100);
    ring.style.stroke = pct > 95 ? "var(--bad)" : pct > 85 ? "var(--warn)" : "var(--good)";
    ring.style.color = ring.style.stroke;
    animateNumber($(`#${id}-v`), Math.round(pct));
    $(`#${id}-sub`).textContent = sub;
  }

  // smooth sparkline with gradient fill on a canvas sized to its box
  function spark(canvas, data, color, max) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    if (data.length < 2) return;
    const top = max || Math.max(1, ...data) * 1.15, n = 100;
    const pts = data.map((v, i) => [w - (data.length - 1 - i) * (w / (n - 1)), h - 4 - (v / top) * (h - 10)]);
    const path = () => {
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2;
        g.bezierCurveTo(mx, y0, mx, y1, x1, y1);
      }
    };
    path(); g.lineTo(pts[pts.length - 1][0], h); g.lineTo(pts[0][0], h); g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + "55"); grad.addColorStop(1, color + "00");
    g.fillStyle = grad; g.fill();
    path(); g.strokeStyle = color; g.lineWidth = 2; g.shadowColor = color; g.shadowBlur = 8; g.stroke();
    const [lx, ly] = pts[pts.length - 1];
    g.beginPath(); g.arc(lx, ly, 3, 0, 7); g.fillStyle = "#fff"; g.fill();
  }

  register("monitor", view => {
    view.innerHTML = `
      <div class="page">
        <div class="page-head"><div><h1>Monitor</h1><div class="sub">เครื่องนี้ · LLM · Rakazo · บอท</div></div>
          <div class="grow"></div><span class="chip"><span class="dot good"></span><span id="m-upd">กำลังโหลด…</span></span></div>
        <div class="grid g4">${gauge("vram", "VRAM")}${gauge("gpu", "GPU")}${gauge("cpu", "CPU")}${gauge("ram", "RAM")}</div>
        <div class="grid g2" style="margin-top:16px">
          <div class="card" style="animation-delay:.05s">
            <h3>${icon("sparkles")} LLM · llama-server :8080 <span class="grow"></span><span class="chip" id="llm-chip">…</span></h3>
            <div class="row"><div><div class="big"><span id="llm-tps">0</span><small>t/s เฉลี่ย</small></div>
              <div class="muted" id="llm-model">&nbsp;</div></div><div class="grow"></div>
              <div style="text-align:right"><div class="muted" style="font-size:12px;margin-bottom:6px">ช่องทำงาน</div><div class="slots" id="llm-slots"></div>
              <div class="muted num" style="font-size:12px;margin-top:6px" id="llm-queue"></div></div></div>
            <div class="spark-wrap"><canvas class="spark" id="sp-tps"></canvas></div>
            <div class="row wrap" style="margin-top:12px">
              <button class="btn sm primary" id="llm-start">${icon("play")}เปิด</button>
              <button class="btn sm danger" id="llm-stop">${icon("stop")}หยุด</button>
              <button class="btn sm" id="llm-restart">${icon("refresh")}รีสตาร์ท</button>
              <div class="grow"></div><span class="muted num" id="llm-tokens"></span>
            </div>
          </div>
          <div class="card" style="animation-delay:.1s">
            <h3>${icon("users")} Rakazo · บอท <span class="grow"></span><span class="chip" id="rk-chip">…</span></h3>
            <div class="row"><div><div class="big"><span id="rk-bots">0</span><small id="rk-bots-sub">บอททำงาน</small></div>
              <div class="muted" id="rk-sub">&nbsp;</div></div></div>
            <div style="max-height:170px;overflow:auto;margin-top:6px"><table class="table"><thead><tr><th>container</th><th>สถานะ</th><th>CPU</th><th>RAM</th></tr></thead>
              <tbody id="rk-rows"></tbody></table></div>
            <div class="row wrap" style="margin-top:12px">
              <button class="btn sm primary" id="rk-start">${icon("play")}เปิด Rakazo</button>
              <button class="btn sm danger" id="rk-stop">${icon("stop")}หยุด Rakazo</button>
              <button class="btn sm ghost" id="rk-web">${icon("external")}เว็บ Rakazo</button>
            </div>
          </div>
        </div>
        <div class="grid g2" style="margin-top:16px">
          <div class="card" style="animation-delay:.15s"><h3>VRAM % · 5 นาทีล่าสุด</h3><canvas class="spark" id="sp-vram"></canvas></div>
          <div class="card" style="animation-delay:.2s"><h3>GPU ใช้งาน % · 5 นาทีล่าสุด</h3><canvas class="spark" id="sp-gpu"></canvas></div>
        </div>
        <div class="card" style="margin-top:16px;animation-delay:.25s">
          <h3>Log <span class="grow"></span><div class="seg" id="log-seg"><div class="thumb"></div>
            ${["llama-server", "rakazo api", "rakazo worker", "rakazo supervisor", "rakazo web"].map((s, i) =>
              `<button data-src="${s}" class="${i ? "" : "on"}">${s.replace("rakazo ", "")}</button>`).join("")}</div></h3>
          <div class="log" id="log"></div>
        </div>
      </div>`;

    let logSrc = "llama-server";
    const seg = $("#log-seg", view);
    const moveThumb = () => { const on = $("button.on", seg), t = $(".thumb", seg); t.style.left = on.offsetLeft + "px"; t.style.width = on.offsetWidth + "px"; };
    requestAnimationFrame(moveThumb);
    seg.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      logSrc = b.dataset.src; moveThumb(); $("#log").textContent = ""; loadLog();
    });
    let logBusy = false;
    async function loadLog() {
      if (logBusy) return;
      logBusy = true;
      const box = $("#log");
      try {
        const s = store.snap;
        const txt = logSrc.startsWith("rakazo") && s && s.rakazo.health === "Ubuntu ปิดอยู่"
          ? "(Ubuntu ปิดอยู่ — กด เปิด Rakazo ก่อน)" : await call("logs", { source: logSrc });
        if (box && box.textContent !== txt) {
          const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
          box.textContent = txt;
          if (atEnd || !box.dataset.init) box.scrollTop = box.scrollHeight;
          box.dataset.init = 1;
        }
      } catch (e) { if (box) box.textContent = "อ่าน log ไม่ได้: " + e.message; }
      finally { logBusy = false; }
    }

    $("#llm-start").onclick = e => act(e.currentTarget, "เปิด LLM", "llm.start");
    $("#llm-stop").onclick = async e => { const b = e.currentTarget;
      if (await confirm({ title: "หยุด LLM?", body: "บอททุกตัวจะหยุดตอบจนกว่า LLM จะเปิดใหม่ (~15 วินาที)", ok: "หยุด LLM", danger: true })) act(b, "หยุด LLM", "llm.stop"); };
    $("#llm-restart").onclick = async e => { const b = e.currentTarget;
      if (await confirm({ title: "รีสตาร์ท LLM?", body: "บอททุกตัวจะหยุดตอบระหว่างรีสตาร์ท (~15 วินาที)", ok: "รีสตาร์ท" })) act(b, "รีสตาร์ท LLM", "llm.restart"); };
    $("#rk-start").onclick = e => act(e.currentTarget, "เปิด Rakazo", "rakazo.start");
    $("#rk-stop").onclick = async e => { const b = e.currentTarget;
      if (await confirm({ title: "หยุด Rakazo?", body: "บอททุกตัวจะหยุด ข้อมูลไม่หาย เปิดใหม่ได้", ok: "หยุด Rakazo", danger: true })) act(b, "หยุด Rakazo", "rakazo.stop"); };
    $("#rk-web").onclick = () => call("rakazo.web", { path: "/app" }).catch(e => App.toast(e.message, "bad"));

    const off = onSnapshot(s => {
      if (s.gpu) {
        const g = s.gpu, pct = 100 * g.vramUsed / g.vramTotal;
        setGauge("vram", pct, `${(g.vramUsed / 1024).toFixed(1)} / ${(g.vramTotal / 1024).toFixed(1)} GB`);
        setGauge("gpu", g.util, `${g.temp}°C · ${Math.round(g.power)} W`);
      }
      setGauge("cpu", s.cpuPct, "24 cores");
      setGauge("ram", 100 * s.ramUsedGb / s.ramTotalGb, `${s.ramUsedGb.toFixed(1)} / ${s.ramTotalGb.toFixed(1)} GB`);

      const l = s.llm, ready = l.health === "พร้อม";
      const chip = $("#llm-chip");
      chip.className = "chip " + (ready ? "good" : l.process ? "warn" : "bad");
      chip.innerHTML = `<span class="dot ${ready ? "good" : l.process ? "warn" : "bad"}"></span>${esc(l.health)}`;
      animateNumber($("#llm-tps"), l.tps, 1);
      $("#llm-model").textContent = ready ? "model: " + l.model : "—";
      $("#llm-slots").innerHTML = Array.from({ length: Math.max(l.slots, 2) }, (_, i) => `<div class="slot ${i < l.busy ? "busy" : ""}"></div>`).join("");
      $("#llm-queue").textContent = `ทำงาน ${l.busy}/${l.slots} · คิวรอ ${l.deferred}`;
      $("#llm-tokens").textContent = `ผลิตรวม ${l.tokensOut.toLocaleString()} tokens`;
      $("#llm-start").disabled = l.process;
      $("#llm-stop").disabled = $("#llm-restart").disabled = !l.process;

      const r = s.rakazo, up = r.health.startsWith("พร้อม");
      const rc = $("#rk-chip");
      rc.className = "chip " + (up ? "good" : "bad");
      rc.innerHTML = `<span class="dot ${up ? "good" : "bad"}"></span>${esc(r.health)}`;
      // computer + data-init are one-shot setup containers (exit 0 by design): not worth a row
      const boxes = r.boxes.filter(b => b.bot || !["computer", "data-init"].includes(b.name));
      const bots = boxes.filter(b => b.bot), sys = boxes.filter(b => !b.bot);
      animateNumber($("#rk-bots"), bots.filter(b => b.state === "running").length);
      $("#rk-bots-sub").textContent = `/ ${bots.length} บอททำงาน`;
      $("#rk-sub").textContent = `container ระบบ ${sys.filter(b => b.state === "running").length} ตัว · keep-alive ${r.keepAlive ? "เปิด" : "ปิด"}`;
      const memPct = m => { const v = parseFloat(m); return /GiB/.test(m) ? v * 1024 / 30 : v / 30; }; // ponytail: bar scale = 3GB per computer
      $("#rk-rows").innerHTML = boxes.map(b => `<tr><td>${b.bot ? "🤖 " : ""}${esc(b.name)}</td>
        <td><span class="dot ${b.state === "running" ? "good" : "bad"}"></span> <span class="muted">${esc(b.status.replace(/^Up /, "").replace(" (healthy)", " · healthy"))}</span></td>
        <td class="num">${esc(b.cpu)}</td><td><div class="row"><span class="num" style="width:74px">${esc(b.mem)}</span>
        <div class="bar grow"><i style="width:${b.mem === "-" ? 0 : Math.min(100, memPct(b.mem))}%"></i></div></div></td></tr>`).join("")
        || `<tr><td colspan="4" class="muted">${esc(r.health)}</td></tr>`;
      $("#rk-start").disabled = up;
      $("#rk-stop").disabled = !up;

      spark($("#sp-tps"), store.history.tps, "#3ddc97");
      spark($("#sp-vram"), store.history.vram, "#62a8ff", 100);
      spark($("#sp-gpu"), store.history.gpu, "#9b7bff", 100);
      $("#m-upd").textContent = "สด · " + new Date().toLocaleTimeString("th-TH");
      loadLog();
    });
    return off;
  });
})();
