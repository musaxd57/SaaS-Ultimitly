import { randomUUID } from "node:crypto";
import { emailService } from "./email-core";

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

// Sensitive JSON/kv KEYS whose VALUE must be masked. Deliberately EXCLUDES bare
// "code"/"id"/"status"/"type" so error codes (P2002, invalid_grant), ids and
// HTTP statuses stay visible for debugging.
const SENSITIVE_KEY =
  "(?:pass(?:word|wd)?|pwd|token|access[_-]?token|refresh[_-]?token|" +
  "client[_-]?secret|secret|api[_-]?key|authorization|cookie|set[_-]?cookie|" +
  "e?mail|phone|telephone|gsm|mobile|full[_-]?name|first[_-]?name|last[_-]?name|" +
  "guest[_-]?name|name|address|street|door[_-]?code|access[_-]?code|postal[_-]?code)";
// Value matcher handles BOTH a quoted JSON value (commas/braces INSIDE the quotes
// are part of the value — e.g. "Istanbul, Turkey") and a bare key=value token.
// The old `[^"\n,}{]*` stopped at the first comma, so a quoted address/full_name
// leaked its value un-redacted; the quoted branch below fixes that.
//
// ─────────────────────────────────────────────────────────────────────────────
// ✅ KAPANDI 08-09 (2) — bu blok TARİHSEL KAYIT olarak duruyor.
//
// Buradaki açık ("JSON tırnaklı bileşik anahtarlar maskelenmiyor": `senderName`,
// `chatToken`, iç içe objeler) ve kardeşi ("dizi/obje değerde yarım damga")
// REGEX'LE çözülemedi — iki deneme de net negatif çıktı. Çözüm ↓YAPISAL
// SANITIZER: JSON gerçekten ayrıştırılıp anahtar politikasıyla geziliyor.
// Aşağıdaki kv regex'i KALDIRILMADI ve kaldırılmamalı: `/`+`\` önekli
// anahtarları (`POST /api/calendar/token=SECRET`) yalnız O yakalıyor — yapısal
// geçiş oraya bakmaz, çünkü orası JSON değil.
// ─────────────────────────────────────────────────────────────────────────────
const FIELD_RE = new RegExp(
  `("?)(${SENSITIVE_KEY})\\1\\s*[:=]\\s*("[^"\\n]*"|[^",}{\\n]+)`,
  "gi",
);

// ═══════════════════════════════════════════════════════════════════════════
// YAPISAL SANITIZER (08-09 (2)) — regex yamalamanın yerine geçen tasarım
//
// 🚨 NEDEN REGEX YETMEDİ (ölçülmüş, iki kez): bir düzenli ifade "bu değer
// nerede bitiyor" sorusunu güvenilir yanıtlayamaz. `("?)(KEY)\1` yapısı
// tırnaklama ile kelime-içi eşleşmeyi BİRBİRİNİ DIŞLAYAN hâle getiriyordu
// (`senderName=X` maskeleniyor, `{"senderName":"X"}` maskelenmiyordu) ve
// dizi/obje değerlerde YARIM DAMGA basıyordu — `"guestName": [REDACTED]"Ayse
// Yilmaz"]` gibi, yani damga var PII duruyor: hiç maskelememekten KÖTÜ, çünkü
// log'a bakan "temizlenmiş" sanıyor.
//
// Çözüm: JSON'u JSON olarak ele al. Dengeli parantezle aday parçayı bul,
// `JSON.parse` et, ağacı gez, hassas ANAHTARIN değerini — skaler, dizi ya da
// obje, fark etmez — TAMAMEN değiştir, sonra yeniden serileştir. Bu, "yarım
// damga" arızasını YAPISAL olarak imkânsız kılar: bir alt ağaç ya bütünüyle
// gider ya hiç dokunulmaz.
//
// KORUNAN KISITLAR (hepsi test-pinli, dördü eski tasarımın KIRDIĞI şeylerdi):
//   · `/`+`\` önekli anahtarlar (`POST /api/x/token=SECRET`) → düz metin
//     bölgesinde kalır, eski kv regex'i onları AYNEN yakalamaya devam eder.
//   · teşhis anahtarları (hostname/filename/pathname/username/modelName/
//     errorName…) → AÇIK İZİN listesi, deny'den ÖNCE bakılır.
//   · yığın izi satır numaraları → JSON olmayan metne dokunulmaz.
//   · ReDoS → burada regex YOK; tarama doğrusal ve BÜTÇELİ.
// ═══════════════════════════════════════════════════════════════════════════

const REDACTED_MARK = "[REDACTED]";
/** Tek bir JSON adayının üst sınırı — devasa gövdede tarama patlamasın. */
const MAX_JSON_CANDIDATE = 64 * 1024;
/** Toplam tarama bütçesi. Tükenirse yapısal geçiş BIRAKILIR (regex'ler kalır). */
const SCAN_BUDGET = 2_000_000;
const MAX_DEPTH = 12;

