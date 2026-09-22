import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, mock, test } from "node:test";
import { db, skip } from "./_setup";
import { claimRateLimitRetentionCadence, cleanupExpiredRateLimitBuckets, drainRateLimitRetention, RATE_LIMIT_RETENTION_BATCH } from "../../lib/rateLimitRetention";
import { enforcePersistentIdentityRateLimit, persistentRateLimitKey } from "../../lib/persistentRateLimit";
import { GET } from "../../app/api/internal/rate-limit-retention/route";

const opts = { skip };
const keys: string[] = [];
async function bucket(expired: boolean) {
  const keyHash = randomUUID();
  keys.push(keyHash);
  await db.securityRateLimitBucket.create({ data: {
    keyHash, count: 99, resetAt: new Date(Date.now() + (expired ? -60_000 : 60_000)),
  } });
  return keyHash;
}
after(async () => {
  if (!skip) await db.securityRateLimitBucket.deleteMany({ where: { keyHash: { in: keys } } });
});

test("retention removes expired buckets but preserves active counters; replay is safe", opts, async () => {
  const expired = await bucket(true);
  const active = await bucket(false);
  await cleanupExpiredRateLimitBuckets();
  assert.equal(await db.securityRateLimitBucket.findUnique({ where: { keyHash: expired } }), null);
  assert.equal((await db.securityRateLimitBucket.findUniqueOrThrow({ where: { keyHash: active } })).count, 99);
  await cleanupExpiredRateLimitBuckets();
  assert.equal((await db.securityRateLimitBucket.findUniqueOrThrow({ where: { keyHash: active } })).count, 99);
});

test("retention respects batch bound and concurrent workers drain without duplicate deletion", opts, async () => {
  const created = await Promise.all(Array.from({ length: RATE_LIMIT_RETENTION_BATCH + 3 }, () => bucket(true)));
  const first = await cleanupExpiredRateLimitBuckets();
  assert.ok(first <= RATE_LIMIT_RETENTION_BATCH);
  assert.ok(await db.securityRateLimitBucket.count({ where: { keyHash: { in: created } } }) >= 3);
  const results = await Promise.all([cleanupExpiredRateLimitBuckets(), cleanupExpiredRateLimitBuckets()]);
  assert.ok(results.every((count) => count <= RATE_LIMIT_RETENTION_BATCH));
  assert.equal(await db.securityRateLimitBucket.count({ where: { keyHash: { in: created } } }), 0);
});

test("cleanup skips locked renewal and never removes the renewed bucket", opts, async () => {
  const keyHash = await bucket(true);
  const unlocked = await bucket(true);
  let release!: () => void;
  let locked!: () => void;
  const barrier = new Promise<void>((resolve) => { locked = resolve; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  const renewal = db.$transaction(async (tx) => {
    await tx.securityRateLimitBucket.update({ where: { keyHash }, data: { resetAt: new Date(Date.now() + 60_000), count: 1 } });
    locked();
    await resume;
  });
  await barrier;
  try {
    await cleanupExpiredRateLimitBuckets();
    assert.equal(await db.securityRateLimitBucket.findUnique({ where: { keyHash: unlocked } }), null);
  } finally { release(); }
  await renewal;
  await cleanupExpiredRateLimitBuckets();
  assert.equal((await db.securityRateLimitBucket.findUniqueOrThrow({ where: { keyHash } })).count, 1);
});

test("frozen login still enforces limits without claiming a lease or deleting expired buckets", opts, async () => {
  const freeze = process.env.RELEASE_WRITE_FREEZE;
  const expired = await bucket(true);
  const identity = randomUUID();
  const keyHash = persistentRateLimitKey("retention-frozen", identity);
  keys.push(keyHash);
  const transaction = mock.method(db, "$transaction");
  try {
    process.env.RELEASE_WRITE_FREEZE = "enabled";
    assert.equal(await enforcePersistentIdentityRateLimit("retention-frozen", identity, 1, 60_000), null);
    assert.equal((await enforcePersistentIdentityRateLimit("retention-frozen", identity, 1, 60_000))?.status, 429);
    assert.equal(transaction.mock.callCount(), 0);
    assert.equal((await db.securityRateLimitBucket.findUniqueOrThrow({ where: { keyHash: expired } })).count, 99);
    assert.equal((await db.securityRateLimitBucket.findUniqueOrThrow({ where: { keyHash } })).count, 2);
  } finally {
    transaction.mock.restore();
    if (freeze === undefined) delete process.env.RELEASE_WRITE_FREEZE; else process.env.RELEASE_WRITE_FREEZE = freeze;
  }
});

test("login attempts shared retention once; denied requests never amplify cleanup", opts, async () => {
  const expired = await bucket(true);
  const identity = randomUUID();
  keys.push(persistentRateLimitKey("retention-test", identity));
  const transaction = mock.method(db, "$transaction");
  try {
    assert.equal(await enforcePersistentIdentityRateLimit("retention-test", identity, 1, 60_000), null);
    const attempts = transaction.mock.callCount();
    assert.ok(attempts >= 1 && attempts <= 2);
    const another = randomUUID();
    keys.push(persistentRateLimitKey("retention-test", another));
    assert.equal(await enforcePersistentIdentityRateLimit("retention-test", another, 1, 60_000), null);
    assert.equal(transaction.mock.callCount(), attempts);
    const denied = await enforcePersistentIdentityRateLimit("retention-test", identity, 1, 60_000);
    assert.equal(denied?.status, 429);
    assert.equal(transaction.mock.callCount(), attempts);
  } finally { transaction.mock.restore(); }
  await cleanupExpiredRateLimitBuckets();
  assert.equal(await db.securityRateLimitBucket.findUnique({ where: { keyHash: expired } }), null);
});

test("scheduled endpoint requires a strong secret and respects release freeze", opts, async () => {
  const previous = process.env.CRON_SECRET;
  const freeze = process.env.RELEASE_WRITE_FREEZE;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await GET(new Request("http://localhost/api/internal/rate-limit-retention"))).status, 401);
    process.env.CRON_SECRET = randomUUID();
    const request = () => new Request("http://localhost/api/internal/rate-limit-retention", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    assert.equal((await GET(new Request("http://localhost/api/internal/rate-limit-retention", { headers: { authorization: "Bearer wrong" } }))).status, 401);
    process.env.RELEASE_WRITE_FREEZE = "enabled";
    assert.equal((await GET(request())).status, 503);
    process.env.RELEASE_WRITE_FREEZE = "disabled";
    assert.equal((await GET(request())).status, 200);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
    if (freeze === undefined) delete process.env.RELEASE_WRITE_FREEZE; else process.env.RELEASE_WRITE_FREEZE = freeze;
  }
});

