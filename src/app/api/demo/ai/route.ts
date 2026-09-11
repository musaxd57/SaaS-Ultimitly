import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { suggestReply } from "@/lib/ai";
import { passesAutoReplySafetyGate } from "@/lib/automation";
import { badRequest, jsonOk, notFound, serverError, tooManyRequests, parseJsonBody, payloadTooLarge } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { DEMO_HOURLY_LIMIT } from "@/lib/constants";

// ---------------------------------------------------------------------------
// PUBLIC landing-page AI demo — "type a guest message, see the real answer".
//
// DORMANT unless LANDING_DEMO_ENABLED=1 (404 otherwise), because this is an
// unauthenticated surface that spends OpenAI money. When enabled it runs the
// exact same suggestReply pipeline the product uses, against a FICTIONAL
// sample apartment + knowledge base baked in below — it never reads any real
// organization's data, so nothing can leak. Nothing is written or sent.
//
// Cost gates: per-IP rate limit + a durable GLOBAL daily cap (ChatUsage row
// under a synthetic key, same mechanism as the QR concierge's per-apartment
// cap — survives restarts and replicas).
// ---------------------------------------------------------------------------

const MAX_MESSAGE = 500;
const DEMO_USAGE_KEY = "landing-demo"; // synthetic ChatUsage propertyId (no FK)

function dailyCap(): number {
  return Number(process.env.LANDING_DEMO_DAILY_CAP) || 300;
}

// Entirely fictional apartment — safe to show anyone.
const DEMO_PROPERTY = {
  name: "Örnek Daire 3",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  address: "Örnek Mah. Deneme Sok. No: 5",
  city: "İstanbul",
};

const DEMO_KB = [
  { category: "wifi", title: "Wi-Fi", content: "Ağ adı: OrnekDaire, şifre: hosgeldiniz2026. Modem salonda TV ünitesinin yanındadır." },
  { category: "parking", title: "Otopark", content: "Bina önünde ücretsiz sokak parkı var; en yakın kapalı otopark 3 dk yürüme mesafesinde (günlük ~₺150)." },
  { category: "rules", title: "Ev kuralları", content: "Dairede sigara içilmez, evcil hayvan kabul edilmez. 22:00'den sonra lütfen gürültü yapmayınız." },
  { category: "trash", title: "Çöp", content: "Çöpleri binanın yan sokağındaki gri konteynere bırakabilirsiniz." },
  { category: "faq", title: "Klima", content: "Klima kumandası yatak odasındaki komodinin üzerindedir. Isıtma için güneş simgeli moda alın." },
  { category: "local_tips", title: "Kahvaltı önerisi", content: "İki sokak ötedeki Örnek Fırın'ın kahvaltısı misafirlerimizin favorisi." },
];

