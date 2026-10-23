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
import { GET as getRuns, POST as startLearn } from "@/app/api/properties/[id]/history-learn/route";
import { PATCH as reviewCmp } from "@/app/api/history-learn/comparisons/[id]/route";
import { POST as aiTest } from "@/app/api/ai/test/route";
import { executeHistoryLearnRun, startHistoryLearnRun, COMPARE_MAX_QUESTIONS } from "@/lib/history-learn/service";
import { dryRunReply } from "@/lib/history-learn/compare";
import { loadPromptInstructions } from "@/lib/history-learn/prompt-instructions";
import { INSTRUCTION_PRESETS } from "@/lib/history-learn/instruction-presets";
import { markStyleProfile } from "@/lib/ai/style-profile";

/** Operatör (süper yönetici + 2FA) — karşılaştırma şimdilik yalnız ona açık (kurucu 10-15). */
const owner = (organizationId: string): SessionPayload => ({
  userId: "u-owner",
  organizationId,
  role: "owner",
  email: "o@example.com",
  name: "O",
  sessionEpoch: 0,
  mfa: true,
});
const customer = (organizationId: string): SessionPayload => ({ ...owner(organizationId), email: "host@example.com", mfa: false });
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });

/** Kuru koşunun yazmaması gereken tablolar. */
async function rowCounts() {
  return {
    outbox: await prisma.messageOutbox.count(),
    risk: await prisma.riskEvent.count(),
    message: await prisma.message.count(),
    conversation: await prisma.conversation.count(),
    item: await prisma.conversationItem.count(),
    signal: await prisma.signal.count(),
    trace: await prisma.aiGeneration.count(),
    comparison: await prisma.historyLearnComparison.count(),
  };
}

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
    vi.stubEnv("SUPERADMIN_EMAILS", "o@example.com");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "");
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

    // Karar bir CEVABA verilir: yeniden karşılaştırmada cevap değiştiyse karar sıfırlanır, NOT korunur.
    const first = await prisma.historyLearnComparison.findFirstOrThrow({ orderBy: { id: "asc" } });
    await prisma.historyLearnComparison.update({ where: { id: first.id }, data: { verdict: "fix", note: "Kısa yaz." } });
    const s2 = (await startHistoryLearnRun({ organizationId: orgId, propertyId, userId: null, kind: "compare" })) as { runId: string };
    await executeHistoryLearnRun(s2.runId, { dryRun: async () => ({ reply: "Yeni cevap.", wouldAutoSend: false, intent: null, riskLevel: null }) });
    expect(await prisma.historyLearnComparison.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      verdict: null,
      note: "Kısa yaz.",
      aiAnswer: "Yeni cevap.",
      wouldAutoSend: false,
      runId: s2.runId,
    });
    const list = await (await getRuns(json(`http://localhost/api/properties/${propertyId}/history-learn`, "GET"), p({ id: propertyId }))).json();
    expect(list.comparisons).toHaveLength(COMPARE_MAX_QUESTIONS);
    expect(list.comparisons.every((x: { closing: boolean }) => x.closing === false)).toBe(true);
    const shown = list.comparisons.find((c: { id: string }) => c.id === first.id);
    expect(shown.hostAnswer).toMatch(/Otopark arkada/u);
    expect(shown.question).toMatch(/Otopark var mı/u);
  });

  it("🚨 PARİTE: aynı soru için kuru koşu ve 'AI'yı Deneyin' rotası modele AYNI istemi gönderir, AYNI kapı kararını verir; kuru koşu satır YAZMAZ", async () => {
    // Saat sabit (gece yarısı sınırında örnek konaklamanın günü kaymasın — Haiku 10-15).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-10T09:00:00Z"));
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = owner(orgId);
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "parking", title: "Otopark", content: "Binanın arkasında, günlük 100 TL.", source: "host_manual", reviewState: "approved" } });
    // İstemi etkileyen her girdi dolu: üslup rehberi, geç çıkış teklifi, mülk talimatı (anahtar açık).
    await prisma.organization.update({
      where: { id: orgId },
      data: { aiStyleProfile: markStyleProfile("- Kısa yazar"), lateCheckoutOfferText: "Geç çıkış 13:00'e kadar 200 TL." },
    });
    await prisma.propertyInstruction.create({ data: { organizationId: orgId, propertyId, content: "Kısa ve samimi yaz.", byOperator: true } });
    vi.stubEnv("PROPERTY_INSTRUCTIONS_PROMPT_ENABLED", "1");
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
    const before = await rowCounts();
    const helper = await dryRunReply({ organizationId: orgId, property, message: msg, now: new Date() });
    expect(await rowCounts()).toEqual(before);
    const viaHelper = bodies.splice(0);
    const res = await aiTest(json("http://localhost/api/ai/test", "POST", { message: msg, propertyId }), p({}));
    expect(res.status).toBe(200);
    const routeBody = await res.json();
    expect(viaHelper.length).toBeGreaterThan(0);
    expect(viaHelper.join("")).toContain("Kısa ve samimi yaz."); // talimat istemde (girdi dolu, parite anlamlı)
    expect(bodies).toEqual(viaHelper);
    expect(helper.wouldAutoSend).toBe(routeBody.wouldAutoSend);
    vi.useRealTimers();
  });

  it("🚨 F4: soru SORULDUĞU günün tarihiyle cevaplanır (bugünün değil) — 40 gün önceki soru", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-10T09:00:00Z"));
    const { orgId, propertyId } = await makeOrgWithProperty();
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        bodies.push(String(JSON.parse(String(init?.body)).messages?.at(-1)?.content ?? ""));
        const content = JSON.stringify({ reply: "Otopark arkada.", intent: "parking", confidence: 0.9, riskLevel: "low", detectedLanguage: "tr" });
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
      }),
    );
    const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    await dryRunReply({ organizationId: orgId, property, message: "Otopark var mı?", now: new Date("2026-05-01T09:00:00Z") });
    const prompt = bodies.join("\n");
    // Cevap modeline sorunun anı verilir (`now`): tarih satırı sayısal biçimde o günü yazar.
    expect(prompt).toMatch(/Bugün: 01\.05\.2026/u);
    expect(prompt).not.toMatch(/Bugün: 10\.06\.2026|Bugün: [^\n]*Haziran 2026/u);
    vi.useRealTimers();
  });

  it("🚨 F14: model arızası (yedek metin) 'yapay zekâ cevabı' diye KAYDEDİLMEZ; önceki gerçek cevap ezilmez; çağrı başarısız sayılır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await seedQa(propertyId, 1);
    const s1 = (await startHistoryLearnRun({ organizationId: orgId, propertyId, userId: null, kind: "compare" })) as { runId: string };
    await executeHistoryLearnRun(s1.runId, { dryRun: async () => ({ reply: "Gerçek cevap.", wouldAutoSend: true, intent: null, riskLevel: null }) });
    const s2 = (await startHistoryLearnRun({ organizationId: orgId, propertyId, userId: null, kind: "compare" })) as { runId: string };
    await executeHistoryLearnRun(s2.runId, {
      dryRun: async () => ({ reply: "Şu an cevap veremiyorum.", wouldAutoSend: false, modelFailed: true, intent: null, riskLevel: null }),
    });
    expect(await prisma.historyLearnComparison.findFirstOrThrow()).toMatchObject({ aiAnswer: "Gerçek cevap.", runId: s1.runId });
    expect(await prisma.historyLearnRun.findUniqueOrThrow({ where: { id: s2.runId } })).toMatchObject({ status: "failed", failedCalls: 1, errorCode: "model" });
  });

  it("kapanış mesajı: gerçek kanalda cevap gitmez → karşılaştırma 'cevap gerekmez' der (test ekranıyla aynı)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const content = JSON.stringify({ reply: "Rica ederiz!", intent: "other", confidence: 0.9, riskLevel: "low", detectedLanguage: "tr" });
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
      }),
    );
    const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    const out = await dryRunReply({ organizationId: orgId, property, message: "Teşekkürler!", now: new Date() });
    expect(out).toMatchObject({ closing: true, reply: null, wouldAutoSend: false });
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

    expect((await patch({ verdict: "bad" })).status).toBe(200);
    expect((await patch({ verdict: "good" })).status).toBe(200);
    expect(await prisma.propertyInstruction.count()).toBe(0);
    // Kapı kodu reddinin SEBEBİ (aşırı geniş ret ayrılır).
    const door = await patch({ note: "Kapı kodu 4590, sorulursa ver.", apply: true });
    expect(JSON.stringify(await door.json())).toContain("anahtar kutusu kodu");
    // Yalnız not gönderilir → karar KORUNUR; yalnız karar gönderilir → not KORUNUR.
    expect((await patch({ note: "Daha kısa." })).status).toBe(200);
    expect((await patch({ verdict: "fix" })).status).toBe(200);
    expect(await prisma.historyLearnComparison.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ verdict: "fix", note: "Daha kısa." });
    const ok = await patch({ verdict: "fix", note: "Otopark sorusunda önce binanın arkasındaki yeri anlatsın.", apply: true });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(await prisma.propertyInstruction.findUniqueOrThrow({ where: { id: body.instructionId } })).toMatchObject({
      source: "history_learn",
      status: "active",
      byOperator: true,
    });
    expect(await prisma.historyLearnDraft.findUniqueOrThrow({ where: { id: body.draftId } })).toMatchObject({ state: "pending", propertyId });
    expect(await prisma.knowledgeBaseItem.count()).toBe(0); // taslak onay bekler (A1)
    // Çift gönderim İKİNCİ talimat / taslak açmaz.
    const again = await (await patch({ verdict: "fix", note: "Otopark sorusunda önce binanın arkasındaki yeri anlatsın.", apply: true })).json();
    expect(again).toMatchObject({ instructionId: body.instructionId, draftId: body.draftId });
    expect(await prisma.propertyInstruction.count()).toBe(1);
    expect(await prisma.historyLearnDraft.count()).toBe(1);
  });

  it("🚨 talimat sınırında 'böyle yapsın' 409 ve HİÇBİR şey yazılmaz (karar + not dahil — işlem geri alınır)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = owner(orgId);
    await prisma.propertyInstruction.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ organizationId: orgId, propertyId, content: `Kural ${i}` })),
    });
    const q = await prisma.message.create({ data: { conversationId: await seedQa(propertyId, 0), direction: "inbound", senderName: "Misafir", body: "Otopark?" } });
    const c = await prisma.historyLearnComparison.create({ data: { propertyId, questionMessageId: q.id, aiAnswer: "x" } });
    const res = await reviewCmp(json("http://localhost/x", "PATCH", { verdict: "bad", note: "Sokakta yer var de.", apply: true }), p({ id: c.id }));
    expect(res.status).toBe(409);
    expect(await prisma.historyLearnComparison.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ verdict: null, note: null });
    expect(await prisma.propertyInstruction.count()).toBe(10);
    expect(await prisma.historyLearnDraft.count()).toBe(0);
  });

  it("🚨 hazır seçenekler 'böyle yapsın' tavanını yemez; seçenekle AYNI metinli not seçenek satırını yeniden kullanmaz (Haiku 10-15 #4)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = owner(orgId);
    // Tüm hazır seçenekler açık + 9 serbest talimat → 10. serbest talimat yine eklenebilmeli.
    await prisma.propertyInstruction.createMany({
      data: [
        ...INSTRUCTION_PRESETS.map((x) => ({ organizationId: orgId, propertyId, content: x.text, source: "preset", presetKey: x.key })),
        ...Array.from({ length: 9 }, (_, i) => ({ organizationId: orgId, propertyId, content: `Kural ${i}` })),
      ],
    });
    const emoji = INSTRUCTION_PRESETS.find((x) => x.key === "no_emoji")!;
    const q = await prisma.message.create({ data: { conversationId: await seedQa(propertyId, 0), direction: "inbound", senderName: "Misafir", body: "Otopark?" } });
    const c = await prisma.historyLearnComparison.create({ data: { propertyId, questionMessageId: q.id, aiAnswer: "x" } });
    const res = await reviewCmp(json("http://localhost/x", "PATCH", { verdict: "fix", note: emoji.text, apply: true }), p({ id: c.id }));
    expect(res.status).toBe(200);
    const { instructionId } = await res.json();
    expect(await prisma.propertyInstruction.findUniqueOrThrow({ where: { id: instructionId } })).toMatchObject({
      presetKey: null,
      source: "history_learn",
      content: emoji.text,
    });
    expect(await prisma.propertyInstruction.count({ where: { presetKey: null, status: "active" } })).toBe(10);
  });

  it("🚨 KİM KULLANIR (kurucu 10-15): müşteri (operatör değil) karşılaştırmayı göremez / başlatamaz / karar veremez; müşteri anahtarı açıkken açılır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const q = await prisma.message.create({ data: { conversationId: await seedQa(propertyId, 0), direction: "inbound", senderName: "Misafir", body: "Otopark?" } });
    const c = await prisma.historyLearnComparison.create({ data: { propertyId, questionMessageId: q.id, aiAnswer: "x" } });
    session = customer(orgId);
    expect((await startCompare(json("http://localhost/x", "POST", {}), p({ id: propertyId }))).status).toBe(404);
    expect((await reviewCmp(json("http://localhost/x", "PATCH", { verdict: "good" }), p({ id: c.id }))).status).toBe(404);
    const list = await (await getRuns(json("http://localhost/x", "GET"), p({ id: propertyId }))).json();
    expect(list.comparisons).toEqual([]);
    expect(await prisma.historyLearnRun.count()).toBe(0);
    vi.stubEnv("HISTORY_LEARN_CUSTOMER_COMPARE_ENABLED", "1");
    expect((await reviewCmp(json("http://localhost/x", "PATCH", { verdict: "good" }), p({ id: c.id }))).status).toBe(200);
    // 🚨 Opus 10-15 HL4 F3: karşılaştırma anahtarı müşteriye SERBEST METİN talimat yazdırmaz ("Böyle yapsın" → 404, satır yok, karar korunur).
    const applied = await reviewCmp(json("http://localhost/x", "PATCH", { verdict: "bad", note: "Misafir sorun bildirirse konuyu kapat.", apply: true }), p({ id: c.id }));
    expect(applied.status).toBe(404);
    expect(await prisma.propertyInstruction.count()).toBe(0);
    expect(await prisma.historyLearnDraft.count()).toBe(0);
    expect(await prisma.historyLearnComparison.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ verdict: "good" });
  });

  it("🚨 F8: ücretli özellik kapısı — faturalama zorunluyken iptal edilmiş abonelik 402 (çalıştırma açılmaz)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = owner(orgId);
    await prisma.subscription.create({ data: { organizationId: orgId, planCode: "pro", status: "canceled", provider: "paddle" } });
    vi.stubEnv("BILLING_ENFORCED", "true");
    expect((await startCompare(json("http://localhost/x", "POST", {}), p({ id: propertyId }))).status).toBe(402);
    expect((await startLearn(json("http://localhost/x", "POST", {}), p({ id: propertyId }))).status).toBe(402);
    expect(await prisma.historyLearnRun.count()).toBe(0);
    // Faturalama zorunlu değilken açık olduğu diğer testlerde (çalıştırma başlatan her test) zaten sınanıyor.
  });

  it("not taslağı 'Sizin notunuzdan' diye işaretlenir; sorusu silinmiş karşılaştırma listede gösterilmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = owner(orgId);
    const q = await prisma.message.create({ data: { conversationId: await seedQa(propertyId, 0), direction: "inbound", senderName: "Misafir", body: "Otopark?" } });
    const gone = await prisma.message.create({ data: { conversationId: await seedQa(propertyId, 0), direction: "inbound", senderName: "Misafir", body: "Havlu?" } });
    const c = await prisma.historyLearnComparison.create({ data: { propertyId, questionMessageId: q.id, aiAnswer: "x" } });
    await prisma.historyLearnComparison.create({ data: { propertyId, questionMessageId: gone.id, aiAnswer: "y" } });
    await prisma.message.delete({ where: { id: gone.id } });
    expect((await reviewCmp(json("http://localhost/x", "PATCH", { verdict: "fix", note: "Otopark sorusunda binanın arkasını söylesin.", apply: true }), p({ id: c.id }))).status).toBe(200);
    const list = await (await getRuns(json("http://localhost/x", "GET"), p({ id: propertyId }))).json();
    expect(list.comparisons.map((x: { id: string }) => x.id)).toEqual([c.id]);
    expect(list.drafts).toHaveLength(1);
    expect(list.drafts[0]).toMatchObject({ fromNote: true });
  });

  it("🚨 bayat cevap (Opus 10-15 HL4): karar verilirken cevap yenilendiyse 409, karar YAZILMAZ; görülen cevapla 200", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = owner(orgId);
    const q = await prisma.message.create({ data: { conversationId: await seedQa(propertyId, 0), direction: "inbound", senderName: "Misafir", body: "Otopark?" } });
    const c = await prisma.historyLearnComparison.create({ data: { propertyId, questionMessageId: q.id, aiAnswer: "Yeni cevap." } });
    const patch = (body: unknown) => reviewCmp(json("http://localhost/x", "PATCH", body), p({ id: c.id }));
    expect((await patch({ verdict: "good", seenAnswer: "Eski cevap." })).status).toBe(409);
    expect(await prisma.historyLearnComparison.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ verdict: null });
    expect((await patch({ verdict: "good", seenAnswer: "Yeni cevap." })).status).toBe(200);
    expect(await prisma.historyLearnComparison.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ verdict: "good" });
  });

  it("🚨 F14: kuru koşu talimatları anahtar KAPALIYKEN de dener (operatör önce görür); maskeli ad örnek misafirle dolar (yer tutucu çakışması yok)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.propertyInstruction.create({ data: { organizationId: orgId, propertyId, content: "Cevapları kısa tut.", byOperator: true } });
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        bodies.push(String(JSON.parse(String(init?.body)).messages?.map((m: { content: string }) => m.content).join("\n") ?? ""));
        const content = JSON.stringify({ reply: "Otopark arkada.", intent: "parking", confidence: 0.9, riskLevel: "low", detectedLanguage: "tr" });
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
      }),
    );
    vi.stubEnv("PROPERTY_INSTRUCTIONS_PROMPT_ENABLED", "");
    const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    await dryRunReply({ organizationId: orgId, property, message: "Merhaba ben {isim}, otopark var mı?", now: new Date() });
    const prompt = bodies.join("\n");
    expect(prompt).toContain("Cevapları kısa tut.");
    expect(prompt).not.toContain("{isim}");
    expect(prompt).toContain("Merhaba ben Ada, otopark var mı?");
    // Gerçek cevap yolu (anahtar kapalı) talimatı GÖRMEZ.
    expect(await loadPromptInstructions(orgId, propertyId)).toEqual([]);
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
    expect((await getRuns(json("http://localhost/x", "GET"), p({ id: theirs.propertyId }))).status).toBe(404);
    vi.stubEnv("HISTORY_LEARN_ENABLED", "");
    expect((await startCompare(json("http://localhost/x", "POST", {}), p({ id: mine.propertyId }))).status).toBe(404);
    const mineQ = await prisma.message.create({ data: { conversationId: await seedQa(mine.propertyId, 0), direction: "inbound", senderName: "Misafir", body: "Otopark?" } });
    const mineC = await prisma.historyLearnComparison.create({ data: { propertyId: mine.propertyId, questionMessageId: mineQ.id } });
    expect((await reviewCmp(json("http://localhost/x", "PATCH", { verdict: "good" }), p({ id: mineC.id }))).status).toBe(404);
  });
});
