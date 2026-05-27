// MIRROR of gorgerich/frontend/app/components/calculationUtils.ts — keep in sync manually.
// Only change from original: DEFAULT_CALCULATOR_CONFIG is exported (needed for B2B agent tool).
// Tracking helpers (reachMetrikaGoal, trackEvent, etc.) are preserved for sync simplicity.

// Справочник цен
export const PRICES = {
  // Формат
  hallDuration: {
    30: 0,
    60: 8000,
    90: 12000,
  },
  ceremonyType: {
    civil: 0,
    religious: 15000,
    combined: 20000,
  },
  // Логистика
  hearse: 8000,
  familyTransport: {
    5: 5000,
    10: 8000,
    15: 12000,
  },
  pallbearers: 6000,
};

export const BASE_START_PRICE = 28000;

export const PLAN_DELTAS = {
  hall: {
    none: -15000,
    "60": 0,
    "90": 8000,
  },
  ceremony: {
    secular: 0,
    religious: 15000,
    mixed: 20000,
    unknown: 0,
  },
  hearse: {
    standard: 0,
    comfort: 15000,
    premium: 45000,
  },
  transport: {
    none: -12000,
    "10": 0,
    "15": 8000,
  },
  pallbearers: {
    included: 0,
    none: -7000,
  },
  attributesLevel: {
    minimal: -9000,
    recommended: 0,
    extended: 16000,
    custom: 0,
  },
} as const;

export type PlanState = {
  format: "burial" | "cremation" | "unknown";
  hall: keyof typeof PLAN_DELTAS.hall;
  ceremony: keyof typeof PLAN_DELTAS.ceremony;
  hearse: keyof typeof PLAN_DELTAS.hearse;
  transport: keyof typeof PLAN_DELTAS.transport;
  pallbearers: keyof typeof PLAN_DELTAS.pallbearers;
  attributesLevel: keyof typeof PLAN_DELTAS.attributesLevel;
};

const formatRubLocal = (v: number) => Math.round(v).toLocaleString("ru-RU");

export const formatDelta = (delta: number) => {
  const sign = delta >= 0 ? "+" : "−";
  return `${sign} ${formatRubLocal(Math.abs(delta))} ₽`;
};

export const formatCurrency = (value: number) => `${formatRubLocal(value)} ₽`;

export const calcPlanTotal = (plan: PlanState) => {
  return (
    BASE_START_PRICE +
    PLAN_DELTAS.hall[plan.hall] +
    PLAN_DELTAS.ceremony[plan.ceremony] +
    PLAN_DELTAS.hearse[plan.hearse] +
    PLAN_DELTAS.transport[plan.transport] +
    PLAN_DELTAS.pallbearers[plan.pallbearers] +
    PLAN_DELTAS.attributesLevel[plan.attributesLevel]
  );
};

export type TariffDraftConfig = {
  format: "burial" | "cremation" | "unknown";
  transport: "none" | "standard" | "comfort" | "premium";
  pallbearers: "none" | "standard" | "comfort" | "premium";
  hall: "none" | "60";
  hearseTier: "standard" | "comfort" | "premium";
  coordinationTier: "base" | "comfort" | "premium";
  ceremonyType: "secular" | "religious" | "mixed";
  churchService: "none" | "morgue" | "parish" | "cathedral";
  panikhida: "none" | "standard" | "comfort" | "premium";
  memorialMeal: "none" | "standard" | "comfort" | "premium";
  host: "no" | "yes";
};

type TariffBreakdownItem = {
  key: string;
  label: string;
  price?: number | null;
  delta?: number | null;
  note?: string;
};

// Типовые диапазоны и ориентиры (используем консервативные значения)
export const TARIFF_PRICING = {
  basePrice: 86600,
  transport: {
    none: 0,
    standard: 11400,
    comfort: 15300,
    premium: 39000,
  },
  pallbearers: {
    none: 0,
    standard: 8000,
    comfort: 16100,
    premium: 24000,
  },
  hearseTier: {
    standard: 0,
    comfort: 12000,
    premium: 35000,
  },
  hall: {
    none: 0,
    "60": 10000,
  },
  coordinationTier: {
    base: 0,
    comfort: 14100,
    premium: 90000,
  },
  ceremony: {
    secular: 0,
    religious: 15000,
    mixed: 20000,
  },
  churchService: {
    none: 0,
    morgue: 4000,
    parish: 6000,
    cathedral: 47000,
  },
  panikhida: {
    none: 0,
    standard: 5000,
    comfort: 10000,
    premium: 20000,
  },
  memorialMeal: {
    none: 0,
    standard: 800,
    comfort: 1500,
    premium: 3000,
  },
  host: {
    no: 0,
    yes: 37000,
  },
} as const;

export const BASE_TARIFF_TOTAL = 86600;
export const BASE_TARIFF_LINES = [
  { key: "sanitary", label: "Санитарно-косметическая подготовка в морге", price: 18000 },
  { key: "attributes", label: "Атрибутика", price: 20000 },
  { key: "hearse", label: "Катафалк", price: 13500 },
  { key: "digging", label: "Подготовка места захоронения", price: 24700 },
  { key: "coord", label: "Координатор базовый", price: 10400 },
] as const;

export const calcTariffTotal = (config: TariffDraftConfig) => {
  const breakdown: TariffBreakdownItem[] = [];

  breakdown.push({
    key: "base",
    label: "Тариф «Традиционный»",
    price: TARIFF_PRICING.basePrice,
    delta: 0,
  });

  const addLine = (key: string, label: string, price: number, delta: number) => {
    if (price === 0 && delta === 0) return;
    breakdown.push({ key, label, price, delta });
  };

  addLine(
    "transport",
    "Транспорт для близких",
    TARIFF_PRICING.transport[config.transport],
    TARIFF_PRICING.transport[config.transport],
  );

  addLine(
    "pallbearers",
    "Носильщики",
    TARIFF_PRICING.pallbearers[config.pallbearers],
    TARIFF_PRICING.pallbearers[config.pallbearers],
  );

  addLine(
    "hearseTier",
    "Катафалк",
    TARIFF_PRICING.hearseTier[config.hearseTier],
    TARIFF_PRICING.hearseTier[config.hearseTier],
  );

  addLine(
    "hall",
    "Зал прощания",
    TARIFF_PRICING.hall[config.hall],
    TARIFF_PRICING.hall[config.hall],
  );

  addLine(
    "coordinationTier",
    "Координатор",
    TARIFF_PRICING.coordinationTier[config.coordinationTier],
    TARIFF_PRICING.coordinationTier[config.coordinationTier],
  );

  if (config.ceremonyType !== "secular") {
    addLine(
      "ceremonyType",
      config.ceremonyType === "religious" ? "Религиозная церемония" : "Комбинированная церемония",
      TARIFF_PRICING.ceremony[config.ceremonyType],
      TARIFF_PRICING.ceremony[config.ceremonyType],
    );
  }

  if (config.churchService !== "none") {
    addLine(
      "churchService",
      "Отпевание",
      TARIFF_PRICING.churchService[config.churchService],
      TARIFF_PRICING.churchService[config.churchService],
    );
  }

  if (config.panikhida !== "none") {
    addLine(
      "panikhida",
      "Панихида",
      TARIFF_PRICING.panikhida[config.panikhida],
      TARIFF_PRICING.panikhida[config.panikhida],
    );
  }

  if (config.memorialMeal !== "none") {
    addLine(
      "memorialMeal",
      "Поминальный обед",
      TARIFF_PRICING.memorialMeal[config.memorialMeal],
      TARIFF_PRICING.memorialMeal[config.memorialMeal],
    );
  }

  if (config.host === "yes") {
    addLine("host", "Ведущий", TARIFF_PRICING.host.yes, TARIFF_PRICING.host.yes);
  }

  const total = breakdown.reduce((sum, item) => sum + (item.price || 0), 0);

  return {
    total,
    breakdown,
  };
};

