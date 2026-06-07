import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readCoState, mergeCoAttributes } from "@/lib/coSession";
import { toPublicEstimateItems, type EstimateItem } from "@/lib/calculationUtils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function resolveMeetingId(code: string): Promise<number | null> {
  // DEV-<id> — обход только вне прода. В проде доступ строго по cobrowseCode,
  // иначе любой подбором DEV-<id> читает/пишет co-state чужой встречи (ПДн).
  if (code.startsWith("DEV-")) {
    return process.env.NODE_ENV === "production" ? null : Number(code.slice(4)) || null;
  }
  try {
    const meeting = await prisma.meeting.findUnique({ where: { cobrowseCode: code }, select: { id: true } });
    return meeting?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const meetingId = await resolveMeetingId(code);
  if (!meetingId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // P2: отметить первый просмотр клиентом (не блокирует ответ).
  if (!code.startsWith("DEV-")) {
    prisma.meeting
      .updateMany({ where: { id: meetingId, coViewedAt: null }, data: { coViewedAt: new Date() } })
      .catch(() => {});
  }

  // 1. Live cobrowse session takes priority.
  const entry = await readCoState(meetingId);
  if (entry) {
    return NextResponse.json({ state: entry.state, updatedAt: entry.updatedAt, isSnapshot: false });
  }

  // 2. Fallback: latest saved QuoteVersion — shown when agent is not in an active session.
  try {
    const quote = await prisma.quote.findFirst({
      where: { meetingId },
      include: {
        versions: { orderBy: { createdAt: "desc" }, take: 1 },
        meeting: {
          select: {
            agent: { select: { user: { select: { name: true, phone: true } } } },
          },
        },
      },
    });

    if (!quote || quote.versions.length === 0) {
      return NextResponse.json({ state: null, updatedAt: null, isSnapshot: false });
    }

    const version = quote.versions[0];
    const raw = JSON.parse(version.payload) as {
      form?: unknown;
      attributes?: unknown;
      estimateItems?: unknown[];
    };

    // Strip internal fields (costPrice, margin) — server is the security boundary.
    const publicItems = Array.isArray(raw.estimateItems)
      ? toPublicEstimateItems(raw.estimateItems as EstimateItem[])
      : [];

    const state = {
      form: raw.form ?? null,
      attributes: raw.attributes ?? null,
      estimateItems: publicItems,
      // externalExpenses not stored in QuoteVersion — omit intentionally
      _ts: version.createdAt.getTime(),
    };

    return NextResponse.json({
      state,
      updatedAt: version.createdAt.getTime(),
      isSnapshot: true,
      agentName: quote.meeting?.agent?.user?.name ?? null,
      agentPhone: quote.meeting?.agent?.user?.phone ?? null,
    });
  } catch {
    return NextResponse.json({ state: null, updatedAt: null, isSnapshot: false });
  }
}

// Клиент меняет только атрибутику (без авторизации — доступ по коду встречи).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const meetingId = await resolveMeetingId(code);
  if (!meetingId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const ok = await mergeCoAttributes(meetingId, (body as { attributes?: unknown }).attributes);
  if (!ok) return NextResponse.json({ error: "Save failed" }, { status: 500 });
  const entry = await readCoState(meetingId);
  return NextResponse.json({ ok: true, state: entry?.state ?? null, updatedAt: entry?.updatedAt ?? null });
}
