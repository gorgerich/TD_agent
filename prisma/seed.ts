/**
 * Одноразовые synthetic demo-данные только для свежей изолированной БД.
 * Повторный запуск блокируется: финансовая, документная и audit-история не удаляется.
 */
import { PrismaClient } from "@prisma/client";
import { encryptField } from "../lib/crypto";
import { ensureCanonicalCaseForLead, scenarioFromCeremonyType, transitionCase } from "../lib/caseService";
import { assertReleaseWritesAllowed } from "../lib/releaseWriteFreeze";
import { ensureLegacyOrganizationForAgent } from "../lib/operationalAuth";

const prisma = new PrismaClient();
const DEMO_EMAIL = "demo@tihiydom.local";
const DAY = 86_400_000;
const now = Date.now();
const at = (deltaDays: number, hour = 11) => new Date(now + deltaDays * DAY - (new Date().getHours() - hour) * 3_600_000);

async function assertFreshDemoScope(agentId: number) {
  const [leads, documents, legacyPayments, ledgerEntries] = await Promise.all([
    prisma.clientLead.count({ where: { agentId } }),
    prisma.document.count({ where: { agentId } }),
    prisma.casePayment.count({ where: { agentId } }),
    prisma.paymentLedgerEntry.count({ where: { case: { ownerId: agentId } } }),
  ]);
  if (leads + documents + legacyPayments + ledgerEntries > 0) {
    throw new Error("Demo scope is not empty. Use a fresh isolated database; destructive re-seed is forbidden.");
  }
}

