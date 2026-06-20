// three грузится динамически и используется как untyped (any) - этого достаточно
// для RitualScene3D и не тянет @types/three. Если позже добавите @types/three,
// удалите этот файл, чтобы не было конфликта объявлений.
declare module "three";
