import { randomUUID } from "node:crypto";
import { emailService } from "./email-core";
import { redactSensitive } from "./redact";

// Redaksiyon yaprak modüle taşındı (F10); eski import yolları için yeniden dışa verilir.
export { formatErrorForLog, redactJsonStructurally, redactSensitive } from "./redact";

// Pure core of the error reporter — the WHOLE thing: redaction, the
// dependency-free Sentry envelope client, the alert-email leg and its
// throttle. Split from report-error.ts (crypto.ts precedent) so operator
// scripts can exercise the EXACT code path prod runs, under tsx, where the
// "server-only" package does not resolve. report-error.ts is a re-export.
//
// Central error reporter. Always logs a structured error; additionally emails
// an operator when ERROR_ALERT_EMAIL (or ALERT_EMAIL) is configured, throttled
// so a burst of failures can't flood the inbox. Never throws.

// Throttle per CONTEXT (not globally) so a fleet-wide failure — e.g. sync
// breaking for several orgs at once, each a distinct context — isn't masked as
// a single blip; each distinct failure still gets one alert per window.
const lastEmailAt = new Map<string, number>();
const EMAIL_THROTTLE_MS = 10 * 60 * 1000; // at most one alert email / context / 10 min

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * `reportError`'ün SONUCU (denetim, 08-01 — üçüncü tur).
 *
 * `notified` = operatöre GERÇEKTEN bir e-posta gitti mi. Bunu döndürmek şart:
 * bazı çağrı yerleri alarmı atmadan ÖNCE atomik bir "pencere" claim ediyor
 * (yaşam-döngüsü 6 saat, Paddle eşlenmemiş fiyat 30 GÜN) ve bildirim düşerse o
 * pencere BOŞUNA yanıyor. Sonucu okumadan claim etmek, CLAUDE.md'nin
 * CLAIM-THEN-NOTIFY kuralının ihlalidir — ve bir denetim ajanı benim yazdığım
 * "geri alma" bloğunun ÖLÜ KOD olduğunu gösterdi: `reportError` ASLA FIRLATMAZ,
 * dolayısıyla `catch` dalı hiç çalışmıyordu ve yorum var olmayan bir korumayı
 * anlatıyordu.
 *
 * `throttled` = bu context için pencere zaten doluydu (e-posta atlandı ama bu
 * BAŞARISIZLIK DEĞİL — çağıran kendi penceresini geri almamalı).
 * `configured` = alarm e-postası hiç yapılandırılmamış (aynı şekilde hata değil).
 */
export interface ReportOutcome {
  notified: boolean;
  throttled: boolean;
  configured: boolean;
}

export async function reportError(context: string, err: unknown): Promise<ReportOutcome> {
  const detail = redactSensitive(
    err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err),
  );
  const errName = err instanceof Error ? err.name : "Error";
  const errMessage = redactSensitive(err instanceof Error ? err.message : String(err));

  // Always log — structured and greppable (redacted: Railway logs are retained).
  console.error(`[reportError] ${context} :: ${detail}`);

  // Real error monitoring (optional): send to Sentry when SENTRY_DSN is set.
  // Fire-and-forget, dependency-free, never throws.
  void captureToSentry(context, errName, errMessage, detail);

  const to = process.env.ERROR_ALERT_EMAIL || process.env.ALERT_EMAIL;
  // ⚠️ `configured` HEM alıcıyı HEM sağlayıcıyı ister. Yalnız alıcıya bakmak
  // yeterli değildi: sağlayıcı yokken `sendReporting` her seferinde
  // `{ok:false, error:"E-posta ayarlı değil"}` döner ve çağıranlar bunu
  // "gönderilemedi" sanıp pencerelerini SONSUZA KADAR geri alır (yapılandırma
  // eksikliği, geçici arıza değil). Üretimde bu kombinasyon boot kapısınca
  // zaten imkânsız; koruma dev/test içindir.
  const providerReady = Boolean(process.env.RESEND_API_KEY || process.env.EMAIL_HOST);
  if (!to || !providerReady) return { notified: false, throttled: false, configured: false };

  const now = Date.now();
  if (now - (lastEmailAt.get(context) ?? 0) < EMAIL_THROTTLE_MS) {
    return { notified: false, throttled: true, configured: true };
  }
  lastEmailAt.set(context, now);

  try {
    // ⚠️ `send` DEĞİL `sendReporting` (denetim, 08-01). `send` sonucu YUTAR ve
    // `void` döner — CLAUDE.md'nin "bildirim yollarında `send` KULLANILMAZ"
    // kuralının ta kendisi, ve raportörün kendisi o kurala uymuyordu. Özyineleme
    // riski YOK: `sendReporting` saf bir gönderimdir, `reportError` çağırmaz.
    const res = await emailService.sendReporting(
      to,
      `⚠️ Lixus AI sistem hatası — ${context}`,
      `<p>Bir sistem hatası oluştu:</p><pre style="white-space:pre-wrap;font-size:13px">${escapeHtml(
        detail,
      ).slice(0, 4000)}</pre>`,
    );
    // Gitmediyse damgayı SİLME, GERİYE ÇEK: bir sonraki hata ~1 dk sonra yeniden
    // dener ama SEL ÜRETMEZ.
    //
    // ⚠️ Damgayı silmek (ilk yazım) bu 10 dakikalık kovayı tam da SAĞLAYICI
    // BOZUKKEN devre dışı bırakıyordu — oysa kovanın var olma sebebi bu. Kanıt:
    // `outbox/worker.ts signalOutboxStuck` SABİT bir context kullanıyor
    // ("outbox-blocked") ve tek drain 20 satıra kadar çıkabiliyor; damga her
    // başarısızlıkta silinseydi tek bir drain 20 e-posta DENEMESİ + 20 Sentry
    // olayı üretir, üstelik her deneme 12-15 sn timeout ile senkron içinde
    // bloklardı. Geri çekme hem tekrarı korur hem tavanı ≤1/dk'ya indirir.
    if (!res.ok) lastEmailAt.set(context, now - (EMAIL_THROTTLE_MS - 60_000));
    return { notified: res.ok, throttled: false, configured: true };
  } catch {
    lastEmailAt.set(context, now - (EMAIL_THROTTLE_MS - 60_000));
    return { notified: false, throttled: false, configured: true }; // Reporting must never throw.
  }
}

