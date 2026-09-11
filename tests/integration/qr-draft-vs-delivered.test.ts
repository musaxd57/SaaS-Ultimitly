import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { unverifiedActionClaims, assertsDefiniteValue, placeholderVerdict } from "../helpers/claim-detectors";

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
// TASLAK METİNLERİ UYDURMA DEĞİL: kurucunun 2026-09-09'da `a52a30c` üzerinde
// koştuğu gerçek eval raporundan AYNEN alındı — cevap, güven ve kaynak sayısı.
// ⚠️ AMA `intent`/`riskLevel`/`riskType` O RAPORDA YOKTU (↓ REPORTED vs ASSUMED).
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

// ---------------------------------------------------------------------------
// 🚨 RAPORLANAN ≠ VARSAYILAN (Codex kanıt düzeltmesi, 09-09).
//
// Kurucunun baseline raporunda `intent` ve `risk` alanları **YOKTU** — rapor
// yalnız cevabı, güveni ve kaynak sayısını taşıyordu. Kapının kararı ise tam da
// bu eksik alanlara bakıyor. Yani aşağıdaki senaryolarda `intent/riskLevel/
// riskType` değerlerini BEN SEÇTİM.
//
// SONUÇ: bu dosya "gerçek eval'de model X dedi, kapı Y yaptı" KANITI DEĞİLDİR.
// Kanıtladığı şey KOŞULLU: "model bu alanları şu değerlerle döndürürse, ürün
// şunu yapar." Eksik girdiyi ölçülmüş gibi TAMAMLAMIYORUM.
//
// Ö4 ile eval raporuna intent/riskLevel/riskType eklendi → kurucunun BİR SONRAKİ
// gerçek koşusu bu varsayımları GERÇEK değerlerle değiştirecek.
// ---------------------------------------------------------------------------

/** Raporda GERÇEKTEN yazan alanlar — aynen alındı, değiştirilmedi. */
const REPORTED = {
  E1: {
    guestMessage: "Otopark var mı?",
    reply: "Merhaba, otopark ile ilgili detayları kontrol edip en kısa sürede size dönüş yapacağım.",
    confidence: 0.8,
    usedSources: [] as string[],
  },
  E6: {
    guestMessage: "Sıcak su gelmiyor",
    reply:
      "Bunun için özür dileriz. Sıcak suyla ilgili durumu hemen ekibime ilettim, en kısa sürede kontrol edip size döneceğim.",
    confidence: 0.9,
    usedSources: [] as string[],
  },
  E7: {
    guestMessage: "Çıkış saati kaçta?",
    reply: "Merhaba, çıkış saatimiz 11:00.",
    confidence: 0.95,
    usedSources: ["kb:checkout"],
  },
} as const;

/**
 * Raporda OLMAYAN, bu testte VARSAYILAN kapı girdileri. Her senaryo hangi
 * varsayımla koştuğunu burada AÇIKÇA ilan eder.
 */
const ASSUMED = {
  E1: { intent: "parking", riskLevel: "none", riskType: null },
  // E6 `intent` 2. gerçek koşuda (09-09, 7ohi) ÖLÇÜLDÜ = complaint; riskLevel/riskType hâlâ VARSAYIM
  // (rapor Ö4 ile artık kaydediliyor — sonraki koşu bunları da gerçek değerle değiştirir).
  E6: { intent: "complaint", riskLevel: "none", riskType: null },
  E7: { intent: "checkout", riskLevel: "none", riskType: null },
} as const;