export type AllInclusiveTier = "standard" | "comfort" | "premium";
export type AllInclusivePackageKey = "basic" | "complete" | "care";

export const ALL_INCLUSIVE_PRICES: Record<AllInclusivePackageKey, Record<AllInclusiveTier, number>> =
  {
    basic: { standard: 160000, comfort: 220000, premium: 280000 },
    complete: { standard: 260000, comfort: 360000, premium: 460000 },
    care: { standard: 360000, comfort: 480000, premium: 620000 },
  };

export const calcAllInclusiveTotal = (
  pkg: AllInclusivePackageKey,
  tier: AllInclusiveTier
) => ALL_INCLUSIVE_PRICES[pkg][tier];

const WREATH_TYPE_LABELS: Record<string, string> = {
  artificial: "Искусственные цветы",
  composition: "Живая композиция",
};

const WREATH_SIZE_LABELS: Record<string, string> = {
  S: "Малый",
  M: "Средний",
  L: "Большой",
};

// Готовые пакеты
export const PACKAGES = [
  {
    id: "basic",
    name: "С поддержкой координатора",
    price: 204928,
    description: "Координатор помогает точечно, по необходимости",
    features: [
      "Оформление документов",
      "Помощь в оформлении захоронения",
      "Базовая подготовка тела",
      "Перевозка к месту прощания/захоронения",
      "Носильщики",
      "Катафалк (стандарт)",
      "Гроб для захоронения (сосна)",
      "Венок (искусственный)",
      "Базовая отделка (обивка)",
      "Зал прощания",
      "Транспорт для близких (до 5 человек)",
      "Координатор в день церемонии"
    ],
  },
  {
    id: "standard",
    name: "Расширенное сопровождение",
    price: 401193,
    description: "Координатор ведёт процесс и контролирует детали",
    features: [
      "Оформление документов",
      "Помощь в оформлении захоронения",
      "Базовая подготовка тела",
      "Перевозка к месту прощания/захоронения",
      "Носильщики",
      "Катафалк (комфорт)",
      "Гроб для захоронения (дуб)",
      "Венок (искусственный/живая композиция)",
      "Улучшенная отделка (обивка)",
      "Зал прощания",
      "Транспорт для близких (до 10 человек)",
      "Координатор в день церемонии"
    ],
    popular: true,
  },
  {
    id: "premium",
    name: "Передать всё координатору",
    price: 609491,
    description: "Персональное сопровождение, вы передаёте процесс полностью",
    features: [
      "Оформление документов",
      "Помощь в оформлении захоронения",
      "Базовая подготовка тела",
      "Перевозка к месту прощания/захоронения,",
      "Носильщики",
      "Катафалк (премиальный)",
      "Гроб для захоронения (ценное дерево)",
      "Венок (премиальная флористика)",
      "Премиальная отделка (обивка)",
      "Зал прощания",
      "Транспорт для близких повышенного комфорта (до 15 человек)",
      "Старший координатор церемонии"
    ],
  },
  {
    id: "cremation-standard",
    name: "Стандарт",
    price: 200000,
    description: "Базовый комплект услуг для кремации",
    features: [
      "Оформление документов",
      "Бронирование места в колумбарии",
      "Хранение и базовая подготовка тела",
      "Гроб-контейнер для кремации",
      "Транспортировка до крематория",
      "Кремация + урна стандартная",
    ],
  },
  {
    id: "cremation-comfort",
    name: "Комфорт",
    price: 400000,
    description: "Расширенный набор услуг для кремации",
    features: [
      "Оформление документов",
      "Бронирование места в колумбарии",
      "Хранение и подготовка тела",
      "Гроб для прощания + гроб-контейнер",
      "Транспортировка до крематория",
      "Кремация",
      "Урна керамическая",
      "Зал прощания на 2 часа",
      "Поминальный обед (до 20 человек)",
    ],
  },
  {
    id: "cremation-premium",
    name: "Премиум",
    price: 600000,
    description: "Полный спектр услуг премиум класса",
    features: [
      "Оформление документов",
      "Бронирование места в колумбарии премиум",
      "Хранение и подготовка тела",
      "Гроб элитный для прощания + контейнер",
      "Транспортировка покойного",
      "Кремация",
      "Урна премиум (мрамор/гранит)",
      "Композиция из живых цветов",
      "Ритуальные принадлежности премиум",
      "Ритуальный зал на 4 часа",
      "Поминальный обед (до 40 человек)",
      "Индивидуальный координатор",
    ],
  },
];

export const SIMPLIFIED_HALL_INCLUDED_MINUTES_BY_PACKAGE: Record<string, number> = {
  basic: 30,
  standard: 60,
  premium: 90,
  "cremation-standard": 30,
  "cremation-comfort": 60,
  "cremation-premium": 90,
};

// Дополнительные услуги
export const ADDITIONAL_SERVICES = [
  {
    id: "morgue-storage",
    name: "Хранение в морге",
    price: 2500,
    costPrice: 2500,
    description: "Резерв времени до церемонии",
  },
  {
    id: "sanitary-prep",
    name: "Санитарная подготовка и бальзамирование",
    price: 12000,
    costPrice: 12000,
    description: "Аккуратный внешний вид",
  },
  {
    id: "makeup",
    name: "Косметическая подготовка",
    price: 8000,
    costPrice: 4000,
    description: "Профессиональный макияж",
  },
  {
    id: "clothing",
    name: "Ритуальная одежда",
    price: 5000,
    costPrice: 2500,
    description: "Подготовка одежды",
  },
  {
    id: "photography",
    name: "Фотосъемка церемонии",
    price: 15000,
    costPrice: 7000,
    description: "Профессиональная съемка",
  },
  {
    id: "videography",
    name: "Видеосъемка церемонии",
    price: 25000,
    costPrice: 12000,
    description: "Профессиональная видеосъемка",
  },
  {
    id: "music",
    name: "Музыкальное сопровождение",
    price: 10000,
    costPrice: 4500,
    description: "Живая музыка или фон",
  },
  {
    id: "flowers-premium",
    name: "Премиум цветочная композиция",
    price: 20000,
    costPrice: 8000,
    description: "Эксклюзивная композиция",
  },
  {
    id: "catering",
    name: "Поминальный обед",
    price: 30000,
    costPrice: 22000,
    description: "Организация поминального обеда",
  },
  {
    id: "memorial-plaque",
    name: "Памятная табличка",
    price: 8000,
    costPrice: 3500,
    description: "Временная табличка",
  },
];

