# DELIGHT.md — программа «фирменные ощущения» (следующая сессия)

Закон визуала: DESIGN.md (плоско, glass только хром). Delight = моторика и материал,
НЕ декор поверхностей.

## Сделано
- Spring-pop активных маркеров (док, сегменты); press-scale; Emil-кривые; drawer-вход
  sheet; tab-fade; staggered rise; liquid-glass хром (шапка/док/палитра/поповеры).

## Очередь (по ценности)
1. Swipe-жесты: задача — свайп вправо = выполнить (velocity-dismiss, damping по Emil);
   sheet — drag-to-close. Pointer capture, multi-touch guard.
2. View Transitions API (Next experimental viewTransition): crossfade+shared header
   между списком и кейсом. Fallback без анимации.
3. Shader-слой (WebGL, @paper-design/shaders-react или OGL, ~5KB): ripple-переход
   на login-обложке и /co «итоговая сумма» — единственные two места (закон: не на
   операционных экранах). prefers-reduced-motion → статично.
4. Генеративная обложка login: Gemini/Imagen API (тихая монохромная текстура),
   1 статичный asset в /public, не runtime.
5. Тосты: spring-вход уже есть; добавить swipe-dismiss.
6. Haptics на мобиле (navigator.vibrate 10ms) для complete-действий.

## Запреты
Шейдеры/генеративка на рабочих экранах агента; >1 marquee; декоративные курсоры;
анимации >300ms в операционных потоках.
