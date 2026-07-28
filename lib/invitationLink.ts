export function buildInvitationUrl(origin: string, rawToken: string): string {
  const token = rawToken.trim();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error("Invalid invitation token");
  const url = new URL("/agent/login", origin);
  url.hash = new URLSearchParams({ invite: token }).toString();
  return url.toString();
}
