/**
 * Fail-closed admission guard for the isolated UAT database.
 *
 * M1, M2 and M3 browser fixtures need to exist in one isolated database so each
 * mission can verify sibling-role and cross-tenant behavior without production data.
 * Their original guards each demanded a completely empty remote database, which made that
 * impossible. This relaxes the rule by exactly one step and no further:
 *
 *   allowed  = empty database
 *            | database containing ONLY rows in this mission's exact synthetic namespaces
 *   blocked  = everything else
 *
 * "Exact" means full-string identity — organization ids and user emails are compared
 * against the precise values a fixture generates for a given run id, never by prefix and
 * never by pattern. One unrecognised Organization, User, Membership, Case, Meeting or
 * Quote blocks the fixture. The guard is a pure function over a census gathered by the
 * caller, so it is unit-testable and cannot itself touch the database.
 */

export type UatNamespace = {
  label: string;
  organizationIds: string[];
  userEmails: string[];
};

/** Exact identifiers the M1 browser UAT fixture creates for a run. */
export function m1UatNamespace(runId: string): UatNamespace {
  return {
    label: `M1 UAT (${runId})`,
    organizationIds: [`m1-uat:${runId}`],
    userEmails: [
      `m1-agent-${runId}@synthetic.invalid`,
      `m1-assigned-${runId}@synthetic.invalid`,
      `m1-manager-${runId}@synthetic.invalid`,
    ],
  };
}

/** Exact identifiers the M2 RBAC browser UAT fixture creates for a run. */
export function m2UatNamespace(runId: string): UatNamespace {
  return {
    label: `M2 UAT (${runId})`,
    organizationIds: [`m2-uat-${runId}-a`, `m2-uat-${runId}-b`],
    userEmails: [
      `m2-platform-${runId}@synthetic.invalid`,
      `m2-activation-${runId}@synthetic.invalid`,
      `m2-admin-${runId}@synthetic.invalid`,
      `m2-manager-${runId}@synthetic.invalid`,
      `m2-agent-${runId}@synthetic.invalid`,
      `m2-second-${runId}@synthetic.invalid`,
    ],
  };
}

/** Exact identifiers the M3 fulfilment browser UAT fixture creates for a run. */
export function m3UatNamespace(runId: string): UatNamespace {
  return {
    label: `M3 UAT (${runId})`,
    organizationIds: [`m3-uat:${runId}:a`, `m3-uat:${runId}:b`],
    userEmails: [
      `m3-agent-${runId}@synthetic.invalid`,
      `m3-manager-${runId}@synthetic.invalid`,
      `m3-reviewer-${runId}@synthetic.invalid`,
      `m3-finance-a-${runId}@synthetic.invalid`,
      `m3-finance-b-${runId}@synthetic.invalid`,
      `m3-foreign-${runId}@synthetic.invalid`,
    ],
  };
}

/**
 * Every business row that exists in the target, reduced to the identifier the guard
 * recognises. Gathered by the fixture; the guard never queries.
 */
export type UatCensus = {
  organizationIds: string[];
  userEmails: string[];
  membershipOrganizationIds: string[];
  caseTenantIds: string[];
  meetingOrganizationIds: string[];
  quoteOrganizationIds: string[];
  leadOwnerEmails: string[];
  /**
   * Rows whose tenant key is null. They cannot be matched against a namespace, so they are
   * reported as foreign rather than dropped — the M2 legacy backfill can leave a quote in
   * exactly this state, and a database holding one is not empty.
   */
  orphanKeyedRows: string[];
};

export const EMPTY_CENSUS: UatCensus = {
  organizationIds: [],
  userEmails: [],
  membershipOrganizationIds: [],
  caseTenantIds: [],
  meetingOrganizationIds: [],
  quoteOrganizationIds: [],
  leadOwnerEmails: [],
  orphanKeyedRows: [],
};

/**
 * Rows that belong to no allowed namespace. Empty result means the target is admissible.
 * Reported as human-readable strings so a refusal names what it found.
 */
export function findForeignRows(census: UatCensus, allowed: UatNamespace[]): string[] {
  const organizations = new Set(allowed.flatMap((ns) => ns.organizationIds));
  const emails = new Set(allowed.flatMap((ns) => ns.userEmails));
  const foreign: string[] = [];
  const check = (label: string, values: string[], permitted: Set<string>) => {
    for (const value of values) {
      if (!permitted.has(value)) foreign.push(`${label}: ${value}`);
    }
  };
  check("Organization", census.organizationIds, organizations);
  check("User", census.userEmails, emails);
  check("Membership.organizationId", census.membershipOrganizationIds, organizations);
  check("Case.tenantId", census.caseTenantIds, organizations);
  check("Meeting.organizationId", census.meetingOrganizationIds, organizations);
  check("Quote.organizationId", census.quoteOrganizationIds, organizations);
  check("ClientLead owner", census.leadOwnerEmails, emails);
  for (const row of census.orphanKeyedRows) foreign.push(`Unkeyed row: ${row}`);
  return [...new Set(foreign)].sort();
}

