"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";

export default function ApplicationError() {
  return <main id="main-content" className="grid min-h-[100dvh] place-items-center bg-canvas px-5 py-10">
    <section role="alert" className="w-full max-w-[480px] space-y-4 text-center">
      <h1 className="text-[24px] font-semibold text-ink">Сервис временно недоступен</h1>
      <p className="text-[14px] leading-6 text-ink-2">Не удалось безопасно загрузить страницу. Повторите попытку.</p>
      <Button type="button" size="md" leftIcon={<ArrowClockwise size={18} aria-hidden />} onClick={() => window.location.reload()}>
        Повторить загрузку
      </Button>
    </section>
  </main>;
}
