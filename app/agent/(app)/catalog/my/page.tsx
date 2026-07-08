"use client";

import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react";
import CustomCatalogManager from "@/components/agent/CustomCatalogManager";

// Страница «Мой каталог»: агент загружает свои товары (авто-вырез фона),
// задаёт название/категорию/цену. Товары появляются в конфигураторе сметы.
export default function MyCatalogPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6">
      <Link
        href="/agent/catalog"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink"
      >
        <ArrowLeft size={15} /> Каталог
      </Link>
      <h1 className="mt-2 text-[20px] font-semibold text-ink">Мой каталог</h1>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-3">
        Загрузите фото своих товаров — платформа сама вырежет фон и поставит товар на белый фон.
        Укажите название и цену, и товар станет доступен в смете наравне с базовым каталогом.
      </p>
      <div className="mt-6">
        <CustomCatalogManager />
      </div>
    </div>
  );
}
