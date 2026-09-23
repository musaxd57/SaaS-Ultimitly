/* ---------------------------------------------------------------------------
 * EMBEDDING SAĞLAYICISI (E1) — metin → vektör.
 *
 * 🚨 BU DOSYANIN BUGÜN HİÇBİR ÇAĞIRANI YOK ve bu BİLİNÇLİ. E1 dilimi yalnız
 * SÖZLEŞMEYİ kurar: ücretli servise tek bir istek gitmez, davranış değişmez,
 * migration istemez. Bağlama E3/E5'te ve AYRI onayla yapılır.
 *
 * ── NEDEN EMBEDDING (ölçülmüş gerekçe, maliyet DEĞİL) ──────────────────────
 * Bugünkü seçim tamamen SÖZCÜKSEL (BM25 + Türkçe kök sökücü + ~45 kavramlık
 * sözlük + karakter 3-gram). Ölçüldü (09-11): **Rusça ve Arapça sorguların
 * TAMAMI** `no_lexical_hits`e düşüyor — sözlük TR+EN, kök sökücü Türkçe ekler.
 * Almanca/Fransızca yalnız KAZAEN çalışıyor ("wlan" sözlükte olduğu için).
 * O dillerde sözcüksel eşleşme YAPISAL OLARAK YOK; en güçlü gerekçe budur.
 *
 * ── KVKK / VERİ AKIŞI: YENİ BİR ŞEY YOK (kurucu 09-12, kodda doğrulandı) ────
 * Kurucu haklıydı: misafirin mesajı (`prompts.ts` istem gövdesi) ve KB içeriği
 * (`packKnowledgeBase`) ZATEN `api.openai.com`a gidiyor. Embedding yeni bir
 * VERİ SINIFI da yeni bir SAĞLAYICI da eklemiyor — aynı veri, aynı firma,
 * farklı uç nokta. Tek gerçek fark vektörlerin BİZİM DB'mizde saklanması; o da
 * zaten sakladığımız metinden türeyen bir değer.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · SAF DEĞİL (ağ var) ama YAN ETKİSİZ: DB'ye yazmaz, hiçbir karar vermez.
 *  · ASLA FIRLATMAZ. Her arıza (anahtar yok · timeout · 4xx/5xx · bozuk gövde ·
 *    boyut uyuşmazlığı) → `null`. Çağıran `null`ı "anlamsal kaynak yok" diye
 *    okur ve `select.ts` sözcüksel davranışına döner. FAIL-OPEN YAPISALDIR:
 *    embedding çökse bile misafir cevapsız kalmaz.
 *    ⚠️ Bu, `select.ts`in try/catch'inden ders alınarak böyle yazıldı — orada
 *    sessiz yakalama bir keresinde retrieval'ı tamamen kapatmıştı.
 *  · VEKTÖRLER NORMALİZE döner (L2 = 1). Böylece kosinüs benzerliği = nokta
 *    çarpımı olur; okuma tarafında karekök/bölme YOK (≤300 parçada brute-force
 *    1,37 ms ölçüldü — pgvector GEREKMİYOR, o Railway'de prod DB taşıma işi).
 *  · Sıra KORUNUR: `embedTexts(["a","b"])[i]` daima `texts[i]`in vektörüdür.
 *    Sağlayıcı `index` alanı döndürür ve ona göre YENİDEN SIRALANIR — sıraya
 *    körü körüne güvenmek sessiz eşleşme hatası üretirdi.
 * ------------------------------------------------------------------------- */

import { createHash } from "node:crypto";
import { reportError } from "@/lib/report-error";
import {
  classifyModelProviderFailure,
  noteModelProviderPersistentFailure,
  noteModelProviderSuccess,
  type ModelProviderPersistentFailure,
} from "@/lib/ai/provider-health";