/** Test helper: reset the email throttle. */
export function __resetReportThrottle() {
  lastEmailAt.clear();
}

// --- Sentry (dependency-free) ----------------------------------------------
// Posts an event to Sentry's ingest "envelope" endpoint, derived from the DSN.
// No SDK, no build changes — active only when SENTRY_DSN is configured.

type SentryDsn = { endpoint: string; publicKey: string };

function parseDsn(dsn: string): SentryDsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.split("/").filter(Boolean).pop();
    if (!u.username || !projectId) return null;
    return {
      endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
      publicKey: u.username,
    };
  } catch {
    return null;
  }
}

/**
 * Sentry gruplama anahtarı: değişken parçaları maskelenmiş hata metni.
 *
 * Sayılar (`5 thread import(s) failed`), cuid/uuid'ler (`row cmpwcnp…`) ve
 * saniye/ms damgaları her olayda farklıdır; maskelenmezse aynı arıza her koşuda
 * YENİ bir Issue açar ve gerçek sinyal gürültüde kaybolur. Maskeleme YALNIZ
 * gruplama içindir — tam metin `extra.message`'ta durur.
 */
export function groupingValue(errMessage: string): string {
  return errMessage
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b(?:c[a-z0-9]{24}|[a-z0-9]{25,})\b/gi, "<id>")
    .replace(/\d+/g, "N")
    .slice(0, 1000);
}

export async function captureToSentry(
  context: string,
  errName: string,
  errMessage: string,
  detail: string,
): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  const parsed = parseDsn(dsn);
  if (!parsed) return;

  try {
    const eventId = randomUUID().replace(/-/g, "");
    const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn });
    const itemHeader = JSON.stringify({ type: "event" });
    const event = JSON.stringify({
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      logger: "guestops",
      environment: process.env.NODE_ENV ?? "production",
      transaction: context,
      // errName/errMessage/detail must arrive PRE-REDACTED (reportError does this).
      //
      // ⚠️ GRUPLAMA ANAHTARI NORMALLEŞTİRİLİR (denetim, 08-01). Sentry varsayılan
      // olarak istisnayı type + value üzerinden gruplar. Bizim mesajlarımız
      // DEĞİŞKEN değer taşıyor ("5 thread import(s) failed…", "(row abc123)") ve
      // her koşu/satır farklı olduğu için TEK bir arıza yüzlerce ayrı Issue'ya
      // bölünüyordu — e-posta throttle'ı context bazlı olduğu için düzeltilmişti
      // ama Sentry bacağı düzelmemişti. Sayılar/id'ler burada maskeleniyor;
      // GERÇEK metin `extra.message` içinde tam hâliyle duruyor, yani hiçbir
      // teşhis bilgisi kaybolmuyor — yalnız gruplama sabitleniyor.
      exception: {
        values: [{ type: errName, value: groupingValue(errMessage) }],
      },
      extra: { detail: detail.slice(0, 4000), message: errMessage.slice(0, 1000) },
    });
    await fetch(parsed.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=guestops/1.0`,
      },
      body: `${header}\n${itemHeader}\n${event}\n`,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Monitoring must never throw or block the caller.
  }
}
