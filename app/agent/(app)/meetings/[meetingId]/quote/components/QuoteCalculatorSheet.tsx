import { Check, Copy, Eye, PaperPlaneTilt, X } from "@phosphor-icons/react";
import s from "../QuoteBuilder.module.css";
import {
  type CalculationSection,
  type EstimateItem,
  type ExternalExpense,
  type EstimateSnapshot,
  calculateOrderEconomics,
  calculateBudgetStatus,
  formatCurrency,
} from "@/lib/calculationUtils";
import { EstimateItemRow } from "./EstimateItemRow";
import { AgentEconomicsBlock } from "./AgentEconomicsBlock";
import { SnapshotBlock } from "./SnapshotBlock";
import type { CalculatorTab } from "../quoteConfig";

/**
 * Плавающий калькулятор сметы (D1b): механический вынос из QuoteBuilder,
 * поведение 1:1. Вкладки: Состав / Экономика / Версии / Действия.
 * Состояние и обработчики остаются в QuoteBuilder — компонент чисто
 * презентационный, чтобы вынос не менял логику.
 */

type CalculatorStatus = { tone: "danger" | "warning" | "ok"; text: string };

export type QuoteCalculatorSheetProps = {
  open: boolean;
  onClose: () => void;
  tab: CalculatorTab;
  onTabChange: (tab: CalculatorTab) => void;
  // Шапка
  grandTotal: number;
  lineCount: number;
  versionLabel: string;
  status: CalculatorStatus;
  savedCount: number;
  // Состав
  sections: CalculationSection[];
  estimateItems: EstimateItem[];
  estimateTotal: number;
  externalExpenses: ExternalExpense[];
  externalTotal: number;
  onEstimatePriceChange: (id: string, value: string) => void;
  onEstimateQuantityChange: (id: string, quantity: number) => void;
  onEstimateRemove: (id: string) => void;
  // Экономика
  economics: ReturnType<typeof calculateOrderEconomics>;
  budgetStatus: ReturnType<typeof calculateBudgetStatus>;
  budgetMessage: string;
  marginWarning: string | null;
  // Версии
  snapshots: EstimateSnapshot[];
  snapshotTitle: string;
  snapshotNote: string;
  snapshotError: string | null;
  openSnapshotId: string | null;
  onSnapshotTitleChange: (value: string) => void;
  onSnapshotNoteChange: (value: string) => void;
  onSnapshotOpenChange: (id: string | null) => void;
  onSnapshotFix: () => void;
  onSnapshotDelete: (id: string) => void;
  // Действия
  saving: boolean;
  savedAt: string | null;
  saveError: string | null;
  cobrowseCode: string | null;
  onSaveVersion: () => void;
  onCopyClientLink: () => void;
};

