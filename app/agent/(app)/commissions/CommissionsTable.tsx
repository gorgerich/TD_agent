"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { moneyFromKopecks, dateLong } from "@/lib/format";

export type CommissionRowData = {
  id: number;
  orderId: number;
  status: string;
  amount: number;
  createdAt: string | null;
};

const STATUS_LABELS: Record<string, string> = { ACCRUED: "Начислено", APPROVED: "Подтверждено", PAID: "Выплачено" };
const STATUS_DOT: Record<string, string> = { ACCRUED: "bg-warning", APPROVED: "bg-info", PAID: "bg-success" };

export function CommissionsTable({ rows }: { rows: CommissionRowData[] }) {
  const columns: Column<CommissionRowData>[] = [
    {
      key: "order",
      header: "Заказ",
      cell: (r) => <span className="tnum font-medium">№{r.orderId}</span>,
      sortValue: (r) => r.orderId,
    },
    {
      key: "date",
      header: "Дата",
      cell: (r) => <span className="text-ink-2">{r.createdAt ? dateLong(new Date(r.createdAt)) : "—"}</span>,
      sortValue: (r) => r.createdAt ?? "",
    },
    {
      key: "status",
      header: "Статус",
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[r.status] ?? "bg-ink-3"}`} />
          {STATUS_LABELS[r.status] ?? r.status}
        </span>
      ),
      sortValue: (r) => STATUS_LABELS[r.status] ?? r.status,
    },
    {
      key: "amount",
      header: "Сумма",
      align: "right",
      numeric: true,
      cell: (r) => moneyFromKopecks(r.amount),
      sortValue: (r) => r.amount,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      empty="Начислений пока нет"
    />
  );
}

export default CommissionsTable;
