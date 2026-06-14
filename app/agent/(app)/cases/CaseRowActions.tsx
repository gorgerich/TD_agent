"use client";

import { DotsThree, Phone, FileText, ShareNetwork, ArrowRight } from "@phosphor-icons/react";
import { Popover, type PopoverItem } from "@/components/ui/Popover";

// Меню быстрых действий по строке кейса — без открытия кейса.
export function CaseRowActions({
  caseId,
  phone,
  cobrowse,
  firstMeetingId,
}: {
  caseId: number;
  phone: string;
  cobrowse: string | null;
  firstMeetingId: number | null;
}) {
  const items: PopoverItem[] = [
    { label: "Открыть кейс", icon: <ArrowRight size={15} />, href: `/agent/cases/${caseId}` },
    ...(phone ? [{ label: "Позвонить", icon: <Phone size={15} />, href: `tel:${phone}` } as PopoverItem] : []),
    ...(firstMeetingId
      ? [{ label: "Открыть смету", icon: <FileText size={15} />, href: `/agent/meetings/${firstMeetingId}/quote` } as PopoverItem]
      : []),
    ...(cobrowse
      ? [{ label: "Клиентский вид", icon: <ShareNetwork size={15} />, href: `/co/${cobrowse}`, external: true } as PopoverItem]
      : []),
  ];

  return <Popover trigger={<DotsThree size={20} weight="bold" />} items={items} align="end" label="Действия по кейсу" />;
}

export default CaseRowActions;
