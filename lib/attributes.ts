// Каталог ритуальной атрибутики для конструктора и co-work.
// Цены — в РУБЛЯХ (единообразно с calculationUtils / result.total).
// Поле image зарезервировано под реальные фотографии (пока null → показываем SVG-рендер).

export type AttrCategory = "coffin" | "textile" | "fittings" | "cross" | "wreath";

export interface AttrItem {
  id: string;
  category: AttrCategory;
  name: string;
  desc?: string;
  price: number; // рубли
  costPrice: number; // Temporary mock cost data for agent margin prototype.
  image?: string | null; // слот под реальное фото
  // визуальные параметры для собираемого SVG-рендера
  render: {
    color?: string; // основной цвет (дерево/ткань/металл)
    grain?: string; // цвет текстуры дерева
    metal?: string; // тон металла фурнитуры
    accent?: string; // акцент (цветы венка и т.п.)
    style?: "wood" | "carved" | "metal" | "none"; // форма креста
  };
}

export interface AttrCatalogGroup {
  category: AttrCategory;
  title: string;
  multi: boolean; // можно выбрать несколько (венки)
  optional: boolean; // можно ничего не выбирать
  items: AttrItem[];
}

export const ATTRIBUTE_CATALOG: AttrCatalogGroup[] = [
  {
    category: "coffin",
    title: "Гроб",
    multi: false,
    optional: false,
    items: [
      { id: "coffin-pine", category: "coffin", name: "Сосна", desc: "светлое дерево, лак", price: 18000, costPrice: 9000, image: null, render: { color: "#c8a06a", grain: "#a87f4a" } },
      { id: "coffin-oak", category: "coffin", name: "Дуб", desc: "массив, матовая отделка", price: 32000, costPrice: 15500, image: null, render: { color: "#8a5a2b", grain: "#6d4420" } },
      { id: "coffin-mahogany", category: "coffin", name: "Махагон", desc: "тёмное дерево, глянец", price: 45000, costPrice: 22000, image: null, render: { color: "#5a2e22", grain: "#431f16" } },
      { id: "coffin-white", category: "coffin", name: "Белый лак", desc: "лакированный, светлый", price: 52000, costPrice: 26000, image: null, render: { color: "#ece7dc", grain: "#d8cfbe" } },
    ],
  },
  {
    category: "fittings",
    title: "Фурнитура",
    multi: false,
    optional: false,
    items: [
      { id: "fit-silver", category: "fittings", name: "Серебро", desc: "ручки и уголки", price: 900, costPrice: 450, image: null, render: { metal: "#b9bcc2" } },
      { id: "fit-gold", category: "fittings", name: "Золото", desc: "ручки и уголки", price: 1400, costPrice: 700, image: null, render: { metal: "#c6a24a" } },
      { id: "fit-bronze", category: "fittings", name: "Бронза", desc: "ручки и уголки", price: 1100, costPrice: 550, image: null, render: { metal: "#9c6b3f" } },
    ],
  },
  {
    category: "textile",
    title: "Покрывало",
    multi: false,
    optional: true,
    items: [
      { id: "tex-satin", category: "textile", name: "Атлас белый", desc: "классический", price: 2500, costPrice: 1250, image: null, render: { color: "#f2efe8" } },
      { id: "tex-velvet", category: "textile", name: "Бархат бордовый", desc: "плотный", price: 4800, costPrice: 2400, image: null, render: { color: "#6e2230" } },
      { id: "tex-brocade", category: "textile", name: "Парча золотая", desc: "узорная", price: 6500, costPrice: 3250, image: null, render: { color: "#b8954a" } },
    ],
  },
  {
    category: "cross",
    title: "Крест / памятный знак",
    multi: false,
    optional: true,
    items: [
      { id: "cross-wood", category: "cross", name: "Деревянный крест", desc: "сосна", price: 3500, costPrice: 1800, image: null, render: { color: "#7a5230", style: "wood" } },
      { id: "cross-orthodox", category: "cross", name: "Православный крест", desc: "резной, восьмиконечный", price: 6000, costPrice: 3200, image: null, render: { color: "#6b4423", style: "carved" } },
      { id: "cross-metal", category: "cross", name: "Металлический крест", desc: "с напылением", price: 7500, costPrice: 4200, image: null, render: { color: "#8a8f99", style: "metal" } },
    ],
  },
  {
    category: "wreath",
    title: "Венки",
    multi: true,
    optional: true,
    items: [
      { id: "wreath-classic", category: "wreath", name: "Классический", desc: "хвоя, белые розы", price: 2800, costPrice: 1000, image: null, render: { color: "#3f5d3a", accent: "#efece4" } },
      { id: "wreath-mourning", category: "wreath", name: "Траурный", desc: "хвоя, красные гвоздики", price: 3500, costPrice: 1300, image: null, render: { color: "#33402f", accent: "#9e3b32" } },
      { id: "wreath-basket", category: "wreath", name: "Корзина лилий", desc: "белые лилии", price: 5200, costPrice: 2500, image: null, render: { color: "#46603f", accent: "#f3efe6" } },
    ],
  },
];

export interface AttrSelection {
  coffin?: string;
  fittings?: string;
  textile?: string;
  cross?: string;
  wreaths: string[];
}

export const DEFAULT_ATTRIBUTES: AttrSelection = {
  coffin: "coffin-pine",
  fittings: "fit-silver",
  textile: undefined,
  cross: undefined,
  wreaths: [],
};

const ITEM_INDEX: Record<string, AttrItem> = Object.fromEntries(
  ATTRIBUTE_CATALOG.flatMap((g) => g.items.map((i) => [i.id, i])),
);

export function getItem(id: string | undefined): AttrItem | undefined {
  return id ? ITEM_INDEX[id] : undefined;
}

/** Сумма выбранной атрибутики, в рублях. */
export function attributesTotal(sel: AttrSelection | undefined): number {
  if (!sel) return 0;
  let total = 0;
  for (const id of [sel.coffin, sel.fittings, sel.textile, sel.cross]) {
    const it = getItem(id);
    if (it) total += it.price;
  }
  for (const id of sel.wreaths ?? []) {
    const it = getItem(id);
    if (it) total += it.price;
  }
  return total;
}

export function selectedAttributeMarginItems(sel: AttrSelection | undefined) {
  if (!sel) return [];

  return [sel.coffin, sel.fittings, sel.textile, sel.cross, ...(sel.wreaths ?? [])]
    .map(getItem)
    .filter((item): item is AttrItem => Boolean(item))
    .map((item) => ({
      name: item.name,
      category: item.category === "wreath" ? "Венки" : "Атрибутика",
      clientPrice: item.price,
      costPrice: item.costPrice,
      quantity: 1,
    }));
}

/** Нормализует произвольный объект до валидного AttrSelection (для клиентских правок). */
export function normalizeSelection(raw: unknown): AttrSelection {
  const r = (raw ?? {}) as Partial<AttrSelection>;
  const validId = (id: unknown, cat: AttrCategory) =>
    typeof id === "string" && ITEM_INDEX[id]?.category === cat ? id : undefined;
  return {
    coffin: validId(r.coffin, "coffin"),
    fittings: validId(r.fittings, "fittings"),
    textile: validId(r.textile, "textile"),
    cross: validId(r.cross, "cross"),
    wreaths: Array.isArray(r.wreaths)
      ? r.wreaths.filter((id): id is string => validId(id, "wreath") !== undefined).slice(0, 6)
      : [],
  };
}