// Кладбища Москвы
export const MOSCOW_CEMETERIES = [
  {
    name: "Троекуровское кладбище",
    type: "burial",
    district: "ЗАО",
    categories: {
      standard: 120000,
      comfort: 220000,
      premium: 350000,
    },
  },
  {
    name: "Хованское кладбище (Южное)",
    type: "burial",
    district: "ЮЗАО",
    categories: {
      standard: 100000,
      comfort: 200000,
      premium: 300000,
    },
  },
  {
    name: "Хованское кладбище (Северное)",
    type: "burial",
    district: "ЮЗАО",
    categories: {
      standard: 100000,
      comfort: 200000,
      premium: 300000,
    },
  },
  {
    name: "Хованское кладбище (Западное)",
    type: "burial",
    district: "ЮЗАО",
    categories: {
      standard: 100000,
      comfort: 200000,
      premium: 300000,
    },
  },
  {
    name: "Хованское кладбище (Центральное)",
    type: "burial",
    district: "ЮЗАО",
    categories: {
      standard: 100000,
      comfort: 200000,
      premium: 300000,
    },
  },
  {
    name: "Митинское кладбище",
    type: "burial",
    district: "СЗАО",
    categories: {
      standard: 100000,
      comfort: 200000,
      premium: 300000,
    },
  },
  {
    name: "Николо-Архангельское кладбище",
    type: "burial",
    district: "ВАО",
    categories: {
      standard: 100000,
      comfort: 200000,
      premium: 300000,
    },
  },
  {
    name: "Востряковское кладбище",
    type: "burial",
    district: "ЮЗАО",
    categories: {
      standard: 100000,
      comfort: 200000,
      premium: 300000,
    },
  },
  {
    name: "Долгопрудненское кладбище",
    type: "burial",
    district: "САО",
    categories: {
      standard: 100000,
      comfort: 200000,
      premium: 300000,
    },
  },
  {
    name: "Перепечинское кладбище",
    type: "burial",
    district: "ВАО",
    categories: {
      standard: 90000,
      comfort: 180000,
      premium: 280000,
    },
  },
  {
    name: "Роговское кладбище",
    type: "burial",
    district: "ЮВАО",
    categories: {
      standard: 90000,
      comfort: 180000,
      premium: 280000,
    },
  },
  {
    name: "Алмазовское кладбище",
    type: "burial",
    district: "ЗАО",
    categories: {
      standard: 90000,
      comfort: 180000,
      premium: 280000,
    },
  },
  {
    name: "Хохловское кладбище",
    type: "burial",
    district: "СВАО",
    categories: {
      standard: 90000,
      comfort: 180000,
      premium: 280000,
    },
  },
  {
    name: "Бабушкинское кладбище",
    type: "burial",
    district: "СВАО",
    categories: {
      standard: 110000,
      comfort: 210000,
      premium: 310000,
    },
  },
  {
    name: "Головинское кладбище",
    type: "burial",
    district: "САО",
    categories: {
      standard: 120000,
      comfort: 220000,
      premium: 320000,
    },
  },
  {
    name: "Перовское кладбище",
    type: "burial",
    district: "ВАО",
    categories: {
      standard: 95000,
      comfort: 190000,
      premium: 290000,
    },
  },
  // Крематории Москвы
  {
    name: "Николо-Архангельский крематорий",
    type: "cremation",
    district: "ВАО",
    categories: {
      standard: 15000,
      comfort: 25000,
      premium: 40000,
    },
  },
  {
    name: "Митинский крематорий",
    type: "cremation",
    district: "СЗАО",
    categories: {
      standard: 15000,
      comfort: 25000,
      premium: 40000,
    },
  },
  {
    name: "Хованский крематорий",
    type: "cremation",
    district: "ЮЗАО",
    categories: {
      standard: 15000,
      comfort: 25000,
      premium: 40000,
    },
  },
];

// Кладбища Московской области
export const MO_CEMETERIES = [
  {
    name: "Мытищинское кладбище (Волковское)",
    type: "burial",
    district: "Мытищинский район",
    categories: {
      standard: 80000,
      comfort: 150000,
      premium: 250000,
    },
  },
  {
    name: "Красногорское кладбище",
    type: "burial",
    district: "Красногорский район",
    categories: {
      standard: 85000,
      comfort: 160000,
      premium: 260000,
    },
  },
  {
    name: "Новолюберецкое кладбище",
    type: "burial",
    district: "Люберецкий район",
    categories: {
      standard: 75000,
      comfort: 140000,
      premium: 240000,
    },
  },
  {
    name: "Шереметьевское кладбище",
    type: "burial",
    district: "Долгопрудный",
    categories: {
      standard: 70000,
      comfort: 130000,
      premium: 220000,
    },
  },
  {
    name: "Невзоровское кладбище",
    type: "burial",
    district: "Пушкинский район",
    categories: {
      standard: 65000,
      comfort: 120000,
      premium: 200000,
    },
  },
  {
    name: "Островецкое кладбище",
    type: "burial",
    district: "Раменский район",
    categories: {
      standard: 60000,
      comfort: 110000,
      premium: 190000,
    },
  },
  {
    name: "Домодедовское городское кладбище",
    type: "burial",
    district: "Домодедово",
    categories: {
      standard: 70000,
      comfort: 130000,
      premium: 220000,
    },
  },
  {
    name: "Балашихинское (Новое) кладбище",
    type: "burial",
    district: "Балашиха",
    categories: {
      standard: 75000,
      comfort: 140000,
      premium: 230000,
    },
  },
  {
    name: "Химкинское кладбище",
    type: "burial",
    district: "Химки",
    categories: {
      standard: 90000,
      comfort: 170000,
      premium: 270000,
    },
  },
  {
    name: "Лайковское кладбище",
    type: "burial",
    district: "Одинцовский район",
    categories: {
      standard: 100000,
      comfort: 200000,
      premium: 300000,
    },
  },
  {
    name: "Нахабинское кладбище",
    type: "burial",
    district: "Красногорский район",
    categories: {
      standard: 70000,
      comfort: 130000,
      premium: 220000,
    },
  },
  {
    name: "Каширское кладбище",
    type: "burial",
    district: "Кашира",
    categories: {
      standard: 50000,
      comfort: 90000,
      premium: 150000,
    },
  },
];

export interface CalculatorItem {
  name: string;
  price?: number;
}

export interface CalculatorSection {
  category: string;
  price: number;
  items?: CalculatorItem[];
}

export type CalculationItem = {
  label: string;
  price?: number;
  category?: string;
  clientPrice?: number;
  costPrice?: number;
  quantity?: number;
  included?: boolean;
};

export type CalculationSection = {
  title: string;
  total: number;
  costTotal?: number;
  items?: CalculationItem[];
};

export type CalculationResult = {
  total: number;
  sections: CalculationSection[];
};

export type CalculatorConfig = {
  base: {
    title: string;
    price: number;
    items: string[];
  };
  prices: {
    hallDuration: Record<number, number>;
    ceremonyType: Record<string, number>;
    hearse: number;
    familyTransport: Record<number, number>;
    pallbearers: number;
  };
  costs: {
    base: number;
    hallDuration: Record<number, number>;
    ceremonyType: Record<string, number>;
    hearse: number;
    familyTransport: Record<number, number>;
    pallbearers: number;
    packageCostRatio: number;
    cemeteryCostRatio: number;
  };
  packages: {
    id: string;
    name: string;
    price: number;
    features: string[];
  }[];
  additionalServices: {
    id: string;
    name: string;
    price: number;
    costPrice?: number;
  }[];
  cemeteries: {
    name: string;
    categories: {
      standard?: number;
      comfort?: number;
      premium?: number;
    };
  }[];
  cemeteryCategoryLabels: {
    standard: string;
    comfort: string;
    premium: string;
  };
  cemeterySectionTitle: (categoryLabel: string) => string;
  includeCemeteryCategoryItem: boolean;
  includeCemeteryWithPackage: boolean;
  includeLogisticsWithPackage: boolean;
  includeFormatWithPackage: boolean;
  includeAdditionalWithPackage: boolean;
  includeBaseWithPackage: boolean;
  packageSectionMinPrice: number;
  hallIncludedMinutesByPackage?: Record<string, number>;
};

export interface FormData {
  serviceType: string;
  hasHall: boolean;
  hallDuration: number;
  ceremonyType: string;
  packageType: string;
  needsHearse: boolean;
  needsFamilyTransport: boolean;
  familyTransportSeats: number;
  needsPallbearers: boolean;
  selectedAdditionalServices: string[];
  cemetery: string;
  clientBudget?: number | null;
  [key: string]: any;
}

export type MarginItemInput = {
  name?: string;
  label?: string;
  category?: string;
  clientPrice?: number | null;
  costPrice?: number | null;
  price?: number | null;
  amount?: number | null;
  total?: number | null;
  quantity?: number | null;
};