export function QuoteCalculatorSheet(p: QuoteCalculatorSheetProps) {
  return (
    <aside className={`${s.panel} ${p.open ? s.panelOpen : ""}`} aria-label="Детали сметы">
      <div className={s.panelCard}>
        <div className={s.panelChrome}>
          <div className={s.panelHero}>
            <div>
              <span className={s.panelHeroLabel}>Предварительно</span>
              <span className={s.panelHeroAmount}>{formatCurrency(p.grandTotal)}</span>
              <span className={s.panelHeroMeta}>{p.lineCount} услуг · {p.versionLabel}</span>
            </div>
            <button type="button" className={s.sheetClose} onClick={p.onClose} aria-label="Свернуть калькулятор">
              <X size={18} weight="bold" />
            </button>
          </div>

          <div className={s.panelHead}>
            <span className={s.panelHeadTitle}>Детали сметы</span>
            <span className={`${s.panelStatus} ${s[`panelStatus_${p.status.tone}`]}`}>
              {p.status.text}
            </span>
            {p.savedCount > 0 && (
              <span className={s.panelVersions}>сохранено v{p.savedCount}</span>
            )}
          </div>

          <div className={s.sheetTabs} role="tablist" aria-label="Разделы калькулятора">
            {[
              ["composition", "Состав"],
              ["economics", "Экономика"],
              ["versions", "Версии"],
              ["actions", "Действия"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={p.tab === id}
                className={`${s.sheetTab} ${p.tab === id ? s.sheetTabActive : ""}`}
                onClick={() => p.onTabChange(id as CalculatorTab)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {p.tab === "composition" && (
          <div className={s.panelSections}>
            {p.sections.length === 0 ? (
              <div className={s.panelEmpty}>
                Выберите услуги слева, смета появится здесь
              </div>
            ) : (
              p.sections.map((section: CalculationSection) => (
                <div key={section.title} className={s.panelSection}>
                  <div className={s.panelSectionHead}>
                    <span>{section.title}</span>
                    <span className={s.panelSectionAmt}>{formatCurrency(section.total)}</span>
                  </div>
                  {section.items?.map((item) => (
                    <div key={item.label} className={s.panelItem}>
                      <span>{item.label}</span>
                      {item.price != null ? (
                        <span>{formatCurrency(item.price)}</span>
                      ) : (
                        <span className={s.panelItemIncluded}>включено</span>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}

            {p.estimateItems.length > 0 && (
              <div className={s.panelSection}>
                <div className={s.panelSectionHead}>
                  <span>Атрибутика</span>
                  <span className={s.panelSectionAmt}>{formatCurrency(p.estimateTotal)}</span>
                </div>
                <div className={s.estimateList}>
                  {p.estimateItems.map((item) => (
                    <EstimateItemRow
                      key={item.id}
                      item={item}
                      onPriceChange={(value) => p.onEstimatePriceChange(item.id, value)}
                      onQuantityChange={(quantity) => p.onEstimateQuantityChange(item.id, quantity)}
                      onRemove={() => p.onEstimateRemove(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {p.externalExpenses.length > 0 && (
              <div className={s.panelSection}>
                <div className={s.panelSectionHead}>
                  <span>Внешние расходы</span>
                  <span className={s.panelSectionAmt}>{formatCurrency(p.externalTotal)}</span>
                </div>
                <div className={s.externalSummaryList}>
                  {p.externalExpenses.map((expense) => {
                    const expenseMargin = calculateOrderEconomics([
                      {
                        name: expense.name,
                        category: expense.category,
                        clientPrice: expense.includeInClientTotal ? expense.clientPrice : 0,
                        costPrice: expense.includeInMarginCalculation ? expense.costPrice : 0,
                        quantity: 1,
                      },
                    ]).items[0];
                    return (
                      <div key={expense.id} className={s.externalSummaryItem}>
                        <div>
                          <span>{expense.category}</span>
                          <strong>{expense.name}</strong>
                          {expense.comment && <em>{expense.comment}</em>}
                        </div>
                        <div className={s.externalSummaryNumbers}>
                          <span className={s.externalSummaryClient}>
                            {formatCurrency(expense.includeInClientTotal ? expense.clientPrice : 0)}
                          </span>
                          <span className={s.externalSummaryMeta}>
                            с/с {formatCurrency(expense.includeInMarginCalculation ? expense.costPrice : 0)} · маржа {formatCurrency(expenseMargin?.marginRub ?? 0)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {p.tab === "economics" && (
          <div className={s.sheetPane}>
            <AgentEconomicsBlock
              budgetMessage={p.budgetMessage}
              budgetStatus={p.budgetStatus.status}
              clientBudget={p.budgetStatus.clientBudget}
              economics={p.economics}
              marginItems={p.economics.items}
              marginWarning={p.marginWarning}
            />
          </div>
        )}

        {p.tab === "versions" && (
          <div className={s.sheetPane}>
            <SnapshotBlock
              budgetStatus={p.budgetStatus}
              error={p.snapshotError}
              note={p.snapshotNote}
              onDelete={p.onSnapshotDelete}
              onFix={p.onSnapshotFix}
              onNoteChange={p.onSnapshotNoteChange}
              onOpenChange={p.onSnapshotOpenChange}
              onTitleChange={p.onSnapshotTitleChange}
              openSnapshotId={p.openSnapshotId}
              snapshots={p.snapshots}
              title={p.snapshotTitle}
            />
          </div>
        )}

        {p.tab === "actions" && (
          <div className={s.panelActions} data-tour="quote-summary">
            <button
              className={s.saveBtn}
              onClick={p.onSaveVersion}
              disabled={p.saving}
            >
              {p.saving ? "Сохраняю..." : "Сохранить черновик"}
            </button>

            <button type="button" className={s.secondaryActionBtn} onClick={p.onSnapshotFix}>
              <Check size={15} weight="bold" /> Сохранить версию
            </button>

            {p.cobrowseCode && (
              <>
                <button type="button" className={s.secondaryActionBtn} onClick={p.onCopyClientLink}>
                  <PaperPlaneTilt size={15} weight="duotone" /> Отправить клиенту
                </button>
                <button type="button" className={s.secondaryActionBtn} onClick={p.onCopyClientLink}>
                  <Copy size={15} weight="duotone" /> Скопировать ссылку
                </button>
                <a href={`/co/${p.cobrowseCode}`} target="_blank" rel="noreferrer" className={s.secondaryActionLink}>
                  <Eye size={15} weight="duotone" /> Показать клиенту
                </a>
              </>
            )}

            {p.savedAt && !p.saveError && (
              <div className={s.savedMsg}>
                <Check size={14} weight="bold" />
                Сохранено в {p.savedAt}
              </div>
            )}
            {p.saveError && (
              <div className={s.errorMsg}>{p.saveError}</div>
            )}
          </div>
        )}

        <div className={s.sheetFooter}>
          <button
            type="button"
            className={s.sheetFooterSummary}
            onClick={() => p.onTabChange("composition")}
            aria-label="Открыть состав сметы"
          >
            <span>Итого</span>
            <strong>{formatCurrency(p.grandTotal)}</strong>
          </button>
          <button type="button" className={s.sheetFooterSave} onClick={p.onSaveVersion} disabled={p.saving}>
            {p.saving ? "Сохраняю..." : "Сохранить"}
          </button>
        </div>
      </div>
    </aside>
  );
}
