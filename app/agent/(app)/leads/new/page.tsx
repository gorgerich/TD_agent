import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import NewLeadForm from "./NewLeadForm";

export default function NewLeadPage() {
  return (
    <div className="p-7 max-w-[1100px]">
      <Link href="/agent/leads" className="inline-flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-400 transition-colors mb-6">
        <ArrowLeft size={13} /> Все лиды
      </Link>
      <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-slate-600 mb-1">CRM</p>
      <h1 className="text-2xl font-bold text-slate-100 tracking-tight mb-7">Новый лид</h1>
      <NewLeadForm />
    </div>
  );
}
