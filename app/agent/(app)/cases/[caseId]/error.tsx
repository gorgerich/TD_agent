"use client";

import { Button } from "@/components/ui/Button";

export default function CaseLoadError({ reset }: { reset: () => void }) {
  return <section className="mx-auto max-w-2xl space-y-4 px-4 py-8" role="alert">
    <h1 className="text-xl font-semibold">Данные кейса временно недоступны</h1>
    <p className="text-sm text-ink-2">Не удалось безопасно загрузить данные. Пустые значения не означают отсутствие информации. Изменения не сохранены.</p>
    <Button type="button" onClick={reset}>Повторить загрузку</Button>
  </section>;
}
