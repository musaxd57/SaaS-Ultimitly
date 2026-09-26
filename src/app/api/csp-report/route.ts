import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, rateLimitClientKey } from "@/lib/rate-limit";
import { BodyTooLargeError, readTextCapped } from "@/lib/api";
import { cspDirectiveForLog, cspDispositionForLog, cspUrlForLog } from "@/lib/csp-report-fields";
import { redactSensitive } from "@/lib/report-error";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// CSP İHLAL TOPLAMA — merkezî, report-only ÖLÇÜM ucu (P1 #6, 08-09 (2))
//
// Bugün iki CSP başlığı da yayımlanıyor ama `report-uri`/`report-to` YOK, yani
// HİÇBİR ihlal toplanmıyor: report-only politika fiilen kör. `script-src`
// enforce'a alınmadan önce ölçüm şart — nonce altyapısı olmadan enforce paneli
// komple kırar (CLAUDE.md).
//
// 🚨 BU UÇ KİMLİKSİZ ve TARAYICI TARAFINDAN ÇAĞRILIR. Kimlik doğrulaması
// EKLENEMEZ (tarayıcı raporu çerezsiz/kimliksiz gönderir), dolayısıyla her
// koruma gövde ve hız tarafında olmak zorunda:
//   · gövde tavanı (8 KB)         · Content-Type doğrulaması
//   · IP başına hız limiti        · YAPISAL alan seçimi (izin listesi)
//   · URL → origin + ROTA ŞABLONU (`/c/:token`, `/inbox/:id`); query/fragment/
//     kullanıcı bilgisi hiç okunmaz; directive/disposition/kaynak anahtar
//     kelimeleri KAPALI KÜME; URL olmayan değer "invalid" (özgün metin dönmez)
//     — kural `lib/csp-report-fields.ts` (F09, Codex 09-05)
//   · satır merkezî redaksiyondan (`redactSensitive`) geçer; log enjeksiyonu
//     alanlar kapalı kümeden kurulduğu için yapısal olarak kapalı
//
// 🚨 HAM RAPOR SAKLANMAZ. Ne DB'ye yazılır ne olduğu gibi loglanır: rapor
// gövdesi `document-uri` içinde OTURUM AÇMIŞ bir host'un panel URL'ini (org/
// rezervasyon id'leri, arama terimleri) ve `script-sample` içinde sayfadan
// alıntı taşıyabilir. Yalnız KAPALI bir alan kümesi, normalize edilerek
// `console.warn`a yazılır — bu depoda Sentry'ye giden tek yol `reportError`
// ve BU UÇ ONU KULLANMAZ: kimliksiz bir uçtan tetiklenen alarm, saldırganın
// eline operatörün alarm kanalını verir.
// ---------------------------------------------------------------------------

/** Tarayıcıların CSP raporu için kullandığı iki MIME (+ düz json toleransı). */
const ACCEPTED_TYPES = new Set(["application/csp-report", "application/reports+json", "application/json"]);

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(req: NextRequest) {
  // ⚠️ BÜTÇE DOĞRULAMADAN ÖNCE TÜKETİLİR — kardeş `/api/leads` ile aynı gerekçe
  // ve `reservations/import`ın TERSİ: burada istekte bulunan ANONİM ve kötüye
  // kullanım vektörünün ta kendisi. Geçersiz gövdelerle sınırsız deneme
  // yapılabilseydi kova hiç dolmadan uç yorulurdu.
  const limited = await rateLimit(`csp-report:${rateLimitClientKey(req)}`, 30, 60 * 60_000); // 30/saat
  if (!limited.ok) {
    return NextResponse.json({ ok: false }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  }

  // Content-Type kapısı: tarayıcı raporu DAİMA bu MIME'lerden biriyle gelir.
  // Rastgele bir form POST'u (CSRF benzeri gürültü) buradan geçemez.
  const essence = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ACCEPTED_TYPES.has(essence)) {
    return NextResponse.json({ ok: false }, { status: 415 });
  }

  let raw: string;
  try {
    raw = await readTextCapped(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return NextResponse.json({ ok: false }, { status: 413 });
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // İki şekil de destekleniyor: klasik `{"csp-report":{…}}` ve Reporting API
  // dizisi `[{"type":"csp-violation","body":{…}}]`.
  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  let accepted = 0;
  for (const item of items.slice(0, 10)) {
    const o = (item ?? {}) as Record<string, unknown>;
    const body = (o["csp-report"] ?? o.body ?? o) as Record<string, unknown>;
    if (!body || typeof body !== "object") continue;

    // 🚨 İZİN LİSTESİ — ham gövde ASLA olduğu gibi kullanılmaz. `script-sample`
    // BİLEREK YOK: sayfadan birebir alıntı taşır (satır içi script gövdesi,
    // içinde token/PII olabilir).
    const directive = cspDirectiveForLog(body["effective-directive"] ?? body.effectiveDirective ?? body["violated-directive"]);
    const blocked = cspUrlForLog(body["blocked-uri"] ?? body.blockedURL);
    const document = cspUrlForLog(body["document-uri"] ?? body.documentURL);
    const disposition = cspDispositionForLog(body.disposition);
    if (!directive && !blocked) continue;

    accepted++;
    // Merkezî redaksiyon bu sink'e de uygulanır (F09/F10): sahte bir raporun origin'ine yazılmış telefon/uzun sayı da düşer.
    console.warn(
      redactSensitive(
        `[csp-report] directive=${directive || "?"} blocked=${blocked || "?"} ` +
          `document=${document || "?"} disposition=${disposition || "report"}`,
      ),
    );
  }

  // 204: tarayıcı gövdeyi okumaz; ayrıca hiçbir şey döndürmemek bu ucu bir
  // yankı/oracle olarak kullanılamaz kılar.
  void accepted; // sayac yalniz log akisini anlamlandirir; yanit HER halde 204
  return new NextResponse(null, { status: 204 });
}