/**
 * Model. `text-embedding-3-small`: 1536 boyut, ölçülen maliyet kurucu org'un
 * TÜM bilgi tabanı için **0,18 sent** (tek sefer), sorgu tarafı mesaj başına
 * 67 token = sohbet isteminin %0,37'si.
 */
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * 🚨 HER ÇAĞRIDA OKUNUR, import anında DONDURULMAZ.
 *
 * İlk yazımda `const EMBEDDING_MODEL = process.env… || default` idi ve test
 * bunu YAKALADI: env sonradan değişse bile modül eski değeri kullanmaya devam
 * ediyordu. Kardeş yol (`ai/index.ts:98`, `:396`) env'i çağrı anında okuyor;
 * ayrışma sessizdir ve önbellek anahtarı modeli içerdiği için EN KÖTÜ hâlde
 * "yeni modelin vektörü eski modelin anahtarıyla" saklanırdı.
 */
export function embeddingModel(): string {
  return process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}

/** Beklenen boyut. Sağlayıcı başka boyut dönerse vektör KABUL EDİLMEZ (↓). */
export const EMBEDDING_DIMENSIONS = 1536;

/** Tek çağrıda en fazla kaç metin (sağlayıcı tavanının çok altında, ölçülü). */
export const EMBEDDING_BATCH_MAX = 64;

/**
 * Tek metin için tavan. Parçalayıcı zaten 900 karakterde kesiyor; bu yalnız
 * kötü çağrıya karşı emniyet kemeri (uzun metin = sessiz maliyet).
 */
export const EMBEDDING_INPUT_MAX_CHARS = 8_000;

/** TEK deneme için ağ zaman aşımı. */
const TIMEOUT_MS = 8_000;

/**
 * 🚨 TOPLAM bütçe — tekrar denemeler DÂHİL. Bu kod bir SOHBETİN içinde koşuyor:
 * misafir ekranın başında bekliyor. "3 deneme × 8 sn" 24 saniye ederdi; tekrar
 * deneme bir gecikme bütçesi ALMAZ, var olanı PAYLAŞIR (test-pinli sabit).
 */
export const EMBEDDING_TOTAL_DEADLINE_MS = 9_000;

/** En fazla kaç deneme (ilk çağrı dâhil). */
const MAX_ATTEMPTS = 3;
/** İlk geri çekilme; her denemede ikiye katlanır (200 → 400). */
const BACKOFF_BASE_MS = 200;

/** Önbellek tavanı: 256 × 1536 × 8 bayt ≈ 3 MB — sınırsız büyüme YOK. */
export const EMBEDDING_CACHE_MAX = 256;

/**
 * ① BELLEK İÇİ LRU ÖNBELLEK (kurucu iş emri 09-12).
 *
 * 🚨 ANAHTAR İÇERİKTİR (model + metin özeti) → **BAYATLAMA YAPISAL OLARAK
 * İMKÂNSIZ**: metin değişirse anahtar da değişir. Bu yüzden TTL YOK; TTL
 * koymak "eski vektör dönebilir" riskini çözmez, sadece isabet oranını düşürür.
 *
 * 🚨 HAM METİN SAKLANMAZ — anahtar SHA-256 özetidir. Misafirin sorusu zaten
 * istek boyunca bellekte, ama uzun ömürlü bir Map'te ADIYLA tutulmaz
 * (test-pinli). Vektörün kendisi kiracı taşımaz: embedding metnin SAF
 * fonksiyonudur, iki kiracı aynı cümleyi sorarsa aynı vektörü hak eder.
 *
 * ⚠️ DÜRÜSTLÜK: bu önbellek ASIL PARA TASARRUFU DEĞİL. KB parçalarını iki kez
 * ödememenin yolu içerik-hash'li KALICI saklamadır (E2 — migration ister).
 * Buradaki kazanç GECİKMEDİR ve süreç ömrüyle sınırlıdır.
 */
const cache = new Map<string, number[]>();
let cacheHits = 0;
let cacheMisses = 0;

