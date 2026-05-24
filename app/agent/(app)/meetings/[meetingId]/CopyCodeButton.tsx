"use client";

import { useState } from "react";
import { Copy, Check } from "@phosphor-icons/react";

export default function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(`${window.location.origin}/co/${code}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={copy}
      className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.09] text-slate-300 text-[13px] font-semibold rounded-lg transition-colors border border-white/[0.07]"
    >
      {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
      {copied ? "Скопировано" : "Копировать ссылку"}
    </button>
  );
}
