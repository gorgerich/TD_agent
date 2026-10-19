import type { DocumentRequirementRule, Prisma } from "@prisma/client";

type Policy = { id: string; version: number; scenario: string; source: string; rules: DocumentRequirementRule[] };
export type CpoSeedInput = {
  runId: string; organizationA: string; organizationB: string;
  candidateMembershipId: string; agentMembershipId: string;
  ownerEmail: string; passwordHash: string; encryptedMfa: string; encryptedDeceasedName: string;
  cases: { safe: string; published: string };
};

// Test-only fixture: keep all admission checks and dependent writes in one unchanged deadline.
export async function seedCpoScenarios(tx: Prisma.TransactionClient, input: CpoSeedInput,
  measured: <T>(label: string, operation: () => Promise<T>) => Promise<T> = (_label, operation) => operation()) {
  const { organizationA, organizationB, runId } = input;
  const [proof] = await measured("preflight", () => tx.$queryRaw<Array<{
    candidateValid: boolean; agent: { id: string; agentId: number } | null; absent: boolean; policies: Policy[];
  }>>`
    SELECT EXISTS (
      SELECT 1 FROM "Membership" m JOIN "User" u ON u.id=m."userId"
      JOIN "Agent" a ON a.id=m."agentId" AND a."userId"=u.id
      JOIN "Organization" o ON o.id=m."organizationId"
      WHERE m.id=${input.candidateMembershipId} AND m."organizationId"=${organizationB}
        AND m.role='AGENT' AND m.status='ACTIVE' AND a.status='ACTIVE' AND o.status='ACTIVE'
        AND u.email=${`m3-foreign-${runId}@synthetic.invalid`} AND u."platformRole"='USER'
    ) AS "candidateValid",
    (SELECT jsonb_build_object('id',m.id,'agentId',a.id)
      FROM "Membership" m JOIN "User" u ON u.id=m."userId"
      JOIN "Agent" a ON a.id=m."agentId" AND a."userId"=u.id
      WHERE m.id=${input.agentMembershipId} AND m."organizationId"=${organizationA}
        AND m.role='AGENT' AND m.status='ACTIVE' AND a.status='ACTIVE'
        AND u.email=${`m3-agent-${runId}@synthetic.invalid`}) AS agent,
    NOT (EXISTS (SELECT 1 FROM "Membership" WHERE "organizationId"=${organizationB} AND role='ADMIN')
      OR EXISTS (SELECT 1 FROM "OrganizationInvite" WHERE "organizationId"=${organizationB} AND role='ADMIN'
        AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt">CURRENT_TIMESTAMP)
      OR EXISTS (SELECT 1 FROM "PlatformAuditEvent" WHERE action='ORGANIZATION_FIRST_ADMIN_ASSIGNED' AND "targetId"=${organizationB})
      OR EXISTS (SELECT 1 FROM "User" WHERE email=${input.ownerEmail})
      OR EXISTS (SELECT 1 FROM "Case" WHERE id IN (${input.cases.safe},${input.cases.published}))) AS absent,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'scenario',p.scenario,'source',p.source,
      'rules',(SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM "DocumentRequirementRule" r WHERE r."policyId"=p.id)))
      FROM "DocumentRequirementPolicy" p WHERE p."organizationId"=${organizationA}
        AND p.status='APPROVED' AND p."retiredAt" IS NULL),'[]'::jsonb) AS policies
  `);
  if (!proof?.candidateValid) throw new Error("Exact untouched M3 foreign AGENT required");
  if (!proof.absent) throw new Error("Fixture already present or consumed; refusing reset/overwrite; use a fresh M3 run");
  if (!proof.agent) throw new Error("Exact active M3 owner required");
  const agent = proof.agent;
  const policy = proof.policies.find(row => row.scenario === "CREMATION_V1");
  if (!policy || policy.rules.length !== 3 || !proof.policies.some(row => row.scenario === "FAMILY_PLOT_BURIAL_V1" && row.rules.length === 4)
    || proof.policies.length !== 2 || proof.policies.some(row => !row.source.startsWith("SYNTHETIC"))) throw new Error("Exact synthetic M3 policies required");
  await measured("owner", () => tx.user.create({ data: { email: input.ownerEmail, name: "CPO synthetic platform owner",
    passwordHash: input.passwordHash, platformRole: "SUPER_ADMIN", platformMfaSecretEncrypted: input.encryptedMfa, platformMfaEnabledAt: new Date() } }));
  const keys = ["safe", "published"] as const;
  const names = new Map(keys.map(key => [key, `CPO ${key} ${runId}`]));
  const leads = await measured("leads", () => tx.clientLead.createManyAndReturn({ data: keys.map(key => ({
    agentId: agent.agentId, name: names.get(key)!, phone: "+70000000000", source: "synthetic-cpo-repair",
    ceremonyType: "кремация", deceasedName: input.encryptedDeceasedName,
  })) }));
  if (leads.length !== 2 || keys.some(key => leads.filter(row => row.name === names.get(key) && row.agentId === agent.agentId).length !== 1)) throw new Error("CPO lead batch mismatch");
  const leadByKey = new Map(keys.map(key => [key, leads.find(row => row.name === names.get(key))!]));
  const cases = await measured("cases", () => tx.case.createManyAndReturn({ data: keys.map(key => ({
    id: input.cases[key], publicRef: `CPO-${runId}-${key}`, tenantId: organizationA,
    ownerId: agent.agentId, leadId: leadByKey.get(key)!.id, stage: "QUOTING", scenarioId: "CREMATION_V1",
  })) }));
  if (cases.length !== 2 || keys.some(key => !cases.some(row => row.id === input.cases[key] && row.leadId === leadByKey.get(key)!.id
    && row.tenantId === organizationA && row.ownerId === agent.agentId && row.scenarioId === "CREMATION_V1"))) throw new Error("CPO case batch mismatch");
  const requirements = await measured("requirements", () => tx.caseDocumentRequirement.createMany({ data: cases.flatMap(record => policy.rules.map(rule => ({
    organizationId: organizationA, caseId: record.id, policyId: policy.id, ruleId: rule.id, policyVersion: policy.version,
    stableKey: rule.stableKey, kind: rule.kind, conditionExplanation: rule.conditionExplanation,
    dueAt: rule.dueOffsetHours == null ? null : new Date(Date.now() + rule.dueOffsetHours * 3_600_000),
    ownerRole: rule.ownerRole, blockingStage: rule.blockingStage, sourceRule: rule.source,
    acceptedDocumentTypeCodes: rule.acceptedDocumentTypeCodes as Prisma.InputJsonValue,
    acceptedDocumentTypeVersionIds: rule.acceptedDocumentTypeVersionIds as Prisma.InputJsonValue,
    reviewChecklist: rule.reviewChecklist as Prisma.InputJsonValue, satisfactionStatus: "NOT_SATISFIED",
  }))) }));
  if (requirements.count !== 6) throw new Error("CPO requirement batch mismatch");
  const meeting = await measured("meeting", () => tx.meeting.create({ data: {
    leadId: leadByKey.get("published")!.id, agentId: agent.agentId, organizationId: organizationA, caseId: input.cases.published,
    ownerMembershipId: agent.id, status: "SCHEDULED", type: "CONSULTATION", operationalStatus: "CONFIRMED", channel: "IN_PERSON",
    timezone: "Europe/Moscow", scheduledAt: new Date(Date.now() + 86_400_000), idempotencyKey: `cpo:${runId}:published:meeting`,
  } }));
  if (!meeting.id) throw new Error("Synthetic meeting creation failed");
}
