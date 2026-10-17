import { NextResponse } from "next/server";
import { providerErrorMessageFromText } from "@/lib/provider-errors";
import { prisma } from "@/lib/db";
import { conversationReplySchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound, tooManyRequests, paymentRequired, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";
import { translate } from "@/lib/ai/translate";
import { sendHostMessage } from "@/lib/host-send";
import { createHash } from "crypto";
import { consumeDailyAiBudget } from "@/lib/ai/daily-budget";

// Only owner/manager may send guest-facing replies (withManage). Staff are read +
// task updates; the inbound-message and status routes stay open for their triage.
export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;

  // Each reply sends to Hospitable (+ optional OpenAI translate). Throttle per
  // conversation so a stuck client or abuse can't spam the guest / burn quota.
  // 🚨 ANAHTAR ORG KAPSAMLI (09-23, güvenlik ajanı): kota sahiplik kontrolünden ÖNCE
  // tüketiliyor ve anahtar yalnız konuşma kimliğiydi → BAŞKA bir kiracının kullanıcısı bu
  // kimlikle (404 alarak) istek atıp SAHİBİN cevap kotasını tüketebiliyordu. Org öneki
  // her kiracıya kendi kovasını verir; sıra (ucuz kota → DB) korunur.
  const limited = await rateLimit(`reply:${session.organizationId}:${id}`, 20, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const conversation = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: {
      id: true,
      channel: true,
      guestIdentifier: true,
      externalReservationId: true,
    },
  });
  if (!conversation) return notFound();

  const rawData = await readJsonCappedOrNull(req);
  const parsed = conversationReplySchema.safeParse(rawData);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  // Optional: translate the reply before sending/saving. Cap the length — this
  // value is forwarded to a paid translate call, so never accept an unbounded
  // string (a valid language name/code is short).
  const translateRaw = typeof rawData?.translateTo === "string" ? rawData.translateTo.trim() : "";
  const translateTo: string | undefined =
    translateRaw && translateRaw.length <= 20 ? translateRaw : undefined;

  // Credit AI-assisted approvals in reports: set by the client when the host
  // clicks "Onayla ve gönder" on an AI draft (vs typing a manual reply).
  const aiAssisted = rawData?.aiAssisted === true;

  let replyBody = parsed.data.body;
  if (translateTo) {
    // Translate is a paid AI feature — gate it in the freemium tier so a lapsed
    // org can't burn OpenAI via the manual reply path. The manual send itself
    // stays free; only the optional translate add-on is premium.
    if (!(await premiumAllowed(session.organizationId))) return paymentRequired();
    // GÜNLÜK ORG BÜTÇESİ — YALNIZ çeviri dalında. Elle gönderimin kendisi ücretsiz
    // kalır; tavana takılan host çevirisiz göndermeye devam edebilir. Buradaki
    // dakikalık limitin anahtarı `reply:{conversationId}` olduğu için konuşma
    // açarak çoğaltılabiliyordu; org bütçesi o boşluğu kapatır.
    const budget = await consumeDailyAiBudget(session.organizationId);
    if (!budget.ok) {
      return tooManyRequests(
        budget.retryAfter,
        "Bugünkü AI kullanım sınırınıza ulaştınız. Çeviri olmadan gönderebilir veya yarın tekrar deneyebilirsiniz.",
      );
    }
    // FAIL-CLOSED (Codex #30): a failed translation used to fall through as the
    // ORIGINAL text — the guest received an untranslated message while the host
    // believed it went out in their language. No send on translate failure; the
    // host can retry or deliberately send without translation.
    const translated = await translate(replyBody, translateTo);
    if (!translated.ok) {
      return NextResponse.json(
        { error: "Çeviri başarısız — mesaj GÖNDERİLMEDİ. Tekrar deneyin veya çeviriyi kapatıp gönderin." },
        { status: 502 },
      );
    }
    replyBody = translated.text;
  }

  // Teslim + kayıt TEK çekirdekten (`host-send.ts`; karar kartı da aynı yolu kullanır). Durum kodları ve metinler burada.
  // Kalıcı kuyruk tekilleştirme (Codex 07-23): istemcinin mesaj başına requestId'si öncelikli — çift tık ya da ağ yeniden
  // denemesi aynı kimliği kullanır, zaman kovası sınırına bölünemez. Yedek (eski istemci / kimlik yok): gövde özeti + 2 dk kova.
  const digest = createHash("sha256").update(parsed.data.body).digest("base64url").slice(0, 24);
  const idempotencyKey = parsed.data.requestId
    ? `manual:${id}:req:${parsed.data.requestId}`
    : `manual:${id}:${digest}:${Math.floor(Date.now() / 120_000)}`;
  const sent = await sendHostMessage({
    organizationId: session.organizationId,
    conversation,
    body: replyBody,
    claimBody: parsed.data.body,
    senderName: parsed.data.senderName || session.name,
    aiAssisted,
    idempotencyKey,
    strictIdempotency: Boolean(parsed.data.requestId),
  });
  switch (sent.status) {
    case "not_connected":
      return NextResponse.json(
        { error: "Kanal hesabınız bağlı değil — mesaj gönderilemiyor. Ayarlar'dan bağlantınızı kurun." },
        { status: 502 },
      );
    case "idempotency_conflict":
      // 409 = "id'yi yeniden üret" (client payload değişince zaten yeni UUID basar).
      return NextResponse.json(
        { error: "Bu istek kimliği farklı bir içerikle kullanılmış — lütfen tekrar gönderin." },
        { status: 409 },
      );
    case "queued":
      // 202 = accepted/queued (NOT yet delivered — the UI shows "sıraya alındı"); a dedupe-hit is a 200 no-op (the identical
      // message is already queued/sent).
      return NextResponse.json(
        { ...sent.message, outbox: { status: "queued", deduped: sent.deduped } },
        { status: sent.deduped ? 200 : 202 },
      );
    case "duplicate":
      return NextResponse.json(
        { error: "Bu mesaj az önce gönderildi veya hâlâ gönderiliyor." },
        { status: 409 },
      );
    case "claim_unavailable":
      return NextResponse.json(
        { error: "Şu anda gönderilemedi — lütfen birazdan tekrar deneyin." },
        { status: 503 },
      );
    case "failed_definitive":
      // 🚨 HAM SAĞLAYICI METNİ MÜŞTERİYE GİTMEZ (08-06): `providerErrorMessageFromText` aynı metni durum-özel bir Türkçe
      // cümleye çevirir; ham metin log/Sentry yolunda aynen durur.
      return NextResponse.json(
        {
          error: providerErrorMessageFromText(sent.error, "Mesaj gönderilemedi. Lütfen kısa bir süre sonra tekrar deneyin."),
        },
        { status: 502 },
      );
    case "failed_ambiguous":
      return NextResponse.json(
        { error: "Gönderim doğrulanamadı — mesaj ulaşmış olabilir. Tekrar göndermeden önce konuşmayı kontrol edin.", ambiguous: true },
        { status: 502 },
      );
    case "sent":
      return jsonOk(sent.message, 201);
  }
});

