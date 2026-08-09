import { formatMinorUnitsCurrency } from "@/lib/calculationUtils";
import s from "../QuoteBuilder.module.css";

type QuoteVersionHistoryItem = {
  id: number;
  versionNumber: number;
  state: string;
  total: number | null;
  totalState: string;
  costTotal: number | null;
  margin: number | null;
  lineCount: number;
  publishedAt: string | null;
  validUntil: string | null;
};

export function QuoteVersionHistory({ versions }: { versions: QuoteVersionHistoryItem[] }) {
  return (
    <section className={s.snapshotBlock} aria-labelledby="quote-version-history-title">
      <header className={s.versionHistoryHead}>
        <div>
          <h3 id="quote-version-history-title">Опубликованные версии</h3>
          <p>Неизменяемая история смет, которые получала семья.</p>
        </div>
        <span className={s.versionHistoryCount} aria-label={`Опубликованных версий: ${versions.length}`}>
          {versions.length}
        </span>
      </header>

      {versions.length === 0 ? (
        <div className={s.versionHistoryEmpty}>
          История появится после первой публикации. Автосохранения остаются черновиком и сюда не попадают.
        </div>
      ) : (
        <ol className={s.snapshotList}>
          {versions.map((version) => (
            <li key={version.id} className={s.snapshotItem}>
              <div className={s.snapshotItemHead}>
                <div>
                  <strong>Версия {version.versionNumber}</strong>
                  <span>{version.publishedAt ? `Опубликована ${formatVersionDate(version.publishedAt)}` : "Дата публикации не указана"}</span>
                </div>
                <span className={s.versionState}>{versionStateLabel(version.state)}</span>
              </div>
              <dl className={s.snapshotMetrics}>
                <div>
                  <dt>Итог клиенту</dt>
                  <dd>{version.total === null ? "Требует уточнения" : formatMinorUnitsCurrency(version.total)}</dd>
                </div>
                <div>
                  <dt>Состав</dt>
                  <dd>{version.lineCount} {pluralizePosition(version.lineCount)}</dd>
                </div>
                <div>
                  <dt>Действует до</dt>
                  <dd>{version.validUntil ? formatVersionDate(version.validUntil) : "Не указано"}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function versionStateLabel(state: string) {
  if (state === "PUBLISHED") return "Актуальная";
  if (state === "SUPERSEDED") return "Заменена новой";
  if (state === "EXPIRED") return "Срок истёк";
  return "Архивная";
}

function pluralizePosition(value: number) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return "позиций";
  if (mod10 === 1) return "позиция";
  if (mod10 >= 2 && mod10 <= 4) return "позиции";
  return "позиций";
}

function formatVersionDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