/** Test/teşhis: önbelleği boşalt. */
export function clearEmbeddingCache(): void {
  cache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

/** Test/teşhis: PII'siz sayaçlar (`sampleKeys` yalnız ÖZETLER). */
export function embeddingCacheStats(): {
  size: number;
  hits: number;
  misses: number;
  sampleKeys: string[];
} {
  return { size: cache.size, hits: cacheHits, misses: cacheMisses, sampleKeys: [...cache.keys()].slice(0, 5) };
}

function cacheKey(model: string, text: string): string {
  return `${model}:${createHash("sha256").update(text).digest("base64url")}`;
}

/** LRU: okunan anahtar en TAZE konuma taşınır (Map ekleme sırasını korur). */
function cacheGet(key: string): number[] | undefined {
  const v = cache.get(key);
  if (v === undefined) return undefined;
  cache.delete(key);
  cache.set(key, v);
  return v;
}

function cacheSet(key: string, vec: number[]): void {
  cache.set(key, vec);
  while (cache.size > EMBEDDING_CACHE_MAX) {
    // En eski (ilk) anahtar düşer.
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * ③ L2 normalizasyon — YERİNDE (in-place).
 *
 * 🚨 BU FONKSİYON AYNI ZAMANDA GEÇERLİLİK KAPISIDIR. Kurucu "OpenAI zaten
 * normalize döndürüyor, bu adım gereksiz CPU" dedi; ölçüldü: tam boyutta DOĞRU
 * ama EKSİK — NaN/Infinity ve sıfır vektör reddi de burada yaşıyor ve onlar
 * sağlayıcının garantisi DEĞİL. Ayrıca `dimensions` ile kısaltma yapılırsa
 * sonuç zaten normalize DEĞİLDİR. Bu yüzden adım KALDI, yalnız TAHSİS kalktı:
 * ölçüldü (1536 boyut × 64 parça) → `.map()` 1,16 ms, in-place 0,32 ms (3,6×).
 *
 * ⚠️ Girdi dizisi sağlayıcı yanıtından TAZE ayrıştırılmıştır ve yalnız bize
 * aittir; in-place yazmak çağıranın verisini bozmaz.
 */
function normalizeInPlace(v: number[]): number[] | null {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x)) return null; // NaN/Infinity taşıyan vektör KULLANILMAZ
    sum += x * x;
  }
  const len = Math.sqrt(sum);
  if (!(len > 0)) return null; // sıfır vektör anlamsızdır
  const inv = 1 / len;
  for (let i = 0; i < v.length; i++) v[i] *= inv;
  return v;
}

/** Tekrar denemeye DEĞER mi? Kalıcı hatada ısrar hem para hem gecikme yakar. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * ② TEKRAR DENEME POLİTİKASI — SAF ve tek başına sınanabilir.
 *
 * 🚨 AYRI FONKSİYON OLMASININ SEBEBİ ÖLÇÜLDÜ: politika döngünün içine gömülüyken
 * mutasyon turu "toplam bütçe kapısını SİL" mutantını YAKALAYAMADI — testler
 * mock'lu `fetch` ile milisaniyelerde bittiği için 9 saniyelik tavana hiç
 * değmiyordu. Yani kural KODDA vardı ama hiçbir şey onu KORUMUYORDU. Saf
 * fonksiyon olarak zaman uydurmaya gerek kalmadan pinlenebilir.
 *
 * @param status HTTP durumu; `null` = ağ/timeout (yeniden denenebilir sayılır).
 * @param elapsedMs İlk denemeden bu yana geçen süre.
 */
export function retryPlan(opts: {
  attempt: number;
  status: number | null;
  elapsedMs: number;
  retryAfterSec?: number | null;
  /** Toplam bütçe (varsayılan `EMBEDDING_TOTAL_DEADLINE_MS`; sıcak yol daha kısa verir). */
  deadlineMs?: number;
}): { retry: boolean; waitMs: number } {
  const { attempt, status, elapsedMs, retryAfterSec } = opts;
  const deadline = effectiveDeadline(opts.deadlineMs);
  if (attempt >= MAX_ATTEMPTS) return { retry: false, waitMs: 0 };
  if (status !== null && !isRetryableStatus(status)) return { retry: false, waitMs: 0 };
  const ra = Number(retryAfterSec);
  const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : BACKOFF_BASE_MS * 2 ** (attempt - 1);
  // 🚨 BEKLEME KALAN BÜTÇEYİ AŞAMAZ: `Retry-After` sağlayıcının talimatıdır ama
  // misafir onun takvimine göre beklemez.
  if (elapsedMs + waitMs >= deadline) return { retry: false, waitMs: 0 };
  return { retry: true, waitMs };
}

