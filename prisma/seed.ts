/**
 * Демо-данные для MVP-демонстрации. Идемпотентно: если у демо-агента уже есть
 * лиды — выходим. Безопасно запускать только против ВЫДЕЛЕННОЙ td_agent БД
 * (не общей, не nox). Запуск: `npm run db:seed`.
 */
import { PrismaClient } from "@prisma/client";
import { encryptField } from "../lib/crypto";

const prisma = new PrismaClient();
const DEMO_EMAIL = "demo@tihiydom.local";
const DAY = 86_400_000;
const now = Date.now();
const at = (deltaDays: number, hour = 11) => new Date(now + deltaDays * DAY - (new Date().getHours() - hour) * 3_600_000);

async function main() {
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

  const existing = await prisma.clientLead.count({ where: { agentId: agent.id } });
  if (existing >= 10) {
    console.log(`Демо уже засеяно (${existing} дел). Пропуск.`);
    return;
  }

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
  };
  const specs: Spec[] = [
    { name: "Семён Иванов", phone: "+79123456789", ctx: "Отец, 78 лет. Бюджет до 90 000 ₽, гражданская церемония.", stage: "docs", meetingIn: 0 },
    { name: "Ирина Соколова", phone: "+79261234567", ctx: "Мать. Рассматривают кремацию, ждут расчёт.", stage: "estimate", meetingIn: 0, total: 124000 },
    { name: "Михаил Петров", phone: "+79031112233", ctx: "Дедушка. Полный пакет, зал прощания.", stage: "contract", meetingIn: 2, total: 215000 },
    { name: "Анна Кузнецова", phone: "+79154445566", ctx: "Супруг. Уточняет состав.", stage: "docs", stale: true },
    { name: "Дмитрий Орлов", phone: "+79167778899", ctx: "Брат. Кремация, минимальный пакет.", stage: "paid", total: 98000 },
    { name: "Ольга Морозова", phone: "+79052223344", ctx: "Мать. Согласовали смету, готовят оплату.", stage: "paid", meetingIn: 1, total: 176000 },
    { name: "Сергей Волков", phone: "+79188889900", ctx: "Отец. Открытый бюджет.", stage: "lead", stale: true },
    { name: "Татьяна Лебедева", phone: "+79219998877", ctx: "Бабушка. Полное сопровождение.", stage: "done", total: 254000 },
    { name: "Алексей Новиков", phone: "+79233334455", ctx: "Тесть. Погребение, зал на 60 минут.", stage: "estimate", meetingIn: 3, total: 142000 },
    { name: "Елена Зайцева", phone: "+79276665544", ctx: "Свекровь. Уточняют документы.", stage: "docs", stale: true },
    { name: "Владимир Соловьёв", phone: "+79294443322", ctx: "Отец. Кремация, урна улучшенная.", stage: "estimate", meetingIn: 0, total: 118000 },
    { name: "Наталья Павлова", phone: "+79101112200", ctx: "Мать. Договор подписан, ждём оплату.", stage: "contract", total: 198000 },
  ];

  for (const s of specs) {
    const created = await prisma.clientLead.create({
      data: {
        agentId: agent.id, name: s.name, phone: s.phone,
        context: encryptField(s.ctx) ?? s.ctx, source: "agent",
        createdAt: s.stale ? new Date(now - 9 * DAY) : new Date(now - Math.random() * 3 * DAY),
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
          scheduledAt: s.meetingIn !== undefined ? at(s.meetingIn) : null,
        },
      });
      meetingId = m.id;
    }

    const hasQuote = ["estimate", "contract", "paid", "done"].includes(s.stage);
    if (hasQuote && meetingId) {
      const quote = await prisma.quote.create({ data: { meetingId } });
      await prisma.quoteVersion.create({
        data: { quoteId: quote.id, total: (s.total ?? 120000) * 100, payload: JSON.stringify({ demo: true }) },
      });
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
  }

  const [leads, tasks, notes] = await Promise.all([
    prisma.clientLead.count({ where: { agentId: agent.id } }),
    prisma.task.count({ where: { agentId: agent.id } }),
    prisma.caseNote.count({ where: { agentId: agent.id } }),
  ]);
  console.log(`Засеяно: ${leads} дел, ${tasks} задач, ${notes} заметок. Агент: ${DEMO_EMAIL}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
