import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { unverifiedActionClaims, assertsDefiniteValue } from "../helpers/claim-detectors";

// ---------------------------------------------------------------------------
// TASLAK ≠ KARAR ≠ ÜRÜNÜN DÖNDÜRDÜĞÜ CEVAP (Codex, 09-09).
//
// 🚨 BULGU: gerçek model eval'i (`tests/eval/`) YALNIZ `suggestReply()` çağırıyor,
// yani ölçtüğü şey MODELİN TASLAĞI. Ürünün ne yapacağı iki adım uzakta:
// `evaluateEscalation` kararı ve ondan çıkan METİN. Devir olan senaryoda taslak
// misafire HİÇ gitmez (`escalationReply()` gider); devir olmayanda AYNEN gider.
// Bu dosya o farkı GERÇEK ROTA üzerinden ölçer.
//
// 🚨 KAPSAM SINIRLARI (bilerek):
//  · Model MOCK'LU. Burası model kalitesini ölçmez; ölçtüğü şey KAPININ verilen
//    bir taslakla ne yaptığıdır. Gerçek model eval'i ayrı ve DB'siz kalır.
//  · "Ürünün döndürdüğü cevap" diyorum, "gerçek misafire teslim edildi" DEMİYORUM:
//    bu bir test ortamı çıktısıdır, canlı teslimat kanıtı değildir.
//  · Hiçbir ürün kodu değişmedi. Bu bir KARAKTERİZASYON testidir: bugünkü
//    davranışı sabitler, böylece P1/P4/P5 onaylanıp uygulandığında hangi
//    satırın değiştiği tek bakışta görünür.
//
// TASLAKLAR UYDURMA DEĞİL: kurucunun 2026-09-09'da `a52a30c` üzerinde koştuğu
// gerçek eval raporundan AYNEN alındı (güven ve kaynak sayıları dahil).
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));

import { NextRequest } from "next/server";
import { POST as CHAT } from "@/app/api/chat/[token]/route";
import { escalationReply } from "@/lib/guest-chat";

const DAY = 86_400_000;

/** Baseline raporundaki model taslakları — DEĞİŞTİRİLMEDİ. */
const BASELINE = {
  E1: {
    guestMessage: "Otopark var mı?",
    reply: "Merhaba, otopark ile ilgili detayları kontrol edip en kısa sürede size dönüş yapacağım.",
    intent: "parking",
    confidence: 0.8,
    usedSources: [] as string[],
  },
  E6: {
    guestMessage: "Sıcak su gelmiyor",
    reply:
      "Bunun için özür dileriz. Sıcak suyla ilgili durumu hemen ekibime ilettim, en kısa sürede kontrol edip size döneceğim.",
    intent: "complaint",
    confidence: 0.9,
    usedSources: [] as string[],
  },
  E7: {
    guestMessage: "Çıkış saati kaçta?",
    reply: "Merhaba, çıkış saatimiz 11:00.",
    intent: "checkout",
    confidence: 0.95,
    usedSources: ["kb:checkout"],
  },
} as const;

function draft(over: { reply: string; intent: string; confidence: number; usedSources: readonly string[] }) {
  return {
    reply: over.reply,
    intent: over.intent,
    riskLevel: "none",
    riskType: null,
    confidence: over.confidence,
    source: "openai",
    priority: "standard",
    risk: null,
    actionSuggestion: null,
    detectedLanguage: "tr",
    usedSources: [...over.usedSources],
    sourceAudit: { declared: over.usedSources.length, verified: over.usedSources.length },
    missingInfo: [],
    statedCheckoutTime: null,
  };
}

async function seed() {
  const { propertyId } = await makeOrgWithProperty();
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
  return { propertyId, token };
}

