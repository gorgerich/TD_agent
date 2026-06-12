"use client";

// Тактильный отклик complete-действий (DELIGHT, пункт 6).
// Работает в Android Chrome; iOS Safari игнорирует navigator.vibrate -
// деградация тихая, без фолбэков.
export function hapticTap(ms = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {
      // настройки/permissions могут запретить - молчим
    }
  }
}
