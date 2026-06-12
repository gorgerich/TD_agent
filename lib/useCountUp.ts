"use client";

// Плавный пересчёт числа (hero-сумма /co). Первый рендер - сразу значение,
// дальше изменения доезжают за ~480ms по ease-out cubic. Клиентский экран,
// не операционный поток - лимит 300ms из DESIGN.md сюда не относится.
// prefers-reduced-motion → мгновенный скачок.

import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number, duration = 480): number {
  const [value, setValue] = useState(target);
  // Стартуем от текущего отображаемого значения (не от прошлой цели) -
  // ретаргет посреди анимации не дёргает число назад.
  const shown = useRef(target);
  const goal = useRef(target);
  const raf = useRef(0);

  useEffect(() => {
    if (target === goal.current) return;
    goal.current = target;
    const from = shown.current;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = reduced ? 1 : Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      shown.current = from + (target - from) * eased;
      setValue(shown.current);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);

  return value;
}
