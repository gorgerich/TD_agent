export function isIsolatedTestDatabase(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const database = url.pathname.slice(1).toLowerCase();
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    return localHost && ["td_agent_test", "td_agent_m1_local_20260718", "td_agent_m2_test"].includes(database);
  } catch {
    return false;
  }
}
