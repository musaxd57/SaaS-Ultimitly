// ---------------------------------------------------------------------------
// MERKEZÎ REDAKSİYON — yaprak modül, HİÇBİR ŞEY import etmez (F10, Codex 09-05).
//
// Kod `report-error-core.ts`ten AYNEN taşındı (davranış değişmedi; o dosya buradan yeniden dışa verir, eski
// import yolları çalışır). Taşıma sebebi: redaksiyon `reportError`ın içindeydi ve o modül e-posta istemcisini
// import ediyor — hafif kalması gereken yerler (`instrumentation.ts`, e-posta istemcisinin kendi log satırı)
// onu alamıyor, kendi dar kopyalarını yazıyordu ya da ham hatayı loga basıyordu. Artık her log çıkışı
// (`reportError`, CSP raporu, audit, hız limiti, gölge AI, e-posta, zamanlayıcı) AYNI redaksiyondan geçer.
//
// 🚨 KURAL: sunucu tarafında ham hata nesnesi / `err.message` / `err.stack` `console.*`a VERİLMEZ;
// `formatErrorForLog(err)` (alarm kurmayan log satırı) ya da `reportError` (alarm) kullanılır.
// Mekanik pin: `tests/unit/log-sink-redaction-pin.test.ts`.
// ---------------------------------------------------------------------------

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
/**
 * Tek bir JSON adayının üst sınırı.
 *
 * ⚠️ 64KB → 1MB YÜKSELTİLDİ (P1 #1 fail-closed turu, 08-09 (2)). 64KB'de
 * ÖLÇÜLMÜŞ bir sızıntı vardı: 70KB'lik GEÇERLİ bir JSON dengelenemiyor,
 * yapısal geçiş onu atlıyor ve `{"…70KB…","senderName":"Ayşe Yılmaz"}` düz
 * metin olarak geçiyordu. `JSON.parse` doğrusaldır (1MB birkaç ms); asıl
 * maliyet `scanBalanced`ın HER `{`ten çağrılmasıydı ve onu SCAN_BUDGET
 * sınırlıyor — yani tavanı büyütmek kabaca bedava, atlamak ise sızıntı.
 */
const MAX_JSON_CANDIDATE = 1024 * 1024;

/**
 * Yapısal olarak İŞLENEMEYEN bir JSON adayının yerine geçen SABİT metin.
 *
 * 🚨 FAIL-CLOSED KURALI (kullanıcı direktifi, 08-09 (2)): ayrıştırma ya da
 * bütçe başarısız olursa ÖZGÜN ADAY GERİ BIRAKILMAZ. Eski davranış "dünkü hâle
 * düş"tü ve bu YETERSİZDİ — ölçüldü: yarıda kesilmiş `{"senderName":"…"` ve
 * bozuk `{'senderName': '…'}` girdilerinde ad AYNEN dışarı çıkıyordu, çünkü
 * kv regex'i tırnaklı bileşik anahtarı zaten yakalayamıyor.
 */
const UNPARSEABLE_MARK = "[REDACTED_UNPARSEABLE_JSON]";

/**
 * Metnin `from`dan sonrasında HASSAS bir anahtar İZİ var mı?
 *
 * Regex burada yalnız ADAY BULUR; hükmü `keyIsSensitive` verir (izin listesi
 * dahil). Böylece 08-05'te geri alınan "regex politikayı da taşısın" hatası
 * tekrarlanmıyor. Nicelikler sınırlı → ReDoS yok.
 */