export type ItemMargin = {
  name: string;
  category: string;
  clientPrice: number;
  costPrice: number;
  quantity: number;
  totalClientPrice: number;
  totalCostPrice: number;
  marginRub: number;
  marginPercent: number;
};

export type OrderEconomics = {
  items: ItemMargin[];
  orderClientTotal: number;
  orderCostTotal: number;
  orderMarginRub: number;
  orderMarginPercent: number;
};

export type BudgetStatus = {
  clientBudget: number | null;
  budgetRemaining: number;
  budgetExceeded: boolean;
  budgetUsagePercent: number;
  status: "not_set" | "within" | "near_limit" | "exceeded";
};

export type MemorialStatus = "not_discussed" | "not_needed" | "client_handles" | "agent_helps";

export type MemorialData = {
  status: MemorialStatus;
  guestsCount?: number | null;
  comment?: string;
  includeCafeAssistance?: boolean;
};

export type ExternalExpenseCategory =
  | "Морг"
  | "Кладбище"
  | "Крематорий"
  | "Церковь / отпевание"
  | "Демонтаж / подготовка места"
  | "Документы"
  | "Доставка"
  | "Другое";

export type ExternalExpense = {
  id: string;
  name: string;
  category: ExternalExpenseCategory;
  clientPrice: number;
  costPrice: number;
  comment?: string;
  includeInClientTotal: boolean;
  includeInMarginCalculation: boolean;
};

export type PublicExternalExpense = {
  id: string;
  name: string;
  category: ExternalExpenseCategory;
  clientPrice: number;
  comment?: string;
};

export type EstimateSnapshot = {
  id: string;
  createdAt: string;
  title: string;
  items: EstimateItem[];
  externalExpenses: ExternalExpense[];
  memorialData: MemorialData;
  orderClientTotal: number;
  orderCostTotal: number;
  orderMarginRub: number;
  orderMarginPercent: number;
  clientBudget?: number | null;
  budgetRemaining?: number | null;
  budgetExceeded?: boolean;
  note?: string;
};

export type CatalogCategory =
  | "Гробы"
  | "Постель / комплект в гроб"
  | "Венки"
  | "Кресты / таблички"
  | "Транспорт"
  | "Бригада / грузчики"
  | "Урны"
  | "Дополнительные услуги";

export type CatalogItem = {
  id: string;
  name: string;
  category: CatalogCategory;
  description: string;
  imageUrl?: string | null;
  imagePlaceholder: string;
  clientPrice: number;
  costPrice: number;
  quantityDefault: number;
  availableColors?: string[];
  selectedColor?: string;
  isRequired?: boolean;
  isRecommended?: boolean;
  tags?: string[];
};

export type EstimateItem = {
  id: string;
  catalogItemId: string;
  name: string;
  category: CatalogCategory | "Поминки / кафе";
  description: string;
  imagePlaceholder: string;
  clientPrice: number;
  costPrice: number;
  quantity: number;
  selectedColor?: string;
  isRequired?: boolean;
  isRecommended?: boolean;
  isOptional?: boolean;
  source?: string;
  tags?: string[];
};

export type PublicEstimateItem = {
  id: string;
  name: string;
  category: CatalogCategory | "Поминки / кафе";
  description: string;
  imagePlaceholder: string;
  clientPrice: number;
  quantity: number;
  selectedColor?: string;
};

export const CATALOG_CATEGORIES: CatalogCategory[] = [
  "Гробы",
  "Постель / комплект в гроб",
  "Венки",
  "Кресты / таблички",
  "Транспорт",
  "Бригада / грузчики",
  "Урны",
  "Дополнительные услуги",
];

export const DEFAULT_MEMORIAL_DATA: MemorialData = {
  status: "not_discussed",
  guestsCount: null,
  comment: "",
  includeCafeAssistance: false,
};

export const EXTERNAL_EXPENSE_CATEGORIES: ExternalExpenseCategory[] = [
  "Морг",
  "Кладбище",
  "Крематорий",
  "Церковь / отпевание",
  "Демонтаж / подготовка места",
  "Документы",
  "Доставка",
  "Другое",
];

// Temporary mock external expense presets for agent prototype. Not real official prices.
export const EXTERNAL_EXPENSE_PRESETS: Omit<ExternalExpense, "id" | "includeInClientTotal" | "includeInMarginCalculation">[] = [
  {
    name: "Подготовка тела в морге",
    category: "Морг",
    clientPrice: 30000,
    costPrice: 30000,
    comment: "Зависит от условий конкретного морга",
  },
  {
    name: "Крематорий",
    category: "Крематорий",
    clientPrice: 35000,
    costPrice: 35000,
  },
  {
    name: "Отпевание",
    category: "Церковь / отпевание",
    clientPrice: 8000,
    costPrice: 3000,
  },
  {
    name: "Демонтаж на кладбище",
    category: "Демонтаж / подготовка места",
    clientPrice: 15000,
    costPrice: 12000,
  },
  {
    name: "Дополнительные расходы кладбища",
    category: "Кладбище",
    clientPrice: 50000,
    costPrice: 50000,
  },
];

const MEMORIAL_ASSISTANCE_ITEM: EstimateItem = {
  id: "memorial:cafe-assistance",
  catalogItemId: "memorial-cafe-assistance",
  name: "Помощь с подбором кафе / поминок",
  category: "Поминки / кафе",
  description: "Подбор вариантов кафе и меню для семьи",
  imagePlaceholder: "ПК",
  clientPrice: 10000,
  costPrice: 0,
  quantity: 1,
  isOptional: true,
  source: "memorial_block",
};

