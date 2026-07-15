/**
 * Демо-данные для MVP-демонстрации. RE-SEED: при каждом запуске СТИРАЕТ данные
 * ТОЛЬКО демо-агента (scoped по agentId, не глобальный wipe) и пересоздаёт их со
 * свежими датами — чтобы операционные статусы и бакеты дашборда были живыми
 * (Срочное / Сегодня / Ждём клиента / Ждём оплату / В работе), а не «всё устарело».
 * Запуск: `npm run db:seed`. Трогает только демо-агента — безопасно и на общей БД.
 */
import { PrismaClient } from "@prisma/client";
import { encryptField } from "../lib/crypto";
import { SCENARIO_CLOSURE_GUARDS, isSupportedScenario } from "../lib/caseDomain";
import { ensureCanonicalCaseForLead, scenarioFromCeremonyType, transitionCase } from "../lib/caseService";
import { assertReleaseWritesAllowed } from "../lib/releaseWriteFreeze";

const prisma = new PrismaClient();
const DEMO_EMAIL = "demo@tihiydom.local";
const DAY = 86_400_000;
const now = Date.now();
const at = (deltaDays: number, hour = 11) => new Date(now + deltaDays * DAY - (new Date().getHours() - hour) * 3_600_000);

async function resetAgentData(agentId: number) {
  // Порядок учитывает FK: версии → сметы → заказы → платежи → встречи → дела.
  // Дети дела (task/note/payment/document) каскадятся при удалении лида.
  const meetings = await prisma.meeting.findMany({ where: { agentId }, select: { id: true } });
  const meetingIds = meetings.map((m) => m.id);

  await prisma.commission.deleteMany({ where: { agentId } });
  await prisma.payout.deleteMany({ where: { agentId } });
  await prisma.payment.deleteMany({ where: { OR: [{ order: { agentId } }, { meetingId: { in: meetingIds } }] } });
  await prisma.quoteVersion.deleteMany({ where: { quote: { meetingId: { in: meetingIds } } } });
  await prisma.quote.deleteMany({ where: { meetingId: { in: meetingIds } } });
  await prisma.order.deleteMany({ where: { agentId } });
  await prisma.task.deleteMany({ where: { agentId } });
  await prisma.caseNote.deleteMany({ where: { agentId } });
  await prisma.casePayment.deleteMany({ where: { agentId } });
  await prisma.document.deleteMany({ where: { agentId } });
  // AgentSession → Meeting (RESTRICT): co-browse сессии держат встречу, чистим первыми.
  await prisma.agentSession.deleteMany({ where: { meetingId: { in: meetingIds } } });
  await prisma.meeting.deleteMany({ where: { agentId } });
  await prisma.clientLead.deleteMany({ where: { agentId } });
}

async function main() {
  assertReleaseWritesAllowed("prisma seed");
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

  await resetAgentData(agent.id);

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

    const needMeeting = s.stage !== "lead";
    let meetingId: number | null = null;
    if (needMeeting) {
      const m = await prisma.meeting.create({
        data: {
          leadId: created.id, agentId: agent.id,
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

    const orderStage = { contract: "SIGNED", paid: "PAID", done: "COMPLETED" } as const;
    if (s.stage in orderStage && meetingId) {
      await prisma.order.create({
        data: {
          publicId: `DEMO-${created.id}-${Math.random().toString(36).slice(2, 7)}`,
          userId: client.id, agentId: agent.id, meetingId,
          status: orderStage[s.stage as keyof typeof orderStage],
          serviceType: "funeral", totalAmount: (s.total ?? 150000) * 100, meta: "{}",
        },
      });
    }

    // Аванс по оплаченным — оплата видна в кейсе
    if (s.stage === "paid") {
      await prisma.casePayment.create({
        data: {
          leadId: created.id, agentId: agent.id,
          amountKopecks: Math.round((s.total ?? 150000) * 100 * 0.5),
          kind: "аванс", method: "наличные",
        },
      });
    }

    // Задачи (часть просроченных) + заметка
    if (["docs", "estimate"].includes(s.stage)) {
      await prisma.task.create({
        data: {
          leadId: created.id, agentId: agent.id,
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

    const canonical = await ensureCanonicalCaseForLead({
      leadId: created.id,
      agentId: agent.id,
      actorId: agent.id,
      idempotencyKey: `seed:case-created:${created.id}`,
      correlationId: `seed:${created.id}`,
    }, prisma);
    const command = async (suffix: string, eventType: Parameters<typeof transitionCase>[0]["eventType"], payload?: Record<string, unknown>) =>
      transitionCase({
        leadId: created.id,
        eventType,
        payload,
        context: {
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
    if (["contract", "paid", "done"].includes(s.stage)) await command("contract", "contract.signed.v1");
    if (["paid", "done"].includes(s.stage)) await command("payment", "payment.requirement_satisfied.v1");
    if (s.stage === "done" && isSupportedScenario(scenarioId)) {
      const guardState = Object.fromEntries(SCENARIO_CLOSURE_GUARDS[scenarioId].map((guard) => [guard, true]));
      await prisma.case.update({ where: { id: canonical.caseId }, data: { guardState } });
      await command("close", "case.closure_requested.v1");
    }
  }

  const [leads, tasks, notes] = await Promise.all([
    prisma.clientLead.count({ where: { agentId: agent.id } }),
    prisma.task.count({ where: { agentId: agent.id } }),
    prisma.caseNote.count({ where: { agentId: agent.id } }),
  ]);
  console.log(`Пересеяно: ${leads} дел, ${tasks} задач, ${notes} заметок. Агент: ${DEMO_EMAIL}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
