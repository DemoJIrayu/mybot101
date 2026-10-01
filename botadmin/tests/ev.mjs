// usage: node ev.mjs "<js expression>"  -> prints JSON result (awaits promises)
import { connect } from "./cdp.mjs";
const c = await connect();
console.log(JSON.stringify(await c.evaluate(process.argv[2]), null, 1));
c.close();
