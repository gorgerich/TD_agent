import { randomBytes } from "node:crypto";
import { constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync, fsyncSync, linkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PrismaClient, type MembershipRole } from "@prisma/client";
import { hashPassword, verifyPassword } from "../../lib/password";
import { inspectDirectMigrationUrl } from "../../lib/migrationTarget";
import { M3_CPO_AUDIT_ORGANIZATION_ID } from "../../lib/m3AuditMode";

const PRODUCTION_FINGERPRINT = "0257665af2dd90a4";
const LOCAL_REHEARSAL_DATABASE = "td_agent_m3_restore";
const roles = ["agent", "manager", "reviewer", "finance-a", "finance-b"] as const;
const membershipRoles: Record<(typeof roles)[number], MembershipRole> = {
  agent: "AGENT",
  manager: "MANAGER",
  reviewer: "DOCUMENT_REVIEWER",
  "finance-a": "FINANCE",
  "finance-b": "FINANCE",
};
const policySource = "SYNTHETIC_CPO_NOT_A_RITUAL_OR_LEGAL_VERDICT";
const types = [
  ["identity", "Документ, удостоверяющий личность"],
  ["death", "Документ о смерти"],
  ["cremation", "Основание для кремации"],
  ["plot", "Право на родственный участок"],
  ["relationship", "Подтверждение родства"],
] as const;
const scenarios = [
  ["CREMATION_V1", [
    ["identity-record", "identity"], ["death-record", "death"], ["cremation-authorization", "cremation"],
  ]],
  ["FAMILY_PLOT_BURIAL_V1", [
    ["identity-record", "identity"], ["death-record", "death"],
    ["plot-entitlement", "plot"], ["relationship-evidence", "relationship"],
  ]],
] as const;
const credentialsDirectory = path.join(homedir(), "Library", "Application Support", "TD Agent M3 CPO Audit");
const credentialsFile = process.env.M3_CPO_LOCAL_REHEARSAL === "YES"
  ? "/private/tmp/td-agent-m3-restore-df18/cpo-credentials.json"
  : path.join(credentialsDirectory, "credentials.json");

function readCredentials(): Record<(typeof roles)[number], string> | null {
  if (!existsSync(credentialsFile)) return null;
  const stat = lstatSync(credentialsFile);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Credential file permissions are unsafe");
  const value = JSON.parse(readFileSync(credentialsFile, "utf8")) as Record<string, unknown>;
  for (const role of roles) {
    if (typeof value[role] !== "string" || value[role].length < 48) throw new Error("Credential file is incomplete");
  }
  return value as Record<(typeof roles)[number], string>;
}

function createCredentials(): Record<(typeof roles)[number], string> {
  const value = Object.fromEntries(roles.map((role) => [role, randomBytes(48).toString("base64url")])) as Record<(typeof roles)[number], string>;
  mkdirSync(path.dirname(credentialsFile), { recursive: true, mode: 0o700 });
  if ((lstatSync(path.dirname(credentialsFile)).mode & 0o077) !== 0) throw new Error("Credential directory permissions are unsafe");
  const temporaryFile = `${credentialsFile}.${randomBytes(8).toString("hex")}.tmp`;
  const handle = openSync(temporaryFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(handle, JSON.stringify(value), "utf8");
    fsyncSync(handle);
    linkSync(temporaryFile, credentialsFile);
  } finally {
    closeSync(handle);
    unlinkSync(temporaryFile);
  }
  return value;
}

