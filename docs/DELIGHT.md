# DELIGHT.md — программа «фирменные ощущения» (следующая сессия)

Закон визуала: DESIGN.md (плоско, glass только хром). Delight = моторика и материал,
НЕ декор поверхностей.

## Сделано
- Spring-pop активных маркеров (док, сегменты); press-scale; Emil-кривые; drawer-вход
  sheet; tab-fade; staggered rise; liquid-glass хром (шапка/док/палитра/поповеры).
- Swipe-жесты (lib/useSwipeX.ts: pointer capture, multi-touch guard, ось-замок,
  rubber-band за порогом, velocity-commit, touch/pen only, click-гашение после драга):
  задача — свайп вправо = выполнить с success-подложкой и откатом при ошибке
  (tasks/TasksClientList); sheet — drag-to-close + overlay-fade (NewCaseSheet);
  тосты — swipe-dismiss в обе стороны (Toast).
- Haptics: navigator.vibrate(10) на complete (lib/haptics.ts; tasks-список +
  TasksSection кейса). iOS Safari игнорирует — тихая деградация.
- View Transitions: next-view-transitions 0.3.5 (React 19.2 stable не экспортирует
  ViewTransition — флаг Next требует canary, отказ). ViewTransitions в root layout;
  transition-Link в списке кейсов, кейсе, задачах. Shared element: имя клиента
  viewTransitionName: case-<id> (строка списка ↔ h1 кейса). CSS в globals
  (vtFadeOut 140ms / vtRiseIn 220ms / group 260ms drawer; reduced-motion гасит
  отдельным блоком — глобальный * не достаёт до ::view-transition-*).
- Shader-слой: components/QuietShader.tsx — свой WebGL без зависимостей
  (fullscreen-треугольник, волновое поле + 4 слота ripple). Палитры night/accent
  из токенов. Login-обложка: interactive (ripple от указателя, data-shader-host
  на aside). /co hero: pulse() через ref при изменении суммы + useCountUp 480ms
  (lib/useCountUp.ts, ретаргет от текущего значения). Деградации: reduced-motion →
  1 статичный кадр; нет WebGL → CSS-фолбэк; вне вьюпорта/context lost → цикл стоит.
- Генеративная обложка: image-gen API-ключей в окружении нет; роль обложки
  выполняет процедурный шейдер (живой, 0 байт ассетов). Пункт закрыт.

## Очередь (по ценности)
(пусто - программа P0 выполнена; новые пункты добавлять с ценностью и законом)

## Запреты
Шейдеры/генеративка на рабочих экранах агента; >1 marquee; декоративные курсоры;
анимации >300ms в операционных потоках.
