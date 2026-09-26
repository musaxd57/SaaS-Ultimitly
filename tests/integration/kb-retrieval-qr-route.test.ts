import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FILLERS } from "../helpers/kb-retrieval-scenarios";
import { KB_ITEM_CAP } from "@/lib/ai/limits";

// ---------------------------------------------------------------------------
// RAG dilim 1 — QR rotası uçtan uca (model MOCK, DB gerçek).
//
// Bayrak KAPALI: modele giden küme = süzülmüş tam küme, kanıt legacy biçimi.
// Bayrak AÇIK: modele giden küme soruya göre seçilmiş, `knowledgeBaseSelection`
// "retrieved", düşen sayısı > 0, `RiskEvent.kbEvidenceJson.retrieval` yazılı,
// `kbRetrieved` seçilen sayı. Misafire dönen gövde kanıt/kimlik TAŞIMAZ.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/[token]/route";

const DAY = 86_400_000;

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Test Misafir",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      currency: "EUR",
    },
  });
  // 31 onaylı, sır kategorisi dışı kalem: 30 dolgu (15 × 2, başlık ekli) + 1 otopark. Küçük-KB
  // eşiğinin (legacy tavanı 30 kalem, 09-23) üstünde → hibrit SEÇİM yapar.
  const base = FILLERS.filter((f) => !["wifi", "checkin"].includes(f.category)).slice(0, 15);
  const fill = [...base, ...base.map((f) => ({ ...f, title: `${f.title} (ek)` }))];
  for (const f of fill) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: f.category, title: f.title, content: f.content, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
  const parking = await prisma.knowledgeBaseItem.create({
    data: { propertyId, category: "parking", title: "Otopark", content: "Bina altı otopark misafirler için ücretsizdir.", isActive: true, source: "host_manual", reviewState: "approved" },
  });
  return { orgId, token, parkingId: parking.id, total: fill.length + 1 };
}

let seq = 0;
const ask = (token: string, message: string) =>
  POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, requestId: `rag-${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );

const model = () => ({
  reply: "Bina altı otopark ücretsizdir.",
  intent: "general",
  riskLevel: "none",
  riskType: null,
  confidence: 0.9,
  source: "openai",
  priority: "standard",
  usedSources: ["kb:parking"],
  missingInfo: [],
  sourceAudit: { declared: 1, verified: 1 },
});

type Input = { knowledgeBase: { id: string; content: string; chunk?: number }[]; knowledgeBaseDropped: number; knowledgeBaseSelection?: string };

describe("QR rotası — hibrit retrieval bayrağı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("BAYRAK KAPALI: tam küme modele gider, seçim 'all', kanıtta retrieval YOK", async () => {
    const { orgId, token, total } = await seed();
    mockSuggest.mockResolvedValue(model());
    const res = await ask(token, "Otopark var mı?");
    expect(res.status).toBe(200);
    const input = mockSuggest.mock.calls[0][0] as Input;
    expect(input.knowledgeBase).toHaveLength(Math.min(total, KB_ITEM_CAP)); // tam küme = legacy tavanı
    expect(input.knowledgeBaseDropped).toBe(Math.max(0, total - KB_ITEM_CAP)); // tavan kırpması sayılır (§C)
    expect(input.knowledgeBaseSelection).toBe("all");
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId, surface: "guest_chat" } });
    expect(ev.kbRetrieved).toBe(Math.min(total, KB_ITEM_CAP));
    expect(ev.kbDropped).toBe(Math.max(0, total - KB_ITEM_CAP));
    expect(String(ev.kbEvidenceJson)).not.toContain("retrieval");
  });

  it("BAYRAK AÇIK: soruya göre seçilmiş küme gider; düşen > 0; RiskEvent retrieval kanıtı + seçilen sayı", async () => {
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    const { orgId, token, parkingId, total } = await seed();
    mockSuggest.mockResolvedValue(model());
    const res = await ask(token, "Otopark var mı?");
    expect(res.status).toBe(200);
    const body = await res.json();
    const input = mockSuggest.mock.calls[0][0] as Input;
    expect(input.knowledgeBase.length).toBeLessThan(total);
    expect(input.knowledgeBase.map((k) => k.id)).toContain(parkingId);
    expect(input.knowledgeBase[0].content).toContain("Bina altı otopark");
    expect(input.knowledgeBaseSelection).toBe("retrieved");
    expect(input.knowledgeBaseDropped).toBe(total - new Set(input.knowledgeBase.map((k) => k.id)).size);
    expect(input.knowledgeBaseDropped).toBeGreaterThan(0);

    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId, surface: "guest_chat" } });
    expect(ev.kbRetrieved).toBe(input.knowledgeBase.length);
    expect(ev.kbDropped).toBe(input.knowledgeBaseDropped);
    const evidence = JSON.parse(String(ev.kbEvidenceJson)) as { retrieved: { id: string; c?: number }[]; retrieval: { mode: string; fb: string; sel: number } };
    expect(evidence.retrieval.mode).toBe("hybrid");
    expect(evidence.retrieval.fb).toBe("none");
    expect(evidence.retrieval.sel).toBe(input.knowledgeBase.length);
    expect(evidence.retrieved.map((r) => r.id)).toContain(parkingId);
    expect(evidence.retrieved.every((r) => typeof r.c === "number")).toBe(true);

    // Misafire dönen gövde kanıt/kimlik taşımaz.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(parkingId);
    expect(raw).not.toContain("retrieval");
    expect(raw).not.toContain("kb_item");
    expect(body.reply).toContain("otopark");
  });

  it("BAYRAK AÇIK, konu tabanda yok: geri çekilir — tam küme gider (E1 dürüst 'bilgi yok' korunur)", async () => {
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    const { orgId, token, total } = await seed();
    mockSuggest.mockResolvedValue({ ...model(), reply: "Jakuzi konusunda kayıtlı bilgim yok.", usedSources: [], sourceAudit: { declared: 0, verified: 0 } });
    await ask(token, "Jakuzi var mı?");
    const input = mockSuggest.mock.calls[0][0] as Input;
    expect(input.knowledgeBase).toHaveLength(Math.min(total, KB_ITEM_CAP)); // tam küme = legacy tavanı
    expect(input.knowledgeBaseSelection).toBe("all");
    expect(input.knowledgeBaseDropped).toBe(Math.max(0, total - KB_ITEM_CAP)); // tavan kırpması sayılır (§C)
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId, surface: "guest_chat" } });
    const evidence = JSON.parse(String(ev.kbEvidenceJson)) as { retrieval: { fb: string } };
    expect(evidence.retrieval.fb).toBe("no_lexical_hits");
  });
});