const KEYISH_RE = /["']?([A-Za-z0-9_$-]{1,64})["']?\s*:/g;

/**
 * 🚨 KAÇIŞ ÇÖZÜMÜ ŞART (ölçüldü, 08-09 (2)): ham metinde `"chat\u0054oken"`
 * yazan bir anahtar iz taramasını ATLATIYORDU — `\` karakter sınıfının dışında
 * olduğu için eşleşme `u0054oken` diye başlıyor ve o dizgi "token" içermiyor.
 * JSON'un tek kaçış biçimi `\uXXXX`; önce onu çözüp sonra bakıyoruz.
 */
function decodeJsonEscapes(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function remainderHasSensitiveKey(input: string, from: number): boolean {
  const tail = decodeJsonEscapes(input.slice(from));
  KEYISH_RE.lastIndex = 0;
  for (const m of tail.matchAll(KEYISH_RE)) {
    if (keyIsSensitive(m[1])) return true;
  }
  return false;
}
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
 * Bir JSON adayının taranma SONUCU. Sebep önemli: "1 MB tavanına dayandı" ile
 * "girdi bitti" AYNI şey değildir ve farklı fail-closed davranışı gerektirir.
 */
type ScanResult =
  | { kind: "balanced"; end: number }
  | { kind: "oversized" } // aday tavanına dayandı, hâlâ açık → İÇERİĞİ GÖREMEDİK
  | { kind: "budget" } // tarama bütçesi tükendi → yine göremedik
  | { kind: "unbalanced" }; // girdi bitti / yapı bozuk → aday SINIRLI ve görülebilir

/**
 * `start`taki `{`/`[` ile dengelenen kapanışı bul. String içi ve kaçış
 * farkındadır (aksi hâlde `"}"` içeren bir değer dengeyi bozardı).
 */
function scanBalanced(s: string, start: number, budget: { left: number }): ScanResult {
  let depth = 0;
  let inStr = false;
  let esc = false;
  const hardEnd = start + MAX_JSON_CANDIDATE;
  const limit = Math.min(s.length, hardEnd);
  for (let i = start; i < limit; i++) {
    if (--budget.left <= 0) return { kind: "budget" };
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
      if (depth === 0) return { kind: "balanced", end: i };
      if (depth < 0) return { kind: "unbalanced" };
    }
  }
  // Tavana mı dayandık, girdi mi bitti? Ayrım fail-closed kararını belirler.
  return limit === hardEnd && hardEnd < s.length ? { kind: "oversized" } : { kind: "unbalanced" };
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
  // Kalan metnin hassas anahtar taşıyıp taşımadığı EN FAZLA BİR KEZ hesaplanır.
  // Sonraki başarısızlıklar daha SAĞDA olduğu için kalanları bu kalanın alt
  // kümesidir — temizse hepsi temizdir.
  let remainderClean = false;
  let remainderChecked = false;

  while (i < input.length) {
    const c = input[i];
    if (c !== "{" && c !== "[") {
      i++;
      continue;
    }
    const scan = scanBalanced(input, i, budget);
    if (scan.kind === "balanced") {
      try {
        const parsed: unknown = JSON.parse(input.slice(i, scan.end + 1));
        out += input.slice(plainStart, i) + JSON.stringify(redactParsed(parsed, 0));
        i = scan.end + 1;
        plainStart = i;
        continue;
      } catch {
        // Dengeli ama JSON DEĞİL (prose süslü parantezi ya da bozuk gövde).
        // Aday SINIRLI ve görülebilir → aşağıdaki iz taraması meşru.
      }
    }

    // ── FAIL-CLOSED, İKİ AYRI REJİM ─────────────────────────────────────────
    //
    // 🚨 (A) ADAY TAVANI AŞILDI ya da BÜTÇE BİTTİ → ANAHTAR ARAMADAN, KOŞULSUZ
    // sabit metne in. Gerekçe ölçüldü (08-09 (2), Codex uyarısı): içeriği
    // GÖREMEDİĞİMİZ bir gövdede metinsel iz taramasına güvenmek yanlış güvence
    // üretir — ham metinde `"chat\u0054oken"` yazan bir anahtar taramayı
    // atlatıyordu ve 1,2 MB'lık gövde TOKEN'IYLA BİRLİKTE dışarı çıkıyordu.
    // Kaçış çözümü ayrıca eklendi ama tek başına yeterli sayılmaz: göremediğimiz
    // içerik hakkında hüküm vermeyiz. Oversized + işlenemeyen adayda GİZLİLİK
    // TEŞHİSTEN ÖNEMLİ — devasa gövdenin kendisi zaten teşhis değeri düşük.
    if (scan.kind === "oversized" || scan.kind === "budget") {
      return out + input.slice(plainStart, i) + UNPARSEABLE_MARK;
    }

    // (B) Aday SINIRLI (girdi bitti / yapı bozuk / JSON değil): içeriği
    // görebiliyoruz, o yüzden iz taraması meşru ve prose korunabiliyor.
    // Tarama `\uXXXX` kaçışlarını ÇÖZDÜKTEN sonra bakar.
    if (!remainderChecked) {
      remainderClean = !remainderHasSensitiveKey(input, i);
      remainderChecked = true;
    }
    if (!remainderClean) return out + input.slice(plainStart, i) + UNPARSEABLE_MARK;
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

/**
 * Hata değerinin LOG biçimi (F10): `ad: mesaj` (+ varsa `cause`un `ad: mesaj`ı), merkezî redaksiyondan geçmiş ve
 * kısaltılmış. Ham hata nesnesi / yığın / `cause` zinciri `console.*`a verilmez: Prisma'nın "Invalid invocation"
 * metni yazılan veriyi, sürücünün DETAIL satırı çakışan anahtarın DEĞERİNİ (ör. `login-acct:<e-posta>`) taşıyabilir.
 * Yığın izi yalnız `reportError` yolunda (redakte) gider. Kısaltma redaksiyondan SONRA (yarım kalan bir e-posta
 * kalıbı kaçmasın). Asla fırlatmaz.
 */
export function formatErrorForLog(err: unknown, max = 500): string {
  try {
    let text: string;
    if (err instanceof Error) {
      text = `${err.name}: ${err.message}`;
      const cause = (err as { cause?: unknown }).cause;
      if (cause instanceof Error) text += ` (cause: ${cause.name}: ${cause.message})`;
    } else {
      text = String(err);
    }
    return redactSensitive(text).slice(0, max);
  } catch {
    return "unformattable error";
  }
}
