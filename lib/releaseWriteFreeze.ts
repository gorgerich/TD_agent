export const RELEASE_WRITE_FREEZE_ENV = "RELEASE_WRITE_FREEZE";

export type ReleaseRequest = {
  method: string;
  pathname: string;
};

export type ReleaseWriteFreezeDecision = {
  active: boolean;
  blocked: boolean;
  reason: "inactive" | "auth-session" | "read-only" | "write-frozen";
};

const AUTH_SESSION_PATHS = new Set([
  "/api/agent/auth/login",
  "/api/agent/auth/logout",
  // Narrow one-time credential recovery. Token TTL, replay protection and
  // persistent rate limits keep business mutations frozen.
  "/api/platform-admin/owner-recovery",
]);
const WRITE_ON_READ_PREFIXES = ["/api/co/", "/co/"];
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isReleaseWriteFreezeActive(value = process.env[RELEASE_WRITE_FREEZE_ENV]): boolean {
  if (value === undefined) return false;
  return value.trim().toLowerCase() !== "disabled";
}

export function evaluateReleaseWriteFreeze(
  request: ReleaseRequest,
  value = process.env[RELEASE_WRITE_FREEZE_ENV],
): ReleaseWriteFreezeDecision {
  if (!isReleaseWriteFreezeActive(value)) {
    return { active: false, blocked: false, reason: "inactive" };
  }

  const method = request.method.toUpperCase();
  if (method === "POST" && AUTH_SESSION_PATHS.has(request.pathname)) {
    return { active: true, blocked: false, reason: "auth-session" };
  }

  const writeOnRead = WRITE_ON_READ_PREFIXES.some((prefix) => request.pathname.startsWith(prefix));
  if (READ_METHODS.has(method) && !writeOnRead) {
    return { active: true, blocked: false, reason: "read-only" };
  }

  return { active: true, blocked: true, reason: "write-frozen" };
}

export function assertReleaseWritesAllowed(source: string, value = process.env[RELEASE_WRITE_FREEZE_ENV]): void {
  if (isReleaseWriteFreezeActive(value)) {
    throw new Error(`Release write freeze active; ${source} refused before database access`);
  }
}
