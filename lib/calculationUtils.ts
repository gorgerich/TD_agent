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
    description: "Резерв времени до церемонии",
  },
  {
    id: "sanitary-prep",
    name: "Санитарная подготовка и бальзамирование",
    price: 12000,
    description: "Аккуратный внешний вид",
  },
  {
    id: "makeup",
    name: "Косметическая подготовка",
    price: 8000,
    description: "Профессиональный макияж",
  },
  {
    id: "clothing",
    name: "Ритуальная одежда",
    price: 5000,
    description: "Подготовка одежды",
  },
  {
    id: "photography",
    name: "Фотосъемка церемонии",
    price: 15000,
    description: "Профессиональная съемка",
  },
  {
    id: "videography",
    name: "Видеосъемка церемонии",
    price: 25000,
    description: "Профессиональная видеосъемка",
  },
  {
    id: "music",
    name: "Музыкальное сопровождение",
    price: 10000,
    description: "Живая музыка или фон",
  },
  {
    id: "flowers-premium",
    name: "Премиум цветочная композиция",
    price: 20000,
    description: "Эксклюзивная композиция",
  },
  {
    id: "catering",
    name: "Поминальный обед",
    price: 30000,
    description: "Организация поминального обеда",
  },
  {
    id: "memorial-plaque",
    name: "Памятная табличка",
    price: 8000,
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
  included?: boolean;
};

export type CalculationSection = {
  title: string;
  total: number;
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
  [key: string]: any;
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
        });
        formatTotal += extraCost;
      }
    } else {
      const hallPrice =
        config.prices.hallDuration[hallDuration as keyof typeof config.prices.hallDuration] || 0;
      formatItems.push({
        label: hallDuration ? `Зал прощания (${hallDuration} мин)` : "Зал прощания",
        price: hallPrice,
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
    formatItems.push({ label: ceremonyName, price: ceremonyPrice });
    formatTotal += ceremonyPrice;
  }

  const logisticsItems: CalculationItem[] = [];
  let logisticsTotal = 0;
  if (formData.needsHearse) {
    logisticsItems.push({ label: "Катафалк", price: config.prices.hearse });
    logisticsTotal += config.prices.hearse;
  }
  if (formData.needsFamilyTransport) {
    const seats = Number(formData.familyTransportSeats || 0);
    const tp =
      config.prices.familyTransport[seats as keyof typeof config.prices.familyTransport] || 0;
    logisticsItems.push({
      label: seats ? `Транспорт для близких (${seats} мест)` : "Транспорт для близких",
      price: tp,
    });
    logisticsTotal += tp;
  }
  if (formData.needsPallbearers) {
    logisticsItems.push({ label: "Носильщики", price: config.prices.pallbearers });
    logisticsTotal += config.prices.pallbearers;
  }

  const additionalItems: CalculationItem[] = [];
  let additionalTotal = 0;
  if (Array.isArray(formData.selectedAdditionalServices)) {
    for (const serviceId of formData.selectedAdditionalServices) {
      const service = config.additionalServices.find((s) => s.id === serviceId);
      if (!service) continue;
      additionalItems.push({ label: service.name, price: service.price });
      additionalTotal += service.price;
    }
  }

  const attributesItems: CalculationItem[] = [];
  let attributesTotal = 0;
  const coffinConfig = formData.coffinConfig as
    | {
        coffin?: {
          wood?: { name?: string; price?: number };
          lining?: { name?: string; price?: number };
          hardware?: { name?: string; price?: number };
          quantity?: number;
        };
        wreath?: {
          type?: string;
          size?: string;
          text?: string;
          quantity?: number;
          price?: number;
        };
      }
    | undefined;

  if (coffinConfig?.coffin) {
    const quantity = Math.max(1, Number(coffinConfig.coffin.quantity || 1));
    const quantitySuffix = quantity > 1 ? ` ×${quantity}` : "";
    const woodName = coffinConfig.coffin.wood?.name;
    const woodPrice = Number(coffinConfig.coffin.wood?.price || 0) * quantity;
    if (woodName) {
      attributesItems.push({ label: `Гроб: ${woodName}${quantitySuffix}`, price: woodPrice });
      attributesTotal += woodPrice;
    }
    const liningName = coffinConfig.coffin.lining?.name;
    const liningPrice = Number(coffinConfig.coffin.lining?.price || 0) * quantity;
    if (liningName) {
      attributesItems.push({ label: `Обивка: ${liningName}${quantitySuffix}`, price: liningPrice });
      attributesTotal += liningPrice;
    }
    const hardwareName = coffinConfig.coffin.hardware?.name;
    const hardwarePrice = Number(coffinConfig.coffin.hardware?.price || 0) * quantity;
    if (hardwareName) {
      attributesItems.push({ label: `Фурнитура: ${hardwareName}${quantitySuffix}`, price: hardwarePrice });
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
    attributesItems.push({ label: wreathLabel, price: wreathPrice });
    attributesTotal += wreathPrice;
  }

  if (!hasPackage || config.includeBaseWithPackage) {
    sections.push({
      title: config.base.title,
      total: config.base.price,
      items: config.base.items.map((name) => ({ label: name, included: true })),
    });
  }

  if (hasPackage && packageItem && packageItem.price >= config.packageSectionMinPrice) {
    sections.push({
      title: `Пакет "${packageItem.name}"`,
      total: packageItem.price,
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