// Temporary mock catalog data for agent attribution prototype. Not real supplier prices.
export const AGENT_ATTRIBUTION_CATALOG: CatalogItem[] = [
  {
    id: "coffin-fabric-standard",
    name: "Гроб тканевый стандартный",
    category: "Гробы",
    description: "Бюджетный вариант с тканевой обивкой",
    imagePlaceholder: "ГТ",
    clientPrice: 18000,
    costPrice: 9000,
    quantityDefault: 1,
    availableColors: ["синий", "бордовый", "белый", "чёрный"],
    isRecommended: true,
    tags: ["атрибутика", "бюджет"],
  },
  {
    id: "coffin-lacquered",
    name: "Гроб лакированный",
    category: "Гробы",
    description: "Классический деревянный гроб с лаковым покрытием",
    imagePlaceholder: "ГЛ",
    clientPrice: 35000,
    costPrice: 17000,
    quantityDefault: 1,
    availableColors: ["тёмный орех", "светлый орех", "вишня"],
    tags: ["атрибутика"],
  },
  {
    id: "coffin-premium-lacquered",
    name: "Гроб премиальный лакированный",
    category: "Гробы",
    description: "Премиальная лакированная модель для расширенной сметы",
    imagePlaceholder: "ГП",
    clientPrice: 65000,
    costPrice: 36000,
    quantityDefault: 1,
    availableColors: ["тёмный орех", "махагон"],
    tags: ["премиум"],
  },
  {
    id: "lining-standard",
    name: "Комплект в гроб стандартный",
    category: "Постель / комплект в гроб",
    description: "Базовый комплект постели и покрывала",
    imagePlaceholder: "КС",
    clientPrice: 5000,
    costPrice: 2500,
    quantityDefault: 1,
    isRequired: true,
  },
  {
    id: "lining-improved",
    name: "Комплект в гроб улучшенный",
    category: "Постель / комплект в гроб",
    description: "Улучшенная ткань и аккуратная отделка",
    imagePlaceholder: "КУ",
    clientPrice: 9000,
    costPrice: 4500,
    quantityDefault: 1,
    isRecommended: true,
  },
  {
    id: "wreath-standard",
    name: "Венок стандартный",
    category: "Венки",
    description: "Классический венок с траурной лентой",
    imagePlaceholder: "ВС",
    clientPrice: 7000,
    costPrice: 2500,
    quantityDefault: 1,
    isRecommended: true,
  },
  {
    id: "wreath-improved",
    name: "Венок улучшенный",
    category: "Венки",
    description: "Более плотная композиция с расширенным набором цветов",
    imagePlaceholder: "ВУ",
    clientPrice: 12000,
    costPrice: 4500,
    quantityDefault: 1,
  },
  {
    id: "flower-basket",
    name: "Корзина цветов",
    category: "Венки",
    description: "Небольшая цветочная корзина для церемонии",
    imagePlaceholder: "КЦ",
    clientPrice: 9000,
    costPrice: 3500,
    quantityDefault: 1,
  },
  {
    id: "cross-wood-catalog",
    name: "Крест деревянный",
    category: "Кресты / таблички",
    description: "Временный деревянный крест",
    imagePlaceholder: "КР",
    clientPrice: 6000,
    costPrice: 3000,
    quantityDefault: 1,
  },
  {
    id: "nameplate",
    name: "Табличка",
    category: "Кресты / таблички",
    description: "Временная табличка с данными",
    imagePlaceholder: "ТБ",
    clientPrice: 2500,
    costPrice: 1000,
    quantityDefault: 1,
  },
  {
    id: "hearse-catalog",
    name: "Катафалк",
    category: "Транспорт",
    description: "Транспорт для сопровождения церемонии",
    imagePlaceholder: "КТ",
    clientPrice: 18000,
    costPrice: 12000,
    quantityDefault: 1,
    isRequired: true,
  },
  {
    id: "family-bus",
    name: "Автобус для родственников",
    category: "Транспорт",
    description: "Транспорт для близких на день церемонии",
    imagePlaceholder: "АВ",
    clientPrice: 15000,
    costPrice: 10000,
    quantityDefault: 1,
  },
  {
    id: "support-crew",
    name: "Бригада сопровождения",
    category: "Бригада / грузчики",
    description: "Команда для переноса и сопровождения",
    imagePlaceholder: "БС",
    clientPrice: 12000,
    costPrice: 8000,
    quantityDefault: 1,
    isRecommended: true,
  },
  {
    id: "urn-standard",
    name: "Урна стандартная",
    category: "Урны",
    description: "Базовая урна для кремации",
    imagePlaceholder: "УС",
    clientPrice: 6000,
    costPrice: 2500,
    quantityDefault: 1,
  },
  {
    id: "urn-improved",
    name: "Урна улучшенная",
    category: "Урны",
    description: "Улучшенная урна с более плотным материалом",
    imagePlaceholder: "УУ",
    clientPrice: 12000,
    costPrice: 5000,
    quantityDefault: 1,
  },
  {
    id: "cafe-help",
    name: "Помощь с кафе / поминками",
    category: "Дополнительные услуги",
    description: "Координация кафе и поминального обеда",
    imagePlaceholder: "ПМ",
    clientPrice: 10000,
    costPrice: 0,
    quantityDefault: 1,
    tags: ["сервис"],
  },
  {
    id: "church-ceremony",
    name: "Организация отпевания",
    category: "Дополнительные услуги",
    description: "Организация отпевания и согласование времени",
    imagePlaceholder: "ОТ",
    clientPrice: 8000,
    costPrice: 3000,
    quantityDefault: 1,
  },
  {
    id: "agent-services",
    name: "Услуги агента",
    category: "Дополнительные услуги",
    description: "Сопровождение семьи агентом",
    imagePlaceholder: "АГ",
    clientPrice: 32000,
    costPrice: 0,
    quantityDefault: 1,
    isRecommended: true,
  },
];

const toSafeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const percentOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

export function calculateItemMargin(item: MarginItemInput): ItemMargin {
  const clientPrice = Math.max(0, toSafeNumber(item.clientPrice ?? item.price ?? item.amount ?? item.total));
  const costPrice = Math.max(0, toSafeNumber(item.costPrice));
  const quantity = Math.max(1, toSafeNumber(item.quantity || 1));
  const totalClientPrice = clientPrice * quantity;
  const totalCostPrice = costPrice * quantity;
  const marginRub = totalClientPrice - totalCostPrice;

  return {
    name: item.name ?? item.label ?? "Позиция",
    category: item.category ?? "Смета",
    clientPrice,
    costPrice,
    quantity,
    totalClientPrice,
    totalCostPrice,
    marginRub,
    marginPercent: percentOf(marginRub, totalClientPrice),
  };
}

export function calculateOrderEconomics(items: MarginItemInput[]): OrderEconomics {
  const marginItems = items.map(calculateItemMargin);
  const orderClientTotal = marginItems.reduce((sum, item) => sum + item.totalClientPrice, 0);
  const orderCostTotal = marginItems.reduce((sum, item) => sum + item.totalCostPrice, 0);
  const orderMarginRub = orderClientTotal - orderCostTotal;

  return {
    items: marginItems,
    orderClientTotal,
    orderCostTotal,
    orderMarginRub,
    orderMarginPercent: percentOf(orderMarginRub, orderClientTotal),
  };
}

export function calculateBudgetStatus(orderClientTotal: number, clientBudget?: number | null): BudgetStatus {
  const budget = toSafeNumber(clientBudget);
  if (budget <= 0) {
    return {
      clientBudget: null,
      budgetRemaining: 0,
      budgetExceeded: false,
      budgetUsagePercent: 0,
      status: "not_set",
    };
  }

  const safeOrderTotal = Math.max(0, toSafeNumber(orderClientTotal));
  const budgetRemaining = budget - safeOrderTotal;
  const budgetExceeded = safeOrderTotal > budget;
  const budgetUsagePercent = percentOf(safeOrderTotal, budget);

  return {
    clientBudget: budget,
    budgetRemaining,
    budgetExceeded,
    budgetUsagePercent,
    status: budgetExceeded ? "exceeded" : budgetUsagePercent > 90 ? "near_limit" : "within",
  };
}

export function normalizeCatalogItemToEstimateItem(
  item: CatalogItem,
  selectedColor?: string,
): EstimateItem {
  const color = selectedColor && item.availableColors?.includes(selectedColor) ? selectedColor : item.availableColors?.[0];

  return {
    id: color ? `${item.id}:${color}` : item.id,
    catalogItemId: item.id,
    name: item.name,
    category: item.category,
    description: item.description,
    imagePlaceholder: item.imagePlaceholder,
    clientPrice: Math.max(0, toSafeNumber(item.clientPrice)),
    costPrice: Math.max(0, toSafeNumber(item.costPrice)),
    quantity: Math.max(1, toSafeNumber(item.quantityDefault || 1)),
    selectedColor: color,
    isRequired: item.isRequired,
    isRecommended: item.isRecommended,
    tags: item.tags,
  };
}

export function addCatalogItemToEstimate(
  items: EstimateItem[],
  catalogItem: CatalogItem,
  selectedColor?: string,
): EstimateItem[] {
  const nextItem = normalizeCatalogItemToEstimateItem(catalogItem, selectedColor);
  const existing = items.find((item) => item.id === nextItem.id);
  if (!existing) return [...items, nextItem];

  return items.map((item) =>
    item.id === nextItem.id ? { ...item, quantity: item.quantity + nextItem.quantity } : item,
  );
}

export function updateEstimateItemQuantity(
  items: EstimateItem[],
  id: string,
  quantity: number,
): EstimateItem[] {
  const safeQuantity = Math.floor(toSafeNumber(quantity));
  if (safeQuantity <= 0) return removeEstimateItem(items, id);
  return items.map((item) => (item.id === id ? { ...item, quantity: safeQuantity } : item));
}

export function removeEstimateItem(items: EstimateItem[], id: string): EstimateItem[] {
  return items.filter((item) => item.id !== id);
}

