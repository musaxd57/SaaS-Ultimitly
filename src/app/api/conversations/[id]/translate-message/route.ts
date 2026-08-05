import { prisma } from "@/lib/db";
import { z } from "zod";
import { NextResponse } from "next/server";
import { badRequest, jsonOk, notFound, tooManyRequests, paymentRequired, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";
import { zodFieldErrors } from "@/lib/validators";
import { translate } from "@/lib/ai/translate";
import { consumeDailyAiBudget, dailyBudgetMessage } from "@/lib/ai/daily-budget";

const translateSchema = z.object({
  messageId: z.string().min(1, "messageId gerekli"),
  targetLanguage: z.string().min(2, "Hedef dil gerekli").max(20, "Geçersiz dil kodu"),
});

export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;

  // Paid AI feature: blocked once the trial lapses (dormant-safe until enforced).
  if (!(await premiumAllowed(session.organizationId))) return paymentRequired();

  // Translation calls OpenAI ($). Throttle per user to cap spend on abuse.
  const limited = await rateLimit(`translate:${session.userId}`, 30, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  // Verify conversation belongs to org
  const conversation = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true },
  });
  if (!conversation) return notFound();

  const data = await readJsonCappedOrNull(req);
  const parsed = translateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  const message = await prisma.message.findFirst({
    where: { id: parsed.data.messageId, conversationId: id },
    select: { id: true, body: true, language: true },
  });
  if (!message) return notFound("Mesaj bulunamadı");

  // KOTA, ORG KAPSAMI VE MESAJ DOĞRULAMASINDAN SONRA (denetim 08-05 —
  // `ai-suggest` ve `ai/test` bunu 08-01'de zaten böyle yapıyordu, bu rota
  // gözden kaçmıştı). Eskiden en başta tüketiliyordu: org içindeki bir
  // kullanıcı, 404 dönen konuşma/mesaj id'leriyle dakikada 30 istek atarak
  // sahibin günlük kotasını TEK bir model çağrısı üretmeden bitirebiliyordu.
  // Kota dolunca misafire giden oto-yanıt da durduğu için (`automation.ts` →
  // `skippedReason:"daily_budget"`) bu, iç bir gürültüyü misafir kaybına
  // çeviriyordu.
  //
  // ⚠️ Kota HÂLÂ model çağrısının ÖNÜNDE: `daily-budget.ts:99-101` interaktif
  // rotalar için "önce tüket" kuralını açıkça yazıyor (bir sağlayıcı arızasında
  // peek-then-consume'a geçmek suistimal kapısını kaldırırdı). Değişen tek şey
  // tüketimin DOĞRULAMALARIN altına inmesi.
  //
  // 🚨 KALAN AÇIK — BU DÜZELTME SALDIRIYI KAPATMAZ, DARALTIR. `ai/translate.ts:118-126`
  // dört dalda ERKEN döner (boş metin · `sourceLanguage === targetLanguage` ·
  // uzunluk · 6 saatlik LRU isabeti) ve bunların HEPSİ anahtar kontrolünün
  // ÜSTÜNDE — yani TEK bir geçerli konuşma+mesaj id'si olan içeriden biri, aynı
  // dili hedef vererek dakikada 30 birimi hâlâ sıfır model çağrısıyla yakabilir
  // (Başlangıç planı ~5 dakikada biter). Kapatmak `translate()`in dönüş
  // sözleşmesine "model GERÇEKTEN çağrıldı mı" bilgisini eklemeyi gerektirir —
  // ayrı bir tur, ayrı karar. Buradaki kazanç: çöp id'lerle sınırsız yakma
  // yolu kapandı ve tüketim artık gerçekten var olan bir kaynağa bağlı.
  const budget = await consumeDailyAiBudget(session.organizationId);
  if (!budget.ok) {
    return tooManyRequests(budget.retryAfter, dailyBudgetMessage(budget));
  }

  const sourceLanguage = message.language || undefined;
  // Structured result (Codex #30): a failed translation must surface as an
  // ERROR, never as the original text masquerading as a translation.
  const result = await translate(message.body, parsed.data.targetLanguage, sourceLanguage);
  if (!result.ok) {
    const error =
      result.reason === "not_configured"
        ? "Çeviri şu an yapılandırılmamış."
        : result.reason === "too_long"
          ? "Mesaj çeviri için çok uzun."
          : "Çeviri başarısız — lütfen tekrar deneyin.";
    return NextResponse.json({ error }, { status: 502 });
  }
  const translation = result.text;

  // Detect language using AI fallback heuristic (cheap, no OpenAI needed)
  // We rely on the stored language field; if missing fall back to detect
  const detectedLanguage = sourceLanguage ?? (
    /\b(the|is|are|can|i |you |please|hello|hi |my |for |and )\b/.test(message.body.toLowerCase()) ? "en"
    : /\b(ich |sie |bitte|danke|hallo|ist |und |für )\b/.test(message.body.toLowerCase()) ? "de"
    : "tr"
  );

  return jsonOk({ translation, detectedLanguage });
});