export async function POST(req: NextRequest) {
  // Master switch — this endpoint simply doesn't exist until the operator
  // deliberately enables the landing demo.
  if (process.env.LANDING_DEMO_ENABLED !== "1") return notFound();

  try {
    // 🚨 BÜTÇE DOĞRULAMADAN SONRA TÜKETİLİR (09-11). Eskiden `rateLimit` ilk
    // satırdaydı: boş ya da çok uzun bir istek de ziyaretçinin saatlik hakkını
    // yakıyordu. Depo kuralı zaten bu ("bütçe doğrulamadan SONRA tüketilir");
    // bu rota istisnaydı ve belgelenmemişti.
    const bodyResult = await parseJsonBody<{ message?: unknown }>(req);
    if (!bodyResult.ok && bodyResult.tooLarge) return payloadTooLarge();
    const body = bodyResult.ok ? bodyResult.data : null;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) return badRequest({ message: "Bir mesaj yazın." });
    if (message.length > MAX_MESSAGE) {
      return badRequest({ message: `Mesaj çok uzun (en fazla ${MAX_MESSAGE} karakter).` });
    }

    // 🚨 SAATLİK HAK ÇİP SAYISINDAN BÜYÜK OLMALI (kurucu, 09-11: "çip sayısını
    // 8e çıkar o zaman orda saatlik"). Eski hâl ölçüldü: 6 çip / saatte 6 istek
    // — ziyaretçi altı çipin altısına tıklarsa KENDİ yazacağı tek soru için hak
    // KALMIYORDU. Sayı `DEMO_HOURLY_LIMIT` tek kaynağından gelir ve landing
    // metninde AYNI sayı yazılır (parite test-pinli).
    const limited = await rateLimit(`demo-ai:${clientIp(req)}`, DEMO_HOURLY_LIMIT, 60 * 60_000);
    if (!limited.ok) {
      return tooManyRequests(
        limited.retryAfter,
        `Bu demo saatte ${DEMO_HOURLY_LIMIT} soru ile sınırlı. Bir süre sonra tekrar deneyebilir ya da hemen ücretsiz kaydolabilirsiniz.`,
      );
    }

    // Durable global daily cap: atomic increment then check, so a burst of
    // visitors can never spend past the ceiling — even across restarts/replicas.
    const day = new Date().toISOString().slice(0, 10);
    const usage = await prisma.chatUsage.upsert({
      where: { propertyId_day: { propertyId: DEMO_USAGE_KEY, day } },
      create: { propertyId: DEMO_USAGE_KEY, day, count: 1 },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    if (usage.count > dailyCap()) {
      return NextResponse.json(
        { error: "Demo bugünlük dolu — yarın tekrar deneyebilir ya da hemen ücretsiz kaydolabilirsiniz." },
        { status: 429 },
      );
    }

    // The REAL product pipeline against the fictional apartment. A sample
    // confirmed stay is attached (like the in-app playground) so questions
    // about the stay behave realistically. Result is returned only.
    const now = new Date();
    const result = await suggestReply({
      guestMessage: message,
      property: DEMO_PROPERTY,
      reservation: {
        guestName: "Demo Misafir",
        arrivalDate: now,
        departureDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        status: "confirmed",
      },
      knowledgeBase: DEMO_KB,
      history: [],
      tone: "warm",
      language: "tr",
      styleProfile: null,
    });

    // The REAL auto-send verdict (Codex #27): run the exact production gate —
    // intent blocklist, deterministic risk word-nets, injection veto, source
    // and confidence checks — not the client's old 2-check approximation
    // (confidence + riskLevel), which overclaimed "would auto-send" for e.g. a
    // confident refund demand the gate always blocks. The badge on the landing
    // page must state what the product would truly do.
    const wouldAutoSend = passesAutoReplySafetyGate(
      {
        intent: result.intent,
        riskLevel: result.riskLevel,
        confidence: result.confidence,
        source: result.source,
        riskType: result.riskType ?? null,
        // 🚨 PARİTE (09-11): `reply` olmadan "bilgim yok" kuralı bu rozette
        // çalışmaz ve landing "kendiliğinden gönderilirdi" derken ürün o cevabı
        // BLOKLAR — yukarıdaki "must state what the product would truly do"
        // sözü tam olarak bunu yasaklıyor.
        reply: result.reply,
      },
      message,
    );

    // ⚠️ YALNIZ ARAYÜZÜN ÇİZDİĞİ ALANLAR DÖNER. `intent`, `detectedLanguage` ve
    // `source` landing bileşeninde HİÇ kullanılmıyordu ama kimliksiz yanıtta
    // gidiyordu. `source` cevabın OpenAI'den mi deterministik fallback'ten mi
    // geldiğini, `intent` de modelin atadığı etiketi söylüyor → güvenlik kapısı
    // saatte 6 istekle sorgulanabilir bir HARİTAYA dönüşüyordu ("hangi ifade
    // hangi intent'e düşüyor, kapı hangi kolda vetoluyor"). Repo tam bu gerekçeyle
    // PRIVATE yapılmıştı ("yayınlanmış kara liste = kaçınma haritası").
    return jsonOk({
      reply: result.reply,
      confidence: result.confidence,
      riskLevel: result.riskLevel,
      wouldAutoSend,
    });
  } catch (err) {
    return serverError(undefined, err);
  }
}
