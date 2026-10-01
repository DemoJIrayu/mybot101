// hard reload (bypass cache) of the BotTeam page
import { connect } from "./cdp.mjs";
const c = await connect();
await c.send("Page.reload", { ignoreCache: true });
c.close();