/**
 * Fingerprint admission. Production is refused unconditionally and first, so a
 * misconfigured expectation can never be the thing that lets production through.
 */
export function assertIsolatedUatFingerprint(
  actual: string,
  options: { expected: string | undefined; production: string | undefined; label: string },
): void {
  if (options.production && actual === options.production) {
    throw new Error(`${options.label}: refusing to run against the production database fingerprint`);
  }
  if (!options.expected) {
    throw new Error(`${options.label}: EXPECTED_DATABASE_FINGERPRINT is required for a remote UAT target`);
  }
  if (actual !== options.expected) {
    throw new Error(`${options.label}: target fingerprint ${actual} does not match the reviewed ${options.expected}`);
  }
}

/** Throws unless the target is empty or holds only recognised sibling synthetic rows. */
export function assertOnlyRecognisedSyntheticData(
  census: UatCensus,
  allowed: UatNamespace[],
  label: string,
): void {
  const foreign = findForeignRows(census, allowed);
  if (foreign.length > 0) {
    throw new Error(
      `${label}: refusing to run — the target holds ${foreign.length} row(s) outside the mission's synthetic namespaces: `
        + `${foreign.slice(0, 5).join("; ")}${foreign.length > 5 ? "; …" : ""}`,
    );
  }
}

/**
 * Structural minimum this module needs. Deliberately not the generated PrismaClient type:
 * the guard must accept whichever client a fixture already holds, and stay unit-testable
 * with a hand-built stub.
 */
export type CensusClient = {
  organization: { findMany: (args?: unknown) => Promise<{ id: string }[]> };
  user: { findMany: (args?: unknown) => Promise<{ email: string }[]> };
  membership: { findMany: (args?: unknown) => Promise<{ organizationId: string }[]> };
  case: { findMany: (args?: unknown) => Promise<{ tenantId: string | null }[]> };
  meeting: { findMany: (args?: unknown) => Promise<{ organizationId: string | null }[]> };
  quote: { findMany: (args?: unknown) => Promise<{ organizationId: string | null }[]> };
  clientLead: { findMany: (args?: unknown) => Promise<{ agent: { user: { email: string } } | null }[]> };
};

/**
 * Read every business row's identifying value. Deliberately unfiltered: the guard must see
 * what is actually there, not what the caller expects to be there.
 */
export async function censusOfTarget(client: unknown): Promise<UatCensus> {
  const db = client as CensusClient;
  const [organizations, users, memberships, cases, meetings, quotes, leads] = await Promise.all([
    db.organization.findMany({ select: { id: true } }),
    db.user.findMany({ select: { email: true } }),
    db.membership.findMany({ select: { organizationId: true } }),
    db.case.findMany({ select: { tenantId: true } }),
    db.meeting.findMany({ select: { organizationId: true } }),
    db.quote.findMany({ select: { organizationId: true } }),
    db.clientLead.findMany({ select: { agent: { select: { user: { select: { email: true } } } } } }),
  ]);
  return {
    organizationIds: organizations.map((row: { id: string }) => row.id),
    userEmails: users.map((row: { email: string }) => row.email),
    membershipOrganizationIds: memberships.map((row: { organizationId: string }) => row.organizationId),
    caseTenantIds: cases.flatMap((row: { tenantId: string | null }) => (row.tenantId ? [row.tenantId] : [])),
    meetingOrganizationIds: meetings.flatMap((row: { organizationId: string | null }) => (row.organizationId ? [row.organizationId] : [])),
    quoteOrganizationIds: quotes.flatMap((row: { organizationId: string | null }) => (row.organizationId ? [row.organizationId] : [])),
    leadOwnerEmails: leads.flatMap((row: { agent: { user: { email: string } } | null }) => (row.agent?.user.email ? [row.agent.user.email] : [])),
    orphanKeyedRows: [
      ...cases.filter((row: { tenantId: string | null }) => !row.tenantId).map(() => "Case.tenantId is null"),
      ...meetings.filter((row: { organizationId: string | null }) => !row.organizationId).map(() => "Meeting.organizationId is null"),
      ...quotes.filter((row: { organizationId: string | null }) => !row.organizationId).map(() => "Quote.organizationId is null"),
      ...leads.filter((row: { agent: { user: { email: string } } | null }) => !row.agent).map(() => "ClientLead has no agent"),
    ],
  };
}
