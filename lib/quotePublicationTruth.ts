type PublishedVersion = {
  state: string;
  totalState: string;
  total: number;
  versionNumber: number | null;
  snapshotChecksum: string | null;
  validUntil: Date | null;
};

export function isCurrentPublishedVersion(version: PublishedVersion | null, now: Date): boolean {
  return version !== null
    && version.state === "PUBLISHED"
    && version.totalState === "KNOWN"
    && version.total > 0
    && version.versionNumber !== null
    && /^[a-f0-9]{64}$/.test(version.snapshotChecksum ?? "")
    && (version.validUntil === null || version.validUntil > now);
}

export function quoteRegistryStatus(input: {
  hasCurrentPublished: boolean;
  hasDraft: boolean;
  lifecycleStatus: string;
  latestDecision: string | null;
}): "Черновик" | "Отправлена" | "Нужны изменения" | "Согласована" | "Требует разбора" {
  if (!input.hasCurrentPublished) return input.hasDraft ? "Черновик" : "Требует разбора";
  if (input.latestDecision === "ACCEPTED" || input.lifecycleStatus === "ACCEPTED") return "Согласована";
  if (input.latestDecision === "CHANGES_REQUESTED") return "Нужны изменения";
  return "Отправлена";
}
