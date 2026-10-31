import { type NextRequest, NextResponse } from "next/server";
import { readTextCapped, MAX_WEBHOOK_BODY_BYTES, BodyTooLargeError, payloadTooLarge, jsonOk, unauthorized } from "@/lib/api";
import { alertOnTransition, clearAlertState } from "@/lib/alert-state";
import { clearBadSignatureThrottleFor, noteBadSignatureSuppressed, skipBadSignatureAlert } from "@/lib/billing/bad-signature-throttle";
import { currentCorrelation, newCorrelationId, runWithCorrelation } from "@/lib/correlation";
import { logEvent } from "@/lib/event-log";
import { reportError } from "@/lib/report-error";
import { redactSensitive } from "@/lib/redact";
import { hostChannelTransport } from "@/lib/host-channel-runtime";
import { hostChannelSecret } from "@/lib/host-channel/binding";
import { handleHostInbound } from "@/lib/host-channel/inbound";
import { recordHostDeliveryStatuses } from "@/lib/host-channel/delivery-status";
import { expediteForFailedProviderIds } from "@/lib/host-channel/alert-email";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { hostChannelFlagsFromEnv } from "@/lib/host-channel/routing";
import { parseMetaWebhook } from "@/lib/host-channel/whatsapp/parse";
import { verifyMetaSignature } from "@/lib/host-channel/whatsapp/signature";
import { looksLikeMetaSignature, verifyWhatsAppHandshake, whatsAppWebhookConfigFromEnv } from "@/lib/host-channel/whatsapp/webhook";

