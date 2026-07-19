"use client";

import { Link } from "next-view-transitions";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowClockwise,
  ArrowRight,
  CalendarBlank,
  CheckCircle,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { buttonClasses } from "@/components/ui/Button";
import type { ControlTowerCase, ControlTowerMember, ControlTowerTask, TeamControlTower } from "@/lib/operationsReadModel";
import { SavedViews } from "./SavedViews";

type CaseFilter = "ATTENTION" | "UNASSIGNED" | "ALL";

const FILTERS: Array<{ id: CaseFilter; label: string }> = [
  { id: "ATTENTION", label: "Требуют внимания" },
  { id: "UNASSIGNED", label: "Без исполнителя" },
  { id: "ALL", label: "Все кейсы" },
];

export function OperationsClient({
  tower,
  error,
  permissionDenied,
  canAssign,
}: {
  tower: TeamControlTower | null;
  error: string | null;
  permissionDenied: boolean;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [filter, setFilter] = useState<CaseFilter>("ATTENTION");
  const [assignmentOverrides, setAssignmentOverrides] = useState<Record<number, { assigneeMembershipId: string | null; ownerName: string; version: number }>>({});
  const [assignmentNotice, setAssignmentNotice] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const visibleCases = useMemo(() => {
    if (!tower) return [];
    if (filter === "UNASSIGNED") return tower.cases.filter((item) => item.unassigned > 0);
    if (filter === "ATTENTION") return tower.cases.filter((item) => item.risk !== "NORMAL");
    return tower.cases;
  }, [filter, tower]);
  const attentionTasks = useMemo(
    () => (tower?.tasks ?? []).map((task) => ({ ...task, ...assignmentOverrides[task.id] })),
    [assignmentOverrides, tower],
  );

  if (permissionDenied) {
    return (
      <PageState
        icon={<UsersThree size={28} weight="fill" />}
        eyebrow="Доступ команды"
        title="Раздел доступен руководителю"
        description="Ваша роль видит собственный рабочий день. Загрузка команды, неназначенные задачи и SLA доступны менеджеру или администратору."
        action={{ label: "Открыть мой день", href: "/agent/tasks" }}
      />
    );
  }

  if (!tower) {
    return (
      <PageState
        icon={<WarningCircle size={28} weight="fill" />}
        eyebrow={online ? "Ошибка загрузки" : "Офлайн"}
        title={online ? "Командный обзор недоступен" : "Нет подключения к сети"}
        description={online ? (error ?? "Повторите запрос.") : "Данные не подменены пустым списком. Верните соединение и повторите загрузку."}
        retry={() => router.refresh()}
      />
    );
  }

  return (
    <div className="td-page mx-auto w-full max-w-[1280px] overflow-x-hidden px-4 py-5 sm:px-7 sm:py-8">
      <header className="td-page-header mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-accent">Управление операциями</p>
          <h1 className="td-display mt-1 text-[30px] leading-tight text-ink sm:text-[38px]">Команда</h1>
          <p className="mt-2 max-w-[66ch] text-[13px] leading-relaxed text-ink-2">
            Нагрузка, неназначенная работа и кейсы с риском срока в одном операционном срезе.
          </p>
        </div>
        <p className="text-[12px] text-ink-3">Часовой пояс: <span className="font-medium text-ink-2">{tower.timezone}</span></p>
      </header>

      {!online && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-[14px] bg-warning-soft px-4 py-3 text-[13px] text-ink-2">
          <WarningCircle size={18} weight="fill" className="mt-0.5 flex-none text-warning" />
          <span>Показан последний загруженный срез. Для актуальных данных восстановите соединение и обновите страницу.</span>
        </div>
      )}

      <section aria-label="Сводка команды" className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] bg-line shadow-[var(--shadow-soft),var(--hl-top)] lg:grid-cols-4">
        <Metric label="Открыто" value={tower.totals.open} hint="задач в работе" />
        <Metric label="Просрочено" value={tower.totals.overdue} hint="нарушен срок" critical={tower.totals.overdue > 0} />
        <Metric label="Без исполнителя" value={tower.totals.unassigned} hint="нужно назначить" critical={tower.totals.unassigned > 0} />
        <Metric label="Церемонии ≤ 72 ч" value={tower.totals.ceremoniesSoon} hint="контроль SLA" />
      </section>

      <div className="mt-5">
        <SavedViews
          screen="team"
          scope="TEAM"
          query={{ filter }}
          onApply={(savedQuery) => {
            const savedFilter = savedQuery.filter;
            if (FILTERS.some((item) => item.id === savedFilter)) setFilter(savedFilter as CaseFilter);
          }}
        />
      </div>

      <section className="mt-5 min-w-0 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-soft),var(--hl-top)]">
        <header className="flex flex-wrap items-end justify-between gap-3 bg-surface-2/60 px-4 py-3.5 sm:px-5">
          <div>
            <h2 className="text-[14px] font-semibold text-ink">Распределение задач</h2>
            <p className="mt-0.5 text-[11px] text-ink-3">Неназначенные и срочные задачи команды</p>
          </div>
          <div className="text-right">
            <span className="tnum block text-[13px] font-semibold text-ink">{attentionTasks.length}</span>
            {!canAssign && <span className="text-[11px] text-ink-3">Только просмотр</span>}
          </div>
        </header>
        {assignmentNotice && (
          <p role="status" className="flex items-start gap-2 border-b border-line bg-success-soft px-4 py-3 text-[12px] text-success sm:px-5">
            <CheckCircle size={16} weight="fill" className="mt-0.5 flex-none" /> {assignmentNotice}
          </p>
        )}
        {attentionTasks.length === 0 ? (
          <CompactEmpty title="Распределение в порядке" description="Срочных и неназначенных задач сейчас нет." />
        ) : (
          <ul className="divide-y divide-line">
            {attentionTasks.map((task) => (
              <AssignmentRow
                key={task.id}
                task={task}
                members={tower.members}
                timezone={tower.timezone}
                canAssign={canAssign}
                onAssigned={(assigneeMembershipId, ownerName, version) => {
                  setAssignmentOverrides((current) => ({ ...current, [task.id]: { assigneeMembershipId, ownerName, version } }));
                  setAssignmentNotice(`Исполнитель задачи «${task.title}» обновлён.`);
                  router.refresh();
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[minmax(300px,0.76fr)_minmax(0,1.24fr)]">
        <section className="min-w-0 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-soft),var(--hl-top)]">
          <header className="flex items-center justify-between gap-3 bg-surface-2/60 px-4 py-3.5 sm:px-5">
            <div>
              <h2 className="text-[14px] font-semibold text-ink">Загрузка команды</h2>
              <p className="mt-0.5 text-[11px] text-ink-3">Открытая работа и встречи</p>
            </div>
            <span className="tnum text-[12px] font-semibold text-ink-3">{tower.members.length}</span>
          </header>
          {tower.members.length === 0 ? (
            <CompactEmpty title="Нет активных участников" description="Добавьте активное членство, чтобы распределять работу внутри организации." />
          ) : (
            <ul className="divide-y divide-line">
              {tower.members.map((member) => <MemberRow key={member.membershipId} member={member} />)}
            </ul>
          )}
        </section>

        <section className="min-w-0 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-soft),var(--hl-top)]">
          <header className="bg-surface-2/60 px-4 py-3.5 sm:px-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-semibold text-ink">Контроль SLA</h2>
                <p className="mt-0.5 text-[11px] text-ink-3">Риски по срокам и назначению</p>
              </div>
              <span className="tnum text-[12px] font-semibold text-ink-3">{visibleCases.length} из {tower.cases.length}</span>
            </div>
            <div className="mt-3 flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1" role="tablist" aria-label="Фильтр кейсов">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={`min-h-9 flex-none rounded-full px-3 text-[11px] font-semibold transition-colors ${filter === item.id ? "bg-accent text-on-accent" : "text-ink-3 hover:bg-surface-2 hover:text-ink"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </header>

          {visibleCases.length === 0 ? (
            <CompactEmpty
              title={filter === "ALL" ? "Активных кейсов нет" : "В этой группе рисков нет"}
              description={filter === "UNASSIGNED" ? "Все открытые задачи назначены исполнителям." : "Текущий срез не содержит кейсов, требующих вмешательства."}
            />
          ) : (
            <ul className="divide-y divide-line">
              {visibleCases.map((item) => <CaseRiskRow key={item.caseId} item={item} timezone={tower.timezone} />)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function AssignmentRow({
  task,
  members,
  timezone,
  canAssign,
  onAssigned,
}: {
  task: ControlTowerTask;
  members: ControlTowerMember[];
  timezone: string;
  canAssign: boolean;
  onAssigned: (assigneeMembershipId: string | null, ownerName: string, version: number) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [assigneeId, setAssigneeId] = useState(task.assigneeMembershipId ?? "");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (!reason.trim()) {
      setError("Укажите причину назначения или переназначения.");
      return;
    }
    if (!navigator.onLine) {
      setError("Нет связи. Назначение не сохранено.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const commandId = crypto.randomUUID();
      const response = await fetch(`/api/agent/cases/${task.leadId}/tasks/${task.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": commandId,
          "X-Correlation-Id": commandId,
        },
        body: JSON.stringify({
          action: "assign",
          assigneeMembershipId: assigneeId || null,
          reason: reason.trim(),
          version: task.version,
        }),
      });
      const payload = await response.json().catch(() => null) as { task?: { version: number }; error?: string } | null;
      if (!response.ok || !payload?.task) {
        if (response.status === 409) {
          setError("Задача уже изменена другим пользователем. Обновите данные перед повтором.");
        } else if (response.status === 403) {
          setError("У вашей роли нет права распределять задачи.");
        } else {
          setError(payload?.error ?? "Назначение не сохранено.");
        }
        return;
      }
      const member = members.find((item) => item.membershipId === assigneeId);
      onAssigned(assigneeId || null, member?.name ?? "Не назначено", payload.task.version);
      setEditing(false);
      setReason("");
    } catch {
      setError("Связь прервалась. Назначение не сохранено.");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="td-entity-row min-w-0 px-4 py-4 sm:px-5">
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.55fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[13px] font-semibold text-ink">{task.title}</h3>
            {!task.assigneeMembershipId && <span className="text-[11px] font-semibold text-danger">Не назначено</span>}
          </div>
          <p className="mt-1 text-[12px] text-ink-2">{task.clientName}</p>
          <p className="mt-2 text-[11px] text-ink-3">
            Срок: <span className="font-medium text-ink-2">{task.dueAt ? dateTimeLabel(task.dueAt, timezone) : "не задан"}</span>
            <span aria-hidden className="px-1.5">·</span>
            Приоритет: <span className="font-medium text-ink-2">{priorityLabel(task.priority)}</span>
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-ink-3">Исполнитель</p>
          <p className={`mt-1 truncate text-[12px] font-semibold ${task.assigneeMembershipId ? "text-ink" : "text-danger"}`}>{task.ownerName}</p>
          {task.expectedOutcome && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-3">Результат: {task.expectedOutcome}</p>}
        </div>
        {canAssign && (
          <button type="button" onClick={() => { setEditing((current) => !current); setError(null); }} className={buttonClasses({ variant: "ghost", size: "sm", className: "w-fit" })} aria-expanded={editing}>
            {task.assigneeMembershipId ? "Переназначить" : "Назначить"}
          </button>
        )}
      </div>

      {editing && canAssign && (
        <form
          className="mt-4 grid min-w-0 gap-3 rounded-[14px] bg-surface-2 p-3.5 lg:grid-cols-[minmax(180px,0.7fr)_minmax(0,1fr)_auto] lg:items-end"
          onSubmit={(event) => { event.preventDefault(); void assign(); }}
          onKeyDown={(event) => { if (event.key === "Escape" && !pending) setEditing(false); }}
        >
          <label className="min-w-0">
            <span className="td-field-label">Исполнитель</span>
            <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="td-field" disabled={pending}>
              <option value="">Не назначено</option>
              {members.map((member) => <option key={member.membershipId} value={member.membershipId}>{member.name}</option>)}
            </select>
          </label>
          <label className="min-w-0">
            <span className="td-field-label">Причина изменения</span>
            <input value={reason} onChange={(event) => setReason(event.target.value)} className="td-field" placeholder="Например, перераспределение нагрузки" maxLength={1000} disabled={pending} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={buttonClasses({ size: "sm" })}>{pending ? "Сохраняю…" : "Сохранить"}</button>
            <button type="button" onClick={() => setEditing(false)} disabled={pending} className={buttonClasses({ variant: "ghost", size: "sm" })}>Отмена</button>
          </div>
          {error && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-[12px] text-danger lg:col-span-3">
              <WarningCircle size={15} weight="fill" />
              <span>{error}</span>
              {error.includes("другим пользователем") && (
                <button type="button" onClick={() => router.refresh()} className="font-semibold text-ink underline decoration-line-strong underline-offset-4">Обновить</button>
              )}
            </div>
          )}
        </form>
      )}
    </li>
  );
}

function Metric({ label, value, hint, critical = false }: { label: string; value: number; hint: string; critical?: boolean }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-4 sm:px-5">
      <p className="text-[11px] font-medium text-ink-3">{label}</p>
      <p className={`tnum mt-2 text-[27px] font-semibold leading-none ${critical ? "text-danger" : "text-ink"}`}>{value}</p>
      <p className="mt-1.5 text-[11px] text-ink-3">{hint}</p>
    </div>
  );
}

function MemberRow({ member }: { member: ControlTowerMember }) {
  const loadPercent = Math.min(100, Math.round((member.open / 12) * 100));
  const capacity = member.capacity === "OVERLOADED"
    ? { label: "Перегрузка", className: "text-danger" }
    : member.capacity === "BALANCED"
      ? { label: "Плотная загрузка", className: "text-warning" }
      : { label: "Есть ресурс", className: "text-success" };

  return (
    <li className="td-entity-row min-w-0 px-4 py-4 sm:px-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink">{member.name}</p>
          <p className="mt-1 text-[11px] text-ink-3">{roleLabel(member.role)}</p>
        </div>
        <span className={`flex-none text-[11px] font-semibold ${capacity.className}`}>{capacity.label}</span>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label="Загрузка исполнителя"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={loadPercent}
      >
        <div className={`h-full rounded-full ${member.capacity === "OVERLOADED" ? "bg-danger" : member.capacity === "BALANCED" ? "bg-warning" : "bg-success"}`} style={{ width: `${loadPercent}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-ink-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
        <Count label="Открыто" value={member.open} />
        <Count label="Сегодня" value={member.today} />
        <Count label="Просрочено" value={member.overdue} danger={member.overdue > 0} />
        <Count label="Встречи" value={member.meetings} />
      </dl>
    </li>
  );
}

function Count({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <div><dt>{label}</dt><dd className={`tnum mt-0.5 font-semibold ${danger ? "text-danger" : "text-ink-2"}`}>{value}</dd></div>;
}

function CaseRiskRow({ item, timezone }: { item: ControlTowerCase; timezone: string }) {
  const risk = item.risk === "CRITICAL"
    ? { label: "SLA под угрозой", className: "text-danger" }
    : item.risk === "ATTENTION"
      ? { label: "Нужно внимание", className: "text-warning" }
      : { label: "В норме", className: "text-success" };
  return (
    <li className="td-entity-row min-w-0 px-4 py-4 sm:px-5">
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-[13px] font-semibold text-ink">{item.clientName}</h3>
            <span className={`text-[11px] font-semibold ${risk.className}`}>{risk.label}</span>
          </div>
          <p className="mt-1 text-[11px] text-ink-3">Владелец: <span className="font-medium text-ink-2">{item.ownerName}</span></p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
            <span>{stageLabel(item.stage)}</span>
            <span><b className={item.overdue > 0 ? "text-danger" : "text-ink-2"}>{item.overdue}</b> просрочено</span>
            <span><b className={item.unassigned > 0 ? "text-warning" : "text-ink-2"}>{item.unassigned}</b> без исполнителя</span>
            <span><b className="text-ink-2">{item.open}</b> открыто</span>
          </div>
          {item.ceremonyAt && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
              <CalendarBlank size={14} weight="fill" aria-hidden /> Церемония: {dateTimeLabel(item.ceremonyAt, timezone)}
            </p>
          )}
        </div>
        <Link href={item.href} className={buttonClasses({ variant: "ghost", size: "sm", className: "w-fit" })}>
          Открыть кейс <ArrowRight size={14} weight="bold" />
        </Link>
      </div>
    </li>
  );
}

function CompactEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <CheckCircle size={24} weight="fill" className="mx-auto text-success" />
      <p className="mt-3 text-[14px] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[42ch] text-[12px] leading-relaxed text-ink-3">{description}</p>
    </div>
  );
}

function PageState({ icon, eyebrow, title, description, action, retry }: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  action?: { label: string; href: string };
  retry?: () => void;
}) {
  return (
    <div className="td-page mx-auto w-full max-w-[900px] px-4 py-8 sm:px-7 sm:py-12">
      <section role={retry ? "alert" : "status"} className="rounded-[var(--radius-card)] bg-surface px-6 py-14 text-center shadow-[var(--shadow-soft),var(--hl-top)] sm:px-10">
        <span className="mx-auto block w-fit text-accent">{icon}</span>
        <p className="mt-5 text-[12px] font-semibold text-ink-3">{eyebrow}</p>
        <h1 className="td-display mt-2 text-[28px] leading-tight text-ink sm:text-[34px]">{title}</h1>
        <p className="mx-auto mt-3 max-w-[48ch] text-[13px] leading-relaxed text-ink-2">{description}</p>
        {action && <Link href={action.href} className={buttonClasses({ size: "sm", className: "mt-6" })}>{action.label}</Link>}
        {retry && (
          <button type="button" onClick={retry} className={buttonClasses({ size: "sm", className: "mt-6" })}>
            <ArrowClockwise size={15} weight="bold" /> Повторить
          </button>
        )}
      </section>
    </div>
  );
}

function roleLabel(role: string) {
  if (role === "MANAGER") return "Руководитель";
  if (role === "ADMIN") return "Администратор";
  return "Агент";
}

function priorityLabel(priority: string) {
  if (priority === "HIGH") return "высокий";
  if (priority === "LOW") return "низкий";
  return "обычный";
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    NEW: "Новый кейс",
    PREPARATION: "Подготовка",
    MEETING: "Встреча",
    QUOTE: "Смета",
    AGREEMENT: "Согласование",
    CONTRACT: "Договор",
    PAYMENT: "Оплата",
    EXECUTION: "Исполнение",
    CLOSURE: "Закрытие",
    CLOSED: "Закрыт",
  };
  return labels[stage] ?? stage;
}

function dateTimeLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
