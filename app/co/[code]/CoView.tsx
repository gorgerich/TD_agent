"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Phone } from "@phosphor-icons/react";
import { useCountUp } from "@/lib/useCountUp";
import {
  calculateOrder,
  calculateEstimateItemsTotal,
  DEFAULT_CALCULATOR_CONFIG,
  formatCurrency,
  type FormData,
  type CalculationResult,
  type PublicEstimateItem,
  type PublicExternalExpense,
} from "@/lib/calculationUtils";
import { DEFAULT_ATTRIBUTES, normalizeSelection, type AttrSelection } from "@/lib/attributes";
import AttributeRender from "@/components/AttributeRender";
import s from "./CoView.module.css";

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

type ApiResponse = {
  state: {
    form?: unknown;
    cemeteryCategory?: string;
    attributes?: unknown;
    estimateItems?: PublicEstimateItem[];
    externalExpenses?: PublicExternalExpense[];
    _ts?: number;
  } | null;
  updatedAt: number | null;
  isSnapshot?: boolean;
  agentName?: string | null;
  agentPhone?: string | null;
};

export default function CoView({ code }: { code: string }) {
  const [attributes, setAttributes] = useState<AttrSelection>(DEFAULT_ATTRIBUTES);
  const [estimateItems, setEstimateItems] = useState<PublicEstimateItem[]>([]);
  const [externalExpenses, setExternalExpenses] = useState<PublicExternalExpense[]>([]);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [checkedOnce, setCheckedOnce] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [isSnapshot, setIsSnapshot] = useState(false);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [agentPhone, setAgentPhone] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [agreeBusy, setAgreeBusy] = useState(false);

  async function agree() {
    setAgreeBusy(true);
    try {
      const response = await fetch(`/api/co/${code}/agree`, { method: "POST" });
      if (response.ok) setAgreed(true);
    } catch {
      // Client can retry without losing context.
    } finally {
      setAgreeBusy(false);
    }
  }

  const attrJson = JSON.stringify(attributes);

  useEffect(() => {
    let alive = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;

    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/co/${code}`, { cache: "no-store" });
        if (!alive) return;
        setCheckedOnce(true);
        if (!response.ok) {
          if (response.status === 404) {
            setUnavailable(true);
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = null;
            }
          }
          return;
        }
        const data: ApiResponse = await response.json();
        const state = data.state;
        if (!state) return;

        setStarted(true);
        if (data.updatedAt) setUpdatedAt(data.updatedAt);
        setAgentName(data.agentName ?? null);
        setAgentPhone(data.agentPhone ?? null);
        if (data.isSnapshot) {
          setIsSnapshot(true);
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }

        if (state.form) {
          setResult(calculateOrder(state.form as FormData, DEFAULT_CALCULATOR_CONFIG, state.cemeteryCategory ?? "standard"));
        }
        if (Array.isArray(state.estimateItems)) setEstimateItems(state.estimateItems);
        if (Array.isArray(state.externalExpenses)) setExternalExpenses(state.externalExpenses);
        if (state.attributes) {
          const normalized = normalizeSelection(state.attributes);
          setAttributes((current) => (JSON.stringify(current) === JSON.stringify(normalized) ? current : normalized));
        }
      } catch {
        // Polling resumes on next interval.
      } finally {
        inFlight = false;
      }
    }

    poll();
    intervalId = setInterval(poll, 700);
    return () => {
      alive = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [code, attrJson]);

  const estimateTotal = calculateEstimateItemsTotal(estimateItems);
  const externalTotal = externalExpenses.reduce((sum, expense) => sum + expense.clientPrice, 0);
  const grandTotal = (result?.total ?? 0) + estimateTotal + externalTotal;
  const animatedTotal = useCountUp(grandTotal);
  const sections = result?.sections.filter((section) => section.total > 0) ?? [];
  const hasItems = sections.length > 0 || estimateItems.length > 0 || externalExpenses.length > 0;

  if (!started) {
    return (
      <div className={s.loading} aria-live="polite">
        <span className={s.loadingMark} aria-hidden="true"><span /></span>
        <h2>{unavailable ? "Ссылка недоступна" : checkedOnce ? "Смета ещё не отправлена" : "Готовим смету"}</h2>
        <p>
          {unavailable
            ? "Попросите агента прислать актуальную ссылку на смету."
            : checkedOnce
            ? "Агент откроет или сохранит смету, и она появится здесь автоматически."
            : "Страница обновится сама, когда агент начнёт собирать вариант."}
        </p>
      </div>
    );
  }

  return (
    <div className={s.view}>
      <div className={s.statusRow}>
        <span className={`${s.statusBadge} ${isSnapshot ? s.statusSnapshot : s.statusLive}`}>
          <span aria-hidden="true" />
          {isSnapshot ? "Смета сформирована" : "Обновляется"}
        </span>
        {updatedAt && (
          <span className={s.updatedAt}>
            {isSnapshot ? `Сохранена ${formatDate(updatedAt)}` : `обновлено в ${formatTime(updatedAt)}`}
          </span>
        )}
      </div>

      <section className={s.totalCard} aria-label="Итог по смете">
        <span className="td-eyebrow">{isSnapshot ? "Итоговая сумма" : "Предварительная сумма"}</span>
        <p className={`${s.totalValue} tnum`}>{formatCurrency(Math.round(animatedTotal))}</p>
        <p className={s.totalTrust}>
          {isSnapshot
            ? "Цена зафиксирована в этой версии сметы."
            : "Состав и сумма меняются только после обсуждения с вами."}
        </p>
      </section>

      {!isSnapshot && agentName && (
        <aside className={s.agentCard}>
          <span className={s.agentInitials} aria-hidden="true">
            {agentName.split(" ").map((part) => part[0]).slice(0, 2).join("")}
          </span>
          <span className={s.agentMeta}>
            <small>Ваш агент</small>
            <strong>{agentName}</strong>
          </span>
          {agentPhone && (
            <a href={`tel:${agentPhone}`} className={s.agentCall}>
              <Phone size={16} weight="fill" /> Позвонить
            </a>
          )}
        </aside>
      )}

      {!isSnapshot && (
        <section className={s.preview}>
          <header className={s.previewHead}>
            <span>
              <h2>Предпросмотр комплекта</h2>
              <p>Меняется при выборе атрибутики.</p>
            </span>
          </header>
          <AttributeRender selection={attributes} selectedItems={estimateItems} className="block h-auto w-full" />
        </section>
      )}

      {hasItems && (
        <section className={s.composition}>
          <header className={s.compositionHead}>
            <h2>Состав сметы</h2>
            <span className="tnum">{formatCurrency(grandTotal)}</span>
          </header>
          <div className={s.compositionCard}>
            {sections.map((section, sectionIndex) => (
              <div key={`${section.title}-${sectionIndex}`} className={s.compositionSection}>
                <div className={s.compositionGroupHead}>
                  <span>{section.title}</span>
                  <strong className="tnum">{formatCurrency(section.total)}</strong>
                </div>
                {section.items?.map((item, itemIndex) => (
                  <div key={`${item.label}-${itemIndex}`} className={s.compositionRow}>
                    <span>{item.label}</span>
                    <strong className="tnum">
                      {item.included ? <em>включено</em> : item.price != null ? formatCurrency(item.price) : ""}
                    </strong>
                  </div>
                ))}
              </div>
            ))}

            {estimateItems.length > 0 && (
              <div className={s.compositionSection}>
                <div className={s.compositionGroupHead}>
                  <span>Услуги и атрибутика</span>
                  <strong className="tnum">{formatCurrency(estimateTotal)}</strong>
                </div>
                {estimateItems.map((item) => (
                  <div key={item.id} className={s.compositionRow}>
                    <span>
                      {item.name}
                      {item.selectedColor ? `, ${item.selectedColor}` : ""}
                      {item.quantity > 1 ? ` ×${item.quantity}` : ""}
                    </span>
                    <strong className="tnum">{formatCurrency(item.clientPrice * item.quantity)}</strong>
                  </div>
                ))}
              </div>
            )}

            {externalExpenses.length > 0 && (
              <div className={s.compositionSection}>
                <div className={s.compositionGroupHead}>
                  <span>Внешние расходы</span>
                  <strong className="tnum">{formatCurrency(externalTotal)}</strong>
                </div>
                {externalExpenses.map((expense) => (
                  <div key={expense.id} className={s.compositionRow}>
                    <span>{expense.category}: {expense.name}</span>
                    <strong className="tnum">{formatCurrency(expense.clientPrice)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {isSnapshot && (
        <div className={s.actionDock}>
          {agreed ? (
            <div className={s.agreed}>
              <CheckCircle size={18} weight="fill" /> Смета согласована
            </div>
          ) : (
            <button type="button" onClick={agree} disabled={agreeBusy} className={s.agreeButton}>
              {agreeBusy ? "Сохраняем…" : "Согласовать смету"}
            </button>
          )}
          {agentPhone && (
            <a href={`tel:${agentPhone}`} className={s.contactButton}>
              <Phone size={16} weight="fill" />
              Связаться{agentName ? ` с ${agentName.split(" ")[0]}` : " с агентом"}
            </a>
          )}
        </div>
      )}

      <section className={s.nextSteps}>
        <h2>Что дальше</h2>
        <ol>
          {[
            ["Посмотрите состав", "Изучите смету в удобном темпе. Ничего не списывается автоматически."],
            ["Обсудите детали", "Любой пункт можно изменить или убрать. Агент поможет с выбором."],
            ["Подтвердите решение", "После согласования цена фиксируется в договоре, организацией занимается команда."],
          ].map(([title, description], index) => (
            <li key={title}>
              <span className={s.stepNumber}>{index + 1}</span>
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <p className={s.footer}>
        {isSnapshot ? "Тихий дом · ритуальные услуги" : `Обновляется автоматически · код ${code}`}
      </p>
    </div>
  );
}