export function updateEstimateItemClientPrice(
  items: EstimateItem[],
  id: string,
  clientPrice: number,
): EstimateItem[] {
  const safePrice = Math.max(0, toSafeNumber(clientPrice));
  return items.map((item) => (item.id === id ? { ...item, clientPrice: safePrice } : item));
}

export function estimateItemsToMarginInputs(items: EstimateItem[]): MarginItemInput[] {
  return items.map((item) => ({
    name: item.selectedColor ? `${item.name} — цвет: ${item.selectedColor}` : item.name,
    category: item.category,
    clientPrice: item.clientPrice,
    costPrice: item.costPrice,
    quantity: item.quantity,
  }));
}

export function calculateEstimateItemsTotal(items: Array<Pick<EstimateItem, "clientPrice" | "quantity">>): number {
  return items.reduce((sum, item) => sum + Math.max(0, toSafeNumber(item.clientPrice)) * Math.max(1, toSafeNumber(item.quantity || 1)), 0);
}

export function toPublicEstimateItems(items: EstimateItem[]): PublicEstimateItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    description: item.description,
    imagePlaceholder: item.imagePlaceholder,
    clientPrice: item.clientPrice,
    quantity: item.quantity,
    selectedColor: item.selectedColor,
  }));
}

export function addMemorialAssistanceItem(items: EstimateItem[]): EstimateItem[] {
  if (items.some((item) => item.id === MEMORIAL_ASSISTANCE_ITEM.id)) return items;
  return [...items, { ...MEMORIAL_ASSISTANCE_ITEM }];
}

export function removeMemorialAssistanceItem(items: EstimateItem[]): EstimateItem[] {
  return items.filter((item) => item.id !== MEMORIAL_ASSISTANCE_ITEM.id);
}

export function normalizeExternalExpenseToEstimateItem(expense: ExternalExpense): MarginItemInput {
  return {
    name: expense.name,
    category: `Внешние расходы · ${expense.category}`,
    clientPrice: expense.includeInClientTotal ? expense.clientPrice : 0,
    costPrice: expense.includeInMarginCalculation ? expense.costPrice : 0,
    quantity: 1,
  };
}

export function calculateExternalExpenseEconomics(expenses: ExternalExpense[]): OrderEconomics {
  return calculateOrderEconomics(expenses.map(normalizeExternalExpenseToEstimateItem));
}

export function externalExpensesToMarginInputs(expenses: ExternalExpense[]): MarginItemInput[] {
  return expenses.map(normalizeExternalExpenseToEstimateItem);
}

export function calculateExternalExpensesClientTotal(expenses: ExternalExpense[]): number {
  return expenses.reduce(
    (sum, expense) => sum + (expense.includeInClientTotal ? Math.max(0, toSafeNumber(expense.clientPrice)) : 0),
    0,
  );
}

export function toPublicExternalExpenses(expenses: ExternalExpense[]): PublicExternalExpense[] {
  return expenses
    .filter((expense) => expense.includeInClientTotal)
    .map((expense) => ({
      id: expense.id,
      name: expense.name,
      category: expense.category,
      clientPrice: expense.clientPrice,
      comment: expense.comment,
    }));
}

