type DatabaseTarget = {
  host: string;
  port: string;
  database: string;
};

function parseDatabaseTarget(value: string | undefined): DatabaseTarget | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    return {
      host: url.hostname.toLowerCase(),
      port: url.port || "5432",
      database: decodeURIComponent(url.pathname.slice(1)).toLowerCase(),
    };
  } catch {
    return null;
  }
}

export function isIsolatedTestDatabase(value: string | undefined): boolean {
  const target = parseDatabaseTarget(value);
  if (!target) return false;
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(target.host);
  return localHost && [
      "td_agent_test",
      "td_agent_m1_local_20260718",
      "td_agent_m2_test",
      "td_agent_m3_20260811_a",
      "td_agent_m3_20260811_b",
    ].includes(target.database);
}

export function isApprovedIntegrationDatabaseEnvironment(environment: {
  testDatabaseUrl: string | undefined;
  databaseUrl: string | undefined;
  directDatabaseUrl: string | undefined;
}): boolean {
  if (!isIsolatedTestDatabase(environment.testDatabaseUrl)) return false;
  const expected = parseDatabaseTarget(environment.testDatabaseUrl);
  const runtime = parseDatabaseTarget(environment.databaseUrl);
  const direct = parseDatabaseTarget(environment.directDatabaseUrl);
  if (!expected || !runtime || !direct) return false;
  return [runtime, direct].every((target) => (
    target.host === expected.host
    && target.port === expected.port
    && target.database === expected.database
  ));
}
