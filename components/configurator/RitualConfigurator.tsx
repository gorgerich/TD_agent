"use client";

// Единый конфигуратор комплекта. Один набор контролов (свотчи + дропдауны),
// без дубля «панель + нижняя лента». Встраивается в смету (mode="inline":
// маленькое превью + разворот на весь экран) или как страница (mode="page").

import { useEffect, useState } from "react";
import { ArrowsOut, X, Info } from "@phosphor-icons/react";
import RitualSetPreview from "../visualizer/RitualSetPreview";
import {
  COFFIN_MODELS,
  CROSS_KINDS,
  DEFAULT_CONFIG,
  UPHOLSTERY_COLORS,
  UPHOLSTERY_MATERIALS,
  WOODS,
  WREATH_COLORS,
  WREATH_SHAPES,
  formatRub,
  previewIds,
  previewSummary,
  totalPrice,
  type ConfigState,
  type Option,
} from "./layers";

// ── Контролы (тёмная тема) ─────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-white/45">{label}</span>
      {children}
    </label>
  );
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: Option<T>[]; onChange: (v: T) => void }) {
  return (
    <div className="relative flex items-center gap-2 rounded-[10px] border border-white/12 bg-white/[0.06] px-3 py-2.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full cursor-pointer appearance-none bg-transparent text-[13px] text-white outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#26262a] text-white">
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none text-white/40">▾</span>
    </div>
  );
}

// Свотч-ряд: заменяет дублирующую нижнюю ленту, живёт в одной панели.
function SwatchRow<T extends string>({ value, options, onChange }: { value: T; options: Option<T>[]; onChange: (v: T) => void }) {
  const active = options.find((o) => o.value === value);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.label}
            aria-label={o.label}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            className={`h-9 w-9 rounded-[10px] border-2 transition-colors ${o.value === value ? "border-[#c9a44a]" : "border-white/12 hover:border-white/35"}`}
            style={{ background: o.swatch ?? "rgba(255,255,255,0.06)" }}
          />
        ))}
      </div>
      {active && <p className="mt-1.5 text-[12px] text-white/55">{active.label}</p>}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[40px] flex-shrink-0 rounded-full transition-colors ${on ? "bg-[#c9a44a]" : "bg-white/15"}`}
    >
      <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-[left] ${on ? "left-[20px]" : "left-[2px]"}`} />
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/8 px-5 py-4">
      <h3 className="mb-3 text-[13px] font-semibold tracking-wide text-white/85">{title}</h3>
      <div className="space-y-3.5">{children}</div>
    </div>
  );
}

function Controls({ config, set }: { config: ConfigState; set: <K extends keyof ConfigState>(k: K, v: ConfigState[K]) => void }) {
  return (
    <>
      <Section title="Гроб">
        <Field label="Модель гроба">
          <Select value={config.coffinModel} options={COFFIN_MODELS} onChange={(v) => set("coffinModel", v)} />
        </Field>
        <Field label="Цвет дерева">
          <SwatchRow value={config.wood} options={WOODS} onChange={(v) => set("wood", v)} />
        </Field>
      </Section>

      <Section title="Обивка">
        <Field label="Материал обивки">
          <Select value={config.upholsteryMaterial} options={UPHOLSTERY_MATERIALS} onChange={(v) => set("upholsteryMaterial", v)} />
        </Field>
        <Field label="Цвет отделки">
          <SwatchRow value={config.upholsteryColor} options={UPHOLSTERY_COLORS} onChange={(v) => set("upholsteryColor", v)} />
        </Field>
      </Section>

      <Section title="Венок">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-white/55">Показать венок</span>
          <Toggle on={config.wreathEnabled} onChange={(v) => set("wreathEnabled", v)} />
        </div>
        {config.wreathEnabled && (
          <>
            <Field label="Тип венка">
              <Select value={config.wreathShape} options={WREATH_SHAPES} onChange={(v) => set("wreathShape", v)} />
            </Field>
            <Field label="Цветовая гамма">
              <SwatchRow value={config.wreathColor} options={WREATH_COLORS} onChange={(v) => set("wreathColor", v)} />
            </Field>
          </>
        )}
      </Section>

      <Section title="Крест">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-white/55">Показать крест</span>
          <Toggle on={config.crossEnabled} onChange={(v) => set("crossEnabled", v)} />
        </div>
        {config.crossEnabled && (
          <Field label="Тип креста">
            <Select value={config.crossKind} options={CROSS_KINDS} onChange={(v) => set("crossKind", v)} />
          </Field>
        )}
      </Section>
    </>
  );
}