async function main() {
  if (process.env.CI || process.env.VERCEL === "1" || process.env.CONFIRM_M3_CPO_PROVISION !== "YES") {
    throw new Error("Local confirmed release operation only");
  }
  const url = process.env.DATABASE_URL_UNPOOLED;
  const target = inspectDirectMigrationUrl(url);
  const localRehearsal = process.env.M3_CPO_LOCAL_REHEARSAL === "YES";
  const parsed = new URL(url!);
  if (localRehearsal) {
    if (target.database !== LOCAL_REHEARSAL_DATABASE || parsed.hostname !== "localhost"
      || parsed.searchParams.get("host") !== "/private/tmp/td-agent-m3-restore-df18/sock") {
      throw new Error("Local rehearsal target mismatch");
    }
  } else {
    if (target.fingerprint !== PRODUCTION_FINGERPRINT) throw new Error("Production target fingerprint mismatch");
    if (parsed.hash || [...parsed.searchParams].some(([key, value]) =>
      key !== "sslmode" || !["require", "verify-ca", "verify-full"].includes(value))) {
      throw new Error("Production connection has unapproved target options");
    }
  }
  if (localRehearsal && target.fingerprint === PRODUCTION_FINGERPRINT) throw new Error("Production target refused in rehearsal mode");

  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [identity] = await db.$queryRaw<Array<{ database: string; recovery: boolean }>>`
      SELECT current_database() AS database, pg_is_in_recovery() AS recovery
    `;
    if (!identity || identity.database !== target.database || identity.recovery) throw new Error("Database identity mismatch");
    const migration = await db.$queryRaw<Array<{ complete: boolean }>>`
      SELECT EXISTS(SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260811172829_m3_fulfilment_money_trust'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS complete
    `;
    if (!migration[0]?.complete) throw new Error("M3 migration is not complete");

    const existing = await db.organization.findUnique({ where: { id: M3_CPO_AUDIT_ORGANIZATION_ID }, select: { id: true, status: true, slug: true, name: true, timezone: true } });
    const emails = roles.map((role) => `m3-cpo-${role}@synthetic.invalid`);
    if (existing) {
      if (existing.status !== "ACTIVE" || existing.slug !== "m3-cpo-audit-synthetic"
        || existing.name !== "M3 CPO аудит · синтетика" || existing.timezone !== "Europe/Moscow") {
        throw new Error("Synthetic CPO organization differs from expected fixture");
      }
      const members = await db.membership.findMany({
        where: { organizationId: M3_CPO_AUDIT_ORGANIZATION_ID },
        select: {
          role: true, status: true,
          user: { select: { id: true, email: true, passwordHash: true, platformRole: true } },
          agent: { select: { status: true } },
        },
      });
      if (members.length !== roles.length || roles.some((role) =>
        members.filter((member) => member.user.email === `m3-cpo-${role}@synthetic.invalid`
          && member.role === membershipRoles[role] && member.status === "ACTIVE"
          && member.agent?.status === "ACTIVE" && member.user.platformRole === "USER").length !== 1)) {
        throw new Error("Existing CPO organization differs from expected synthetic fixture");
      }
      const saved = readCredentials();
      if (!saved || roles.some((role) => !verifyPassword(saved[role], members.find((member) =>
        member.user.email === `m3-cpo-${role}@synthetic.invalid`)?.user.passwordHash ?? null))) {
        throw new Error("Synthetic accounts do not match local protected credentials");
      }
      const [actualTypes, policies, signing, financial] = await Promise.all([
        db.documentTypeDefinition.findMany({ where: { organizationId: M3_CPO_AUDIT_ORGANIZATION_ID } }),
        db.documentRequirementPolicy.findMany({ where: { organizationId: M3_CPO_AUDIT_ORGANIZATION_ID }, include: { rules: true } }),
        db.contractSigningPolicy.findMany({ where: { organizationId: M3_CPO_AUDIT_ORGANIZATION_ID } }),
        db.financialControlPolicy.findMany({ where: { organizationId: M3_CPO_AUDIT_ORGANIZATION_ID } }),
      ]);
      const managerId = members.find((member) => member.user.email === "m3-cpo-manager@synthetic.invalid")?.user.id;
      const typeIds = new Map(actualTypes.map((row) => [row.code, row.id]));
      const now = Date.now();
      const expectedTypes = types.map(([code, name]) => ({
        code: `m3-cpo:${code}`, name, version: 1, description: "Synthetic CPO audit only",
        allowedMimeTypes: ["application/pdf"], maxBytes: 1_048_576, status: "APPROVED", source: policySource,
      }));
      if (!isDeepStrictEqual(actualTypes.map(({ code, name, version, description, allowedMimeTypes, maxBytes, status, source }) =>
        ({ code, name, version, description, allowedMimeTypes, maxBytes, status, source })).sort((a, b) => a.code.localeCompare(b.code)),
      expectedTypes.sort((a, b) => a.code.localeCompare(b.code)))) {
        throw new Error("Synthetic CPO document types differ from expected fixture");
      }
      if (policies.length !== scenarios.length || scenarios.some(([scenario, expectedRules]) => {
        const policy = policies.find((row) => row.scenario === scenario);
        return !policy || policy.version !== 1 || policy.status !== "APPROVED" || policy.source !== policySource
          || policy.approvedByUserId !== managerId || !policy.approvedAt || !policy.effectiveFrom
          || policy.effectiveFrom.getTime() > now || policy.retiredAt !== null
          || !isDeepStrictEqual(policy.rules.map((rule) => ({
            stableKey: rule.stableKey, kind: rule.kind, conditionKey: rule.conditionKey,
            conditionExplanation: rule.conditionExplanation, dueOffsetHours: rule.dueOffsetHours,
            ownerRole: rule.ownerRole, blockingStage: rule.blockingStage,
            acceptedDocumentTypeCodes: rule.acceptedDocumentTypeCodes,
            acceptedDocumentTypeVersionIds: rule.acceptedDocumentTypeVersionIds,
            reviewChecklist: rule.reviewChecklist, source: rule.source,
          })).sort((a, b) => a.stableKey.localeCompare(b.stableKey)), expectedRules.map(([stableKey, code]) => ({
            stableKey, kind: "REQUIRED", conditionKey: null, conditionExplanation: null, dueOffsetHours: 24,
            ownerRole: "AGENT", blockingStage: "EXECUTION",
            acceptedDocumentTypeCodes: [`m3-cpo:${code}`],
            acceptedDocumentTypeVersionIds: [typeIds.get(`m3-cpo:${code}`)],
            reviewChecklist: ["readable", "identity_match"], source: policySource,
          })).sort((a, b) => a.stableKey.localeCompare(b.stableKey)));
      })) {
        throw new Error("Synthetic CPO document policies differ from expected fixture");
      }
      if (signing.length !== 1 || signing[0].version !== "SYNTHETIC-CPO-V1"
        || signing[0].status !== "APPROVED" || signing[0].source !== "SYNTHETIC_CPO_NOT_A_LEGAL_VERDICT"
        || signing[0].approvedByUserId !== managerId || !signing[0].approvedAt || !signing[0].effectiveFrom
        || signing[0].effectiveFrom.getTime() > now || signing[0].retiredAt !== null
        || !isDeepStrictEqual(signing[0].allowedEvidenceTypes, ["SYNTHETIC_CPO_ACK"])) {
        throw new Error("Synthetic CPO signing policy differs from expected fixture");
      }
      if (financial.length !== 1 || financial[0].version !== 1 || financial[0].status !== "APPROVED"
        || financial[0].source !== "SYNTHETIC_CPO_NOT_A_FINANCE_VERDICT"
        || financial[0].correctionThresholdKopecks !== 1 || !financial[0].approvedAt) {
        throw new Error("Synthetic CPO finance policy differs from expected fixture");
      }
      process.stdout.write(JSON.stringify({ status: "REPLAY", organizationId: M3_CPO_AUDIT_ORGANIZATION_ID, users: members.length, credentialFile: credentialsFile }) + "\n");
      return;
    }
    if (await db.user.count({ where: { email: { in: emails } } })) throw new Error("Synthetic email collision");
    const tier = await db.agentTier.findFirst({ select: { id: true }, orderBy: { id: "asc" } });
    if (!tier) throw new Error("AgentTier missing");
    const passwords = readCredentials() ?? createCredentials();
    const hashes = await Promise.all(roles.map((role) => hashPassword(passwords[role])));
    await db.$transaction(async (tx) => {
      await tx.organization.create({ data: {
        id: M3_CPO_AUDIT_ORGANIZATION_ID, slug: "m3-cpo-audit-synthetic", name: "M3 CPO аудит · синтетика", status: "ACTIVE",
      } });
      let managerUserId = 0;
      for (const [index, role] of roles.entries()) {
        const user = await tx.user.create({ data: { email: emails[index], name: `M3 CPO ${role}`, passwordHash: hashes[index] } });
        const agent = await tx.agent.create({ data: {
          userId: user.id, tierId: tier.id, status: "ACTIVE", selfEmployed: false, onboardingCompleted: true, notifyEnabled: false,
        } });
        await tx.membership.create({ data: {
          id: `m3-cpo:${role}`, organizationId: M3_CPO_AUDIT_ORGANIZATION_ID,
          userId: user.id, agentId: agent.id, role: membershipRoles[role], status: "ACTIVE",
        } });
        if (role === "manager") managerUserId = user.id;
      }
      const typeIds = new Map<string, string>();
      for (const [code, name] of types) {
        const row = await tx.documentTypeDefinition.create({ data: {
          organizationId: M3_CPO_AUDIT_ORGANIZATION_ID, code: `m3-cpo:${code}`, version: 1, name,
          description: "Synthetic CPO audit only", allowedMimeTypes: ["application/pdf"], maxBytes: 1_048_576,
          status: "APPROVED", source: policySource,
        }, select: { id: true } });
        typeIds.set(code, row.id);
      }
      for (const [scenario, rules] of scenarios) {
        await tx.documentRequirementPolicy.create({ data: {
          organizationId: M3_CPO_AUDIT_ORGANIZATION_ID, scenario, version: 1, status: "APPROVED",
          source: policySource, approvedByUserId: managerUserId,
          approvedAt: new Date(), effectiveFrom: new Date(Date.now() - 60_000),
          rules: { create: rules.map(([stableKey, code]) => ({
            stableKey, kind: "REQUIRED", dueOffsetHours: 24,
            ownerRole: "AGENT", blockingStage: "EXECUTION", acceptedDocumentTypeCodes: [`m3-cpo:${code}`],
            acceptedDocumentTypeVersionIds: [typeIds.get(code)!], reviewChecklist: ["readable", "identity_match"],
            source: policySource,
          })) },
        } });
      }
      await tx.contractSigningPolicy.create({ data: {
        organizationId: M3_CPO_AUDIT_ORGANIZATION_ID, version: "SYNTHETIC-CPO-V1", status: "APPROVED",
        allowedEvidenceTypes: ["SYNTHETIC_CPO_ACK"], source: "SYNTHETIC_CPO_NOT_A_LEGAL_VERDICT",
        approvedByUserId: managerUserId, approvedAt: new Date(), effectiveFrom: new Date(Date.now() - 60_000),
      } });
      await tx.financialControlPolicy.create({ data: {
        organizationId: M3_CPO_AUDIT_ORGANIZATION_ID, version: 1, status: "APPROVED",
        correctionThresholdKopecks: 1, source: "SYNTHETIC_CPO_NOT_A_FINANCE_VERDICT", approvedAt: new Date(),
      } });
    }, { maxWait: 10_000, timeout: 60_000 });
    process.stdout.write(JSON.stringify({ status: "READY", organizationId: M3_CPO_AUDIT_ORGANIZATION_ID, users: roles.length, credentialFile: credentialsFile }) + "\n");
  } finally {
    await db.$disconnect();
  }
}

void main().catch(() => {
  process.stderr.write("M3 CPO provisioning refused or failed; no secrets printed.\n");
  process.exitCode = 1;
});