export function createExternalExpense(
  input: Partial<ExternalExpense> & Pick<ExternalExpense, "name" | "category">,
): ExternalExpense {
  return {
    id: input.id ?? `external-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    category: input.category,
    clientPrice: Math.max(0, toSafeNumber(input.clientPrice)),
    costPrice: Math.max(0, toSafeNumber(input.costPrice)),
    comment: input.comment ?? "",
    includeInClientTotal: input.includeInClientTotal ?? true,
    includeInMarginCalculation: input.includeInMarginCalculation ?? true,
  };
}

export function createEstimateSnapshot({
  title,
  note,
  items,
  externalExpenses,
  memorialData,
  economics,
  clientBudget,
  budgetStatus,
}: {
  title: string;
  note?: string;
  items: EstimateItem[];
  externalExpenses: ExternalExpense[];
  memorialData: MemorialData;
  economics: OrderEconomics;
  clientBudget?: number | null;
  budgetStatus: BudgetStatus;
}): EstimateSnapshot {
  return {
    id: `snapshot-${Date.now()}`,
    createdAt: new Date().toISOString(),
    title,
    items: items.map((item) => ({ ...item })),
    externalExpenses: externalExpenses.map((expense) => ({ ...expense })),
    memorialData: { ...memorialData },
    orderClientTotal: economics.orderClientTotal,
    orderCostTotal: economics.orderCostTotal,
    orderMarginRub: economics.orderMarginRub,
    orderMarginPercent: economics.orderMarginPercent,
    clientBudget,
    budgetRemaining: budgetStatus.clientBudget ? budgetStatus.budgetRemaining : null,
    budgetExceeded: budgetStatus.clientBudget ? budgetStatus.budgetExceeded : false,
    note,
  };
}

const DEFAULT_BASE_PRICE = 25000;
export const DEFAULT_CALCULATOR_CONFIG: CalculatorConfig = {
  base: {
    title: "Базовые услуги",
    price: DEFAULT_BASE_PRICE,
    items: [
      "Оформление документов",
      "Подтверждение места захоронения",
      "Хранение и базовая подготовка тела",
      "Гроб, подушка и покрывало",
      "Транспортировка покойного и перенос",
      "Кладбищенские работы",
    ],
  },
  prices: {
    hallDuration: PRICES.hallDuration,
    ceremonyType: PRICES.ceremonyType,
    hearse: PRICES.hearse,
    familyTransport: PRICES.familyTransport,
    pallbearers: PRICES.pallbearers,
  },
  // Temporary mock cost data for agent margin prototype.
  costs: {
    base: 0,
    hallDuration: {
      30: 0,
      60: 5000,
      90: 8000,
    },
    ceremonyType: {
      civil: 0,
      religious: 7000,
      combined: 9000,
    },
    hearse: 12000,
    familyTransport: {
      5: 3000,
      10: 5000,
      15: 8000,
    },
    pallbearers: 8000,
    packageCostRatio: 0.62,
    cemeteryCostRatio: 1,
  },
  packages: PACKAGES.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    price: pkg.price,
    features: [...pkg.features],
  })),
  additionalServices: ADDITIONAL_SERVICES.map((s) => ({
    id: s.id,
    name: s.name,
    price: s.price,
    costPrice: s.costPrice,
  })),
  cemeteries: [...MOSCOW_CEMETERIES, ...MO_CEMETERIES].map((c) => ({
    name: c.name,
    categories: { ...c.categories },
  })),
  cemeteryCategoryLabels: {
    standard: "Стандарт",
    comfort: "Комфорт",
    premium: "Премиум",
  },
  cemeterySectionTitle: (categoryLabel) => `Место на кладбище (${categoryLabel})`,
  includeCemeteryCategoryItem: false,
  includeCemeteryWithPackage: true,
  includeLogisticsWithPackage: true,
  includeFormatWithPackage: true,
  includeAdditionalWithPackage: true,
  includeBaseWithPackage: false,
  packageSectionMinPrice: 0,
};

export function calculateOrder(
  formData: FormData,
  config: CalculatorConfig,
  selectedCemeteryCategory: string = "standard",
): CalculationResult {
  const sections: CalculationSection[] = [];
  const packageType = formData.packageType;
  const packageItem =
    packageType && packageType !== "custom"
      ? config.packages.find((pkg) => pkg.id === packageType)
      : undefined;
  const hasPackage = Boolean(packageItem);

  const formatItems: CalculationItem[] = [];
  let formatTotal = 0;
  const hallDuration = Number(formData.hallDuration || 0);
  if (formData.hasHall) {
    const includedMinutes =
      hasPackage && packageType && config.hallIncludedMinutesByPackage
        ? config.hallIncludedMinutesByPackage[packageType]
        : undefined;
    if (includedMinutes && hallDuration) {
      const selectedPrice =
        config.prices.hallDuration[hallDuration as keyof typeof config.prices.hallDuration] || 0;
      const includedPrice =
        config.prices.hallDuration[includedMinutes as keyof typeof config.prices.hallDuration] || 0;
      const extraCost = Math.max(0, selectedPrice - includedPrice);
      if (extraCost > 0) {
        const extraBlocks = Math.ceil((hallDuration - includedMinutes) / 30);
        const blocksLabel = extraBlocks > 0 ? ` (${extraBlocks} × 30 мин)` : "";
        formatItems.push({
          label: `Дополнительное время зала${blocksLabel}`,
          price: extraCost,
          category: "Формат",
          clientPrice: extraCost,
          costPrice: Math.max(0, config.costs.hallDuration[hallDuration] - config.costs.hallDuration[includedMinutes]),
          quantity: 1,
        });
        formatTotal += extraCost;
      }
    } else {
      const hallPrice =
        config.prices.hallDuration[hallDuration as keyof typeof config.prices.hallDuration] || 0;
      formatItems.push({
        label: hallDuration ? `Зал прощания (${hallDuration} мин)` : "Зал прощания",
        price: hallPrice,
        category: "Формат",
        clientPrice: hallPrice,
        costPrice: config.costs.hallDuration[hallDuration] || 0,
        quantity: 1,
      });
      formatTotal += hallPrice;
    }
  }

  const ceremonyPrice =
    config.prices.ceremonyType[formData.ceremonyType as keyof typeof config.prices.ceremonyType] || 0;
  if (ceremonyPrice > 0) {
    const ceremonyName =
      formData.ceremonyType === "religious"
        ? "Религиозная церемония"
        : "Комбинированная церемония";
    formatItems.push({
      label: ceremonyName,
      price: ceremonyPrice,
      category: "Формат",
      clientPrice: ceremonyPrice,
      costPrice: config.costs.ceremonyType[formData.ceremonyType] || 0,
      quantity: 1,
    });
    formatTotal += ceremonyPrice;
  }

  const logisticsItems: CalculationItem[] = [];
  let logisticsTotal = 0;
  if (formData.needsHearse) {
    logisticsItems.push({
      label: "Катафалк",
      price: config.prices.hearse,
      category: "Логистика",
      clientPrice: config.prices.hearse,
      costPrice: config.costs.hearse,
      quantity: 1,
    });
    logisticsTotal += config.prices.hearse;
  }
  if (formData.needsFamilyTransport) {
    const seats = Number(formData.familyTransportSeats || 0);
    const tp =
      config.prices.familyTransport[seats as keyof typeof config.prices.familyTransport] || 0;
    logisticsItems.push({
      label: seats ? `Транспорт для близких (${seats} мест)` : "Транспорт для близких",
      price: tp,
      category: "Логистика",
      clientPrice: tp,
      costPrice: config.costs.familyTransport[seats] || 0,
      quantity: 1,
    });
    logisticsTotal += tp;
  }
  if (formData.needsPallbearers) {
    logisticsItems.push({
      label: "Носильщики",
      price: config.prices.pallbearers,
      category: "Логистика",
      clientPrice: config.prices.pallbearers,
      costPrice: config.costs.pallbearers,
      quantity: 1,
    });
    logisticsTotal += config.prices.pallbearers;
  }

  const additionalItems: CalculationItem[] = [];
  let additionalTotal = 0;
  if (Array.isArray(formData.selectedAdditionalServices)) {
    for (const serviceId of formData.selectedAdditionalServices) {
      const service = config.additionalServices.find((s) => s.id === serviceId);
      if (!service) continue;
      additionalItems.push({
        label: service.name,
        price: service.price,
        category: "Дополнительные услуги",
        clientPrice: service.price,
        costPrice: service.costPrice ?? 0,
        quantity: 1,
      });
      additionalTotal += service.price;
    }
  }

  const attributesItems: CalculationItem[] = [];
  let attributesTotal = 0;
  const coffinConfig = formData.coffinConfig as
    | {
        coffin?: {
          wood?: { name?: string; price?: number; costPrice?: number };
          lining?: { name?: string; price?: number; costPrice?: number };
          hardware?: { name?: string; price?: number; costPrice?: number };
          quantity?: number;
        };
        wreath?: {
          type?: string;
          size?: string;
          text?: string;
          quantity?: number;
          price?: number;
          costPrice?: number;
        };
      }
    | undefined;

  if (coffinConfig?.coffin) {
    const quantity = Math.max(1, Number(coffinConfig.coffin.quantity || 1));
    const quantitySuffix = quantity > 1 ? ` ×${quantity}` : "";
    const woodName = coffinConfig.coffin.wood?.name;
    const woodPrice = Number(coffinConfig.coffin.wood?.price || 0) * quantity;
    if (woodName) {
      attributesItems.push({
        label: `Гроб: ${woodName}${quantitySuffix}`,
        price: woodPrice,
        category: "Атрибутика",
        clientPrice: Number(coffinConfig.coffin.wood?.price || 0),
        costPrice: Number(coffinConfig.coffin.wood?.costPrice || 0),
        quantity,
      });
      attributesTotal += woodPrice;
    }
    const liningName = coffinConfig.coffin.lining?.name;
    const liningPrice = Number(coffinConfig.coffin.lining?.price || 0) * quantity;
    if (liningName) {
      attributesItems.push({
        label: `Обивка: ${liningName}${quantitySuffix}`,
        price: liningPrice,
        category: "Атрибутика",
        clientPrice: Number(coffinConfig.coffin.lining?.price || 0),
        costPrice: Number(coffinConfig.coffin.lining?.costPrice || 0),
        quantity,
      });
      attributesTotal += liningPrice;
    }
    const hardwareName = coffinConfig.coffin.hardware?.name;
    const hardwarePrice = Number(coffinConfig.coffin.hardware?.price || 0) * quantity;
    if (hardwareName) {
      attributesItems.push({
        label: `Фурнитура: ${hardwareName}${quantitySuffix}`,
        price: hardwarePrice,
        category: "Атрибутика",
        clientPrice: Number(coffinConfig.coffin.hardware?.price || 0),
        costPrice: Number(coffinConfig.coffin.hardware?.costPrice || 0),
        quantity,
      });
      attributesTotal += hardwarePrice;
    }
  }

  if (coffinConfig?.wreath) {
    const wreathQuantity = Math.max(1, Number(coffinConfig.wreath.quantity || 1));
    const typeLabel =
      WREATH_TYPE_LABELS[coffinConfig.wreath.type || ""] || coffinConfig.wreath.type || "";
    const sizeLabel =
      WREATH_SIZE_LABELS[coffinConfig.wreath.size || ""] || coffinConfig.wreath.size || "";
    const labelParts = [typeLabel, sizeLabel].filter(Boolean);
    const text = (coffinConfig.wreath.text || "").trim();
    let wreathLabel = labelParts.length ? `Венок: ${labelParts.join(", ")}` : "Венок";
    if (text) wreathLabel += `, "${text}"`;
    if (wreathQuantity > 1) wreathLabel += ` ×${wreathQuantity}`;
    const wreathPrice = Number(coffinConfig.wreath.price || 0);
    attributesItems.push({
      label: wreathLabel,
      price: wreathPrice,
      category: "Атрибутика",
      clientPrice: wreathQuantity > 0 ? wreathPrice / wreathQuantity : wreathPrice,
      costPrice: Number(coffinConfig.wreath.costPrice || 0),
      quantity: wreathQuantity,
    });
    attributesTotal += wreathPrice;
  }

  if (!hasPackage || config.includeBaseWithPackage) {
    sections.push({
      title: config.base.title,
      total: config.base.price,
      costTotal: config.costs.base,
      items: config.base.items.map((name) => ({ label: name, included: true })),
    });
  }

  if (hasPackage && packageItem && packageItem.price >= config.packageSectionMinPrice) {
    sections.push({
      title: `Пакет "${packageItem.name}"`,
      total: packageItem.price,
      costTotal: Math.round(packageItem.price * config.costs.packageCostRatio),
      items: packageItem.features.map((feature) => ({ label: feature, included: true })),
    });
  }

  if (formatItems.length && (!hasPackage || config.includeFormatWithPackage)) {
    sections.push({ title: "Формат", total: formatTotal, items: formatItems });
  }

  if (logisticsItems.length && (!hasPackage || config.includeLogisticsWithPackage)) {
    sections.push({ title: "Логистика", total: logisticsTotal, items: logisticsItems });
  }

  if (attributesItems.length) {
    sections.push({ title: "Атрибутика", total: attributesTotal, items: attributesItems });
  }

  if (additionalItems.length && (!hasPackage || config.includeAdditionalWithPackage)) {
    sections.push({ title: "Дополнительные услуги", total: additionalTotal, items: additionalItems });
  }

  let total = 0;
  if (hasPackage && packageItem) {
    total += packageItem.price;
  } else {
    total += config.base.price;
  }

  if (!hasPackage || config.includeFormatWithPackage) total += formatTotal;
  if (!hasPackage || config.includeLogisticsWithPackage) total += logisticsTotal;
  total += attributesTotal;
  if (!hasPackage || config.includeAdditionalWithPackage) total += additionalTotal;

  if (formData.cemetery) {
    const selectedCemetery = config.cemeteries.find((c) => c.name === formData.cemetery);
    const price =
      selectedCemetery?.categories?.[selectedCemeteryCategory as keyof typeof selectedCemetery.categories] || 0;
    if (price) {
      const categoryLabel =
        config.cemeteryCategoryLabels[selectedCemeteryCategory as keyof typeof config.cemeteryCategoryLabels] || "Стандарт";
      if (!hasPackage || config.includeCemeteryWithPackage) {
        sections.push({
          title: config.cemeterySectionTitle(categoryLabel),
          total: price,
          costTotal: Math.round(price * config.costs.cemeteryCostRatio),
          items: config.includeCemeteryCategoryItem
            ? [
                { label: selectedCemetery?.name || "" },
                { label: `Категория: ${categoryLabel}` },
              ]
            : [{ label: selectedCemetery?.name || "" }],
        });
      }
      total += price;
    }
  }

  return { total, sections };
}

// Функция расчета общей стоимости
export function calculateTotal(
  formData: FormData,
  selectedCemeteryCategory: string = "standard",
  config: CalculatorConfig = DEFAULT_CALCULATOR_CONFIG,
): number {
  return calculateOrder(formData, config, selectedCemeteryCategory).total;
}

// Функция расчета детализации стоимости
export function calculateBreakdown(
  formData: FormData,
  selectedCemeteryCategory: string = "standard",
  config: CalculatorConfig = DEFAULT_CALCULATOR_CONFIG,
): CalculatorSection[] {
  const result = calculateOrder(formData, config, selectedCemeteryCategory);
  return result.sections.map((section) => ({
    category: section.title,
    price: section.total,
    items: section.items?.map((item) => ({
      name: item.label,
      price: item.price,
    })),
  }));
}

type TrackerWindow = Window & {
  dataLayer?: Array<Record<string, any>>;
  gtag?: (...args: any[]) => void;
  ym?: (...args: any[]) => void;
  __tdTracked?: Set<string>;
  __tdSessionId?: string;
};

export function getTrackingSessionId() {
  if (typeof window === "undefined") return "server";
  const w = window as TrackerWindow;
  if (!w.__tdSessionId) {
    w.__tdSessionId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
  return w.__tdSessionId;
}

const YM_FALLBACK_ID = 106219376;
const YM_FLOW_PREFIXES = ["wizard", "tariffs"] as const;
type YmFlow = (typeof YM_FLOW_PREFIXES)[number];
const YM_BASE_GOALS = new Set<string>([
  "format_started",
  "format_filled",
  "attributes_started",
  "attributes_filled",
  "logistics_started",
  "logistics_filled",
  "documents_started",
  "documents_filled",
  "confirmation_viewed",
  "calculator_viewed",
  "contacts_filled",
  "order_created",
  "payment_start",
  "payment_success",
  "payment_option_full",
  "payment_option_deposit_5",
  "payment_option_split",
  "payment_option_deposit_10",
  "payment_option_call",
]);
const YM_ALLOWED_GOALS = new Set<string>([
  "wizard_started",
  "tariffs_started",
  ...YM_FLOW_PREFIXES.flatMap((flow) =>
    Array.from(YM_BASE_GOALS, (goal) => `${flow}_${goal}`),
  ),
]);

export function buildGoalName(flow: YmFlow, goalBase: string) {
  return `${flow}_${goalBase}`;
}

export function reachMetrikaGoal(
  name: string,
  params: Record<string, any> = {},
) {
  if (!YM_ALLOWED_GOALS.has(name)) return;
  if (typeof window === "undefined") return;
  const w = window as TrackerWindow;
  const ymIdRaw = process.env.NEXT_PUBLIC_YM_ID;
  const ymId = Number.isFinite(Number(ymIdRaw)) ? Number(ymIdRaw) : YM_FALLBACK_ID;
  if (!Number.isFinite(ymId)) return;
  if (typeof w.ym !== "function") return;
  try {
    w.ym(ymId, "reachGoal", name, params);
    if (process.env.NEXT_PUBLIC_YM_DEBUG === "true") {
      console.debug("[ym]", name, params);
    }
  } catch (_) {
    // best-effort analytics: ignore failures
  }
}

export function setMetrikaVisitParams(params: Record<string, any> = {}) {
  if (typeof window === "undefined") return;
  const w = window as TrackerWindow;
  const ymIdRaw = process.env.NEXT_PUBLIC_YM_ID;
  const ymId = Number.isFinite(Number(ymIdRaw)) ? Number(ymIdRaw) : YM_FALLBACK_ID;
  if (!Number.isFinite(ymId)) return;
  if (typeof w.ym !== "function") return;
  try {
    w.ym(ymId, "params", params);
    if (process.env.NEXT_PUBLIC_YM_DEBUG === "true") {
      console.debug("[ym:params]", params);
    }
  } catch (_) {
    // best-effort analytics: ignore failures
  }
}

export function trackEvent(
  name: string,
  params: Record<string, any> = {},
  dedupeKey?: string,
) {
  if (typeof window === "undefined") return;
  const w = window as TrackerWindow;

  const store = w.__tdTracked ?? new Set<string>();
  if (!w.__tdTracked) w.__tdTracked = store;

  const key = dedupeKey ?? JSON.stringify(params ?? {});
  const fullKey = `${name}:${key}`;
  if (store.has(fullKey)) return;
  store.add(fullKey);

  try {
    w.dataLayer = Array.isArray(w.dataLayer) ? w.dataLayer : [];
    w.dataLayer.push({ event: name, ...params });
  } catch (_) {
    // best-effort analytics: ignore failures
  }

  if (typeof w.gtag === "function") {
    try {
      w.gtag("event", name, params);
    } catch (_) {
      // best-effort analytics: ignore failures
    }
  }

  const flow = typeof params?.flow === "string" ? params.flow : undefined;
  const hasPrefix = name.startsWith("wizard_") || name.startsWith("tariffs_");
  const ymGoal =
    !hasPrefix &&
    flow &&
    (YM_FLOW_PREFIXES as readonly string[]).includes(flow) &&
    YM_BASE_GOALS.has(name)
      ? buildGoalName(flow as YmFlow, name)
      : name;

  reachMetrikaGoal(ymGoal, params);

  if (process.env.NODE_ENV !== "production") {
    console.info("[tracking]", name, params);
  }
}
