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
      className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
      {copied ? "Скопировано" : "Копировать ссылку"}
    </button>
  );
}
