import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// CEVAP KARŞILAŞTIRMA (F1, migration 65) — gerçek PostgreSQL. Pinlenen:
//  · kuru koşuya giden soru MASKELİ (ad / telefon / kapı kodu yok); hiçbir şey gönderilmez (giden kuyruk / mesaj / risk satırı yok);
//  · yeniden karşılaştırma ev sahibinin kararını + notunu KORUR, yalnız yapay zekâ alanlarını yeniler; en çok 50 soru;
//  · 🚨 PARİTE: aynı soru için `dryRunReply` ve "AI'yı Deneyin" rotası modele AYNI istemi gönderir (karşılaştırma ekranı canlı
//    davranışı gösterir);
//  · karar: geçersiz karar / notsuz "böyle yapsın" 400; kapıdan dönen not (kapı kodu) HİÇBİR şey yazmaz; geçerli not HEM talimat HEM
//    bekleyen bilgi tabanı taslağı;
//  · anahtar kapalı 404; KİRACILAR ARASI 404 ve yazma yok.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as startCompare } from "@/app/api/properties/[id]/history-learn/compare/route";
import { GET as getRuns } from "@/app/api/properties/[id]/history-learn/route";
import { PATCH as reviewCmp } from "@/app/api/history-learn/comparisons/[id]/route";
import { POST as aiTest } from "@/app/api/ai/test/route";
import { executeHistoryLearnRun, startHistoryLearnRun, COMPARE_MAX_QUESTIONS } from "@/lib/history-learn/service";
import { dryRunReply } from "@/lib/history-learn/compare";

const owner = (organizationId: string): SessionPayload => ({
  userId: "u-owner",
  organizationId,
  role: "owner",
  email: "o@example.com",
  name: "O",
  sessionEpoch: 0,
});
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });

async function seedQa(propertyId: string, n = 1, guest = "Ayşe Yılmaz") {
  const t0 = Date.now() - 3 * 86_400_000;
  const conv = await prisma.conversation.create({ data: { propertyId, guestIdentifier: guest, channel: "airbnb", status: "closed", lastMessageAt: new Date(t0) } });
  for (let i = 0; i < n; i += 1) {
    await prisma.message.create({ data: { conversationId: conv.id, direction: "inbound", authorType: "guest", senderName: guest, body: `Merhaba, ben Ayşe. Otopark var mı? (${i}) Numaram 0532 111 22 33`, createdAt: new Date(t0 + i * 600_000) } });
    await prisma.message.create({ data: { conversationId: conv.id, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: `Otopark arkada (${i}).`, createdAt: new Date(t0 + i * 600_000 + 60_000) } });
  }
  return conv.id;
}