// ---------------------------------------------------------------------------
// WhatsApp (Meta Cloud API) web kancası — ev sahibi soru kanalının GELEN ucu (tasarım §5.1, §9 madde 10; adres
// `/api/webhooks/host-channel/whatsapp`). Kimliksiz, halka açık uç; güven yalnız Meta imzasından (uygulama gizli anahtarıyla HMAC-SHA256).
//
//  · Anahtar (`HOST_CHANNEL_ENABLED`) kapalıyken uç UYUR: GET 403, POST 200 `{disabled:true}` (gövde okunmaz, veritabanına dokunulmaz).
//    Kurulum sırası (RAILWAY belgesi): önce anahtar + kimlik bilgileri, SONRA Meta'da abonelik.
//  · Anahtar açık ama uygulama gizli anahtarı / numara kimliği / numara arama anahtarı (`HOST_CHANNEL_HMAC_SECRET`) yok → 503 + geçiş tabanlı
//    alarm: Meta yeniden dener, yapılandırma düzelince ev sahibinin kodu / "DUR"u işlenir (200 dönseydi kaybolurdu — inceleme 10-30 gece P2).
//    Bu durumda gönderim de kapalıdır (`hostChannelTransport` gelen uç hazır değilse `null`), soru gitmez. Kimliksiz istek seli alarm
//    yazımını süreç içi frenle sınırlı tetikler.
//  · İmza HAM gövde üzerinde, ayrıştırmadan ve veritabanından ÖNCE; imzasız / bozuk → 401, hiçbir şey yazılmaz. Alarm yalnız başlık Meta'nın
//    biçimindeyse (gerçek teslimat, yanlış anahtar) ve süreç içi frenle. `Content-Type` imzadan önce kapı DEĞİLDİR (repo kuralı,
//    `api.ts` `readJsonCapped` yorumu): imzalı gövde başlıktan bağımsız işlenir.
//  · Yalnız bizim numaramıza (`phone_number_id`) gelen mesajlar işlenir; karışık teslimatta bizimkiler kaybolmaz. İmzalı teslimatta YABANCI
//    numara kimliği = yapılandırma hatası (yanlış `WHATSAPP_PHONE_NUMBER_ID` her mesajı sessizce yutardı) → geçiş tabanlı alarm. Bu kimlik
//    yalnız DENETİMDİR, işletme SEÇMEZ: işletme yalnız gönderen numaradan bulunur (`handleHostInbound`).
//  · Durum olayları (gönderildi / iletildi / okundu / hata) bu dilimde işlenmez.
//  · İşleme yarıda düşerse 500 → Meta yeniden dener; aynı mesaj başka teslimatta hâlâ işleniyorsa 503 (Meta sonra yeniden dener).
//  · Günlüğe numara, metin, sağlayıcı mesaj kimliği, gövde YAZILMAZ — yalnız sayılar ve işletme.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const cfg = hostChannelFlagsFromEnv().channel ? whatsAppWebhookConfigFromEnv() : null;
  const q = req.nextUrl.searchParams;
  const challenge = verifyWhatsAppHandshake(
    { mode: q.get("hub.mode"), token: q.get("hub.verify_token"), challenge: q.get("hub.challenge") },
    cfg?.verifyToken ?? null,
  );
  if (!challenge) return NextResponse.json({ error: "Yetkisiz erişim" }, { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!currentCorrelation()) return runWithCorrelation({ id: newCorrelationId(), organizationId: null }, () => POST(req));
  const flags = hostChannelFlagsFromEnv();
  if (!flags.channel) return NextResponse.json({ disabled: true }, { status: 200 });
  const cfg = whatsAppWebhookConfigFromEnv();
  if (!cfg || !hostChannelSecret()) {
    const dormantKey = "host-channel-webhook:dormant";
    if (!skipBadSignatureAlert(dormantKey)) {
      const outcome = await alertOnTransition(
        dormantKey,
        "host-channel-webhook-dormant",
        new Error(
          "HOST_CHANNEL_ENABLED açık ama WHATSAPP_APP_SECRET / WHATSAPP_PHONE_NUMBER_ID / HOST_CHANNEL_HMAC_SECRET eksik — gelen WhatsApp mesajı ACK'lenip ATILDI",
        ),
      );
      if (outcome === "suppressed") noteBadSignatureSuppressed(dormantKey);
    }
    return NextResponse.json({ disabled: true }, { status: 503 });
  }

  let rawBody: string;
  try {
    rawBody = await readTextCapped(req, MAX_WEBHOOK_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return payloadTooLarge();
    throw err;
  }
  const signatureHeader = req.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(rawBody, signatureHeader, cfg.appSecret)) {
    const alertKey = "host-channel-webhook:signature-mismatch";
    if (looksLikeMetaSignature(signatureHeader) && !skipBadSignatureAlert(alertKey)) {
      const outcome = await alertOnTransition(
        alertKey,
        "host-channel-webhook-signature-mismatch",
        new Error("WhatsApp web kancası imzası doğrulanmadı — WHATSAPP_APP_SECRET yanlış / değişmiş olabilir"),
      );
      if (outcome === "suppressed") noteBadSignatureSuppressed(alertKey);
    }
    return unauthorized();
  }
  await clearAlertState("host-channel-webhook:signature-mismatch");
  await clearAlertState("host-channel-webhook:dormant");
  clearBadSignatureThrottleFor("host-channel-webhook:signature-mismatch");
  clearBadSignatureThrottleFor("host-channel-webhook:dormant");

  let body: unknown = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonOk({ ok: true });
  }
  const parsed = parseMetaWebhook(body, { onlyPhoneNumberId: cfg.phoneNumberId });
  const foreignKey = "host-channel-webhook:foreign-number";
  if (parsed.phoneNumberIds.some((id) => id !== cfg.phoneNumberId)) {
    if (!skipBadSignatureAlert(foreignKey)) {
      const outcome = await alertOnTransition(
        foreignKey,
        "host-channel-webhook-foreign-number",
        new Error("İmzalı WhatsApp teslimatında başka bir numara kimliği var — WHATSAPP_PHONE_NUMBER_ID yanlış olabilir (o numaranın mesajları işlenmedi)"),
      );
      if (outcome === "suppressed") noteBadSignatureSuppressed(foreignKey);
    }
  } else if (parsed.phoneNumberIds.length > 0) {
    await clearAlertState(foreignKey);
    clearBadSignatureThrottleFor(foreignKey);
  }
  // Teslim / okundu durumları (yalnız durum taşıyan teslimat da buraya gelir — eskiden aşağıdaki erken dönüşte atılıyordu). Kayıt hatası
  // teslimatı düşürmez: kayıp "okundu" yalnız gereksiz bir acil e-postası doğurur (güvenli yön; tasarım §3.12).
  if (parsed.statuses.length > 0) {
    try {
      const recorded = await recordHostDeliveryStatuses(parsed.statuses);
      // Gönderildi sanılan acil bildirim ulaşmadı → ertelenmiş e-postası bir sonraki geçişte gider (§3.12).
      await expediteForFailedProviderIds(recorded.failedIds);
    } catch (err) {
      await reportError("host-channel-webhook-status", new Error(redactSensitive(String(err)).slice(0, 500)));
    }
  }
  if (parsed.messages.length === 0) return jsonOk({ ok: true });

  try {
    const r = await handleHostInbound({ provider: WHATSAPP_CLOUD_PROVIDER, events: parsed.messages, flags, transport: hostChannelTransport() });
    if (r.processed + r.duplicates > 0) {
      await logEvent(
        "host_channel.webhook.received",
        { count: parsed.messages.length, processed: r.processed, duplicates: r.duplicates, ignored: r.ignored },
        { organizationId: r.organizationIds.length === 1 ? r.organizationIds[0]! : null },
      );
    }
    if (r.busy > 0) return NextResponse.json({ error: "Geçici hata" }, { status: 503 });
  } catch (err) {
    await reportError("host-channel-webhook", new Error(redactSensitive(String(err)).slice(0, 500)));
    return NextResponse.json({ error: "Geçici hata" }, { status: 500 });
  }
  return jsonOk({ ok: true });
}
