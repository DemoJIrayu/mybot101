import { fetch as undiciFetch } from "undici";

// Hotfix from upstream elie222/rakazo#808 (not in v0.1.6): a package undici Agent must be driven by the
// package's own fetch; Node 22's built-in fetch (undici 6) rejects it with "invalid onRequestStart method".
export const dispatcherFetch = undiciFetch as unknown as typeof globalThis.fetch;
