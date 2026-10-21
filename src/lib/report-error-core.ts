import { randomUUID } from "node:crypto";
import { emailService } from "./email-core";
import { currentCorrelationId } from "./correlation";
import { prismaErrorSummary, redactSensitive } from "./redact";

// Redaksiyon yaprak modüle taşındı (F10); eski import yolları için yeniden dışa verilir.
export { errorWithContext, formatErrorForLog, prismaErrorSummary, redactJsonStructurally, redactSensitive } from "./redact";

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
// Bağlam dizesi işletme kimliği taşır (ör. `qr-cancelled-stay org=…`) → harita işletme × bağlam kadar büyür, hiç silinmiyordu (altyapı
// envanteri 10-21, madde 41). Tavan aşılınca EN ESKİ DAMGA gider. Damga her yazılışta sil + ekle ile haritanın sonuna taşınır
// (`stampEmail`), böylece ekleme sırası = damga sırası (Haiku 10-21: yerinde `set` sırayı korur, taze damga silinebilirdi; tek istisna
// gönderim düşünce geri çekilen damga — o zaten 1 dk içinde düşer); penceresi geçmiş damgalar baştadır, ayrı bir süpürme gerekmez (mutasyon M3 eşdeğer çıktı → kaldırıldı). Yalnız 10 dakikada 2.000'den
// fazla FARKLI bağlam hata verirse en eskisi bir e-postayı erken alır.
export const EMAIL_THROTTLE_MAX_KEYS = 2_000;

function pruneEmailThrottle(): void {
  if (lastEmailAt.size < EMAIL_THROTTLE_MAX_KEYS) return;
  for (const key of lastEmailAt.keys()) {
    if (lastEmailAt.size < EMAIL_THROTTLE_MAX_KEYS) break;
    lastEmailAt.delete(key);
  }
}

function stampEmail(context: string, at: number): void {
  lastEmailAt.delete(context);
  lastEmailAt.set(context, at);
}

/** Test helper: throttle map size (memory bound). */
export function __emailThrottleSizeForTest(): number {
  return lastEmailAt.size;
}

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
  /** Sentry'ye giden olayın kimliği (32 onaltılık; `SENTRY_DSN` yoksa yok) — olay günlüğüne yazılır, iki yönlü bağ (takip no. dilim G). */
  sentryEventId?: string;
}

/**
 * Sentry ALANI (takip numarası dilim G, 10-15): bağlamın ilk kod belirteci — olay günlüğüyle AYNI kural (`report-error.ts`): "sync org=…"
 * → "sync", "ical.reconcile:<kaynak>" → "ical.reconcile". Değişken parça (ad, kimlik) etikete giremez.
 */
export function sentryArea(context: string): string {
  return context.split(/[^A-Za-z0-9_.-]/)[0].slice(0, 40) || "unknown";
}

/** Sürüm: Railway'in commit değişkeninin ilk 12 onaltılığı; yoksa / biçimsizse alan hiç gönderilmez. */
export function sentryRelease(env: Record<string, string | undefined> = process.env): string | null {
  const sha = env.RAILWAY_GIT_COMMIT_SHA?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{12,40}$/.test(sha) ? sha.slice(0, 12) : null;
}

/**
 * Railway ortam adı ETİKETİ (ileride hazırlık / .eu ayrışır). Sentry'nin `environment` alanı BİLEREK eskisi gibi NODE_ENV kalır (Opus 10-15
 * B11): operatörün `environment:production` süzgeçli uyarı kuralları ortam adı değişince sessizce boşa düşmesin. Türkçe harfler ASCII
 * karşılığına çevrilir, kalan biçim dışı karakter "-" olur ("Hazırlık EU" → "hazirlik-eu"); boş kalırsa / değişken yoksa etiket yok.
 */
export function sentryRailwayEnv(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.RAILWAY_ENVIRONMENT_NAME?.trim();
  if (!raw) return null;
  const ascii = raw
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .toLowerCase();
  const clean = ascii.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return clean || null;
}

