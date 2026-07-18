import { prisma } from "@/lib/prisma";
import { encryptField } from "@/lib/crypto";
import { ensureCanonicalCaseForLead, scenarioFromCeremonyType } from "@/lib/caseService";
import { CaseStage } from "@prisma/client";
import { assertReleaseWritesAllowed } from "@/lib/releaseWriteFreeze";
import { ensureLegacyOrganizationForAgent } from "@/lib/operationalAuth";

export const DEMO_PHONE = "+79990000000";
export const DEMO_CODE = "0000";
const DEMO_EMAIL = "demo@tihiydom.local";

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

/**
 * Идемпотентно создаёт демо-агента и (если их ещё нет) примеры лидов и встреч.
 * Используется ТОЛЬКО в демо-режиме (DEMO_MODE=1) — это витрина, не боевой вход.
 * Возвращает данные для подписи сессии.
 */
export async function ensureDemoAgent(): Promise<{ userId: number; agentId: number; name: string }> {
  assertReleaseWritesAllowed("demo seed");
  const tier = await prisma.agentTier.upsert({
    where: { name: "Senior" },
    update: {},
    create: { name: "Senior", commissionPct: "10.00" },
  });

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { name: "Демо Агент", phone: DEMO_PHONE },
    create: { email: DEMO_EMAIL, name: "Демо Агент", phone: DEMO_PHONE },
  });

  const agent = await prisma.agent.upsert({
    where: { userId: user.id },
    update: { status: "ACTIVE" },
    create: { userId: user.id, status: "ACTIVE", tierId: tier.id, selfEmployed: true },
  });
  const operational = await ensureLegacyOrganizationForAgent({
    agentId: agent.id,
    userId: user.id,
    agentStatus: "ACTIVE",
  });

  // Примеры данных создаём один раз — если у демо-агента ещё нет лидов.
  const existing = await prisma.clientLead.count({ where: { agentId: agent.id } });
  if (existing === 0) {
    const now = new Date();
    const today = (h: number) => {
      const d = new Date(now);
      d.setHours(h, 0, 0, 0);
      return d;
    };
    const daysAgo = (n: number) => new Date(now.getTime() - n * 864e5);

    const seed: Array<{
      name: string;
      phone: string;
      context: string;
      source: string;
      status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED";
      scheduledAt: Date;
      code: string;
    }> = [
      { name: "Ирина Соколова", phone: "+79161234567", context: "Отец, 78 лет. Бюджет до 90 000 ₽, гражданская церемония.", source: "form", status: "SCHEDULED", scheduledAt: today(14), code: "DEMO-A1" },
      { name: "Михаил Петров", phone: "+79262345678", context: "Мать. Рассматривают кремацию, ожидают расчёт.", source: "telegram", status: "IN_PROGRESS", scheduledAt: today(11), code: "DEMO-B2" },
      { name: "Анна Кузнецова", phone: "+79031112233", context: "Дедушка. Полный пакет, зал прощания на 90 минут.", source: "agent", status: "COMPLETED", scheduledAt: daysAgo(2), code: "DEMO-C3" },
      { name: "Сергей Волков", phone: "+79154445566", context: "Супруга. Уточняет состав, бюджет открытый.", source: "form", status: "SCHEDULED", scheduledAt: daysAgo(-1), code: "DEMO-D4" },
    ];

    for (const s of seed) {
      const lead = await prisma.clientLead.create({
        data: { agentId: agent.id, name: s.name, phone: s.phone, context: encryptField(s.context), source: s.source },
      });
      const canonical = await ensureCanonicalCaseForLead({
        leadId: lead.id,
        organizationId: operational.organizationId,
        agentId: agent.id,
        actorId: agent.id,
        stage: CaseStage.PLANNING,
        idempotencyKey: `demo:case-created:${lead.id}`,
        correlationId: `demo:${lead.id}`,
      });
      await prisma.meeting.create({
        data: {
          leadId: lead.id,
          agentId: agent.id,
          organizationId: operational.organizationId,
          caseId: canonical.caseId,
          ownerMembershipId: operational.membershipId,
          idempotencyKey: `demo:meeting:${lead.id}`,
          operationalStatus: s.status === "COMPLETED" ? "COMPLETED" : s.status === "IN_PROGRESS" ? "CONFIRMED" : "SCHEDULED",
          status: s.status,
          scheduledAt: s.scheduledAt,
          cobrowseCode: s.code,
        },
      });
    }
  }

  // Keep demo compatible with the canonical Week 2 Case aggregate. This is a
  // repair-only path for old demo databases; no lifecycle is inferred in UI.
  const demoLeads = await prisma.clientLead.findMany({
    where: { agentId: agent.id },
    select: {
      id: true,
      ceremonyType: true,
      meetings: { select: { id: true } },
    },
  });
  for (const lead of demoLeads) {
    await ensureCanonicalCaseForLead({
      leadId: lead.id,
      organizationId: operational.organizationId,
      agentId: agent.id,
      actorId: agent.id,
      scenarioId: scenarioFromCeremonyType(lead.ceremonyType),
      stage: lead.meetings.length > 0 ? CaseStage.PLANNING : CaseStage.INTAKE,
      idempotencyKey: `demo:case-created:${lead.id}`,
      correlationId: `demo:${lead.id}`,
    });
  }

  return { userId: user.id, agentId: agent.id, name: "Демо Агент" };
}
