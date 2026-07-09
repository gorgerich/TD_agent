"use client";

import { useState } from "react";
import { Copy, Check } from "@phosphor-icons/react";
import { buttonClasses } from "@/components/ui/Button";

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
      type="button"
      onClick={copy}
      className={buttonClasses({ variant: "secondary" })}
    >
      {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
      {copied ? "Скопировано" : "Копировать ссылку"}
    </button>
  );
}