test("cleanup failure never bypasses login protection or logs database details", opts, async () => {
  const identity = randomUUID();
  keys.push(persistentRateLimitKey("retention-failure", identity));
  const transaction = mock.method(db, "$transaction", async () => { throw new Error("private-database-detail"); });
  const warning = mock.method(console, "warn", () => {});
  const future = performance.now() + 120_000;
  const clock = mock.method(performance, "now", () => future);
  try {
    assert.equal(await enforcePersistentIdentityRateLimit("retention-failure", identity, 1, 60_000), null);
    assert.equal((await enforcePersistentIdentityRateLimit("retention-failure", identity, 1, 60_000))?.status, 429);
    assert.equal(warning.mock.callCount(), 1);
    for (const call of warning.mock.calls) assert.deepEqual(call.arguments, ["RATE_LIMIT_RETENTION_FAILED"]);
  } finally {
    transaction.mock.restore();
    warning.mock.restore();
    clock.mock.restore();
  }
});

test("shared cadence admits one parallel claimant and survives a failed cleanup", opts, async () => {
  const keyHash = randomUUID();
  keys.push(keyHash);
  const claims = await Promise.all(Array.from({ length: 5 }, () => claimRateLimitRetentionCadence(keyHash)));
  assert.equal(claims.filter(Boolean).length, 1);
  const transaction = mock.method(db, "$transaction", async () => { throw new Error("synthetic retention failure"); });
  try { await assert.rejects(cleanupExpiredRateLimitBuckets()); } finally { transaction.mock.restore(); }
  assert.equal(await claimRateLimitRetentionCadence(keyHash), false);
  await db.securityRateLimitBucket.update({ where: { keyHash }, data: { resetAt: new Date(0) } });
  assert.equal(await claimRateLimitRetentionCadence(keyHash), true);
});

test("application clock skew cannot reset an active database-clock limit", opts, async () => {
  const identity = randomUUID();
  keys.push(persistentRateLimitKey("retention-clock", identity));
  assert.equal(await enforcePersistentIdentityRateLimit("retention-clock", identity, 1, 60_000), null);
  const future = Date.now() + 86_400_000;
  const clock = mock.method(Date, "now", () => future);
  try {
    const result = await enforcePersistentIdentityRateLimit("retention-clock", identity, 1, 60_000);
    assert.equal(result?.status, 429);
    assert.ok(Number(result?.headers.get("Retry-After")) <= 60);
  } finally { clock.mock.restore(); }
});

test("drain reports batch and monotonic-time budget exhaustion", opts, async () => {
  const transaction = mock.method(db, "$transaction", async () => RATE_LIMIT_RETENTION_BATCH);
  const warning = mock.method(console, "warn", () => {});
  try {
    assert.deepEqual(await drainRateLimitRetention(), { deleted: 4096, budgetExhausted: true });
    assert.equal(transaction.mock.callCount(), 32);
    let tick = 0;
    const clock = mock.method(performance, "now", () => tick++ === 0 ? 0 : 9000);
    try {
      assert.deepEqual(await drainRateLimitRetention(), { deleted: 0, budgetExhausted: true });
      assert.equal(transaction.mock.callCount(), 32);
    } finally { clock.mock.restore(); }
  } finally {
    transaction.mock.restore();
    warning.mock.restore();
  }
});

test("bounded scheduled drain handles a burst of 1024 distinct expired identities", opts, async () => {
  const burst = Array.from({ length: 1024 }, () => randomUUID());
  keys.push(...burst);
  await db.securityRateLimitBucket.createMany({ data: burst.map((keyHash) => ({
    keyHash, count: 1, resetAt: new Date(Date.now() - 60_000),
  })) });
  const result = await drainRateLimitRetention();
  assert.notEqual(result, null);
  assert.ok(result!.deleted <= RATE_LIMIT_RETENTION_BATCH * 32);
  assert.equal(result!.budgetExhausted, false);
  assert.equal(await db.securityRateLimitBucket.count({ where: { keyHash: { in: burst } } }), 0);
});