let seq = 0;
async function ask(token: string, message: string) {
  const res = await CHAT(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, requestId: `d${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
  return (await res.json()) as { reply?: string; escalated?: boolean; handoff?: boolean };
}

describe("QR: model taslağı ile ürünün döndürdüğü cevap AYNI ŞEY DEĞİL", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    // Bant kapalı = canlı varsayılan. Bu dosya bandı AÇMAZ.
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("E6 (şikayet): taslakta 'ekibime ilettim' VAR — ama ürün DEVREDİYOR, o cümle GİTMİYOR", async () => {
    const { token } = await seed();
    mockSuggest.mockResolvedValue(draft(BASELINE.E6));

    const out = await ask(token, BASELINE.E6.guestMessage);

    // Taslakta makbuzsuz iddia gerçekten var (dedektör çalışıyor mu — kontrol).
    expect(unverifiedActionClaims(BASELINE.E6.reply)).toContain("past_action");

    // 🚨 ÜRÜNÜN CEVABI taslak DEĞİL: model `complaint` dedi → ESCALATE_INTENTS.
    expect(out.escalated).toBe(true);
    expect(out.reply).toBe(escalationReply());
    expect(out.reply).not.toContain("ilettim");
    // Devir metni hiçbir eylem/taahhüt iddiası taşımıyor.
    expect(unverifiedActionClaims(out.reply ?? "")).toEqual([]);
  });

  it("🚨 E1 (bilgi sorusu, güven 0.8, KAYNAK YOK): kapı GEÇİLİYOR — kanıtsız söz ÜRÜNÜN CEVABINA giriyor", async () => {
    const { token } = await seed();
    mockSuggest.mockResolvedValue(draft(BASELINE.E1));

    const out = await ask(token, BASELINE.E1.guestMessage);

    // Devir YOK: güven 0.75'in ÜSTÜNDE, intent devir kümesinde değil.
    expect(out.escalated).toBeFalsy();
    expect(out.reply).toBe(BASELINE.E1.reply);

    // 🚨 ASIL BULGU: sıfır kaynakla verilen bir GELECEK TAAHHÜDÜ ürünün
    // cevabında. `hasUnsourcedSpecificClaim` bunu YAKALAYAMAZ — o yalnız rakam
    // ve yer kelimesi arar, üstelik yalnız 0.45-0.75 bandının İÇİNDE çalışır;
    // 0.8'de hiç danışılmaz.
    expect(unverifiedActionClaims(out.reply ?? "")).toContain("future_commitment");
    expect(BASELINE.E1.usedSources).toEqual([]);
  });

  it("🚨 E7 (çelişkili kaynak, güven 0.95): KESİN SAAT ürünün cevabına giriyor", async () => {
    const { token } = await seed();
    mockSuggest.mockResolvedValue(draft(BASELINE.E7));

    const out = await ask(token, BASELINE.E7.guestMessage);

    expect(out.escalated).toBeFalsy();
    expect(out.reply).toBe(BASELINE.E7.reply);
    // 🚨 Kaynak öncelik sözleşmesi YOK (istemde böyle bir kural hiç yok), yani
    // hangi kaynağın kazandığı tanımsız — ama cevap KESİN bir saat söylüyor.
    expect(assertsDefiniteValue(out.reply ?? "")).toBe(true);
  });

  it("KARŞILAŞTIRMA: aynı taslak, düşük güvende ürünün cevabı DEĞİŞİYOR", async () => {
    const { token } = await seed();
    // E1'in taslağı aynen; tek fark güvenin eşiğin ALTINA düşmesi.
    mockSuggest.mockResolvedValue(draft({ ...BASELINE.E1, confidence: 0.6 }));

    const out = await ask(token, BASELINE.E1.guestMessage);

    // Bant kapalı → 0.75 altı devir. Aynı cümle bu kez misafire GİTMEZ.
    expect(out.escalated).toBe(true);
    expect(out.reply).toBe(escalationReply());
    // Yani "kanıtsız söz gider mi" sorusunun cevabı TASLAKTA değil KAPIDA.
    expect(unverifiedActionClaims(out.reply ?? "")).toEqual([]);
  });
});
