import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import NewMeetingForm from "./NewMeetingForm";

export default function NewMeetingPage() {
  return (
    <div className="td-page mx-auto max-w-[1160px] px-4 py-7 sm:px-7 sm:py-10">
      <Link href="/agent/meetings" className="mb-6 inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-ink-2 transition-colors hover:bg-accent-soft hover:text-ink">
        <ArrowLeft size={14} /> Все встречи
      </Link>
      <span className="td-eyebrow">CRM</span>
      <h1 className="mb-3 mt-4 font-serif text-[34px] leading-tight text-ink sm:text-[42px]">Новая встреча</h1>
      <div className="mb-7 flex flex-wrap gap-2">
        <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-2">Лид</span>
        <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-2">Дата</span>
        <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-2">Время</span>
      </div>
      <NewMeetingForm />
    </div>
  );
}
