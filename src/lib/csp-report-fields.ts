// ---------------------------------------------------------------------------
// CSP RAPORU LOG ALANLARI — saf, yaprak modül (F09, Codex 09-05; Next.js `route.ts` yalnız rota alanlarını dışa verir).
//
// Kimliksiz `/api/csp-report` ucuna gelen raporun hiçbir alanı loga OLDUĞU GİBİ yazılmaz. Üç sızıntı ölçüldü:
//   1. YOL da taşıyıcıdır: `/c/<chatToken>` QR sohbetinin kapısı (sabit, fiziksel olarak asılı bearer), `/api/calendar/
//      <token>` halka açık takvim beslemesi. Query atılıyordu ama yol olduğu gibi `console.warn`a gidiyordu.
//   2. URL olmayan değerin ilk 120 karakteri aynen dönüyordu (sahte rapordaki kişisel veri loga taşınırdı).
//   3. directive / disposition yalnız uzunluk + kontrol karakteri süzgecinden geçiyordu (serbest metin).
//
// Kural: URL → origin + ROTA ŞABLONU (taşıyıcı ebeveynin ardındaki segment `:token`, ekran adına benzemeyen her segment
// `:id`, en fazla 6 segment); http(s) dışı şema → yalnız şema ("data:"); CSP'nin URL olmayan kaynak anahtar kelimeleri
// kapalı kümeden; geçersiz → "invalid". directive ve disposition KAPALI KÜME, bilinmeyen → "other".
// "Hangi ekran / hangi kaynak origin'i" sorusu ölçümün kendisidir, o KALIR (aşırı uygulama testli).
// ---------------------------------------------------------------------------

/** URL olarak okunamayan ya da izin listesinde olmayan değerin log etiketi (özgün metin ASLA dönmez). */
export const CSP_INVALID = "invalid";
/** Kapalı kümede olmayan directive / disposition değerinin log etiketi. */
export const CSP_OTHER = "other";

/**
 * CSP'nin `blocked-uri` alanında URL yerine yazdığı anahtar kelimeler (CSP3 + tarayıcıların eski biçimleri). Kapalı küme.
 */
const SOURCE_KEYWORDS: ReadonlySet<string> = new Set([
  "inline",
  "eval",
  "wasm-eval",
  "trusted-types-policy",
  "trusted-types-sink",
  "self",
  "data",
  "blob",
  "about",
  "filesystem",
  "mediastream",
]);

/** CSP directive adları (Level 3 + eski). Kapalı küme. */
const DIRECTIVES: ReadonlySet<string> = new Set([
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "img-src",
  "font-src",
  "connect-src",
  "media-src",
  "object-src",
  "frame-src",
  "child-src",
  "worker-src",
  "manifest-src",
  "prefetch-src",
  "fenced-frame-src",
  "form-action",
  "frame-ancestors",
  "base-uri",
  "navigate-to",
  "sandbox",
  "report-uri",
  "report-to",
  "require-trusted-types-for",
  "trusted-types",
  "upgrade-insecure-requests",
  "block-all-mixed-content",
  "webrtc",
  "plugin-types",
  "require-sri-for",
]);

const DISPOSITIONS: ReadonlySet<string> = new Set(["enforce", "report"]);

/**
 * Ardındaki segment TAŞIYICI SIR olan yol önekleri (küçük harfle kıyaslanır; her origin'de uygulanır — başka bir sitenin
 * `/c/...` yolunu da şablona indirmek zararsızdır). Yeni halka açık "bağlantıyı bilen girer" rotası eklenirse buraya da girer.
 */
const BEARER_PARENTS: readonly (readonly string[])[] = [["c"], ["api", "chat"], ["api", "calendar"]];

/**
 * Ekran/kaynak ADI gibi görünen segment: küçük harf + tire gövde (≤32) + isteğe bağlı kısa uzantı ("inbox", "gtag", "x.js").
 * Rakam, büyük harf, alt çizgi, yüzde kodu taşıyan her segment kimlik sayılır (cuid, uuid, hex token, base64url).
 */
const SCREEN_SEGMENT = /^[a-z][a-z-]{0,31}(?:\.[a-z0-9]{1,5})?$/;
const MAX_PATH_SEGMENTS = 6;

/** Origin + yol şablonuyla yazılan şemalar. */
const HIERARCHICAL_PROTOCOLS: ReadonlySet<string> = new Set(["https:", "http:", "wss:", "ws:"]);

/**
 * Gövdesi içerik / eklenti kimliği taşıyabilen şemalar → yalnız şema adı yazılır. Kapalı küme: sahte rapordaki
 * "ayse-yilmaz:x" gibi uydurma şema da loga taşınmaz ("invalid").
 */
const OPAQUE_SCHEMES: ReadonlySet<string> = new Set([
  "data",
  "blob",
  "filesystem",
  "about",
  "javascript",
  "file",
  "chrome-extension",
  "moz-extension",
  "safari-extension",
  "safari-web-extension",
  "ms-browser-extension",
]);

function isBearerParent(segments: readonly string[], index: number): boolean {
  return BEARER_PARENTS.some((p) => p.length === index && p.every((s, j) => segments[j]?.toLowerCase() === s));
}

/** `blocked-uri` / `document-uri` değerinin log biçimi (yukarıdaki kural). Boş/metin olmayan → "". */
export function cspUrlForLog(v: unknown): string {
  if (typeof v !== "string") return "";
  const raw = v.trim();
  if (!raw) return "";
  const keyword = raw.toLowerCase();
  if (SOURCE_KEYWORDS.has(keyword)) return keyword;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return CSP_INVALID;
  }
  if (!HIERARCHICAL_PROTOCOLS.has(u.protocol)) {
    const scheme = u.protocol.slice(0, -1);
    return OPAQUE_SCHEMES.has(scheme) ? `${scheme}:` : CSP_INVALID;
  }
  const segments = u.pathname.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < segments.length && i < MAX_PATH_SEGMENTS; i++) {
    if (isBearerParent(segments, i)) out.push(":token");
    else out.push(SCREEN_SEGMENT.test(segments[i]) ? segments[i] : ":id");
  }
  if (segments.length > MAX_PATH_SEGMENTS) out.push("…");
  // `origin` kullanıcı bilgisini (user:parola@) taşımaz; query ve fragment hiç okunmaz.
  return `${u.origin}/${out.join("/")}`;
}

/** directive: ilk sözcük (CSP2 `violated-directive` "script-src 'self' …" biçimi), kapalı küme; bilinmeyen → "other". */
export function cspDirectiveForLog(v: unknown): string {
  if (typeof v !== "string") return "";
  const raw = v.trim();
  if (!raw) return "";
  const first = raw.slice(0, 64).split(/\s/)[0].toLowerCase();
  return DIRECTIVES.has(first) ? first : CSP_OTHER;
}

/** disposition: "enforce" | "report", bilinmeyen → "other"; yok → "" (log varsayılanı çağıranda). */
export function cspDispositionForLog(v: unknown): string {
  if (typeof v !== "string") return "";
  const raw = v.trim().toLowerCase();
  if (!raw) return "";
  return DISPOSITIONS.has(raw) ? raw : CSP_OTHER;
}
