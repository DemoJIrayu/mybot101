// Local-only API: reject other Host headers (DNS rebinding) and cross-site writes (CSRF from any open web page).
const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export function guard(req: Request, write = false): Response | null {
  const host = req.headers.get("host") ?? "";
  if (!LOCAL.test(host)) return new Response("forbidden", { status: 403 });
  if (write && req.headers.get("origin") !== `http://${host}`) return new Response("forbidden", { status: 403 });
  return null;
}
