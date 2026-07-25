import { getAgentSession } from "@/lib/auth";
import { hasCapability } from "@/lib/operationalAuth";
import { getTeamControlTower, type TeamControlTower } from "@/lib/operationsReadModel";
import { OperationsClient } from "./OperationsClient";

type TowerResult = {
  tower: TeamControlTower | null;
  error: string | null;
  permissionDenied: boolean;
  canAssign: boolean;
};

async function loadControlTower(): Promise<TowerResult> {
  const session = await getAgentSession();
  if (!session) return { tower: null, error: "Сессия завершена. Войдите снова.", permissionDenied: false, canAssign: false };
  if (!hasCapability(session.role, "team:read")) {
    return { tower: null, error: null, permissionDenied: true, canAssign: false };
  }

  try {
    return {
      tower: await getTeamControlTower(session),
      error: null,
      permissionDenied: false,
      canAssign: hasCapability(session.role, "team:assign"),
    };
  } catch (error) {
    console.error("[operations] team control tower unavailable", error);
    return {
      tower: null,
      error: "Командные данные не загрузились. Повторите запрос: пустой экран не означает, что рисков нет.",
      permissionDenied: false,
      canAssign: hasCapability(session.role, "team:assign"),
    };
  }
}

export default async function OperationsPage() {
  const result = await loadControlTower();
  return <OperationsClient {...result} />;
}