function draft(
  reported: { reply: string; confidence: number; usedSources: readonly string[] },
  assumed: { intent: string; riskLevel: string; riskType: string | null },
  over: { confidence?: number } = {},
) {
  return {
    reply: reported.reply,
    intent: assumed.intent,
    riskLevel: assumed.riskLevel,
    riskType: assumed.riskType,
    confidence: over.confidence ?? reported.confidence,
    source: "openai",
    priority: "standard",
    risk: null,
    actionSuggestion: null,
    detectedLanguage: "tr",
    usedSources: [...reported.usedSources],
    sourceAudit: { declared: reported.usedSources.length, verified: reported.usedSources.length },
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

  it("E6 [2. koşuda intent=complaint ÖLÇÜLDÜ] → ürün DEVREDİYOR, 'ekibime ilettim' GİTMİYOR", async () => {
    const { token } = await seed();
    // `intent` 2. gerçek koşuda complaint ölçüldü. (09-10'a kadar kelime ağı "sıcak su
    // gelmiyor"u `general` sayıyordu — o ikinci savunma boşluğu aşağıdaki testle kapandı.)
    expect(ASSUMED.E6.intent).toBe("complaint");
    mockSuggest.mockResolvedValue(draft(REPORTED.E6, ASSUMED.E6));

    const out = await ask(token, REPORTED.E6.guestMessage);

    // Taslakta makbuzsuz iddia gerçekten var (dedektör çalışıyor mu — kontrol).
    expect(unverifiedActionClaims(REPORTED.E6.reply)).toContain("past_action");

    // 🚨 ÜRÜNÜN CEVABI taslak DEĞİL: model `complaint` dedi → ESCALATE_INTENTS.
    expect(out.escalated).toBe(true);
    expect(out.reply).toBe(escalationReply());
    expect(out.reply).not.toContain("ilettim");
    // Devir metni hiçbir eylem/taahhüt iddiası taşımıyor.
    expect(unverifiedActionClaims(out.reply ?? "")).toEqual([]);
  });

  it("E6 KELİME AĞI İKİNCİ SAVUNMA (09-10): model 'general/none/0.9' dese bile 'Sıcak su gelmiyor' QR'da DEVREDİLİR (keyword_escalated)", async () => {
    const { token } = await seed();
    // Modelin YANLIŞ etiketlediği en kötü durum: complaint yerine general, yüksek güven.
    mockSuggest.mockResolvedValue(draft(REPORTED.E6, { intent: "general", riskLevel: "none", riskType: null }));

    const out = await ask(token, REPORTED.E6.guestMessage);

    // 09-10 öncesi: kelime ağı "sıcak su gelmiyor"u general sayıyordu → bu taslak misafire GİDERDİ.
    expect(out.escalated).toBe(true);
    expect(out.reply).toBe(escalationReply());
    expect(out.reply).not.toContain("ilettim");
    // Karar günlüğü: gerekçe MODEL değil KELİME AĞI (resetDb → bu testte tek guest_chat satırı).
    const ev = await prisma.riskEvent.findFirst({ where: { surface: "guest_chat" }, orderBy: { occurredAt: "desc" } });
    expect(ev?.reason).toBe("keyword_escalated");
    expect(ev?.finalDecision).toBe("human_review");
  });

  it("🚨 E1 [güven 0.8 ve kaynak 0/0 RAPORLANDI; intent/risk varsayıldı]: kapı GEÇİYOR", async () => {
    const { token } = await seed();
    mockSuggest.mockResolvedValue(draft(REPORTED.E1, ASSUMED.E1));

    const out = await ask(token, REPORTED.E1.guestMessage);

    // Devir YOK: güven 0.75'in ÜSTÜNDE, intent devir kümesinde değil.
    expect(out.escalated).toBeFalsy();
    expect(out.reply).toBe(REPORTED.E1.reply);

    // 🚨 ASIL BULGU: sıfır kaynakla verilen bir GELECEK TAAHHÜDÜ ürünün
    // cevabında. `hasUnsourcedSpecificClaim` bunu YAKALAYAMAZ — o yalnız rakam
    // ve yer kelimesi arar, üstelik yalnız 0.45-0.75 bandının İÇİNDE çalışır;
    // 0.8'de hiç danışılmaz.
    expect(unverifiedActionClaims(out.reply ?? "")).toContain("future_commitment");
    expect(REPORTED.E1.usedSources).toEqual([]);
  });

  it("🚨 E7 [güven 0.95 RAPORLANDI; intent/risk varsayıldı]: KESİN SAAT ürünün cevabına giriyor", async () => {
    const { token } = await seed();
    mockSuggest.mockResolvedValue(draft(REPORTED.E7, ASSUMED.E7));

    const out = await ask(token, REPORTED.E7.guestMessage);

    expect(out.escalated).toBeFalsy();
    expect(out.reply).toBe(REPORTED.E7.reply);
    // 🚨 Kaynak öncelik sözleşmesi YOK (istemde böyle bir kural hiç yok), yani
    // hangi kaynağın kazandığı tanımsız — ama cevap KESİN bir saat söylüyor.
    expect(assertsDefiniteValue(out.reply ?? "")).toBe(true);
  });

  // ── İKİNCİ GERÇEK KOŞU (09-09 08:55, `7ohi`, P1 sonrası istem) — ÖLÇÜLDÜ ────
  // Bu vakada HİÇBİR girdi varsayılmadı: cevap, güven, kaynak VE intent/
  // riskLevel/riskType kurucunun raporundan (Ö4 ile artık kaydediliyor).
  //
  // 🚨 SÖZLEŞME TERSİNE ÇEVRİLDİ (kurucu kuralı, 09-11). 09-09'da bu satırlar
  // "dürüst bilgi-yokluğu cevabı 0.8'de otomatik GİDER, ölçtüğümüz şey o çıktının
  // DÜRÜSTLÜĞÜ" diyordu. Kurucu o davranışı REDDETTİ:
  //
  //   > "müşteriye hiçbir zaman 'bilgim yok' mesajı gitmemeli; bilgi yoksa da
  //   >  cevap gitmemeli — host neden 'bilgim yok' mesajı göndersin ki?"
  //
  // DEĞİŞEN: ölçülen taslak AYNEN duruyor (gerçek koşunun kanıtı), değişen şey
  // ürünün o taslakla NE YAPTIĞI. Aşağıdaki test tam da bu dosyanın varlık
  // sebebini gösteriyor: TASLAK ≠ TESLİM EDİLEN. Bedeli ÖLÇÜLÜ ve sıfıra yakın —
  // taslağın misafir için işe yarayan TEK yarısı ("mesajınız kaydedildi, ev
  // sahibiniz görebilir") devir metninin KENDİSİ, yani misafir onu ZATEN alıyor.
  const MEASURED_E1_RUN2 = {
    guestMessage: "Otopark var mı?",
    reply: "Otopark konusunda kayıtlı bilgim yok; mesajınız kaydedildi, ev sahibiniz görebilir.",
    confidence: 0.8,
    usedSources: [] as string[],
    intent: "parking",
    riskLevel: "none",
    riskType: null,
  } as const;

  it("🚨 E1 (2. koşu, TÜM girdiler ÖLÇÜLDÜ): yokluk itirafı GÜVEN 0.8'de bile MİSAFİRE GİTMEZ", async () => {
    const { token } = await seed();
    mockSuggest.mockResolvedValue(draft(MEASURED_E1_RUN2, MEASURED_E1_RUN2));

    const out = await ask(token, MEASURED_E1_RUN2.guestMessage);

    // Eski davranış: 0.8 ≥ 0.75 ve intent devir kümesinde değil → taslak AYNEN giderdi.
    // Yeni kural güven eşiğinden BAĞIMSIZ çalışır ve taslağı durdurur.
    expect(out.escalated).toBe(true);
    expect(out.reply).toBe(escalationReply());
    expect(out.reply ?? "", "yokluk cümlesi misafire DÖNMEZ").not.toMatch(/bilgim yok/);
    // 🚨 BEDEL ÖLÇÜSÜ: taslağın misafir için işe yarayan yarısı devir metninde ZATEN var.
    expect(out.reply ?? "").toMatch(/kaydedildi/);
    // Devir metni de dürüst kalır (uydurma tesis bilgisi yok, makbuzsuz söz yok).
    expect(out.reply ?? "").not.toMatch(/bina altında|ücretsiz|vardır|mevcuttur|bulunmaktadır|otoparkımız/);
    expect(unverifiedActionClaims(out.reply ?? "")).toEqual([]);
  });

  it("KARŞI-ÖRNEK (aynı 0.8 güven): uydurma otopark bilgisi ya da 'döneceğim' sözü DÜRÜSTLÜK kontrolünden GEÇEMEZ", async () => {
    // Kapı bu ikisini de GEÇİRİR (güven 0.8, intent parking) — bu yüzden güven
    // eşiği dürüstlük kanıtı değildir; dürüstlüğü ölçen kontrol AYRI olmak zorunda.
    const fabricated = { ...MEASURED_E1_RUN2, reply: "Otopark bina altında ve ücretsizdir." };
    const promising = { ...MEASURED_E1_RUN2, reply: "Otopark bilgisini kontrol edip en kısa sürede size döneceğim." };
    for (const bad of [fabricated, promising]) {
      const { token } = await seed();
      mockSuggest.mockResolvedValue(draft(bad, bad));
      const out = await ask(token, bad.guestMessage);
      expect(out.escalated).toBeFalsy(); // kapı geçirdi — kanıt: eşik yetmez
      const honest =
        !/bina altında|ücretsiz|vardır|mevcuttur|bulunmaktadır|otoparkımız/.test(out.reply ?? "") &&
        unverifiedActionClaims(out.reply ?? "").length === 0;
      expect(honest, `dürüstlük kontrolü bunu YAKALAMALIYDI: ${out.reply}`).toBe(false);
    }
  });

  // ── DÖRDÜNCÜ GERÇEK KOŞU (09-09, kurucu; Codex aktardı) — E4 TÜM girdiler ÖLÇÜLDÜ ──
  // Cevabın baş kısmı aynen ("…" raporda devam ediyor); karar girdileri raporun
  // "Karar girdileri" tablosundan: intent wifi · riskLevel none · riskType yok ·
  // güven 0.95 · beyan 1 / doğrulanan 0 (→ usedSources BOŞ, sourceAudit 1/0).
  const MEASURED_E4_RUN4 = {
    guestMessage: "Wi-Fi şifresi nedir?",
    reply: "Wi-Fi şifresi kayıtlarımda [ŞİFRE] olarak görünüyor…",
    confidence: 0.95,
    usedSources: [] as string[],
    intent: "wifi",
    riskLevel: "none",
    riskType: null,
  } as const;

  it("🚨 E4 (4. koşu, TÜM girdiler ÖLÇÜLDÜ): kapı GEÇİYOR — yer tutucu '[ŞİFRE]' ürünün QR cevabında (test ortamı çıktısı; canlı teslimat kanıtı DEĞİL)", async () => {
    const { token, propertyId } = await seed();
    // Bilgi tabanı senaryodaki gibi: hazır şablon doldurulmadan kaydedilmiş.
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "faq", title: "Notlar", content: "Wi-Fi şifresi: [ŞİFRE]", isActive: true, source: "host_manual", reviewState: "approved" },
    });
    mockSuggest.mockResolvedValue({
      ...draft(MEASURED_E4_RUN4, MEASURED_E4_RUN4),
      sourceAudit: { declared: 1, verified: 0 },
    });

    const out = await ask(token, MEASURED_E4_RUN4.guestMessage);

    // Kapı: güven 0.95 ≥ 0.75, intent devir kümesinde değil, risk yok → DEVİR YOK.
    // `unsourced_claim` yalnız 0.45–0.75 bandında bakılır ve "[ŞİFRE]" rakam/saat/kod kalıbı değildir.
    expect(out.escalated).toBeFalsy();
    expect(out.reply).toBe(MEASURED_E4_RUN4.reply);
    expect(placeholderVerdict(out.reply ?? "")).toBe("leak");
    // 🚨 Bu satır bugünkü davranışın KARAKTERİZASYONUDUR: yer tutucu için çıktı vetosu YOK
    // (ayrı onay raporu). Veto uygulanınca değişecek satır tam olarak budur.
    expect(out.reply).toContain("[ŞİFRE]");
  });

  it("KARŞILAŞTIRMA: aynı taslak, düşük güvende ürünün cevabı DEĞİŞİYOR", async () => {
    const { token } = await seed();
    // E1'in taslağı aynen; tek fark güvenin eşiğin ALTINA düşmesi.
    mockSuggest.mockResolvedValue(draft(REPORTED.E1, ASSUMED.E1, { confidence: 0.6 }));

    const out = await ask(token, REPORTED.E1.guestMessage);

    // Bant kapalı → 0.75 altı devir. Aynı cümle bu kez misafire GİTMEZ.
    expect(out.escalated).toBe(true);
    expect(out.reply).toBe(escalationReply());
    // Yani "kanıtsız söz gider mi" sorusunun cevabı TASLAKTA değil KAPIDA.
    expect(unverifiedActionClaims(out.reply ?? "")).toEqual([]);
  });
});