/** Anahtarı karşılaştırma biçimine indir: `guest_name`, `guest-name`, `guestName` → `guestname`. */
function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * 🚨 İZİN LİSTESİ DENY'DEN ÖNCE GELİR ve bu SIRA yük taşıyor.
 *
 * Aşağıdakilerin hepsi `name` parçasını içeriyor; salt "içeriyorsa maskele"
 * kuralı gece 3'te arıza bakarken lazım olan TAM ALANLARI kör ederdi — geri
 * alınan tasarımın ölçülmüş kusurlarından biri buydu.
 */
const DIAGNOSTIC_KEYS = new Set([
  "hostname", "filename", "pathname", "username", "modelname", "errorname",
  "dirname", "basename", "tablename", "columnname", "fieldname", "constraintname",
  "eventname", "typename", "classname", "packagename", "branchname", "jobname",
]);

/**
 * Hassas anahtar PARÇALARI (normalize edilmiş). PARÇA eşleşmesi bilinçli:
 * `senderName` · `chatToken` · `icalToken` · `refresh_token` gibi BİLEŞİK
 * adlar tam-liste yaklaşımından kaçıyordu, ve kaçan tam olarak bu ikisiydi.
 *
 * ⚠️ `code`/`id`/`status`/`type` BİLEREK YOK — hata kodları (P2002,
 * invalid_grant), id'ler ve HTTP durumları görünür kalmalı.
 */
const SENSITIVE_FRAGMENTS = [
  "password", "passwd", "pwd", "token", "secret", "apikey", "authorization",
  "cookie", "email", "mail", "phone", "telephone", "gsm", "mobile",
  "name", "address", "street", "doorcode", "accesscode", "postalcode",
];

function keyIsSensitive(key: string): boolean {
  const k = normalizeKey(key);
  if (DIAGNOSTIC_KEYS.has(k)) return false; // izin DAİMA kazanır
  return SENSITIVE_FRAGMENTS.some((f) => k.includes(f));
}

/**
 * Ağacı gez. Hassas anahtarın değeri — skaler/dizi/obje fark etmez — TAMAMEN
 * `[REDACTED]` olur. Derinlik tavanı, kendine referans veren devasa yapılarda
 * yığını korur (JSON.parse döngü üretemez ama derinlik üretebilir).
 */