// Заполняющее превью (тёмная сцена)
function Stage({ config }: { config: ConfigState }) {
  return (
    <RitualSetPreview
      variant="bare"
      {...previewIds(config)}
      showWreath={config.wreathEnabled}
      showCross={config.crossEnabled}
      enableZoom={false}
    />
  );
}

// Полноэкранный/страничный вид: единая панель контролов + большое превью.
function FullView({
  config,
  set,
  overlay,
  onClose,
}: {
  config: ConfigState;
  set: <K extends keyof ConfigState>(k: K, v: ConfigState[K]) => void;
  overlay: boolean;
  onClose?: () => void;
}) {
  const wrap = overlay
    ? "fixed inset-0 z-[1000] flex flex-col bg-[#161618] text-white lg:flex-row"
    : "flex h-[100dvh] flex-col bg-[#161618] text-white lg:flex-row";
  return (
    <div
      className={wrap}
      {...(overlay ? { role: "dialog", "aria-modal": true, "aria-label": "Конфигуратор комплекта" } : {})}
    >
      <aside className="flex w-full min-h-0 flex-1 flex-col overflow-y-auto border-r border-white/8 bg-[#1d1d20] lg:w-[320px] lg:flex-none">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <h2 className="text-[14px] font-semibold">Конфигуратор комплекта</h2>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-8 w-8 place-items-center rounded-[8px] bg-white/[0.06] text-white/70 transition-colors hover:bg-white/12">
              <X size={16} />
            </button>
          )}
        </div>
        <Controls config={config} set={set} />
        <div className="mt-auto border-t border-white/10 bg-[#19191c] px-5 py-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-white/45">Итого</span>
            <span className="tnum font-mono text-[20px] font-semibold">{formatRub(totalPrice(config))}</span>
          </div>
        </div>
      </aside>

      <main className="order-first flex h-[42vh] min-w-0 flex-shrink-0 flex-col lg:order-none lg:h-auto lg:flex-1">
        <div className="flex items-center justify-end gap-2 border-b border-white/8 bg-[#1d1d20] px-4 py-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/55">
            <Info size={13} /> Превью подбирается по выбору
          </span>
          {onClose && (
            <button type="button" onClick={onClose} className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[12px] text-white/70 transition-colors hover:bg-white/12">
              Готово
            </button>
          )}
        </div>
        <div className="relative min-h-0 flex-1">
          <Stage config={config} />
        </div>
      </main>
    </div>
  );
}

export default function RitualConfigurator({ mode = "inline" }: { mode?: "inline" | "page" }) {
  const [config, setConfig] = useState<ConfigState>(DEFAULT_CONFIG);
  const [full, setFull] = useState(false);
  const set = <K extends keyof ConfigState>(k: K, v: ConfigState[K]) => setConfig((c) => ({ ...c, [k]: v }));

  // Esc закрывает полноэкранный режим + блокировка прокрутки фона.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [full]);

  if (mode === "page") {
    return <FullView config={config} set={set} overlay={false} />;
  }

  const sum = previewSummary(config);

  // inline: маленькое окно превью + кнопка «На весь экран»
  return (
    <>
      <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-soft">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <p className="text-[13px] font-semibold text-ink">Визуализация комплекта</p>
            <p className="mt-0.5 text-[11px] text-ink-3">Подбор вида гроба, обивки, венка и креста</p>
          </div>
          <button
            type="button"
            onClick={() => setFull(true)}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12px] font-semibold text-on-accent transition-colors hover:bg-accent-hover"
          >
            <ArrowsOut size={14} /> На весь экран
          </button>
        </div>

        {/* маленькое тёмное превью */}
        <button
          type="button"
          onClick={() => setFull(true)}
          aria-label="Открыть конфигуратор на весь экран"
          className="relative block aspect-[16/10] w-full bg-[#1d1d20]"
        >
          <Stage config={config} />
        </button>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[11px] text-ink-2">
          <span>Гроб: {sum.coffin}</span>
          <span>Обивка: {sum.upholstery}</span>
          {sum.wreath && <span>Венок: {sum.wreath}</span>}
          {sum.cross && <span>Крест: {sum.cross}</span>}
        </div>
      </div>

      {full && <FullView config={config} set={set} overlay onClose={() => setFull(false)} />}
    </>
  );
}
