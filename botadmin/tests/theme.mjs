// Light/dark theme: sidebar picker, "ระบบ" follows Windows (emulated prefers-color-scheme), host title bar/background +
// remembered file, every main page rendered in light with a text-contrast scan (WCAG ratio < 3 is reported), the bot card
// PNG follows the theme. Screenshots: D:/tmp/theme-<page>.png. Restores the user's choice.
// usage: node theme.mjs  (BotAdmin.exe --devtools-port 9223 running; ask ลุงจืด not to click the app meanwhile)
import fs from "node:fs";
import path from "node:path";
import { connect } from "./cdp.mjs";
const c = await connect();
const js = s => JSON.stringify(s);
const results = [];
const check = (name, ok, info = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${typeof info === "string" ? info : js(info)}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const themeFile = path.join(process.env.LOCALAPPDATA, "BotTeam", "theme.txt");
const pick = async t => { await c.evaluate(`document.querySelector('[data-theme-pick="${t}"]').click()`); await sleep(400); };
const state = () => c.evaluate(`({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, choice: Theme.choice(),
  on: document.querySelector("[data-theme-pick].on")?.dataset.themePick })`);
// text elements whose colour is too close to what is behind them (backgrounds blended up the tree; images ignored)
const CONTRAST = `(() => {
  const rgb = s => (s.match(/[\\d.]+/g) || []).map(Number), lum = ([r, g, b]) => { const f = v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const over = (top, under) => { const a = top[3] ?? 1; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)); };
  // a strong gradient/image behind the text (avatars, bot colours) can't be judged here: skip; faint surface gradients are ignored
  const strongImage = e => { const bi = getComputedStyle(e).backgroundImage; return bi !== "none" && (/url\\(|#/.test(bi) || (bi.match(/rgba?\\([^)]*\\)/g) || []).some(s => (rgb(s)[3] ?? 1) > .3)); };
  const bgOf = el => { const layers = [], thumb = el.classList.contains("on") && el.parentElement?.querySelector(":scope > .thumb");
    if (thumb) layers.push(rgb(getComputedStyle(thumb).backgroundColor)); // segmented control: the pill slides behind the active button
    for (let e = el; e; e = e.parentElement) { if (strongImage(e)) return null; const c = rgb(getComputedStyle(e).backgroundColor); if (c.length && (c[3] ?? 1) > 0) { layers.push(c); if ((c[3] ?? 1) >= 1) break; } }
    let base = layers.length && (layers.at(-1)[3] ?? 1) >= 1 ? layers.pop().slice(0, 3) : rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3);
    for (const l of layers.reverse()) base = over(l, base); return base; };
  const bad = [];
  for (const el of document.querySelectorAll("#main *, #sideFoot *, .side *, .modal *")) {
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden" || +cs.opacity === 0 || r.bottom < 0 || r.top > innerHeight) continue;
    const fg = rgb(cs.color), bg = bgOf(el);
    if (!bg || (fg[3] ?? 1) === 0) continue; // gradient text (background-clip) / strong image behind
    const f = over(fg, bg), [a, b] = [lum(f) + .05, lum(bg) + .05].sort((x, y) => y - x), ratio = a / b;
    if (ratio < 3) bad.push({ ratio: +ratio.toFixed(2), text: el.textContent.trim().slice(0, 30), cls: (el.className?.baseVal ?? el.className) || el.tagName });
  }
  return bad.sort((x, y) => x.ratio - y.ratio).slice(0, 8);
})()`;
let before;
try {
  await c.waitFor(`App.chat.state.ready`, 60000);
  await c.evaluate("window.__errors.length = 0");
  before = await c.evaluate(`localStorage.getItem("bt.theme")`);
  await c.evaluate(`App.go({ type: "home" })`); await sleep(800);
  check("sidebar has the 3-way theme picker", await c.evaluate(`[...document.querySelectorAll("[data-theme-pick]")].map(b => b.dataset.themePick).join() === "system,light,dark"`));

  await pick("light");
  let s = await state();
  check("สว่าง -> light tokens on the page", s.theme === "light" && s.bg === "rgb(244, 244, 241)" && s.on === "light" && s.choice === "light", s);
  check("host remembers light (title bar + window background)", fs.readFileSync(themeFile, "utf8") === "light");
  const shots = [["home", `{ type: "home" }`], ["chat", `{ type: "bot", id: App.chat.state.bots[0].id }`], ["inbox", `{ type: "work", tab: "inbox" }`],
    ["persona", `{ type: "work", tab: "persona" }`], ["rules", `{ type: "work", tab: "rules" }`], ["monitor", `{ type: "monitor" }`], ["live", `{ type: "live" }`], ["mcp", `{ type: "mcp" }`]];
  for (const [name, route] of shots) {
    await c.evaluate(`App.go(${route})`); await sleep(2500);
    await c.screenshot(`D:/tmp/theme-${name}.png`);
    const bad = await c.evaluate(CONTRAST);
    check(`light ${name}: readable text (no contrast < 3)`, bad.length === 0, bad);
  }
  const lightCard = await c.evaluate(`App.assistant.cardPng(App.chat.state.bots[0])`);

  await pick("dark");
  s = await state();
  check("มืด -> dark tokens", s.theme === "dark" && s.bg === "rgb(11, 11, 12)" && s.on === "dark", s);
  check("host remembers dark", fs.readFileSync(themeFile, "utf8") === "dark");
  check("bot card PNG follows the theme", lightCard !== await c.evaluate(`App.assistant.cardPng(App.chat.state.bots[0])`));
  await c.evaluate(`App.go({ type: "work", tab: "inbox" })`); await sleep(2000);
  await c.screenshot("D:/tmp/theme-inbox-dark.png");
  check("dark inbox: readable text", (await c.evaluate(CONTRAST)).length === 0, await c.evaluate(CONTRAST));

  await pick("system");
  for (const [os, want] of [["light", "light"], ["dark", "dark"]]) {
    await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: os }] }); await sleep(500);
    check(`ระบบ follows Windows (${os})`, (await state()).theme === want && fs.readFileSync(themeFile, "utf8") === want, await state());
  }
  await c.send("Emulation.setEmulatedMedia", { features: [] });
  check("no JS errors", (await c.evaluate("window.__errors")).length === 0, await c.evaluate("window.__errors"));
} catch (e) {
  check("run", false, e.stack || e.message);
} finally {
  await c.evaluate(`(${js(before)} === null ? localStorage.removeItem("bt.theme") : localStorage.setItem("bt.theme", ${js(before)}), Theme.set(Theme.choice()), App.go({ type: "home" }))`).catch(() => {});
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  c.close();
  process.exitCode = failed ? 1 : 0;
}
