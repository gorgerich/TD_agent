"use client";

import { useMemo, useState } from "react";
import {
  ArrowClockwise,
  Check,
  Copy,
  PaperPlaneTilt,
  Prohibit,
  ShieldCheck,
  UserCircle,
  Warning,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";

type Role = "AGENT" | "MANAGER" | "ADMIN";
type MemberStatus = "INVITED" | "ACTIVE" | "SUSPENDED";

export type TeamSnapshot = {
  id: string;
  name: string;
  generatedAt: string;
  memberships: Array<{
    id: string;
    role: Role;
    status: MemberStatus;
    createdAt: string;
    updatedAt: string;
    user: { name: string | null; email: string | null };
  }>;
  invitations: Array<{
    id: string;
    emailNormalized: string;
    role: Role;
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
  }>;
};

const ROLE_LABELS: Record<Role, string> = {
  AGENT: "Агент",
  MANAGER: "Руководитель",
  ADMIN: "Администратор",
};

const ADMIN_CONFIRMATION = "НАЗНАЧИТЬ АДМИНИСТРАТОРА";
const INVITE_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});

function requestHeaders() {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
    "X-Correlation-Id": crypto.randomUUID(),
  };
}

export function TeamAccessClient({
  initial,
  currentMembershipId,
}: {
  initial: TeamSnapshot;
  currentMembershipId: string;
}) {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState(initial);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("AGENT");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuedLink, setIssuedLink] = useState<string | null>(null);

  const activeCount = useMemo(
    () => snapshot.memberships.filter((membership) => membership.status === "ACTIVE").length,
    [snapshot.memberships],
  );

  async function refresh() {
    const response = await fetch("/api/agent/organization/team", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось обновить список команды");
    setSnapshot(await response.json());
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIssuedLink(null);
    setBusy("invite");
    try {
      const response = await fetch("/api/agent/invitations", {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({
          email,
          role,
          confirmation: role === "ADMIN" ? confirmation : undefined,
          expiresInHours: 48,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Не удалось создать приглашение");
      if (data.token) setIssuedLink(`${window.location.origin}/agent/register?invite=${data.token}`);
      await refresh();
      setEmail("");
      setRole("AGENT");
      setConfirmation("");
      toast({ type: "success", message: "Приглашение создано. Ссылка показывается один раз." });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать приглашение");
    } finally {
      setBusy(null);
    }
  }

  async function updateMember(membershipId: string, change: { role?: Role; status?: MemberStatus }) {
    const nextRole = change.role;
    let adminConfirmation: string | undefined;
    if (nextRole === "ADMIN") {
      adminConfirmation = window.prompt(`Введите ${ADMIN_CONFIRMATION}`) ?? undefined;
      if (adminConfirmation !== ADMIN_CONFIRMATION) return;
    }
    const reason = window.prompt("Кратко укажите причину изменения");
    if (!reason?.trim()) return;
    setBusy(`member:${membershipId}`);
    try {
      const response = await fetch(`/api/agent/organization/memberships/${membershipId}`, {
        method: "PATCH",
        headers: requestHeaders(),
        body: JSON.stringify({ ...change, confirmation: adminConfirmation, reason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Не удалось изменить доступ");
      await refresh();
      toast({ type: "success", message: "Доступ сотрудника обновлён." });
    } catch (cause) {
      toast({ type: "error", message: cause instanceof Error ? cause.message : "Не удалось изменить доступ" });
    } finally {
      setBusy(null);
    }
  }

  async function updateInvite(inviteId: string, action: "RESEND" | "REVOKE") {
    setBusy(`invite:${inviteId}`);
    setIssuedLink(null);
    try {
      const response = await fetch(`/api/agent/invitations/${inviteId}`, {
        method: "PATCH",
        headers: requestHeaders(),
        body: JSON.stringify({ action, expiresInHours: 48 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Не удалось обновить приглашение");
      if (data.token) setIssuedLink(`${window.location.origin}/agent/register?invite=${data.token}`);
      await refresh();
      toast({ type: "success", message: action === "RESEND" ? "Создана новая ссылка приглашения." : "Приглашение отозвано." });
    } catch (cause) {
      toast({ type: "error", message: cause instanceof Error ? cause.message : "Не удалось обновить приглашение" });
    } finally {
      setBusy(null);
    }
  }

  async function copyIssuedLink() {
    if (!issuedLink) return;
    await navigator.clipboard.writeText(issuedLink);
    toast({ type: "success", message: "Ссылка скопирована." });
  }

  return (
    <div className="mt-7 space-y-5">
      <section className="td-shell overflow-hidden" aria-labelledby="team-members-title">
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            <h2 id="team-members-title" className="text-[17px] font-semibold text-ink">Сотрудники</h2>
            <p className="mt-1 text-[12px] text-ink-3">{activeCount} активных · {snapshot.memberships.length} всего</p>
          </span>
          <Button type="button" size="sm" onClick={() => setInviteOpen((value) => !value)} leftIcon={<PaperPlaneTilt size={16} weight="fill" />}>
            Пригласить сотрудника
          </Button>
        </div>

        {inviteOpen && (
          <form onSubmit={invite} className="border-y border-line bg-surface-2 px-5 py-5 sm:px-6">
            <div className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_180px_auto] md:items-end">
              <label>
                <span className="td-field-label">Рабочий email</span>
                <input className="td-field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
              </label>
              <label>
                <span className="td-field-label">Роль</span>
                <select className="td-field" value={role} onChange={(event) => setRole(event.target.value as Role)}>
                  <option value="AGENT">Агент</option>
                  <option value="MANAGER">Руководитель</option>
                  <option value="ADMIN">Администратор</option>
                </select>
              </label>
              <Button type="submit" loading={busy === "invite"} disabled={role === "ADMIN" && confirmation !== ADMIN_CONFIRMATION}>
                Создать ссылку
              </Button>
            </div>
            {role === "ADMIN" && (
              <label className="mt-4 block max-w-[480px]">
                <span className="td-field-label">Подтверждение усиленных прав</span>
                <input
                  className="td-field"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={ADMIN_CONFIRMATION}
                  aria-describedby="admin-confirmation-help"
                />
                <span id="admin-confirmation-help" className="mt-2 block text-[11px] leading-5 text-warning">
                  ADMIN сможет управлять сотрудниками и назначать других администраторов организации.
                </span>
              </label>
            )}
            {error && <p role="alert" className="mt-3 inline-flex items-center gap-2 text-[12px] font-medium text-danger"><Warning size={15} weight="fill" />{error}</p>}
          </form>
        )}

        {issuedLink && (
          <div className="flex flex-col gap-3 border-b border-line bg-success-soft px-5 py-4 sm:flex-row sm:items-center sm:px-6">
            <Check size={18} weight="bold" className="shrink-0 text-success" />
            <p className="min-w-0 flex-1 break-all text-[12px] text-ink">
              Ссылка показана один раз: {issuedLink}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={copyIssuedLink} leftIcon={<Copy size={15} weight="bold" />}>Копировать</Button>
          </div>
        )}

        <div className="divide-y divide-line">
          {snapshot.memberships.map((membership) => {
            const own = membership.id === currentMembershipId;
            const isBusy = busy === `member:${membership.id}`;
            return (
              <article key={membership.id} className="grid gap-4 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(180px,1fr)_170px_130px_auto] lg:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <UserCircle size={30} weight="fill" className="shrink-0 text-ink-3" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink">{membership.user.name ?? "Без имени"}{own ? " · Вы" : ""}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-3">{membership.user.email ?? "Email не указан"}</span>
                  </span>
                </div>
                <label>
                  <span className="sr-only">Роль сотрудника</span>
                  <select
                    className="td-field min-h-10 py-2 text-[12px]"
                    value={membership.role}
                    disabled={isBusy}
                    onChange={(event) => updateMember(membership.id, { role: event.target.value as Role })}
                    aria-label={`Роль ${membership.user.name ?? membership.user.email ?? "сотрудника"}`}
                  >
                    <option value="AGENT">Агент</option>
                    <option value="MANAGER">Руководитель</option>
                    <option value="ADMIN">Администратор</option>
                  </select>
                </label>
                <span className={`inline-flex w-fit items-center gap-2 text-[12px] font-semibold ${membership.status === "ACTIVE" ? "text-success" : "text-ink-3"}`}>
                  {membership.status === "ACTIVE" ? <Check size={15} weight="bold" /> : <Prohibit size={15} weight="fill" />}
                  {membership.status === "ACTIVE" ? "Активен" : membership.status === "INVITED" ? "Приглашён" : "Приостановлен"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={isBusy}
                  onClick={() => updateMember(membership.id, { status: membership.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })}
                  leftIcon={membership.status === "ACTIVE" ? <Prohibit size={15} weight="fill" /> : <ArrowClockwise size={15} weight="bold" />}
                >
                  {membership.status === "ACTIVE" ? "Приостановить" : "Возобновить"}
                </Button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="td-shell overflow-hidden" aria-labelledby="team-invites-title">
        <div className="px-5 py-5 sm:px-6">
          <h2 id="team-invites-title" className="text-[17px] font-semibold text-ink">Приглашения</h2>
          <p className="mt-1 text-[12px] text-ink-3">Токены не хранятся и не отображаются в списке.</p>
        </div>
        {snapshot.invitations.length ? (
          <div className="divide-y divide-line border-t border-line">
            {snapshot.invitations.map((invite) => {
              const expired = new Date(invite.expiresAt).getTime() <= new Date(snapshot.generatedAt).getTime();
              const revoked = Boolean(invite.revokedAt);
              const isBusy = busy === `invite:${invite.id}`;
              return (
                <article key={invite.id} className="grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(220px,1fr)_130px_160px_auto] lg:items-center">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink">{invite.emailNormalized}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-3">{ROLE_LABELS[invite.role]}</span>
                  </span>
                  <span className={`text-[12px] font-semibold ${revoked || expired ? "text-danger" : "text-success"}`}>
                    {revoked ? "Отозвано" : expired ? "Истекло" : "Ожидает"}
                  </span>
                  <time className="text-[11px] text-ink-3">до {INVITE_DATE_FORMATTER.format(new Date(invite.expiresAt))}</time>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="ghost" size="sm" loading={isBusy} onClick={() => updateInvite(invite.id, "RESEND")}>Отправить снова</Button>
                    {!revoked && <Button type="button" variant="ghost" size="sm" disabled={isBusy} onClick={() => updateInvite(invite.id, "REVOKE")}>Отозвать</Button>}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="border-t border-line px-5 py-10 text-center sm:px-6">
            <ShieldCheck size={30} weight="fill" className="mx-auto text-ink-3" />
            <p className="mt-3 text-[13px] font-semibold text-ink">Нет ожидающих приглашений</p>
            <p className="mt-1 text-[12px] text-ink-3">Новые сотрудники появятся здесь до регистрации.</p>
          </div>
        )}
      </section>
    </div>
  );
}
