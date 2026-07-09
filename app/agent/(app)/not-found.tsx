import Link from "next/link";
import { Compass, House } from "@phosphor-icons/react/dist/ssr";
import { buttonClasses } from "@/components/ui/Button";

export default function AgentNotFound() {
  return (
    <div className="td-page mx-auto flex min-h-[70dvh] max-w-[560px] flex-col items-center justify-center px-5 py-16 text-center">
      <span className="mb-5 grid h-16 w-16 place-items-center rounded-full icon-3d text-accent">
        <Compass size={30} weight="duotone" />
      </span>
      <span className="td-eyebrow">Ошибка 404</span>
      <h1 className="mt-4 td-display text-[30px] leading-tight text-ink sm:text-[36px]">
        Страница не найдена
      </h1>
      <p className="mx-auto mt-2 max-w-[400px] text-[14px] leading-relaxed text-ink-2">
        Возможно, кейс удалили или ссылка устарела. Вернитесь на главную и продолжите работу.
      </p>
      <Link
        href="/agent/cases"
        className={buttonClasses({ size: "lg", className: "mt-6" })}
      >
        <House size={16} weight="bold" /> На главную
      </Link>
    </div>
  );
}
