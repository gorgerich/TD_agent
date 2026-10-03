import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

const source = new URL(process.env.TEST_DATABASE_URL);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(source.hostname), "Latency harness is local-only");
const roundTripMs = Number(process.argv[2] ?? 80);
assert.ok(Number.isInteger(roundTripMs) && roundTripMs >= 80 && roundTripMs <= 200);
const sockets = new Set();
let activeRequests = 0;
const controlPath = `/${randomBytes(32).toString("hex")}`;
const control = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== controlPath) {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const part of request) {
    body += part;
    if (body.length > 100) { response.writeHead(400).end(); return; }
  }
  const input = JSON.parse(body);
  assert.equal(typeof input.active, "boolean");
  activeRequests += input.active ? 1 : -1;
  assert.ok(activeRequests >= 0);
  response.writeHead(204).end();
});
const proxy = net.createServer(front => {
  const back = net.connect({ host: source.hostname.replace(/^\[|\]$/g, ""), port: Number(source.port || 5432) });
  front.setNoDelay(true);
  back.setNoDelay(true);
  sockets.add(front);
  sockets.add(back);
  for (const [input, output] of [[front, back], [back, front]]) {
    input.on("data", bytes => {
      input.pause();
      setTimeout(() => {
        if (!output.destroyed) output.write(bytes, () => input.resume());
      }, activeRequests ? roundTripMs / 2 : 0);
    });
    input.on("error", () => output.destroy());
    input.on("close", () => { sockets.delete(input); output.destroy(); });
    input.on("end", () => output.end());
  }
});
try {
  await new Promise(resolve => control.listen(0, "127.0.0.1", resolve));
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const target = new URL(source);
  target.hostname = "127.0.0.1";
  target.port = String(proxy.address().port);
  const child = spawn(process.execPath, ["scripts/run-integration-tests.mjs", "tests/integration/m3IntakePerformance.itest.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      TEST_DATABASE_URL: target.href,
      M3_INTAKE_LATENCY_CONTROL_URL: `http://127.0.0.1:${control.address().port}${controlPath}`,
      M3_INTAKE_LATENCY_BUDGET_MS: "4500",
    },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolve(code ?? 1));
  });
  assert.equal(activeRequests, 0, "All request delay scopes must close");
} finally {
  for (const socket of sockets) socket.destroy();
  if (proxy.listening) await new Promise(resolve => proxy.close(resolve));
  if (control.listening) await new Promise(resolve => control.close(resolve));
}
