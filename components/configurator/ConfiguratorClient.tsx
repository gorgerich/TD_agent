"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ArrowsOut, Info, Cube, Image as ImageIcon } from "@phosphor-icons/react";

// Клиент-только: img-слои создаются после гидратации → onError ловится надёжно,
// Canvas-фолбэк не пытается рендериться на сервере.
const ConfiguratorScene = dynamic(() => import("./ConfiguratorScene"), { ssr: false });
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
  totalPrice,
  type ConfigState,
  type Option,
} from "./layers";

// ── Мелкие контролы (тёмная тема студии) ───────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-white/45">{label}</span>
      {children}
    </label>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
  swatch,
}: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  swatch?: boolean;
}) {
  const active = options.find((o) => o.value === value);
  return (
    <div className="relative flex items-center gap-2 rounded-[9px] border border-white/12 bg-white/[0.06] px-3 py-2.5">
      {swatch && active?.swatch && (
        <span className="h-4 w-4 flex-shrink-0 rounded-full ring-1 ring-white/20" style={{ background: active.swatch }} />
      )}
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

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[40px] flex-shrink-0 rounded-full transition-colors ${on ? "bg-[#c9a44a]" : "bg-white/15"}`}
    >
      <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-all ${on ? "left-[20px]" : "left-[2px]"}`} />
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/8 px-5 py-4">
      <h3 className="mb-3 text-[13px] font-semibold tracking-wide text-white/85">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ThumbGroup<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex-shrink-0 border-l border-white/8 px-4">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.1em] text-white/40">{title}</p>
      <div className="flex gap-2">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              title={o.label}
              onClick={() => onChange(o.value)}
              className={`grid h-12 w-12 place-items-center overflow-hidden rounded-[10px] border-2 transition-colors ${active ? "border-[#c9a44a]" : "border-white/10 hover:border-white/30"}`}
              style={{ background: o.swatch ?? "rgba(255,255,255,0.06)" }}
            >
              {!o.swatch && <ImageIcon size={16} className="text-white/35" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Страница ───────────────────────────────────────────────────────────────
export default function ConfiguratorClient({ meetingId }: { meetingId?: number }) {
  const [config, setConfig] = useState<ConfigState>(DEFAULT_CONFIG);
  const [added, setAdded] = useState(false);
  const set = <K extends keyof ConfigState>(key: K, value: ConfigState[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  function addToOrder() {
    // TODO: при наличии meetingId — POST позиций в смету. Пока локальное подтверждение.
    setAdded(true);
    setTimeout(() => setAdded(false), 2200);
  }

  function fullscreen() {
    document.getElementById("cfg-stage")?.requestFullscreen?.();
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[#161618] text-white lg:flex-row">
      {/* ── Левая панель ─────────────────────────────── */}
      <aside className="flex w-full flex-shrink-0 flex-col overflow-y-auto border-r border-white/8 bg-[#1d1d20] lg:w-[320px]">
        <div className="border-b border-white/8 px-5 py-4">
          <h1 className="text-[15px] font-semibold">Конфигуратор ритуальных принадлежностей</h1>
        </div>

        <Section title="Гроб">
          <Field label="Модель гроба">
            <Select value={config.coffinModel} options={COFFIN_MODELS} onChange={(v) => set("coffinModel", v)} />
          </Field>
          <Field label="Цвет дерева">
            <Select value={config.wood} options={WOODS} onChange={(v) => set("wood", v)} swatch />
          </Field>
        </Section>

        <Section title="Обивка">
          <Field label="Материал обивки">
            <Select value={config.upholsteryMaterial} options={UPHOLSTERY_MATERIALS} onChange={(v) => set("upholsteryMaterial", v)} />
          </Field>
          <Field label="Цвет отделки">
            <Select value={config.upholsteryColor} options={UPHOLSTERY_COLORS} onChange={(v) => set("upholsteryColor", v)} swatch />
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
                <Select value={config.wreathColor} options={WREATH_COLORS} onChange={(v) => set("wreathColor", v)} swatch />
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

        {/* Итого + CTA */}
        <div className="mt-auto border-t border-white/10 bg-[#19191c] px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-white/45">Итого</span>
            <span className="tnum font-mono text-[22px] font-semibold text-white">{formatRub(totalPrice(config))}</span>
          </div>
          <button
            type="button"
            onClick={addToOrder}
            className="w-full rounded-[10px] bg-[#d8c79a] py-3 text-[14px] font-semibold text-[#2a2114] transition-colors hover:bg-[#e3d4ac]"
          >
            {added ? "Добавлено ✓" : "Добавить в заказ"}
          </button>
          {meetingId && <p className="mt-2 text-center text-[11px] text-white/35">Встреча №{meetingId}</p>}
        </div>
      </aside>

      {/* ── Центр: тулбар + превью + лента ───────────── */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* тулбар */}
        <div className="flex items-center justify-between gap-2 border-b border-white/8 bg-[#1d1d20] px-4 py-2.5">
          <div className="flex items-center gap-1.5 rounded-[9px] bg-white/[0.06] p-1">
            <span className="px-2 text-[11px] text-white/40">Вид</span>
            <button type="button" className="grid h-8 w-8 place-items-center rounded-[7px] bg-white/10 text-white" title="3/4">
              <Cube size={16} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[11.5px] text-white/55 sm:inline-flex">
              <Info size={13} /> Подсказка
            </span>
            <button type="button" onClick={fullscreen} className="grid h-8 w-8 place-items-center rounded-[8px] bg-white/[0.06] text-white/70 transition-colors hover:bg-white/12" title="На весь экран">
              <ArrowsOut size={16} />
            </button>
          </div>
        </div>

        {/* превью */}
        <div id="cfg-stage" className="relative min-h-0 flex-1">
          <ConfiguratorScene config={config} />
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3.5 py-1.5 text-[11.5px] text-white/70 backdrop-blur">
            Вращайте сцену мышью или пальцем
          </div>
        </div>

        {/* нижняя лента превью */}
        <div className="flex items-start gap-1 overflow-x-auto border-t border-white/8 bg-[#1d1d20] py-3">
          <ThumbGroup title="Модель гроба" options={COFFIN_MODELS} value={config.coffinModel} onChange={(v) => set("coffinModel", v)} />
          <ThumbGroup title="Цвет дерева" options={WOODS} value={config.wood} onChange={(v) => set("wood", v)} />
          <ThumbGroup title="Обивка" options={UPHOLSTERY_COLORS} value={config.upholsteryColor} onChange={(v) => set("upholsteryColor", v)} />
          {config.wreathEnabled && (
            <ThumbGroup title="Венок" options={WREATH_COLORS} value={config.wreathColor} onChange={(v) => set("wreathColor", v)} />
          )}
          {config.crossEnabled && (
            <ThumbGroup title="Крест" options={CROSS_KINDS} value={config.crossKind} onChange={(v) => set("crossKind", v)} />
          )}
        </div>
      </main>
    </div>
  );
}
