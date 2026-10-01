// Round-2 features, no LLM needed: files (bot + group room) with preview, file chips in chat, usage/cost, mission-control
// wall (every bot, live screens, click-through), and search across every chat from the sidebar box (message and file hits).
// usage: node extra.mjs  (BotAdmin.exe --devtools-port 9223 running; needs at least one file made in a group room)
import { connect } from "./cdp.mjs";
const c = await connect();
const js = s => JSON.stringify(s);
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${js({ path, input })})`);
const results = [];
const check = (name, ok, info = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${info}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const closeModal = () => c.evaluate(`document.querySelector("#fp-x")?.click()`).then(() => sleep(300));
const search = async q => {
  await c.evaluate(`(() => { const s = document.querySelector("#search"); s.value = ${js(q)}; s.dispatchEvent(new Event("input")); })()`);
  return c.waitFor(`document.querySelectorAll(".item.hit").length || /ไม่พบ "/.test(document.querySelector("#sideList").innerText)`, 15000);
};
try {
  await c.waitFor(`App.chat.state.ready && App.store.waiting !== undefined`, 60000);
  const bots = await rk("bots/list");
  check("company has 9 bots, each with its own computer", bots.length === 9 && bots.every(b => b.computerMode === "dedicated"), bots.map(b => b.name).join(","));

  // ---------- files ----------
  await c.evaluate(`App.go({ type: "work", tab: "files" })`);
  await c.waitFor(`!document.querySelector("#w-body .skeleton")`, 20000);
  const files = await c.evaluate(`[...document.querySelectorAll(".file")].map(x => x.innerText.replace(/\\s+/g, " "))`);
  check("files tab lists files, including ones made in a group room", files.length && files.some(t => t.includes("ห้องรวม")), files[0]);
  await c.evaluate(`document.querySelector(".file").click()`);
  const shown = await c.waitFor(`(document.querySelector("#fp-body .md, #fp-body pre, #fp-body img")?.textContent || "x").length > 20`, 15000);
  check("preview renders the file", shown, (await c.evaluate(`document.querySelector("#fp-meta")?.textContent`)));
  await closeModal();

  // ---------- file chip in the chat ----------
  const room = (await rk("groups/list")).find(g => g.name === "ห้องประชุมทีมบริหาร");
  await c.evaluate(`App.go({ type: "group", id: ${js(room.id)} })`);
  const chip = await c.waitFor(`!!document.querySelector(".file-chip")`, 20000);
  check("chat shows a file chip instead of [ไฟล์]", chip, await c.evaluate(`document.querySelector(".file-chip")?.textContent`));
  if (chip) {
    await c.evaluate(`document.querySelector(".file-chip").click()`);
    check("clicking the chip opens the preview", await c.waitFor(`(document.querySelector("#fp-body .md, #fp-body pre")?.textContent || "").length > 20`, 15000));
    await closeModal();
  }

  // ---------- usage ----------
  const sum = await rk("usage/summary");
  await c.evaluate(`App.go({ type: "work", tab: "usage" })`);
  await c.waitFor(`!!document.querySelector(".usage-row")`, 20000);
  const u = await c.evaluate(`({ cards: [...document.querySelectorAll("#w-body .grid .big")].map(x => x.textContent), rows: document.querySelectorAll(".usage-row").length })`);
  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);
  check("usage totals match Rakazo's summary", u.cards[0] === fmt(sum.runs) && u.cards[1] === fmt(sum.inputTokens + sum.outputTokens), u.cards.join(" | "));
  check("usage has per-bot rows and a dollar estimate", u.rows > 0 && /^\$\d/.test(u.cards[3]), `${u.rows} rows`);

  // ---------- mission control ----------
  await c.evaluate(`App.go({ type: "live" })`);
  await c.waitFor(`/จอเปิด \\d+\\/\\d+/.test(document.querySelector("#lv-sum")?.innerText || "")`, 20000);
  const live = await c.evaluate(`({ cards: document.querySelectorAll(".live").length, sum: document.querySelector("#lv-sum").innerText.replace(/\\s+/g, " "),
    screens: document.querySelectorAll(".live iframe").length, fits: document.querySelector(".live-page, #main .page").scrollHeight <= document.querySelector("#main .page").clientHeight + 2 })`);
  check("wall shows every bot", live.cards === bots.length, live.sum);
  const on = +(/จอเปิด (\d+)/.exec(live.sum) || [])[1];
  check("running computers stream live screens", live.screens === on, `${live.screens} iframes`);
  check("all cards fit one page (no scrolling)", live.fits);
  await c.evaluate(`document.querySelector(".live").click()`);
  check("clicking a card opens that bot's chat", await c.waitFor(`App.route().type === "bot"`, 5000));

  // ---------- search ----------
  await search("แผนการตลาด");
  const hits = await c.evaluate(`[...document.querySelectorAll(".item.hit")].map(x => ({ t: x.innerText.replace(/\\s+/g, " "), mark: !!x.querySelector("mark") }))`);
  check("search finds Thai text in chats and highlights it", hits.length && hits.some(h => h.mark), hits[0]?.t.slice(0, 60));
  await c.evaluate(`document.querySelector(".item.hit").click()`);
  check("clicking a hit opens the chat", await c.waitFor(`/^(bot|group)$/.test(App.route().type)`, 5000), js(await c.evaluate("App.route()")));
  await search("solaao");
  const fileHit = await c.evaluate(`[...document.querySelectorAll(".item.hit")].findIndex(x => x.querySelector(".hit-ic").textContent.includes("📄"))`);
  check("search finds files by name", fileHit >= 0);
  if (fileHit >= 0) {
    await c.evaluate(`document.querySelectorAll(".item.hit")[${fileHit}].click()`);
    check("a file hit opens the preview", await c.waitFor(`(document.querySelector("#fp-body .md, #fp-body pre")?.textContent || "").length > 20`, 15000),
      await c.evaluate(`document.querySelector("#fp-meta")?.textContent`));
    await closeModal();
  }
  await c.evaluate(`(() => { const s = document.querySelector("#search"); s.value = ""; s.dispatchEvent(new Event("input")); })()`);
  const errors = await c.evaluate("window.__errors");
  check("no JS errors", !errors.length, js(errors));
  await c.screenshot("D:/tmp/extra.png");
} finally {
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  c.close();
  process.exitCode = failed ? 1 : 0;
}
