// Координаты мольбертов в каждой AI-сцене (доля ширины кадра). Венок ставится
// по центру мольберта: left — левый, right — правый. Значения получены детекцией
// тёмных вертикальных структур (мольберты) в кадре + ручная правка выбросов.
// Используется RitualSetPreview для органичного наложения до двух венков.

export type EaselAnchors = { left: number; right: number };

export const SCENE_EASEL_ANCHORS: Record<string, EaselAnchors> = {
  "fch-2": { left: 0.158, right: 0.87 },
  "fh-2": { left: 0.159, right: 0.857 },
  "fkl-6s": { left: 0.155, right: 0.871 },
  "fkl-6t": { left: 0.161, right: 0.865 },
  "fklv-6s": { left: 0.158, right: 0.863 },
  "fko-6": { left: 0.157, right: 0.895 },
  "fo-2": { left: 0.156, right: 0.886 },
  "fs-4": { left: 0.15, right: 0.87 },
  "fs-6": { left: 0.157, right: 0.873 },
  "fsi-6": { left: 0.16, right: 0.883 },
  "fsi-6b": { left: 0.16, right: 0.856 },
  "fsi-6s": { left: 0.16, right: 0.902 },
  "fsi-6t": { left: 0.16, right: 0.91 },
  "fsn-4": { left: 0.16, right: 0.885 },
  "fsn-6s": { left: 0.16, right: 0.881 },
  "fsr-4": { left: 0.159, right: 0.852 },
  "fsr-6": { left: 0.16, right: 0.838 },
  "fv-2": { left: 0.156, right: 0.857 },
  "fva-2": { left: 0.153, right: 0.863 },
  "fvk-2s": { left: 0.151, right: 0.893 },
  "fvp-2s": { left: 0.158, right: 0.884 },
};

// Дефолт, если у сцены нет карты (напр. кастомный гроб без сцены).
export const DEFAULT_EASEL_ANCHORS: EaselAnchors = { left: 0.16, right: 0.87 };

// Вертикальный центр венка и высота (доля высоты кадра) — так венок садится в
// держатель мольберта и выглядит стоящим.
export const WREATH_CENTER_Y = 0.41;
export const WREATH_HEIGHT = 0.45;

// ── Параметры «посадки» венка в сцену (вариант C: убрать эффект наклейки) ──
// Мольберты в сценах слегка наклонены назад и развёрнуты внутрь к камере.
// Небольшая перспектива (CSS 3D) заставляет плоский вырез следовать плоскости
// мольберта. Углы малые намеренно: одна пара значений работает на всех 21 сценах.
export const WREATH_TILT_X = 5; // наклон верха венка от камеры, градусы
export const WREATH_TILT_Y = 6; // разворот к центру зала (знак зависит от стороны)
export const WREATH_PERSPECTIVE = 1100; // px, фокус перспективы

// Цветокоррекция выреза под тёплый свет зала: чуть меньше насыщенности и
// яркости, чуть больше контраста + двойная тень (контактная и рассеянная).
export const WREATH_GRADE_FILTER =
  "saturate(0.94) brightness(0.97) contrast(1.03) " +
  "drop-shadow(0 8px 7px rgba(24,16,10,0.32)) drop-shadow(0 20px 22px rgba(24,16,10,0.16))";
