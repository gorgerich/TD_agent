import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_CENSUS,
  assertIsolatedUatFingerprint,
  assertOnlyRecognisedSyntheticData,
  censusOfTarget,
  findForeignRows,
  m1UatNamespace,
  m2UatNamespace,
  type UatCensus,
} from "./e2e/uatFixtureGuard";

const PRODUCTION = "0257665af2dd90a4";
const ISOLATED = "c89bdda845806b40";
const M1_RUN = "m2uat-0d7204e";
const M2_RUN = "m2uat-0d7204e";

const m1 = m1UatNamespace(M1_RUN);
const m2 = m2UatNamespace(M2_RUN);

/** Census of a database holding exactly one fixture's synthetic rows. */
function censusOf(namespaces: Array<ReturnType<typeof m1UatNamespace>>): UatCensus {
  const organizationIds = namespaces.flatMap((ns) => ns.organizationIds);
  const userEmails = namespaces.flatMap((ns) => ns.userEmails);
  return {
    organizationIds,
    userEmails,
    membershipOrganizationIds: organizationIds,
    caseTenantIds: organizationIds,
    meetingOrganizationIds: organizationIds,
    quoteOrganizationIds: organizationIds,
    leadOwnerEmails: userEmails,
  };
}

test("an empty isolated database is admissible", () => {
  assert.deepEqual(findForeignRows(EMPTY_CENSUS, [m1]), []);
  assert.doesNotThrow(() => assertOnlyRecognisedSyntheticData(EMPTY_CENSUS, [m1], "M1 UAT"));
  assert.doesNotThrow(() => assertOnlyRecognisedSyntheticData(EMPTY_CENSUS, [m2], "M2 UAT"));
});

test("a database holding only the M1 fixture admits the M2 fixture", () => {
  assert.doesNotThrow(() => assertOnlyRecognisedSyntheticData(censusOf([m1]), [m2, m1], "M2 UAT"));
});

test("a database holding only the M2 fixture admits the M1 fixture", () => {
  assert.doesNotThrow(() => assertOnlyRecognisedSyntheticData(censusOf([m2]), [m1, m2], "M1 UAT"));
});

test("re-running a fixture over its own rows is idempotent, not a refusal", () => {
  const both = censusOf([m1, m2]);
  assert.doesNotThrow(() => assertOnlyRecognisedSyntheticData(both, [m1, m2], "M1 UAT"));
  assert.doesNotThrow(() => assertOnlyRecognisedSyntheticData(both, [m2, m1], "M2 UAT"));
});

test("a single unknown business row blocks the fixture", () => {
  for (const [field, value] of [
    ["organizationIds", "real-customer-org"],
    ["userEmails", "director@realfuneralhome.ru"],
    ["membershipOrganizationIds", "real-customer-org"],
    ["caseTenantIds", "real-customer-org"],
    ["meetingOrganizationIds", "real-customer-org"],
    ["quoteOrganizationIds", "real-customer-org"],
    ["leadOwnerEmails", "director@realfuneralhome.ru"],
  ] as const) {
    const census: UatCensus = { ...EMPTY_CENSUS, [field]: [value] };
    assert.throws(
      () => assertOnlyRecognisedSyntheticData(census, [m1, m2], "M1 UAT"),
      /refusing to run/,
      `${field} carrying an unknown value must block`,
    );
  }
});

test("synthetic rows mixed with one unknown row still block", () => {
  const mixed: UatCensus = { ...censusOf([m1, m2]), organizationIds: [...m1.organizationIds, "real-customer-org"] };
  assert.throws(() => assertOnlyRecognisedSyntheticData(mixed, [m1, m2], "M2 UAT"), /real-customer-org/);
});

test("a foreign run id is not the same namespace, even with the right shape", () => {
  const otherRun = censusOf([m1UatNamespace("someone-elses-run")]);
  assert.throws(() => assertOnlyRecognisedSyntheticData(otherRun, [m1, m2], "M1 UAT"), /refusing to run/);
});

test("the production fingerprint is refused unconditionally", () => {
  assert.throws(
    () => assertIsolatedUatFingerprint(PRODUCTION, { expected: PRODUCTION, production: PRODUCTION, label: "M1 UAT" }),
    /production database fingerprint/,
    "production must be refused even when it is also the expected value",
  );
});

test("a fingerprint that is not the reviewed UAT target is refused", () => {
  assert.throws(
    () => assertIsolatedUatFingerprint("deadbeefdeadbeef", { expected: ISOLATED, production: PRODUCTION, label: "M2 UAT" }),
    /does not match the reviewed/,
  );
  assert.throws(
    () => assertIsolatedUatFingerprint(ISOLATED, { expected: undefined, production: PRODUCTION, label: "M2 UAT" }),
    /EXPECTED_DATABASE_FINGERPRINT is required/,
    "a missing expectation must fail closed, not default to allowed",
  );
  assert.doesNotThrow(
    () => assertIsolatedUatFingerprint(ISOLATED, { expected: ISOLATED, production: PRODUCTION, label: "M2 UAT" }),
  );
});

test("the census reads every business table unfiltered", async () => {
  const seen: string[] = [];
  const rows = <T,>(model: string, value: T[]) => ({
    findMany: async () => {
      seen.push(model);
      return value;
    },
  });
  const census = await censusOfTarget({
    organization: rows("organization", [{ id: "m1-uat:run" }]),
    user: rows("user", [{ email: "a@synthetic.invalid" }]),
    membership: rows("membership", [{ organizationId: "m1-uat:run" }]),
    case: rows("case", [{ tenantId: null }, { tenantId: "m1-uat:run" }]),
    meeting: rows("meeting", [{ organizationId: null }]),
    quote: rows("quote", [{ organizationId: "m1-uat:run" }]),
    clientLead: rows("clientLead", [{ agent: { user: { email: "a@synthetic.invalid" } } }, { agent: null }]),
  });
  assert.deepEqual(seen.sort(), ["case", "clientLead", "meeting", "membership", "organization", "quote", "user"]);
  assert.deepEqual(census.caseTenantIds, ["m1-uat:run"], "null tenants are dropped, not counted as foreign");
  assert.deepEqual(census.meetingOrganizationIds, []);
  assert.deepEqual(census.leadOwnerEmails, ["a@synthetic.invalid"]);
});
