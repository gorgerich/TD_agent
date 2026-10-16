import { randomBytes } from "node:crypto";

/** @returns {() => Record<string, string>} */
export function createLocalClientHeaders(origin) {
  const url = new URL(origin);
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
  const run = randomBytes(6).toString("hex").match(/.{4}/g).join(":");
  let client = 0;
  return () => {
    if (!local) return {};
    if (++client > 65535) throw new Error("LOCAL_CLIENT_IDENTITIES_EXHAUSTED");
    // Local Next simulates separate trusted-proxy clients; deployed requests are unchanged.
    return { "x-real-ip": `2001:db8:${run}::${client.toString(16)}` };
  };
}