async function main() {
  assertReleaseWritesAllowed("prisma seed");
  if (process.env.DEMO_MODE !== "1") throw new Error("Prisma seed is restricted to DEMO_MODE=1");
  if (process.env.NODE_ENV === "production") throw new Error("Prisma seed is forbidden in production");
  if (process.env.PREVIEW_DB_ISOLATION !== "PASS" && process.env.ALLOW_DB_TESTS !== "1") {
    throw new Error("Prisma seed requires PREVIEW_DB_ISOLATION=PASS or an approved local test database");
  }
  const tier = await prisma.agentTier.upsert({
    where: { name: "Стандарт" },
    update: {},
    create: { name: "Стандарт", commissionPct: "10.00" },
  });

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, name: "Пётр Соколов", phone: "+79990000000" },
  });
  const agent = await prisma.agent.upsert({
    where: { userId: user.id },
    update: { status: "ACTIVE" },
    create: { userId: user.id, status: "ACTIVE", selfEmployed: true, tierId: tier.id },
  });
  const operational = await ensureLegacyOrganizationForAgent({
    agentId: agent.id,
    userId: user.id,
    agentStatus: "ACTIVE",
  });

  await assertFreshDemoScope(agent.id);

  // Клиент-плейсхолдер для заказов (Order.userId).
  const client = await prisma.user.upsert({
    where: { email: "client-demo@tihiydom.local" },
    update: {},
    create: { email: "client-demo@tihiydom.local", name: "Клиент (демо)" },
  });

  type Spec = {
    name: string; phone: string; ctx: string;
    stage: "lead" | "docs" | "estimate" | "contract" | "paid" | "done";
    meetingIn?: number; stale?: boolean; total?: number;
    deceased?: string; ceremonyType?: string;
    ceremonyInDays?: number; ceremonyPlace?: string;
    viewed?: boolean; agreed?: boolean;
  };
  // Спеки покрывают ВСЕ бакеты дашборда:
  //   critical (церемония <48ч / застой), today (встреча сегодня),
  //   awaitClient (смета отправлена/смотрит), awaitPayment (договор без оплаты),
  //   progress (оплачено / в работе).
  const specs: Spec[] = [
    // critical — церемония в ближайшие 48 ч
    { name: "Семён Иванов", phone: "+79123456789", ctx: "Отец, 78 лет. Бюджет до 90 000 ₽, гражданская церемония.", stage: "docs", meetingIn: 0, deceased: "Иванов Иван Петрович", ceremonyType: "погребение", ceremonyInDays: 1, ceremonyPlace: "Хованское кладбище" },
    // critical — застой
    { name: "Анна Кузнецова", phone: "+79154445566", ctx: "Супруг. Уточняет состав.", stage: "docs", stale: true, deceased: "Кузнецов Олег Иванович", ceremonyType: "погребение" },
    { name: "Сергей Волков", phone: "+79188889900", ctx: "Отец. Открытый бюджет.", stage: "lead", stale: true },
    // today — встреча сегодня
    { name: "Ирина Соколова", phone: "+79261234567", ctx: "Мать. Рассматривают кремацию, ждут расчёт.", stage: "estimate", meetingIn: 0, total: 124000, deceased: "Соколова Мария Ильинична", ceremonyType: "кремация" },
    { name: "Владимир Соловьёв", phone: "+79294443322", ctx: "Отец. Кремация, урна улучшенная.", stage: "estimate", meetingIn: 0, total: 118000, deceased: "Соловьёв Пётр Кузьмич", ceremonyType: "кремация" },
    // awaitClient — клиент смотрит смету
    { name: "Алексей Новиков", phone: "+79233334455", ctx: "Тесть. Погребение, зал на 60 минут.", stage: "estimate", meetingIn: 3, total: 142000, deceased: "Новиков Борис Семёнович", ceremonyType: "погребение", viewed: true },
    // awaitPayment — договор без оплаты
    { name: "Михаил Петров", phone: "+79031112233", ctx: "Дедушка. Полный пакет, зал прощания.", stage: "contract", meetingIn: 2, total: 215000, deceased: "Петров Семён Фёдорович", ceremonyType: "погребение", agreed: true },
    { name: "Наталья Павлова", phone: "+79101112200", ctx: "Мать. Договор подписан, ждём оплату.", stage: "contract", total: 198000, deceased: "Павлова Зоя Андреевна", ceremonyType: "погребение", agreed: true },
    // progress — оплачено, церемония запланирована
    { name: "Дмитрий Орлов", phone: "+79167778899", ctx: "Брат. Кремация, минимальный пакет.", stage: "paid", total: 98000, deceased: "Орлов Игорь Николаевич", ceremonyType: "кремация", ceremonyInDays: 4, ceremonyPlace: "Николо-Архангельский крематорий" },
    { name: "Ольга Морозова", phone: "+79052223344", ctx: "Мать. Согласовали смету, готовят оплату.", stage: "paid", meetingIn: 1, total: 176000, deceased: "Морозова Тамара Петровна", ceremonyType: "погребение" },
    // progress — в работе, документы
    { name: "Елена Зайцева", phone: "+79276665544", ctx: "Свекровь. Уточняют документы.", stage: "docs", deceased: "Зайцева Лидия Сергеевна", ceremonyType: "погребение" },
    // done — в архиве (не показывается в активных)
    { name: "Татьяна Лебедева", phone: "+79219998877", ctx: "Бабушка. Полное сопровождение.", stage: "done", total: 254000, deceased: "Лебедева Мария Павловна", ceremonyType: "погребение", ceremonyPlace: "Семейное захоронение" },
  ];

  for (const s of specs) {
    const created = await prisma.clientLead.create({
      data: {
        agentId: agent.id, name: s.name, phone: s.phone,
        context: encryptField(s.ctx) ?? s.ctx, source: "agent",
        deceasedName: s.deceased ? encryptField(s.deceased) : null,
        ceremonyType: s.ceremonyType ?? null,
        ceremonyAt: s.ceremonyInDays !== undefined ? at(s.ceremonyInDays, 10) : null,
        ceremonyPlace: s.ceremonyPlace ?? null,
        createdAt: s.stale ? new Date(now - 9 * DAY) : new Date(now - Math.random() * 2 * DAY),
      },
    });
    const canonical = await ensureCanonicalCaseForLead({
      leadId: created.id,
      organizationId: operational.organizationId,
      agentId: agent.id,
      actorId: agent.id,
      idempotencyKey: `seed:case-created:${created.id}`,
      correlationId: `seed:${created.id}`,
    }, prisma);

    const needMeeting = s.stage !== "lead";
    let meetingId: number | null = null;
    if (needMeeting) {
      const m = await prisma.meeting.create({
        data: {
          leadId: created.id, agentId: agent.id,
          organizationId: operational.organizationId,
          caseId: canonical.caseId,
          ownerMembershipId: operational.membershipId,
          idempotencyKey: `seed:meeting:${created.id}`,
          operationalStatus: s.meetingIn === undefined ? "TENTATIVE" : "SCHEDULED",
          status: "SCHEDULED",
          cobrowseCode: Buffer.from(crypto.getRandomValues(new Uint8Array(5))).toString("hex").toUpperCase(),
          // meetingIn:0 — встреча сегодня, но в БУДУЩЕМ (now+2ч), чтобы попасть в бакет «Сегодня».
          scheduledAt: s.meetingIn === 0 ? new Date(now + 2 * 3_600_000) : s.meetingIn !== undefined ? at(s.meetingIn) : null,
          coViewedAt: s.viewed || s.agreed ? new Date(now - 3 * 3_600_000) : null,
          coAgreedAt: s.agreed ? new Date(now - 2 * 3_600_000) : null,
        },
      });
      meetingId = m.id;
    }

    const hasQuote = ["estimate", "contract", "paid", "done"].includes(s.stage);
    let quoteVersionId: number | null = null;
    if (hasQuote && meetingId) {
      const quote = await prisma.quote.create({ data: { meetingId } });
      const version = await prisma.quoteVersion.create({
        data: { quoteId: quote.id, total: (s.total ?? 120000) * 100, payload: JSON.stringify({ demo: true }) },
      });
      quoteVersionId = version.id;
    }

    if (["contract", "paid", "done"].includes(s.stage) && meetingId) {
      await prisma.order.create({
        data: {
          publicId: `DEMO-${created.id}-${Math.random().toString(36).slice(2, 7)}`,
          userId: client.id, agentId: agent.id, meetingId,
          status: "PENDING",
          serviceType: "funeral", totalAmount: (s.total ?? 150000) * 100,
          meta: JSON.stringify({ truthStatus: "LEGACY_INCOMPLETE", synthetic: true }),
        },
      });
    }

    // Задачи (часть просроченных) + заметка
    if (["docs", "estimate"].includes(s.stage)) {
      await prisma.task.create({
        data: {
          leadId: created.id, agentId: agent.id,
          organizationId: operational.organizationId,
          caseId: canonical.caseId,
          assigneeMembershipId: operational.membershipId,
          createdByMembershipId: operational.membershipId,
          idempotencyKey: `seed:task:${created.id}`,
          type: s.stage === "docs" ? "PREPARATION" : "QUOTE_SEND",
          expectedOutcome: s.stage === "docs" ? "Документ получен" : "Смета отправлена клиенту",
          title: s.stage === "docs" ? "Получить справку о смерти" : "Отправить смету клиенту",
          dueAt: s.stale ? new Date(now - 2 * DAY) : at(1),
        },
      });
    }
    if (Math.random() > 0.5) {
      await prisma.caseNote.create({
        data: { leadId: created.id, agentId: agent.id, body: encryptField("Созвон: клиент уточняет состав.") ?? "" },
      });
    }

    const command = async (suffix: string, eventType: Parameters<typeof transitionCase>[0]["eventType"], payload?: Record<string, unknown>) =>
      transitionCase({
        leadId: created.id,
        eventType,
        payload,
        context: {
          organizationId: operational.organizationId,
          membershipId: operational.membershipId,
          agentId: agent.id,
          actorId: agent.id,
          idempotencyKey: `seed:${created.id}:${suffix}`,
          correlationId: `seed:${created.id}`,
        },
      });

    if (s.deceased) await command("intake", "intake.completed.v1");
    const scenarioId = scenarioFromCeremonyType(s.ceremonyType);
    if (s.deceased && scenarioId !== "UNSELECTED") {
      await command("scenario", "scenario.selected.v1", { scenarioId });
    }
    const shouldPublish = Boolean(quoteVersionId) && (Boolean(s.viewed) || Boolean(s.agreed) || ["contract", "paid", "done"].includes(s.stage));
    if (shouldPublish && quoteVersionId) await command("publish", "quote.published.v1", { quoteVersionId });
    if (shouldPublish && quoteVersionId && (Boolean(s.agreed) || ["contract", "paid", "done"].includes(s.stage))) {
      await command("accept", "quote.accepted.v1", { quoteVersionId });
    }
  }

  const [leads, tasks, notes] = await Promise.all([
    prisma.clientLead.count({ where: { agentId: agent.id } }),
    prisma.task.count({ where: { agentId: agent.id } }),
    prisma.caseNote.count({ where: { agentId: agent.id } }),
  ]);
  console.log(`Создано: ${leads} дел, ${tasks} задач, ${notes} заметок. Агент: ${DEMO_EMAIL}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
