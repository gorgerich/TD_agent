"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X, CaretLeft, CaretRight, Check, GraduationCap } from "@phosphor-icons/react";
import {
  TOURS,
  TOUR_START_EVENT,
  type TourDef,
  type TourStep,
} from "@/lib/tour";

type Phase = "intro" | "steps";
type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;
const TOOLTIP_W = 332;
const GAP = 14;

function findEl(anchor: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
}

async function persistCompleted() {
  try {
    await fetch("/api/agent/onboarding", { method: "POST" });
  } catch {
    /* офлайн/ошибка - не критично, статус подхватится при следующем заходе */
  }
}

export default function OnboardingTour({ onboardingCompleted }: { onboardingCompleted: boolean }) {
  const pathname = usePathname();
  const [tour, setTour] = useState<TourDef | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [done, setDone] = useState(onboardingCompleted);
  const startedRef = useRef(false);

  const activeTour = TOURS.find((t) => t.match(pathname)) ?? null;

  // Подобрать видимые шаги (пропустить optional без элемента - определяем при измерении).
  const close = useCallback(
    (markDone: boolean) => {
      if (markDone && !done) {
        setDone(true);
        void persistCompleted();
      }
      setTour(null);
      setRect(null);
      setIndex(0);
      setPhase("intro");
    },
    [done],
  );

  const begin = useCallback(
    (def: TourDef) => {
      startedRef.current = true;
      setTour(def);
      setIndex(0);
      setPhase(def.intro ? "intro" : "steps");
      setRect(null);
    },
    [],
  );

  // Автозапуск при первом входе на странице, которой соответствует тур.
  useEffect(() => {
    if (!activeTour) return;
    if (tour) return;
    if (done) return;
    const timer = window.setTimeout(() => {
      if (findEl(activeTour.steps[0]?.anchor ?? "")) begin(activeTour);
    }, 650);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, activeTour?.id, done]);

  // Ручной запуск из меню «Обучение».
  useEffect(() => {
    function onStart() {
      const def = TOURS.find((t) => t.match(pathname));
      if (def) begin(def);
    }
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, [pathname, begin]);

  // Принудительный запуск через #tour в URL (перезапуск с любой страницы).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#tour") return;
    const def = TOURS.find((t) => t.match(pathname));
    if (!def) return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    const timer = window.setTimeout(() => {
      if (findEl(def.steps[0]?.anchor ?? "")) begin(def);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [pathname, begin]);

  // Если ушли со страницы тура - закрываем без отметки (вернётся при возврате,
  // если ещё не пройден). Корректировка состояния при смене pathname делается
  // во время рендера (рекомендованный паттерн React вместо эффекта).
  if (tour && (!activeTour || activeTour.id !== tour.id)) {
    setTour(null);
    setRect(null);
    setIndex(0);
    setPhase("intro");
  }

  // useMemo — стабильная ссылка на массив, иначе зависимости goNext/goBack
  // меняются на каждом рендере (react-hooks/exhaustive-deps).
  const steps: TourStep[] = useMemo(() => tour?.steps ?? [], [tour]);
  const current = phase === "steps" ? steps[index] : null;

  const measure = useCallback(() => {
    if (!current) {
      setRect(null);
      return;
    }
    const el = findEl(current.anchor);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [current]);

  // Прокрутить цель в зону видимости и измерить.
  useLayoutEffect(() => {
    if (phase !== "steps" || !current) return;
    const el = findEl(current.anchor);
    if (el) {
      const mob = window.innerWidth < 640;
      if (mob) {
        // На мобильном карточка - нижний лист. Цель нужно вывести в видимую
        // зону НАД листом, иначе подсказка перекрывает обучаемый элемент.
        const vh = window.innerHeight;
        const topBar = 64; // фиксированный верхний бар кабинета
        const reserve = Math.min(vh * 0.48, 360) + 24; // лист + отступ
        const visCenter = topBar + (vh - reserve - topBar) / 2;
        const r = el.getBoundingClientRect();
        const elCenter = r.top + r.height / 2;
        window.scrollBy({ top: elCenter - visCenter, behavior: "smooth" });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    const raf = requestAnimationFrame(() => {
      measure();
      // повторное измерение после плавной прокрутки
      window.setTimeout(measure, 320);
    });
    return () => cancelAnimationFrame(raf);
  }, [phase, index, current, measure]);

  // Пересчёт при ресайзе/скролле.
  useEffect(() => {
    if (phase !== "steps") return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [phase, measure]);

  const goNext = useCallback(() => {
    if (phase === "intro") {
      setPhase("steps");
      setIndex(0);
      return;
    }
    // пропустить optional-шаги без элемента
    let next = index + 1;
    while (next < steps.length && steps[next].optional && !findEl(steps[next].anchor)) {
      next += 1;
    }
    if (next >= steps.length) {
      close(true);
    } else {
      setIndex(next);
    }
  }, [phase, index, steps, close]);

  const goBack = useCallback(() => {
    if (phase === "steps" && index === 0 && tour?.intro) {
      setPhase("intro");
      return;
    }
    let prev = index - 1;
    while (prev > 0 && steps[prev].optional && !findEl(steps[prev].anchor)) {
      prev -= 1;
    }
    if (prev >= 0) setIndex(prev);
  }, [phase, index, steps, tour]);

  // Esc закрывает.
  useEffect(() => {
    if (!tour) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(true);
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goBack();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour, close, goNext, goBack]);

  if (!tour) return null;

  const totalSteps = steps.length;
  const isIntro = phase === "intro";

  // Координаты подсветки (viewport).
  const spot = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  // Позиция карточки-подсказки.
  const mobile = typeof window !== "undefined" && window.innerWidth < 640;
  let cardStyle: React.CSSProperties;
  if (mobile) {
    // Лист снизу по умолчанию. Но если цель оказалась в нижней половине
    // (последний/низкий элемент - страницу не прокрутить выше листа), уводим
    // карточку НАВЕРХ, чтобы не перекрывать подсветку.
    const vhM = window.innerHeight;
    const lowTarget = !isIntro && !!spot && spot.top > vhM * 0.5;
    cardStyle = lowTarget
      ? { top: "max(16px, env(safe-area-inset-top))", left: 12, right: 12 }
      : { left: 12, right: 12, bottom: "max(16px, env(safe-area-inset-bottom))" };
  } else if (isIntro || !spot) {
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  } else {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const placeBelow =
      current?.placement === "bottom" ||
      (current?.placement !== "top" && spot.top + spot.height + 200 < vh);
    let left = spot.left + spot.width / 2 - TOOLTIP_W / 2;
    left = Math.max(12, Math.min(left, vw - TOOLTIP_W - 12));
    if (placeBelow) {
      cardStyle = { top: spot.top + spot.height + GAP, left };
    } else {
      cardStyle = { bottom: vh - spot.top + GAP, left };
    }
  }
  // На мобильном лист не должен занимать весь экран - оставляем место для цели.
  cardStyle.maxHeight = mobile ? "42vh" : "min(72vh, 560px)";
  cardStyle.overflowY = "auto";

  return (
    <div className="fixed inset-0 z-[1000]" role="dialog" aria-modal="true" aria-label="Обучение">
      {/* Затемнение + подсветка цели (или сплошное на интро) */}
      {spot && !isIntro ? (
        <div
          className="pointer-events-none fixed rounded-[16px] transition-[top,left,width,height] duration-300 ease-out"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            boxShadow: "0 0 0 9999px rgba(20,16,11,0.62)",
            outline: "2px solid var(--color-gold)",
            outlineOffset: "2px",
          }}
        />
      ) : (
        <div
          className="fixed inset-0"
          style={{ background: "rgba(20,16,11,0.62)" }}
          onClick={() => close(true)}
        />
      )}

      {/* Карточка-подсказка */}
      <div
        className={`fixed rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-pop ${mobile ? "" : "w-[332px] max-w-[calc(100vw-24px)]"}`}
        style={cardStyle}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
            <GraduationCap size={13} weight="fill" />
            {isIntro ? "Обучение" : `Шаг ${index + 1} из ${totalSteps}`}
          </span>
          <button
            type="button"
            onClick={() => close(true)}
            aria-label="Закрыть обучение"
            className="grid h-8 w-8 place-items-center rounded-[10px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <h3 className="td-display text-[18px] leading-tight text-ink">
          {isIntro ? tour.intro?.title : current?.title}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {isIntro ? tour.intro?.body : current?.body}
        </p>

        {/* Прогресс-точки */}
        {!isIntro && totalSteps > 1 && (
          <div className="mt-4 flex gap-1.5" aria-hidden="true">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ${
                  i === index ? "w-5 bg-accent" : "w-1.5 bg-line-strong"
                }`}
              />
            ))}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => close(true)}
            className="text-[12px] font-medium text-ink-3 transition-colors hover:text-ink-2"
          >
            Пропустить
          </button>
          <div className="flex items-center gap-2">
            {!isIntro && (index > 0 || !!tour.intro) && (
              <button
                type="button"
                onClick={goBack}
                className="inline-flex min-h-10 items-center gap-1 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-semibold text-ink transition-colors hover:border-line-strong"
              >
                <CaretLeft size={13} weight="bold" /> Назад
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-on-accent shadow-[0_1px_2px_rgba(0,31,39,0.16),0_6px_14px_-12px_rgba(0,58,53,0.42)] transition-colors duration-150 hover:bg-accent-hover"
            >
              {isIntro ? (
                <>Начать <CaretRight size={13} weight="bold" /></>
              ) : index === totalSteps - 1 ? (
                <>Готово <Check size={14} weight="bold" /></>
              ) : (
                <>Далее <CaretRight size={13} weight="bold" /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
