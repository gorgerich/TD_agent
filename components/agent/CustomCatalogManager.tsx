"use client";

// Свой каталог агента: загрузка фото товара → авто-вырез фона в браузере
// (@imgly/background-removal, ONNX/WASM, без ключей и затрат) → аккуратная
// карточка на белом фоне → название/категория/цена → сохранение в свой каталог.
// Сохранённые товары приходят в конфигуратор сметы наравне с базовым каталогом.

import { useCallback, useEffect, useRef, useState } from "react";
import { CATALOG_CATEGORIES, type CatalogCategory } from "@/lib/calculationUtils";

export type AgentCatalogItemDTO = {
  id: string;
  name: string;
  category: string;
  clientPrice: number;
  costPrice: number;
  description: string;
  imageData: string;
  createdAt?: string;
};

// Карточка на белом фоне из прозрачного выреза: контейнер 4:5, поле 7%, объект по центру.
async function toWhiteCard(cutout: Blob, side = 1000): Promise<string> {
  const bmp = await createImageBitmap(cutout);
  const W = side;
  const H = Math.round(side * 1.25);
  const pad = Math.round(Math.min(W, H) * 0.07);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const scale = Math.min((W - 2 * pad) / bmp.width, (H - 2 * pad) / bmp.height);
  const dw = Math.max(1, Math.round(bmp.width * scale));
  const dh = Math.max(1, Math.round(bmp.height * scale));
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
  return canvas.toDataURL("image/webp", 0.9);
}

export default function CustomCatalogManager({ onChange }: { onChange?: (items: AgentCatalogItemDTO[]) => void }) {
  const [items, setItems] = useState<AgentCatalogItemDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"idle" | "cutting" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CatalogCategory>("Венки");
  const [clientPrice, setClientPrice] = useState<string>("");
  const [costPrice, setCostPrice] = useState<string>("");
  const [description, setDescription] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/catalog");
      const d = await r.json();
      setItems(d.items ?? []);
      onChange?.(d.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setBusy("cutting");
    setPreview(null);
    try {
      // Динамический импорт: тяжёлая библиотека грузится только при использовании.
      const { removeBackground } = await import("@imgly/background-removal");
      const cutout = await removeBackground(file, { output: { format: "image/png" } });
      const card = await toWhiteCard(cutout);
      setPreview(card);
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      setError("Не удалось вырезать фон. Попробуйте фото товара на светлом фоне.");
      console.error(e);
    } finally {
      setBusy("idle");
    }
  }, [name]);

  const save = useCallback(async () => {
    setError(null);
    if (!preview) return setError("Сначала загрузите фото товара");
    if (name.trim().length < 2) return setError("Укажите название");
    const price = Math.round(Number(clientPrice));
    if (!Number.isFinite(price) || price < 0) return setError("Укажите цену");
    setBusy("saving");
    try {
      const r = await fetch("/api/agent/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category,
          clientPrice: price,
          costPrice: Math.max(0, Math.round(Number(costPrice) || 0)),
          description: description.trim(),
          imageData: preview,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Ошибка сохранения");
      // сброс формы
      setPreview(null);
      setName("");
      setClientPrice("");
      setCostPrice("");
      setDescription("");
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy("idle");
    }
  }, [preview, name, category, clientPrice, costPrice, description, refresh]);

  const remove = useCallback(async (id: string) => {
    try {
      await fetch(`/api/agent/catalog/${id}`, { method: "DELETE" });
      await refresh();
    } catch {
      /* no-op */
    }
  }, [refresh]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      {/* Форма добавления */}
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-soft">
        <h3 className="text-[14px] font-semibold text-ink">Добавить свой товар</h3>
        <p className="mt-1 text-[12px] text-ink-3">
          Загрузите фото — платформа сама вырежет фон и поставит товар на белый фон.
        </p>

        <div className="mt-3">
          <label className="block cursor-pointer rounded-[var(--radius-control)] border border-dashed border-line bg-surface-2 px-4 py-6 text-center text-[13px] text-ink-2 transition-colors hover:border-ink-3">
            {busy === "cutting" ? "Вырезаю фон…" : "Выбрать фото товара"}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy !== "idle"}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </label>
        </div>

        {preview && (
          <div className="mt-3 overflow-hidden rounded-[var(--radius-control)] border border-line bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Предпросмотр товара" className="mx-auto max-h-56 w-auto object-contain" />
          </div>
        )}

        <div className="mt-3 grid gap-2.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название товара"
            className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink-3"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CatalogCategory)}
            className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink-3"
          >
            {CATALOG_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2.5">
            <input
              value={clientPrice}
              onChange={(e) => setClientPrice(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="Цена клиенту, ₽"
              className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink-3"
            />
            <input
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="Закупка, ₽"
              className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink-3"
            />
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Описание (необязательно)"
            className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink-3"
          />
        </div>

        {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}

        <button
          type="button"
          onClick={() => void save()}
          disabled={busy !== "idle" || !preview}
          className="mt-3 w-full rounded-[var(--radius-control)] bg-ink px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity disabled:opacity-40"
        >
          {busy === "saving" ? "Сохраняю…" : "Добавить в мой каталог"}
        </button>
      </div>

      {/* Список товаров агента */}
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-ink">Мои товары</h3>
          <span className="text-[12px] text-ink-3">{items.length}</span>
        </div>
        {loading ? (
          <p className="mt-3 text-[13px] text-ink-3">Загрузка…</p>
        ) : items.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-3">Пока пусто. Добавьте первый товар слева.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((it) => (
              <div key={it.id} className="group relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-soft">
                <div className="aspect-[4/5] w-full bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.imageData} alt={it.name} className="h-full w-full object-contain" />
                </div>
                <div className="p-2.5">
                  <p className="truncate text-[12px] font-semibold text-ink">{it.name}</p>
                  <p className="text-[11px] text-ink-3">{it.category}</p>
                  <p className="mt-0.5 text-[12px] font-medium text-ink-2">{it.clientPrice.toLocaleString("ru-RU")} ₽</p>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(it.id)}
                  aria-label="Удалить"
                  className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-surface/90 text-ink-2 opacity-0 shadow-soft transition-opacity hover:text-red-600 group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