/**
 * Çağıranın istediği toplam bütçe — `EMBEDDING_TOTAL_DEADLINE_MS`i ASLA aşamaz (üst tavan
 * sabit), geçersiz değer varsayılana düşer. Sıcak yol (misafir cevabı beklerken sorgu gömme)
 * daha KISA bütçe verir: uzun bekleme yerine sözcüksel seçimle devam etmek doğrudur.
 */
function effectiveDeadline(ms: number | undefined): number {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? Math.min(ms, EMBEDDING_TOTAL_DEADLINE_MS) : EMBEDDING_TOTAL_DEADLINE_MS;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Metinleri vektöre çevirir. Girdi sırası KORUNUR.
 *
 * @returns Her girdi için bir vektör, ya da TAMAMI için `null` (arıza).
 *          Kısmi sonuç DÖNMEZ: yarım küme, çağıranda sessizce yanlış eşleşme
 *          üretirdi ("2. parçanın vektörü" aslında 3. parçanınki olurdu).
 */
export async function embedTexts(
  texts: readonly string[],
  opts: { deadlineMs?: number } = {},
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  if (texts.length > EMBEDDING_BATCH_MAX) return null;
  // Boş/aşırı uzun girdi sağlayıcıya HİÇ gitmez (maliyet + 400 gürültüsü).
  if (texts.some((t) => typeof t !== "string" || t.trim() === "" || t.length > EMBEDDING_INPUT_MAX_CHARS)) {
    return null;
  }

  // ── ① ÖNBELLEK: yalnız EKSİK metinler sağlayıcıya gider ───────────────────
  // 🚨 Sıra burada kurulur ve SONUNA KADAR korunur: `out` girdi uzunluğunda
  // açılır, isabetler yerine oturur, eksikler `missing` ile toplanır ve dönen
  // vektörler KENDİ indekslerine yazılır. Kısmi isabette sırayı yeniden
  // kurmaya çalışmak tam olarak bu modülün baştan reddettiği hata sınıfıdır.
  const model = embeddingModel();
  const keys = texts.map((t) => cacheKey(model, t));
  const out: (number[] | null)[] = new Array(texts.length).fill(null);
  const missing: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const hit = cacheGet(keys[i]);
    if (hit) {
      out[i] = hit;
      cacheHits += 1;
    } else {
      missing.push(i);
      cacheMisses += 1;
    }
  }
  if (missing.length === 0) return out as number[][];

  const key = process.env.OPENAI_API_KEY;
  if (!key) return null; // anahtar yok = ücretli servis YOK; alarm da yok (beklenen hâl)

  const input = missing.map((i) => texts[i]);
  const startedAt = Date.now();
  const deadline = effectiveDeadline(opts.deadlineMs);
  let lastStatus = 0;
  let persistent: ModelProviderPersistentFailure | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // ── ② TOPLAM BÜTÇE: her deneme KALAN süreyi alır, yenisini değil ────────
    const remaining = deadline - (Date.now() - startedAt);
    if (remaining <= 0) break;

    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, input }),
        signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, remaining)),
      });

      if (!res.ok) {
        lastStatus = res.status;
        // 🚨 KALICI ARIZA (kredi bitti / anahtar reddedildi / model yok) yeniden DENENMEZ: kredisi biten
        // hesabın 429'u `isRetryableStatus` için geçici görünür ama hiçbir deneme başarılı olamaz (09-23
        // ölçüldü). Gövde YALNIZ sınıflandırma için okunur; alarma geçmez (↓ yalnız durum kodu).
        const errBody = await res.text().catch(() => "");
        persistent = classifyModelProviderFailure(res.status, errBody);
        if (persistent) break;
        // 🚨 KALICI HATADA ISRAR YOK ve BEKLEME KALAN BÜTÇEYİ AŞAMAZ — karar
        // saf `retryPlan`da (tek başına test-pinli).
        const plan = retryPlan({
          attempt,
          status: res.status,
          elapsedMs: Date.now() - startedAt,
          retryAfterSec: Number(res.headers.get("retry-after")),
          deadlineMs: deadline,
        });
        if (!plan.retry) break;
        await sleep(plan.waitMs);
        continue;
      }

      const json: unknown = await res.json();
      const data = (json as { data?: unknown }).data;
      if (!Array.isArray(data) || data.length !== input.length) {
        await reportError(
          "openai-embeddings shape violation",
          new Error(`expected ${input.length} rows`),
        );
        return null;
      }

      // 🚨 SIRAYA GÜVENME: sağlayıcı `index` döndürür, ona göre yerleştir.
      // `index` İSTEK dizisine (`input`) göredir; `missing` onu ÖZGÜN girdi
      // konumuna çevirir.
      const fetched: (number[] | null)[] = new Array(input.length).fill(null);
      for (const row of data) {
        const r = row as { index?: unknown; embedding?: unknown };
        const i = typeof r.index === "number" ? r.index : -1;
        if (!Number.isInteger(i) || i < 0 || i >= input.length) return null;
        if (!Array.isArray(r.embedding) || r.embedding.length !== EMBEDDING_DIMENSIONS) return null;
        const unit = normalizeInPlace(r.embedding as number[]);
        if (!unit) return null;
        fetched[i] = unit;
      }
      if (fetched.some((v) => v === null)) return null; // her girdiye TAM KARŞILIK şart

      for (let j = 0; j < missing.length; j++) {
        const vec = fetched[j] as number[];
        out[missing[j]] = vec;
        // 🚨 YALNIZ BAŞARI ÖNBELLEĞE GİRER — arıza önbelleklenirse geçici bir
        // kesinti kalıcı bir körlüğe dönerdi.
        cacheSet(keys[missing[j]], vec);
      }
      noteModelProviderSuccess("embedding");
      return out as number[][];
    } catch (err) {
      // Timeout/abort/ağ — `status: null` ile aynı politikadan geçer.
      const plan = retryPlan({ attempt, status: null, elapsedMs: Date.now() - startedAt, deadlineMs: deadline });
      if (!plan.retry) {
        await reportError("openai-embeddings", err);
        return null;
      }
      await sleep(plan.waitMs);
    }
  }

  // 🚨 Yalnız DURUM KODU alarma girer; sağlayıcının hata GÖVDESİ GEÇİLMEZ.
  // Kardeş yol (`ai/index.ts`) gövdeyi geçiriyor ama orada istek gövdesi
  // İSTEMDİR; burada istek gövdesi KB metni + misafirin SORUSUDUR, yani hata
  // ekosu PII taşıyabilir. Alarm/RiskEvent sözleşmesi PII'sizdir.
  // 🚨 KALICI ARIZA GEÇİŞ TABANLI ALARMA gider (09-23): anahtar açıkken HER misafir mesajı bir gömme
  // çağrısıdır; kredisi biten hesapta çağrı başına `reportError` sohbet yolunun 09-23 selini aynen
  // tekrarlardı. Anahtar AYRI (`model-provider:embedding`); gövde yine GEÇİLMEZ (PII kuralı ↑).
  if (persistent) {
    await noteModelProviderPersistentFailure(persistent, lastStatus, "", "embedding");
    return null;
  }
  if (lastStatus) {
    await reportError(`openai-embeddings ${lastStatus}`, new Error(`HTTP ${lastStatus}`));
  }
  return null;
}

/** Tek metin için kolaylık sarmalayıcı. */
export async function embedText(text: string): Promise<number[] | null> {
  const out = await embedTexts([text]);
  return out && out.length === 1 ? out[0] : null;
}

/**
 * İki NORMALİZE vektörün kosinüs benzerliği = nokta çarpımı.
 *
 * ⚠️ Girdilerin normalize olduğunu VARSAYAR (`embedTexts` öyle döndürür).
 * Boyut uyuşmazlığında `null` — sessizce 0 dönmek "hiç benzemiyor" diye
 * okunurdu, oysa gerçek durum "karşılaştırılamaz".
 */
export function cosineOfUnit(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Kayan nokta hatası [-1,1] dışına taşabilir; kelepçele.
  return Math.max(-1, Math.min(1, dot));
}
