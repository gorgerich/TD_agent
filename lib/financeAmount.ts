export function parseRublesToKopecks(raw: string): number | null {
  if (raw.length > 16) return null;
  const match = /^(0|[1-9]\d*)(?:[,.](\d{1,2}))?$/.exec(raw.trim());
  if (!match) return null;

  const kopecks = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return kopecks > 0n && kopecks <= 2_147_483_647n ? Number(kopecks) : null;
}
