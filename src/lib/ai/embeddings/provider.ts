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

import { reportError } from "@/lib/report-error";

/**
 * Model. `text-embedding-3-small`: 1536 boyut, ölçülen maliyet kurucu org'un
 * TÜM bilgi tabanı için **0,18 sent** (tek sefer), sorgu tarafı mesaj başına
 * 67 token = sohbet isteminin %0,37'si.
 */
export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

/** Beklenen boyut. Sağlayıcı başka boyut dönerse vektör KABUL EDİLMEZ (↓). */
export const EMBEDDING_DIMENSIONS = 1536;

/** Tek çağrıda en fazla kaç metin (sağlayıcı tavanının çok altında, ölçülü). */
export const EMBEDDING_BATCH_MAX = 64;

/**
 * Tek metin için tavan. Parçalayıcı zaten 900 karakterde kesiyor; bu yalnız
 * kötü çağrıya karşı emniyet kemeri (uzun metin = sessiz maliyet).
 */
export const EMBEDDING_INPUT_MAX_CHARS = 8_000;

/** Ağ zaman aşımı. Retrieval bir SOHBETİN içinde koşuyor; beklemek yasak. */
const TIMEOUT_MS = 8_000;

/** L2 normalizasyon: kosinüs = nokta çarpımı olsun diye. */
function normalize(v: number[]): number[] | null {
  let sum = 0;
  for (const x of v) {
    if (!Number.isFinite(x)) return null; // NaN/Infinity taşıyan vektör KULLANILMAZ
    sum += x * x;
  }
  const len = Math.sqrt(sum);
  if (!(len > 0)) return null; // sıfır vektör anlamsızdır
  return v.map((x) => x / len);
}

/**
 * Metinleri vektöre çevirir. Girdi sırası KORUNUR.
 *
 * @returns Her girdi için bir vektör, ya da TAMAMI için `null` (arıza).
 *          Kısmi sonuç DÖNMEZ: yarım küme, çağıranda sessizce yanlış eşleşme
 *          üretirdi ("2. parçanın vektörü" aslında 3. parçanınki olurdu).
 */
export async function embedTexts(texts: readonly string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  if (texts.length > EMBEDDING_BATCH_MAX) return null;
  // Boş/aşırı uzun girdi sağlayıcıya HİÇ gitmez (maliyet + 400 gürültüsü).
  if (texts.some((t) => typeof t !== "string" || t.trim() === "" || t.length > EMBEDDING_INPUT_MAX_CHARS)) {
    return null;
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return null; // anahtar yok = ücretli servis YOK; alarm da yok (beklenen hâl)

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // 🚨 Yalnız DURUM KODU alarma girer; sağlayıcının hata GÖVDESİ GEÇİLMEZ.
      // Kardeş yol (`ai/index.ts:181`) gövdeyi geçiriyor ama orada istek gövdesi
      // İSTEMDİR; burada istek gövdesi KB metni + misafirin SORUSUDUR, yani hata
      // ekosu PII taşıyabilir. Alarm/RiskEvent sözleşmesi PII'sizdir.
      await reportError(`openai-embeddings ${res.status}`, new Error(`HTTP ${res.status}`));
      return null;
    }
    const json: unknown = await res.json();
    const data = (json as { data?: unknown }).data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      await reportError(
        "openai-embeddings shape violation",
        new Error(`expected ${texts.length} rows`),
      );
      return null;
    }

    // 🚨 SIRAYA GÜVENME: sağlayıcı `index` döndürür, ona göre yerleştir.
    const out: (number[] | null)[] = new Array(texts.length).fill(null);
    for (const row of data) {
      const r = row as { index?: unknown; embedding?: unknown };
      const i = typeof r.index === "number" ? r.index : -1;
      if (!Number.isInteger(i) || i < 0 || i >= texts.length) return null;
      if (!Array.isArray(r.embedding) || r.embedding.length !== EMBEDDING_DIMENSIONS) return null;
      const unit = normalize(r.embedding as number[]);
      if (!unit) return null;
      out[i] = unit;
    }
    if (out.some((v) => v === null)) return null; // her girdiye TAM KARŞILIK şart
    return out as number[][];
  } catch (err) {
    // Timeout/abort/ağ — hepsi aynı sonuç: anlamsal kaynak yok, sözcüksel devam.
    await reportError("openai-embeddings", err);
    return null;
  }
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
