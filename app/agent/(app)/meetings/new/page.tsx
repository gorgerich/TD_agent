import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import NewMeetingForm from "./NewMeetingForm";

export default function NewMeetingPage() {
  return (
    <div className="p-7 max-w-[1100px]">
      <Link href="/agent/meetings" className="inline-flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-400 transition-colors mb-6">
        <ArrowLeft size={13} /> Все встречи
      </Link>
      <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-slate-600 mb-1">CRM</p>
      <h1 className="text-2xl font-bold text-slate-100 tracking-tight mb-7">Новая встреча</h1>
      <NewMeetingForm />
    </div>
  );
}
