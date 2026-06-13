// Пакет = пресет конструктора, а не отдельный мир.
// «Изменить детали» раскладывает тариф на реальные позиции: поля формы
// (зал, катафалк, транспорт, носильщики) + позиции каталога (гроб, венок...)
// + строка «Организация и сопровождение» — остаток до точной цены тарифа.
// После гидратации агент меняет гроб как обычную позицию сметы, итог
// пересчитывается, а дельта от цены тарифа показывается у якоря.

import {
  AGENT_ATTRIBUTION_CATALOG,
  DEFAULT_CALCULATOR_CONFIG,
  calculateOrder,
  calculateEstimateItemsTotal,
  type EstimateItem,
  type FormData,
} from "@/lib/calculationUtils";

export const PACKAGE_ITEM_SOURCE = "package-preset";

export type PackagePreset = {
  /** Поля формы, которые включает тариф (поверх DEFAULT_FORM). */
  form: Partial<FormData>;
  /** Позиции каталога, входящие в тариф (гроб, постель, венок, крест...). */
  catalogItemIds: string[];
};

export const PACKAGE_PRESETS: Record<string, PackagePreset> = {
  basic: {
    form: {
      hasHall: true,
      hallDuration: 60,
      ceremonyType: "civil",
      needsHearse: true,
      needsFamilyTransport: true,
      familyTransportSeats: 5,
      needsPallbearers: true,
    },
    catalogItemIds: [
      "coffin-fabric-standard",
      "lining-standard",
      "wreath-standard",
      "cross-wood-catalog",
      "nameplate",
    ],
  },
  standard: {
    form: {
      hasHall: true,
      hallDuration: 60,
      ceremonyType: "civil",
      needsHearse: true,
      needsFamilyTransport: true,
      familyTransportSeats: 10,
      needsPallbearers: true,
    },
    catalogItemIds: [
      "coffin-lacquered",
      "lining-improved",
      "wreath-improved",
      "cross-wood-catalog",
      "nameplate",
    ],
  },
  premium: {
    form: {
      hasHall: true,
      hallDuration: 90,
      ceremonyType: "civil",
      needsHearse: true,
      needsFamilyTransport: true,
      familyTransportSeats: 15,
      needsPallbearers: true,
    },
    catalogItemIds: [
      "coffin-premium-lacquered",
      "lining-improved",
      "wreath-improved",
      "flower-basket",
      "cross-wood-catalog",
      "nameplate",
    ],
  },
  "cremation-standard": {
    form: {
      hasHall: false,
      ceremonyType: "civil",
      needsHearse: true,
      needsFamilyTransport: false,
      needsPallbearers: false,
    },
    catalogItemIds: ["coffin-fabric-standard", "lining-standard", "urn-standard"],
  },
  "cremation-comfort": {
    form: {
      hasHall: true,
      hallDuration: 90,
      ceremonyType: "civil",
      needsHearse: true,
      needsFamilyTransport: false,
      needsPallbearers: true,
    },
    catalogItemIds: ["coffin-lacquered", "lining-improved", "urn-improved"],
  },
  "cremation-premium": {
    form: {
      hasHall: true,
      hallDuration: 90,
      ceremonyType: "civil",
      needsHearse: true,
      needsFamilyTransport: true,
      familyTransportSeats: 10,
      needsPallbearers: true,
    },
    catalogItemIds: [
      "coffin-premium-lacquered",
      "lining-improved",
      "wreath-improved",
      "urn-improved",
    ],
  },
};

export type HydratedPackage = {
  formPatch: Partial<FormData>;
  items: EstimateItem[];
};

/**
 * Раскладывает тариф на позиции. Сумма (форма + позиции) сходится с ценой
 * тарифа копейка в копейку за счёт строки «Организация и сопровождение».
 */
export function hydratePackage(
  pkg: { id: string; name: string; price: number },
  baseForm: FormData,
): HydratedPackage | null {
  const preset = PACKAGE_PRESETS[pkg.id];
  if (!preset) return null;

  const formPatch: Partial<FormData> = {
    ...preset.form,
    packageType: "custom",
    selectedAdditionalServices: [],
  };

  const hydratedForm: FormData = { ...baseForm, ...formPatch };
  const formDriven = calculateOrder(hydratedForm, DEFAULT_CALCULATOR_CONFIG, "standard").total;

  const items: EstimateItem[] = preset.catalogItemIds.flatMap((catalogId) => {
    const catalogItem = AGENT_ATTRIBUTION_CATALOG.find((c) => c.id === catalogId);
    if (!catalogItem) return [];
    return [
      {
        id: `pkg:${pkg.id}:${catalogItem.id}`,
        catalogItemId: catalogItem.id,
        name: catalogItem.name,
        category: catalogItem.category,
        description: catalogItem.description,
        imagePlaceholder: catalogItem.imagePlaceholder,
        clientPrice: catalogItem.clientPrice,
        costPrice: catalogItem.costPrice,
        quantity: catalogItem.quantityDefault || 1,
        selectedColor: catalogItem.availableColors?.[0],
        source: PACKAGE_ITEM_SOURCE,
      },
    ];
  });

  const itemsTotal = calculateEstimateItemsTotal(items);
  const coordination = Math.max(0, pkg.price - formDriven - itemsTotal);
  if (coordination > 0) {
    items.push({
      id: `pkg:${pkg.id}:coordination`,
      catalogItemId: "package-coordination",
      name: `Организация и сопровождение - тариф «${pkg.name}»`,
      category: "Дополнительные услуги",
      description: "Документы, подготовка, координатор церемонии и сопровождение семьи",
      imagePlaceholder: "ОС",
      clientPrice: coordination,
      costPrice: Math.round(coordination * DEFAULT_CALCULATOR_CONFIG.costs.packageCostRatio),
      quantity: 1,
      source: PACKAGE_ITEM_SOURCE,
    });
  }

  return { formPatch, items };
}

/** Убирает позиции прошлой гидратации (повторный выбор тарифа не дублирует). */
export function withoutPackageItems(items: EstimateItem[]): EstimateItem[] {
  return items.filter((item) => item.source !== PACKAGE_ITEM_SOURCE);
}
