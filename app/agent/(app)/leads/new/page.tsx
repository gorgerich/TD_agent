import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import NewLeadForm from "./NewLeadForm";

export default function NewCasePage() {
  return (
    <div className="td-page mx-auto max-w-[680px] px-4 py-7 sm:px-7 sm:py-10">
      <Link href="/agent/cases" className="mb-6 inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-ink-2 transition-colors hover:bg-accent-soft hover:text-ink">
        <ArrowLeft size={14} /> Все дела
      </Link>
      <span className="td-eyebrow">Дела</span>
      <h1 className="mb-1 mt-4 font-serif text-[34px] leading-tight text-ink sm:text-[42px]">Новое дело</h1>
      <p className="mb-7 text-[14px] text-ink-2">Заполните контактные данные — дело откроется сразу после создания.</p>
      <NewLeadForm />
    </div>
  );
}
