// Определения интерактивных туров для онбординга агентов.
// Каждый шаг привязан к элементу через атрибут data-tour="<anchor>".

export type TourPlacement = "top" | "bottom" | "auto";

export type TourStep = {
  /** Значение атрибута data-tour у целевого элемента. */
  anchor: string;
  title: string;
  body: string;
  placement?: TourPlacement;
  /** Если целевого элемента нет на странице — шаг пропускается. */
  optional?: boolean;
};

export type TourDef = {
  id: string;
  /** Подходит ли тур к текущему пути. */
  match: (pathname: string) => boolean;
  /** Заголовок приветствия (первый экран без подсветки). */
  intro?: { title: string; body: string };
  steps: TourStep[];
};

export const DASHBOARD_TOUR: TourDef = {
  id: "dashboard-v1",
  match: (p) => p === "/agent/dashboard" || p === "/agent",
  intro: {
    title: "Добро пожаловать в «Тихий дом»",
    body: "Покажем за минуту, как устроен кабинет агента: где смотреть встречи, где добавлять клиентов и как собрать смету. Можно пропустить в любой момент.",
  },
  steps: [
    {
      anchor: "greeting",
      title: "Ваш рабочий день",
      body: "Здесь — приветствие и сводка на сегодня: сколько встреч, клиентов в работе и сумма к выплате.",
      placement: "bottom",
    },
    {
      anchor: "stats",
      title: "Ключевые цифры",
      body: "Три показателя обновляются автоматически. «К выплате» — начисленные комиссии, которые ждут выплаты.",
      placement: "bottom",
    },
    {
      anchor: "quick-actions",
      title: "Быстрые действия",
      body: "Отсюда начинается работа: «Новый клиент» — добавить лид, «Назначить встречу» — запланировать выезд или звонок.",
      placement: "bottom",
    },
    {
      anchor: "recent",
      title: "Последние встречи",
      body: "Список недавних встреч со статусами. Нажмите на встречу, чтобы открыть её и собрать смету в конструкторе.",
      placement: "top",
    },
  ],
};

export const QUOTE_TOUR: TourDef = {
  id: "quote-v1",
  match: (p) => /^\/agent\/meeting\/[^/]+\/quote\/?$/.test(p),
  intro: {
    title: "Конструктор сметы",
    body: "Смета собирается по шагам. Проведём по каждому: что заполнять и где увидеть итог. Это займёт меньше минуты.",
  },
  steps: [
    {
      anchor: "quote-stepper",
      title: "Шаги сметы",
      body: "Пять этапов: Основное, Логистика, Атрибутика, Поминки, Расходы. Текущий шаг подсвечен, пройденные отмечены галочкой. Можно переключаться в любом порядке.",
      placement: "bottom",
    },
    {
      anchor: "quote-intro",
      title: "Подсказка по шагу",
      body: "Под шагами всегда видно, какой это шаг из пяти и что именно нужно заполнить на этом этапе.",
      placement: "bottom",
    },
    {
      anchor: "quote-nav",
      title: "Навигация по шагам",
      body: "Кнопки «Назад» и «Далее» ведут по этапам. На последнем шаге появится зелёная кнопка «Готово — сохранить смету».",
      placement: "top",
    },
    {
      anchor: "quote-summary",
      title: "Итог и сохранение",
      body: "Справа всегда виден итог сметы. Кнопка «Сохранить версию сметы» фиксирует расчёт — клиент увидит его на своей странице.",
      placement: "top",
      optional: true,
    },
  ],
};

export const LEADS_TOUR: TourDef = {
  id: "leads-v1",
  match: (p) => p === "/agent/leads",
  intro: {
    title: "База клиентов",
    body: "Здесь живут все ваши клиенты. Покажем, как добавить первого и что делать дальше.",
  },
  steps: [
    {
      anchor: "leads-new",
      title: "Добавить клиента",
      body: "Кнопка создаёт карточку клиента: имя и телефон. С неё начинается каждая сделка.",
      placement: "bottom",
    },
    {
      anchor: "leads-list",
      title: "Список и статусы",
      body: "Все клиенты со статусом: «Новый», «В работе», «Завершён». Нажмите на клиента, чтобы открыть карточку и назначить встречу.",
      placement: "top",
    },
  ],
};

export const MEETINGS_TOUR: TourDef = {
  id: "meetings-v1",
  match: (p) => p === "/agent/meetings",
  intro: {
    title: "Расписание встреч",
    body: "Встречи — это выезды и звонки с клиентами. На встрече вы собираете смету. Короткий обзор раздела.",
  },
  steps: [
    {
      anchor: "meetings-new",
      title: "Назначить встречу",
      body: "Запланируйте выезд или звонок: выберите клиента, дату и время.",
      placement: "bottom",
    },
    {
      anchor: "meetings-filters",
      title: "Фильтры по статусу",
      body: "Быстрый отбор: запланированные, идущие, завершённые. Помогает не потерять активные встречи.",
      placement: "bottom",
    },
    {
      anchor: "meetings-list",
      title: "Встречи и смета",
      body: "Откройте встречу, чтобы перейти к конструктору сметы и собрать расчёт для клиента.",
      placement: "top",
    },
  ],
};

export const TOURS: TourDef[] = [DASHBOARD_TOUR, QUOTE_TOUR, LEADS_TOUR, MEETINGS_TOUR];

export function tourStorageKey(id: string) {
  return `td_tour_done:${id}`;
}

/** Событие для ручного перезапуска тура из меню. */
export const TOUR_START_EVENT = "td:start-tour";