export async function reportError(context: string, err: unknown): Promise<ReportOutcome> {
  // Prisma hatası VERİ taşır (sorgunun argümanları, "Failing row contains …") → yalnız yapısal özet + yığın ÇERÇEVELERİ (bizim
  // kodumuzun satırları; ilk satırı iletiyi tekrarlar, yazılmaz). İnceleme b5, 09-30.
  const prismaSummary = prismaErrorSummary(err);
  const frames = err instanceof Error && err.stack ? err.stack.split("\n").filter((l) => /^\s+at /.test(l)).slice(0, 15).join("\n") : "";
  const detail = redactSensitive(
    prismaSummary !== null
      ? `${prismaSummary}\n${frames}`
      : err instanceof Error
        ? `${err.name}: ${err.message}\n${err.stack ?? ""}`
        : String(err),
  );
  const errName = err instanceof Error ? err.name : "Error";
  const errMessage = redactSensitive(prismaSummary ?? (err instanceof Error ? err.message : String(err)));

  // Takip numarası (kurucu kararı 10-10): süren işlemin numarası — log satırı, Sentry etiketi ve alarm e-postası aynı numarayı taşır;
  // operatör ekranı (`api/admin/events`) numarayla olay günlüğünü bulur. Numara doğrudan tanımlayıcı değildir (kayıtlara bağlanabildiği için takma adlıdır), yalnız iz.
  const correlationId = currentCorrelationId();

  // Always log — structured and greppable (redacted: Railway logs are retained).
  console.error(`[reportError] ${context}${correlationId ? ` [takip ${correlationId}]` : ""} :: ${detail}`);

  // Real error monitoring (optional): send to Sentry when SENTRY_DSN is set.
  // Fire-and-forget, dependency-free, never throws. Olay kimliği BURADA üretilir → çağıran olay günlüğüne yazar (iki yönlü bağ).
  // Kimlik yalnız olay GERÇEKTEN gönderilebilecekse (geçerli https adresi) üretilir — gönderilmeyen olaya bağ yazılmaz.
  const sentryEventId = parseDsn(process.env.SENTRY_DSN?.trim() ?? "") ? randomUUID().replace(/-/g, "") : undefined;
  if (sentryEventId) void captureToSentry(context, errName, errMessage, detail, correlationId, sentryEventId);
  const linked = sentryEventId ? { sentryEventId } : {};

  const to = process.env.ERROR_ALERT_EMAIL || process.env.ALERT_EMAIL;
  // ⚠️ `configured` HEM alıcıyı HEM sağlayıcıyı ister. Yalnız alıcıya bakmak
  // yeterli değildi: sağlayıcı yokken `sendReporting` her seferinde
  // `{ok:false, error:"E-posta ayarlı değil"}` döner ve çağıranlar bunu
  // "gönderilemedi" sanıp pencerelerini SONSUZA KADAR geri alır (yapılandırma
  // eksikliği, geçici arıza değil). Üretimde bu kombinasyon boot kapısınca
  // zaten imkânsız; koruma dev/test içindir.
  const providerReady = Boolean(process.env.RESEND_API_KEY || process.env.EMAIL_HOST);
  if (!to || !providerReady) return { notified: false, throttled: false, configured: false, ...linked };

  const now = Date.now();
  if (now - (lastEmailAt.get(context) ?? 0) < EMAIL_THROTTLE_MS) {
    return { notified: false, throttled: true, configured: true, ...linked };
  }
  pruneEmailThrottle();
  stampEmail(context, now);

  try {
    // ⚠️ `send` DEĞİL `sendReporting` (denetim, 08-01). `send` sonucu YUTAR ve
    // `void` döner — CLAUDE.md'nin "bildirim yollarında `send` KULLANILMAZ"
    // kuralının ta kendisi, ve raportörün kendisi o kurala uymuyordu. Özyineleme
    // riski YOK: `sendReporting` saf bir gönderimdir, `reportError` çağırmaz.
    const res = await emailService.sendReporting(
      to,
      `⚠️ Lixus AI sistem hatası — ${context}`,
      `<p>Bir sistem hatası oluştu:</p>${
        correlationId ? `<p>Takip numarası: <code>${escapeHtml(correlationId)}</code> (operatör paneli → olay araması)</p>` : ""
      }<pre style="white-space:pre-wrap;font-size:13px">${escapeHtml(detail).slice(0, 4000)}</pre>`,
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
    if (!res.ok) stampEmail(context, now - (EMAIL_THROTTLE_MS - 60_000));
    return { notified: res.ok, throttled: false, configured: true, ...linked };
  } catch {
    stampEmail(context, now - (EMAIL_THROTTLE_MS - 60_000));
    return { notified: false, throttled: false, configured: true, ...linked }; // Reporting must never throw.
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
    // Yalnız şifreli bağlantı (eski denetim DEN#27): redakte de olsa hata ayrıntısı düz metin gönderilmez; açılış doğrulaması uyarır.
    if (u.protocol !== "https:") return null;
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
  correlationId: string | null = null,
  eventId: string = randomUUID().replace(/-/g, ""),
): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  const parsed = parseDsn(dsn);
  if (!parsed) return;

  try {
    const release = sentryRelease();
    const railwayEnv = sentryRailwayEnv();
    const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn });
    const itemHeader = JSON.stringify({ type: "event" });
    const event = JSON.stringify({
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      logger: "guestops",
      environment: process.env.NODE_ENV ?? "production",
      ...(release ? { release } : {}),
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
      // Etiketler (gruplamaya girmez): takip numarası (Sentry'de numarayla arama) + ALAN (ödeme / kuyruk / senkron… süzme; dilim G).
      // İşletme etiketi (anahtarlı özet) kurucu kararına bırakıldı (F5) — Sentry yurt dışı alt işleyen.
      tags: {
        area: sentryArea(context),
        ...(correlationId ? { correlation_id: correlationId } : {}),
        ...(railwayEnv ? { railway_env: railwayEnv } : {}),
      },
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
