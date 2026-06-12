"use client";

// Горизонтальный swipe-жест на Pointer Events (DELIGHT, пункт 1).
// Захват указателя, multi-touch guard, направление-замок (вертикаль уходит
// скроллу), rubber-band за порогом, velocity-commit. Только touch/pen -
// мышь оставляем кликам и выделению текста.

import { useCallback, useRef, useState } from "react";

export type SwipeCommitDir = "right" | "left";

type Options = {
  dir: SwipeCommitDir | "both";
  threshold?: number; // px смещения до коммита
  velocity?: number; // px/ms - флик коммитит раньше порога
  enabled?: boolean;
  ignore?: string; // селектор зон без жеста (поля ввода)
  onCommit: (dir: SwipeCommitDir) => void;
};

const LOCK_SLOP = 6; // px до выбора оси
const FLICK_MIN_DX = 12; // px - флик не считается с места

export function useSwipeX({
  dir,
  threshold = 72,
  velocity = 0.45,
  enabled = true,
  ignore = "input, textarea, select",
  onCommit,
}: Options) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [committed, setCommitted] = useState<SwipeCommitDir | null>(null);
  const s = useRef({
    id: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastT: 0,
    v: 0,
    lock: null as null | "x" | "y",
    dragged: false,
  });

  const reset = useCallback(() => {
    s.current.id = -1;
    s.current.lock = null;
    s.current.v = 0;
    setDx(0);
    setDragging(false);
    setCommitted(null);
  }, []);

  const damp = useCallback(
    (raw: number) => {
      const sign = raw >= 0 ? 1 : -1;
      const allowed = sign > 0 ? dir !== "left" : dir !== "right";
      if (!allowed) return raw * 0.12; // rubber против хода
      const abs = Math.abs(raw);
      return sign * (abs <= threshold ? abs : threshold + (abs - threshold) * 0.45);
    },
    [dir, threshold],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || committed || e.pointerType === "mouse" || !e.isPrimary) return;
      if (s.current.id !== -1) return; // multi-touch guard
      if (ignore && (e.target as Element).closest(ignore)) return;
      s.current.id = e.pointerId;
      s.current.startX = s.current.lastX = e.clientX;
      s.current.startY = e.clientY;
      s.current.lastT = e.timeStamp;
      s.current.v = 0;
      s.current.lock = null;
      s.current.dragged = false;
    },
    [enabled, committed, ignore],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const st = s.current;
      if (e.pointerId !== st.id) return;
      const rawX = e.clientX - st.startX;
      const rawY = e.clientY - st.startY;
      if (st.lock === null) {
        if (Math.max(Math.abs(rawX), Math.abs(rawY)) < LOCK_SLOP) return;
        st.lock = Math.abs(rawX) > Math.abs(rawY) ? "x" : "y";
        if (st.lock === "y") {
          st.id = -1; // вертикаль - скроллу
          return;
        }
        st.dragged = true;
        try {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        } catch {
          // указатель уже отпущен браузером - жест продолжаем без захвата
        }
        setDragging(true);
      }
      if (st.lock !== "x") return;
      const dt = e.timeStamp - st.lastT;
      if (dt > 0) st.v = 0.8 * st.v + 0.2 * ((e.clientX - st.lastX) / dt);
      st.lastX = e.clientX;
      st.lastT = e.timeStamp;
      setDx(damp(rawX));
    },
    [damp],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const st = s.current;
      if (e.pointerId !== st.id) return;
      const wasDrag = st.lock === "x";
      st.id = -1;
      st.lock = null;
      if (!wasDrag) return;
      setDragging(false);
      const raw = e.clientX - st.startX;
      const v = st.v;
      const commitRight =
        dir !== "left" && (raw >= threshold || (raw > FLICK_MIN_DX && v >= velocity));
      const commitLeft =
        dir !== "right" && (-raw >= threshold || (raw < -FLICK_MIN_DX && -v >= velocity));
      if (commitRight || commitLeft) {
        const d: SwipeCommitDir = commitRight ? "right" : "left";
        setCommitted(d);
        onCommit(d);
      } else {
        setDx(0);
      }
    },
    [dir, threshold, velocity, onCommit],
  );

  const onPointerCancel = useCallback(() => {
    s.current.id = -1;
    s.current.lock = null;
    setDragging(false);
    setDx(0);
  }, []);

  // После драга гасим click, иначе вложенный Link сработает на отпускании.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (s.current.dragged) {
      e.preventDefault();
      e.stopPropagation();
      s.current.dragged = false;
    }
  }, []);

  return {
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
    dx,
    dragging,
    committed,
    progress: Math.min(1, Math.abs(dx) / threshold),
    reset,
  };
}
