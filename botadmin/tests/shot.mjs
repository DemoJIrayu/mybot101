// usage: node shot.mjs <out.png> [js-to-run-first]
import { connect } from "./cdp.mjs";
const c = await connect();
if (process.argv[3]) await c.evaluate(process.argv[3]);
await new Promise(r => setTimeout(r, 1500));
await c.screenshot(process.argv[2]);
console.log(JSON.stringify(await c.evaluate("({errors: window.__errors || [], title: document.title})")));
c.close();
