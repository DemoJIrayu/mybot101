// Theme before the first paint (loaded in <head>): bt.theme = "system" | "light" | "dark"; "system" follows Windows.
// The host gets the resolved theme for the title bar and window background (and remembers it for the next start).
(() => {
  const mq = matchMedia("(prefers-color-scheme: light)"), root = document.documentElement;
  const choice = () => localStorage.getItem("bt.theme") || "system";
  const resolved = () => { const c = choice(); return c === "system" ? (mq.matches ? "light" : "dark") : c; };
  const tellHost = () => { if (typeof App !== "undefined") App.call("theme.set", { theme: resolved() }).catch(() => {}); };
  const apply = () => { root.dataset.theme = resolved(); tellHost(); };
  mq.addEventListener("change", () => { if (choice() === "system") apply(); });
  document.addEventListener("app:start", tellHost);
  root.dataset.theme = resolved();
  window.Theme = { choice, resolved, set: t => { localStorage.setItem("bt.theme", t); apply(); } };
})();
