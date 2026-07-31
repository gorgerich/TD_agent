"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Phone, Printer } from "@phosphor-icons/react";
import { formatCurrency } from "@/lib/calculationUtils";
import s from "./CoView.module.css";

type PublicLine = {
  stableKey: string;
  description: string;
  quantity: number;
  unit: string;
  priceState: "KNOWN" | "UNKNOWN" | "REQUESTED" | "EXPIRED";
  clientUnitPrice: number | null;
  discountAmount: number;
  included: boolean;
};

type PublishedResponse = {
  state: "PUBLISHED";
  organizationName: string;
  agentName: string | null;
  agentPhone: string | null;
  decision: "ACCEPTED" | "CHANGES_REQUESTED" | null;
  version: {
    id: number;
    versionNumber: number;
    publishedAt: string;
    validUntil: string;
    total: number;
    currency: string;
    snapshotChecksum: string;
    lines: PublicLine[];
  };
};

type ViewState =
  | { kind: "loading" }
  | { kind: "published"; data: PublishedResponse }
  | { kind: "expired" | "superseded" | "unavailable" | "error" };

export default function CoView({ code }: { code: string }) {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [decision, setDecision] = useState<"ACCEPTED" | "CHANGES_REQUESTED" | null>(null);
  const [comment, setComment] = useState("");
  const [showChanges, setShowChanges] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const acceptKey = useRef(crypto.randomUUID());
  const changesKey = useRef(crypto.randomUUID());

  useEffect(() => {
    let active = true;
    fetch(`/api/co/${code}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 410) return { state: "EXPIRED" };
        if (response.status === 409) return { state: "SUPERSEDED" };
        if (response.status === 404) return { state: "UNAVAILABLE" };
        if (!response.ok) throw new Error("load-failed");
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        if (data.state === "PUBLISHED") {
          setView({ kind: "published", data });
          setDecision(data.decision ?? null);
        } else if (data.state === "EXPIRED") {
          setView({ kind: "expired" });
        } else if (data.state === "SUPERSEDED") {
          setView({ kind: "superseded" });
        } else {
          setView({ kind: "unavailable" });
        }
      })
      .catch(() => active && setView({ kind: "error" }));
    return () => {
      active = false;
    };
  }, [code]);

  async function submitDecision(type: "ACCEPTED" | "CHANGES_REQUESTED") {
    setBusy(true);
    setActionError(null);
    const idempotencyKey = type === "ACCEPTED" ? acceptKey.current : changesKey.current;
    try {
      const response = await fetch(
        type === "ACCEPTED" ? `/api/co/${code}/agree` : `/api/co/${code}/request-changes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "X-Correlation-Id": idempotencyKey,
          },
          body: type === "CHANGES_REQUESTED" ? JSON.stringify({ comment }) : undefined,
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Не удалось сохранить решение");
      setDecision(type);
      setShowChanges(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не удалось сохранить решение");
    } finally {
      setBusy(false);
    }
  }

  if (view.kind === "loading") {
    return (
      <div className={s.loading} aria-live="polite">
        <h2>Открываем опубликованную смету</h2>
        <p>Проверяем версию и срок действия ссылки.</p>
      </div>
    );
  }

  if (view.kind !== "published") {
    const copy = {
      expired: ["Срок ссылки истёк", "Попросите агента прислать новую ссылку на актуальную смету."],
      superseded: ["Есть более новая версия", "Эта смета сохранена в истории, но решение нужно принять по новой версии."],
      unavailable: ["Ссылка недоступна", "Ссылка могла быть отозвана. Свяжитесь с агентом, чтобы получить актуальную."],
      error: ["Не удалось открыть смету", "Проверьте интернет и обновите страницу. Ничего не было изменено."],
    }[view.kind];
    return (
      <div className={s.loading} role="status">
        <h2>{copy[0]}</h2>
        <p>{copy[1]}</p>
        {view.kind === "error" && <button type="button" onClick={() => window.location.reload()}>Повторить</button>}
      </div>
    );
  }

  const { data } = view;
  const version = data.version;
  const publishedAt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(version.publishedAt));
  const validUntil = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(version.validUntil));

  return (
    <article className={s.view}>
      <div className={s.statusRow}>
        <span className={`${s.statusBadge} ${s.statusSnapshot}`}>Опубликована версия {version.versionNumber}</span>
        <span className={s.updatedAt}>от {publishedAt} · действует до {validUntil}</span>
      </div>

      <section className={s.totalCard} aria-label="Итог по опубликованной смете">
        <span className="td-eyebrow">Итоговая сумма</span>
        <p className={`${s.totalValue} tnum`}>{formatCurrency(version.total / 100)}</p>
        <p className={s.totalTrust}>Состав и сумма зафиксированы в версии {version.versionNumber}.</p>
      </section>

      <aside className={s.agentCard}>
        <span className={s.agentMeta}>
          <small>{data.organizationName}</small>
          <strong>{data.agentName ?? "Ваш агент"}</strong>
        </span>
        {data.agentPhone && (
          <a href={`tel:${data.agentPhone}`} className={s.agentCall}>
            <Phone size={16} weight="fill" /> Позвонить
          </a>
        )}
      </aside>

      <section className={s.composition}>
        <header className={s.compositionHead}>
          <h2>Состав сметы</h2>
          <button type="button" className={s.printButton} onClick={() => window.print()}>
            <Printer size={16} weight="fill" /> Печать / PDF
          </button>
        </header>
        <div className={s.compositionCard}>
          {version.lines.map((line) => (
            <div key={line.stableKey} className={s.compositionRow}>
              <span>
                {line.description}
                {line.quantity > 1 ? ` × ${line.quantity} ${line.unit}` : ""}
              </span>
              <strong className="tnum">
                {line.included
                  ? <em>включено</em>
                  : line.priceState === "KNOWN" && line.clientUnitPrice !== null
                    ? formatCurrency((line.clientUnitPrice * line.quantity - line.discountAmount) / 100)
                    : "цена не подтверждена"}
              </strong>
            </div>
          ))}
          <div className={s.compositionTotal}>
            <span>Итого по версии {version.versionNumber}</span>
            <strong className="tnum">{formatCurrency(version.total / 100)}</strong>
          </div>
        </div>
      </section>

      <div className={s.actionDock}>
        {decision === "ACCEPTED" ? (
          <div className={s.agreed}><CheckCircle size={18} weight="fill" /> Смета принята</div>
        ) : decision === "CHANGES_REQUESTED" ? (
          <div className={s.agreed}><CheckCircle size={18} weight="fill" /> Изменения переданы агенту</div>
        ) : (
          <>
            <button type="button" onClick={() => submitDecision("ACCEPTED")} disabled={busy} className={s.agreeButton}>
              {busy ? "Сохраняем..." : "Принять смету"}
            </button>
            <button type="button" onClick={() => setShowChanges((current) => !current)} disabled={busy} className={s.contactButton}>
              Запросить изменения
            </button>
          </>
        )}
      </div>

      {showChanges && decision === null && (
        <section className={s.changeRequest}>
          <label htmlFor="quote-change-comment">Что нужно изменить</label>
          <textarea
            id="quote-change-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={2000}
            placeholder="Например: заменить транспорт или уточнить стоимость позиции"
          />
          <button type="button" onClick={() => submitDecision("CHANGES_REQUESTED")} disabled={busy || comment.trim().length < 3}>
            {busy ? "Отправляем..." : "Передать агенту"}
          </button>
        </section>
      )}

      {actionError && <p className={s.actionError} role="alert">{actionError}</p>}
      <p className={s.footer}>Тихий дом · версия {version.versionNumber} · {version.snapshotChecksum.slice(0, 8)}</p>
    </article>
  );
}