describe("Geçmişten öğren — cevap karşılaştırma", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("HISTORY_LEARN_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 kuru koşu: soru MASKELİ gider, hiçbir şey gönderilmez; karar korunarak yeniden karşılaştırılır; en çok 50 soru", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = owner(orgId);
    await seedQa(propertyId, COMPARE_MAX_QUESTIONS + 5);
    const seen: string[] = [];
    const dryRun = vi.fn(async (i: { message: string }) => {
      seen.push(i.message);
      return { reply: "Otopark binanın arkasında.", wouldAutoSend: true, intent: "parking", riskLevel: "low" };
    });
    const s1 = (await startHistoryLearnRun({ organizationId: orgId, propertyId, userId: null, kind: "compare" })) as { runId: string };
    await executeHistoryLearnRun(s1.runId, { dryRun });
    expect(dryRun).toHaveBeenCalledTimes(COMPARE_MAX_QUESTIONS);
    expect(seen.every((m) => !m.includes("Ayşe") && !m.includes("0532"))).toBe(true);
    expect(await prisma.historyLearnComparison.count()).toBe(COMPARE_MAX_QUESTIONS);
    expect(await prisma.messageOutbox.count()).toBe(0);
    expect(await prisma.riskEvent.count()).toBe(0);
    expect(await prisma.message.count()).toBe((COMPARE_MAX_QUESTIONS + 5) * 2);
    expect(await prisma.historyLearnRun.findUniqueOrThrow({ where: { id: s1.runId } })).toMatchObject({ status: "done", calls: COMPARE_MAX_QUESTIONS, failedCalls: 0 });

    // Ev sahibi karar verir; yeniden karşılaştırma kararı KORUR, yapay zekâ cevabını yeniler.
    const first = await prisma.historyLearnComparison.findFirstOrThrow({ orderBy: { id: "asc" } });
    await prisma.historyLearnComparison.update({ where: { id: first.id }, data: { verdict: "fix", note: "Kısa yaz." } });
    const s2 = (await startHistoryLearnRun({ organizationId: orgId, propertyId, userId: null, kind: "compare" })) as { runId: string };
    await executeHistoryLearnRun(s2.runId, { dryRun: async () => ({ reply: "Yeni cevap.", wouldAutoSend: false, intent: null, riskLevel: null }) });
    expect(await prisma.historyLearnComparison.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      verdict: "fix",
      note: "Kısa yaz.",
      aiAnswer: "Yeni cevap.",
      wouldAutoSend: false,
      runId: s2.runId,
    });
    const list = await (await getRuns(json(`http://localhost/api/properties/${propertyId}/history-learn`, "GET"), p({ id: propertyId }))).json();
    expect(list.comparisons).toHaveLength(COMPARE_MAX_QUESTIONS);
    const shown = list.comparisons.find((c: { id: string }) => c.id === first.id);
    expect(shown.hostAnswer).toMatch(/Otopark arkada/u);
    expect(shown.question).toMatch(/Otopark var mı/u);
  });

  it("🚨 PARİTE: aynı soru için kuru koşu ve 'AI'yı Deneyin' rotası modele AYNI istemi gönderir", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = owner(orgId);
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "parking", title: "Otopark", content: "Binanın arkasında, günlük 100 TL.", source: "host_manual", reviewState: "approved" } });
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        const b = JSON.parse(String(init?.body));
        bodies.push(JSON.stringify(b.messages));
        const content = JSON.stringify({ reply: "Otopark binanın arkasında, günlük 100 TL.", intent: "parking", confidence: 0.9, riskLevel: "low", detectedLanguage: "tr" });
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
      }),
    );
    const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    const msg = "Otopark var mı?";
    await dryRunReply({ organizationId: orgId, property, message: msg, now: new Date() });
    const viaHelper = bodies.splice(0);
    const res = await aiTest(json("http://localhost/api/ai/test", "POST", { message: msg, propertyId }), p({}));
    expect(res.status).toBe(200);
    expect(viaHelper.length).toBeGreaterThan(0);
    expect(bodies).toEqual(viaHelper);
  });

  it("karar: geçersiz / notsuz 'böyle yapsın' 400; kapıdan dönen not hiçbir şey yazmaz; geçerli not HEM talimat HEM bekleyen taslak", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = owner(orgId);
    const q = await prisma.message.create({ data: { conversationId: await seedQa(propertyId, 0), direction: "inbound", senderName: "Misafir", body: "Otopark?" } });
    const c = await prisma.historyLearnComparison.create({ data: { propertyId, questionMessageId: q.id, aiAnswer: "x" } });
    const patch = (body: unknown) => reviewCmp(json(`http://localhost/api/history-learn/comparisons/${c.id}`, "PATCH", body), p({ id: c.id }));
    expect((await patch({ verdict: "great" })).status).toBe(400);
    expect((await patch({ verdict: "fix", apply: true })).status).toBe(400);
    expect((await patch({ verdict: "fix", note: "Kapı kodu 4590, sorulursa ver.", apply: true })).status).toBe(400);
    expect(await prisma.propertyInstruction.count()).toBe(0);
    expect(await prisma.historyLearnDraft.count()).toBe(0);
    expect(await prisma.historyLearnComparison.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ verdict: null, note: null });

    expect((await patch({ verdict: "good" })).status).toBe(200);
    expect(await prisma.propertyInstruction.count()).toBe(0);
    const ok = await patch({ verdict: "fix", note: "Otopark sorulursa önce sokakta ücretsiz yer olduğunu söyle.", apply: true });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(await prisma.propertyInstruction.findUniqueOrThrow({ where: { id: body.instructionId } })).toMatchObject({ source: "history_learn", status: "active" });
    expect(await prisma.historyLearnDraft.findUniqueOrThrow({ where: { id: body.draftId } })).toMatchObject({ state: "pending", propertyId });
    expect(await prisma.knowledgeBaseItem.count()).toBe(0); // taslak onay bekler (A1)
  });

  it("anahtar kapalı 404; 🚨 KİRACILAR ARASI: başka işletmenin mülkü / karşılaştırması 404, yazma yok", async () => {
    const mine = await makeOrgWithProperty();
    const theirs = await makeOrgWithProperty();
    const q = await prisma.message.create({ data: { conversationId: await seedQa(theirs.propertyId, 0), direction: "inbound", senderName: "Misafir", body: "Otopark?" } });
    const c = await prisma.historyLearnComparison.create({ data: { propertyId: theirs.propertyId, questionMessageId: q.id } });
    session = owner(mine.orgId);
    expect((await startCompare(json("http://localhost/x", "POST", {}), p({ id: theirs.propertyId }))).status).toBe(404);
    expect((await reviewCmp(json("http://localhost/x", "PATCH", { verdict: "good", note: "Kısa yaz.", apply: true }), p({ id: c.id }))).status).toBe(404);
    expect(await prisma.historyLearnRun.count()).toBe(0);
    expect(await prisma.propertyInstruction.count()).toBe(0);
    expect(await prisma.historyLearnComparison.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ verdict: null });
    vi.stubEnv("HISTORY_LEARN_ENABLED", "");
    expect((await startCompare(json("http://localhost/x", "POST", {}), p({ id: mine.propertyId }))).status).toBe(404);
  });
});
