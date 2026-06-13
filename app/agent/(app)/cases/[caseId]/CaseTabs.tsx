"use client";

import { useState } from "react";
import { Check, Circle, ClipboardText, ClockCounterClockwise, Files, FileText, UsersThree, type Icon } from "@phosphor-icons/react";
import { TasksSection } from "./TasksSection";
import { NotesSection } from "./NotesSection";
import { DocumentsSection } from "./DocumentsSection";
import { IntakeSection, type Intake } from "./IntakeSection";
import { PaymentsSection, type PaymentItem } from "./PaymentsSection";

type TaskItem = { id: number; title: string; dueAt: string | null; completedAt: string | null };
type NoteItem = { id: number; body: string; createdAt: string };
type DocItem = { id: number; name: string; category: string; url: string; mimeType: string; size: number; createdAt: string };
type ChecklistItem = { label: string; done: boolean };
type ActivityItem = { label: string; sub?: string };

type TabId = "work" | "docs" | "family" | "history";

export function CaseTabs({
  caseId,
  checklist,
  tasks,
  docs,
  notes,
  intake,
  context,
  payments,
  activity,
}: {
  caseId: number;
  checklist: ChecklistItem[];
  tasks: TaskItem[];
  docs: DocItem[];
  notes: NoteItem[];
  intake: Intake;
  context: string | null;
  payments: PaymentItem[];
  activity: ActivityItem[];
}) {
  const [tab, setTab] = useState<TabId>("work");

  const openTasks = tasks.filter((t) => !t.completedAt).length;
  const missingDocs = docs.length === 0;

  const TABS: { id: TabId; label: string; icon: Icon; badge?: string }[] = [
    { id: "work", label: "Работа", icon: ClipboardText, badge: openTasks > 0 ? String(openTasks) : undefined },
    { id: "docs", label: "Документы", icon: Files, badge: docs.length ? String(docs.length) : undefined },
    { id: "family", label: "Семья", icon: UsersThree },
    { id: "history", label: "История", icon: ClockCounterClockwise },
  ];

  return (
    <div className="td-shell min-w-0 overflow-hidden sm:grid sm:grid-cols-[190px_minmax(0,1fr)]">
      {/* Tab bar */}
      <div className="border-b border-line bg-surface-2/45 px-2 py-2 sm:border-b-0 sm:border-r sm:bg-surface/70 sm:p-3">
        <div className="flex min-w-0 gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
        {TABS.map((t) => {
          const active = tab === t.id;
          const IconComponent = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={active ? "true" : undefined}
              data-active={active ? "true" : undefined}
              className={`td-side-nav-item td-press group flex min-h-[60px] flex-shrink-0 items-center gap-2.5 px-2.5 text-left text-[13px] ${
                active ? "font-semibold text-ink" : "font-medium text-ink-2 hover:text-ink"
              }`}
            >
              <span className="td-nav-orb" data-active={active ? "true" : undefined}>
                <IconComponent size={26} weight="fill" />
              </span>
              <span>{t.label}</span>
              {t.badge && (
                <span className={`tnum ml-auto rounded-full px-1.5 text-[11px] ${active ? "bg-accent text-on-accent" : "bg-surface-2 text-ink-3"}`}>{t.badge}</span>
              )}
            </button>
          );
        })}
        </div>
      </div>

      <div key={tab} className="tab-panel p-4 sm:p-5">
        {tab === "work" && (
          <div className="space-y-5">
            <Section title={`Задачи · ${openTasks} открыто`}>
              <TasksSection caseId={caseId} initial={tasks} />
            </Section>
            <Section title="Оплата" hint="Фиксация аванса и остатка по договорённости с семьёй.">
              <PaymentsSection caseId={caseId} initial={payments} />
            </Section>
            <Section title="Статус оформления" hint="Справка. Обновляется автоматически по ходу кейса.">
              <ul className="grid gap-2 sm:grid-cols-2">
                {checklist.map((it) => (
                  <li key={it.label} className="flex items-center gap-2.5 rounded-[12px] border border-line bg-surface-2/45 px-3 py-2.5 text-[13px]">
                    {it.done ? <Check size={17} weight="bold" className="flex-shrink-0 text-success" /> : <Circle size={17} className="flex-shrink-0 text-ink-3" />}
                    <span className={it.done ? "text-ink-2" : "text-ink"}>{it.label}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        )}

        {tab === "docs" && (
          <Section title={`Документы${missingDocs ? "" : ` · ${docs.length}`}`}>
            <DocumentsSection caseId={caseId} initial={docs} />
          </Section>
        )}

        {tab === "family" && (
          <div className="space-y-5">
            <Section title="Потребности семьи">
              <IntakeSection caseId={caseId} initial={intake} />
            </Section>
            {context && (
              <Section title="Контекст" icon={<FileText size={16} weight="fill" />}>
                <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-2">{context}</p>
              </Section>
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="space-y-5">
            <Section title={`Заметки · ${notes.length}`}>
              <NotesSection caseId={caseId} initial={notes} />
            </Section>
            <Section title="Активность">
              <ol className="divide-y divide-line">
                {activity.map((a, i) => (
                  <li key={i} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="td-nav-orb td-nav-orb-sm mt-0.5 flex-shrink-0">
                      <ClockCounterClockwise size={18} weight="fill" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] text-ink">{a.label}</span>
                      {a.sub && <span className="block text-[12px] text-ink-3">{a.sub}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, hint, icon, children }: { title: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        {icon && <span className="text-accent">{icon}</span>}
        <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      </div>
      {hint && <p className="-mt-2 mb-3 text-[12px] text-ink-3">{hint}</p>}
      {children}
    </section>
  );
}

export default CaseTabs;
