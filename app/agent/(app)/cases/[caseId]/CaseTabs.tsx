"use client";

import { useState } from "react";
import { ClipboardText, ClockCounterClockwise, Files, FileText, UsersThree, type Icon } from "@phosphor-icons/react";
import s from "./CaseTabs.module.css";
import { TasksSection } from "./TasksSection";
import { NotesSection } from "./NotesSection";
import { DocumentsSection } from "./DocumentsSection";
import { IntakeSection, type Intake } from "./IntakeSection";
import { PaymentsSection, type PaymentItem } from "./PaymentsSection";

type TaskItem = {
  id: number;
  title: string;
  type: string;
  priority: string;
  status: string;
  source: string;
  expectedOutcome: string | null;
  waitingReason: string | null;
  ownerName: string;
  version: number;
  dueAt: string | null;
  completedAt: string | null;
};
type NoteItem = { id: number; body: string; createdAt: string };
type DocItem = { id: number; name: string; category: string; url: string; mimeType: string; size: number; createdAt: string };
type ActivityItem = { label: string; sub?: string };

type TabId = "work" | "docs" | "family" | "history";

export function CaseTabs({
  caseId,
  tasks,
  docs,
  notes,
  intake,
  context,
  payments,
  activity,
  initialTab = "work",
  canMutate = true,
}: {
  caseId: number;
  tasks: TaskItem[];
  docs: DocItem[];
  notes: NoteItem[];
  intake: Intake;
  context: string | null;
  payments: PaymentItem[];
  activity: ActivityItem[];
  initialTab?: TabId;
  canMutate?: boolean;
}) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const openTasks = tasks.filter((task) => task.status === "OPEN").length;
  const missingDocs = docs.length === 0;

  const tabs: { id: TabId; label: string; subtitle: string; icon: Icon; badge?: string }[] = [
    {
      id: "work",
      label: "Работа",
      subtitle: openTasks > 0 ? `${openTasks} задач в работе` : "Задачи и оплаты",
      icon: ClipboardText,
      badge: openTasks > 0 ? String(openTasks) : undefined,
    },
    {
      id: "docs",
      label: "Документы",
      subtitle: missingDocs ? "Нужно собрать" : `${docs.length} в кейсе`,
      icon: Files,
    },
    { id: "family", label: "Семья", subtitle: "Потребности и контекст", icon: UsersThree },
    { id: "history", label: "История", subtitle: "Заметки и события", icon: ClockCounterClockwise },
  ];
  return (
    <section className={`td-shell ${s.workspace}`} aria-label="Рабочая зона кейса">
      <nav className={s.nav} aria-label="Разделы кейса">
        <div className={s.navIntro}>
          <span className="td-eyebrow">Кейс</span>
          <span className={s.navSummary}>
            {openTasks > 0 ? `${openTasks} требуют внимания` : "Кейс под контролем"}
          </span>
        </div>
        <div className={s.navItems} role="tablist" aria-label="Разделы рабочей зоны">
          {tabs.map((item) => {
            const active = tab === item.id;
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`case-panel-${item.id}`}
                data-active={active ? "true" : undefined}
                className={`${s.navItem} td-press`}
                onClick={() => setTab(item.id)}
              >
                <span className={s.navIcon} data-active={active ? "true" : undefined}>
                  <ItemIcon size={22} weight="fill" />
                </span>
                <span className={s.navText}>
                  <strong>{item.label}</strong>
                </span>
                {item.badge && (
                  <span className={`${s.navBadge} tnum`} data-active={active ? "true" : undefined}>{item.badge}</span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <div className={s.canvas}>
        <div key={tab} id={`case-panel-${tab}`} role="tabpanel" className={`tab-panel ${s.panel}`}>
          {tab === "work" && (
            <div className={s.workGrid}>
              <Section title="Задачи" meta={openTasks > 0 ? `${openTasks} открыто` : "всё сделано"}>
                <TasksSection caseId={caseId} initial={tasks} canMutate={canMutate} />
              </Section>
              <Section title="Оплата" hint="Аванс и остаток по договорённости с семьёй.">
                <PaymentsSection caseId={caseId} initial={payments} />
              </Section>
            </div>
          )}

          {tab === "docs" && (
            <Section title="Документы" meta={missingDocs ? "нужно собрать" : `${docs.length} в кейсе`}>
              <DocumentsSection caseId={caseId} initial={docs} />
            </Section>
          )}

          {tab === "family" && (
            <div className={s.stack}>
              <Section title="Потребности семьи">
                <IntakeSection caseId={caseId} initial={intake} />
              </Section>
              {context && (
                <Section title="Контекст" icon={<FileText size={16} weight="fill" />}>
                  <p className={s.context}>{context}</p>
                </Section>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className={s.stack}>
              <Section title="Заметки" meta={notes.length ? String(notes.length) : "пусто"}>
                <NotesSection caseId={caseId} initial={notes} />
              </Section>
              <Section title="Активность">
                <ol className={s.activityList}>
                  {activity.map((entry, index) => (
                    <li key={index}>
                      <span className={s.activityIcon}>
                        <ClockCounterClockwise size={15} weight="fill" />
                      </span>
                      <span className={s.activityText}>
                        <strong>{entry.label}</strong>
                        {entry.sub && <small>{entry.sub}</small>}
                      </span>
                    </li>
                  ))}
                </ol>
              </Section>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Section({
  title,
  meta,
  hint,
  icon,
  children,
}: {
  title: string;
  meta?: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <span className={s.sectionTitle}>
          {icon && <span className={s.sectionIcon}>{icon}</span>}
          <h3>{title}</h3>
        </span>
        {meta && <span className={s.sectionMeta}>{meta}</span>}
      </div>
      {hint && <p className={s.sectionHint}>{hint}</p>}
      {children}
    </section>
  );
}

export default CaseTabs;