function redactParsed(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return REDACTED_MARK;
  if (Array.isArray(value)) return value.map((v) => redactParsed(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = keyIsSensitive(k) ? REDACTED_MARK : redactParsed(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * `start`taki `{`/`[` ile dengelenen kapanışın indeksini bul; yoksa -1.
 * String içi ve kaçış farkındadır (aksi hâlde `"}"` içeren bir değer dengeyi
 * bozardı). `budget` toplam iş miktarını sınırlar.
 */
function scanBalanced(s: string, start: number, budget: { left: number }): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  const limit = Math.min(s.length, start + MAX_JSON_CANDIDATE);
  for (let i = start; i < limit; i++) {
    if (--budget.left <= 0) return -1;
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/**
 * Metindeki her GERÇEK JSON parçasını yapısal olarak temizle, gerisine dokunma.
 *
 * ⚠️ FAIL-SAFE: bütçe tükenirse ya da parça ayrıştırılamazsa metin OLDUĞU GİBİ
 * geçer ve aşağıdaki değer-biçimli regex'ler yine koşar — yani en kötü hâlde
 * DÜNKÜ davranış. Yapısal geçiş koruma EKLER, hiçbir korumayı KALDIRMAZ.
 */
export function redactJsonStructurally(input: string): string {
  const budget = { left: SCAN_BUDGET };
  let out = "";
  let plainStart = 0;
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === "{" || c === "[") {
      const end = scanBalanced(input, i, budget);
      if (end !== -1) {
        const candidate = input.slice(i, end + 1);
        try {
          const parsed: unknown = JSON.parse(candidate);
          out += input.slice(plainStart, i) + JSON.stringify(redactParsed(parsed, 0));
          i = end + 1;
          plainStart = i;
          continue;
        } catch {
          // JSON değil (ör. prose içindeki süslü parantez) — dokunma.
        }
      }
      if (budget.left <= 0) break; // bütçe bitti: kalanı düz metin say
    }
    i++;
  }
  return out + input.slice(plainStart);
}

/**
 * Mask PII/secret VALUES from an error string before it leaves the process —
 * Sentry is US-hosted (KVKK cross-border egress) and the alert email / logs are
 * retained too. Preserves error TYPE, HTTP status codes, error codes, and stack
 * frames (only values are masked), so reports stay debuggable. Exported for tests.
 */
export function redactSensitive(input: string): string {
  if (!input) return input;
  // (0) YAPISAL GEÇİŞ — regex'ten ÖNCE. JSON parçaları gerçekten ayrıştırılıp
  // anahtar politikasıyla gezilir; kalan düz metne aşağıdaki değer-biçimli
  // kurallar uygulanır. Sıra ÖNEMLİ: yapısal geçiş hassas alt ağacı komple
  // `"[REDACTED]"` yaptığı için regex'lerin oraya bakacak bir şeyi kalmaz.
  let s = redactJsonStructurally(input);
  // (A) value-shaped secrets
  s = s.replace(/\b[Bb]earer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]");
  s = s.replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]"); // OpenAI key
  s = s.replace(/\bwhsec_[A-Za-z0-9]+/g, "whsec_[REDACTED]"); // webhook secret
  // ⚠️ TEK KARAKTER SINIFI — nokta SINIFIN İÇİNDE, ayrı `\.` ayırıcı YOK.
  //
  // Eski `eyJ…+\.…+\.…+` biçimi katastrofik geri-izleme yapıyordu: `-` hem
  // sınıfın içinde hem bir `\b` ürettiği için `"eyJa-"` tekrarında HER `eyJ`
  // bir başlangıç olup asla gelmeyecek bir `.` aramak üzere metnin sonuna kadar
  // tarıyordu (31KB → 224-291 ms, 62KB → 888-912 ms; ÜÇ koşumun aralığı —
  // tek koşumluk mikro-benchmark %30-60 sapıyor, ilk raporladığım 341/1460
  // sayıları bu yüzden yüksekti).
  //
  // 🚨 İLK DÜZELTMEM ({1,1024} segment sınırları) FAIL-OPEN'DI: 1024'ten uzun
  // segmentli bir token HİÇ maskelenmiyordu (eskiden `[JWT]` oluyordu) — yani
  // ReDoS'u kapatırken bir SIR SIZINTISI açmıştım. Ölçülerek yakalandı.
  //
  // Bu biçimde alternasyon/geri-izleme YOK, tarama doğrusal: 64KB → 2 ms
  // (sınırlı sürüm 78 ms, sınırsız 1460 ms). Uzun segment de, gerçek JWT de
  // MASKELENİR (fail-CLOSED). `{20,}` eşiği çıplak "eyJ" kelimesini korur.
  // Fazla maskeleme burada GÜVENLİ yön: `eyJ` başlangıcı (base64 `{"`) pratikte
  // token demektir.
  s = s.replace(/\beyJ[A-Za-z0-9_.-]{20,}/g, "[JWT]");
  s = s.replace(/\b(authorization|cookie|set-cookie)\b\s*[:=]\s*[^\n]+/gi, "$1: [REDACTED]");
  // (B) field-name-aware: catches names/addresses/door-codes of any shape in JSON bodies
  s = s.replace(FIELD_RE, (_m, q, key) => `${q}${key}${q}: [REDACTED]`);
  // (C) unlabelled value-shaped PII
  // ⚠️ NİCELİK SINIRLARI ZORUNLU (ölçüldü 08-05): sınırsız hâli katastrofik
  // geri-izleme yapıyordu — `"x@" + "a.".repeat(N)` girdisinde 40KB → 1906 ms,
  // 80KB → 7118 ms. Ulaşılabilir bir DoS'tu: `quality-audit.ts:65` ve
  // `shadow-ai.ts:264` misafir metnini uzunluk tavanından ÖNCE redakte ediyor.
  // ⚠️ ULAŞILABİLİRLİK GEREKÇESİ DÜZELTİLDİ: önce "QR sohbet gövde kapısı 64KB"
  // yazmıştım, YANLIŞ — `chat/[token]/route.ts:47,379` mesajı 2000 karakterde
  // zaten kesiyor. Gerçek kapsız yol `Message.body` (`import/sync.ts`'te slice
  // YOK) → shadow-ai / quality-audit / `automation.ts:2426`, bir de
  // `ai/index.ts:139` (`new Error(await res.text())`). Node tek iş parçacıklı → o süre boyunca
  // TÜM instance bloke. Sınırlı hâlde 40KB → 51 ms, 80KB → 99 ms.
  //
  // ⚠️ LOCAL-PART SINIRI 64 DEĞİL 256. İlk hâlim RFC'nin 64'ünü kullanıyordu ve
  // KISMİ SIZINTI üretiyordu: 72 karakterlik bir local-part'ta eşleşme dizenin
  // ORTASINDAN başlayıp `kirlendi[EMAIL]` çıkarıyordu — ilk 8 karakter açıkta.
  // Bu metin `shadow-ai`/`quality-audit`'te MODEL GİRDİSİ olduğu için sessiz
  // bir davranış değişikliği de demekti (ölçülerek yakalandı, 08-05).
  // 256 = geçerli local-part maksimumunun (64) dört katı; o uzunlukta bir dizi
  // zaten adres değildir, ama maskelenmesi güvenli yöndür.
  //
  // ⚠️ Local-part sınırı YÜK TAŞIYOR, kaldırılamaz — yalnız genişletilebilir:
  // yalnız domain'i sınırlamak 40KB'da 1514 ms bırakıyor (ölçüldü).
  s = s.replace(/[A-Za-z0-9._%+-]{1,256}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g, "[EMAIL]");
  s = s.replace(/\+?\d[\d\s().-]{8,}\d/g, "[PHONE]");
  s = s.replace(/\b\d{6,}\b/g, "[NUM]"); // long digit runs (ids/door codes); 3-digit statuses survive
  return s;
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
