import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import NewLeadForm from "./NewLeadForm";

export default function NewLeadPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-7 sm:px-7 sm:py-9">
      <Link href="/agent/leads" className="mb-6 inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 transition-colors hover:text-ink">
        <ArrowLeft size={14} /> Все лиды
      </Link>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">CRM</p>
      <h1 className="mb-7 font-serif text-[26px] text-ink sm:text-[30px]">Новый лид</h1>
      <NewLeadForm />
    </div>
  );
}
