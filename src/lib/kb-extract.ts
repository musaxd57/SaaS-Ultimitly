// ---------------------------------------------------------------------------
// A5 — HOST METNİNDEN TASLAK ÖNERİ ÇIKARMA (09-08). SAF FONKSİYON, LLM YOK.
//
// Neden var: kurulumun en pahalı kısmı boş bir formu tek tek doldurmak. Host'un
// elinde metin ZATEN var (karşılama mesajı, ev rehberi, eski Airbnb açıklaması).
// Bu modül o metni okuyup "şunu şu kategoriye kaydedebilirsiniz" ÖNERİLERİ
// üretir.
//
// 🚨 DÖRT DEĞİŞMEZ (kurucu şartları, 09-08):
//
// 1. HİÇBİR ŞEY KENDİLİĞİNDEN YAZILMAZ. Bu fonksiyon yalnız ÖNERİ döndürür;
//    yazma kararı host'undur ve mevcut `POST /api/kb` yolundan (tüm plan
//    sınırları, doğrulama, hafıza eşitlemesi) geçer.
//
// 2. YER TUTUCU GERÇEĞE DÖNÜŞMEZ. `{isim}` · `[ŞİFRE]` · `<adres>` içeren bir
//    satırdan öneri ÇIKARILMAZ. Şablon metinlerinde bunlar bolca bulunur ve
//    "Sayın {isim}" cümlesinden misafir adı diye `{isim}` yazan bir "gerçek"
//    üretmek, ürünün en temel sözünü (uydurma bilgi yok) ilk günde kırardı.
//
// 3. MESAJ ŞABLONU MÜLK GERÇEĞİ SAYILMAZ — ama içindeki AÇIK bilgi öneri
//    üretebilir. "Çıkış saati 11:00'dir, anahtarı kutuya bırakın" cümlesinden
//    `checkOutTime=11:00` ÖNERİSİ çıkar; şablonun kendisi kalem OLMAZ.
//
// 4. ÇİFT KOPYA YASAK. Hedefi yapılandırılmış bir kolon olan bilgi (giriş/çıkış
//    saati) KB kalemi olarak ÖNERİLMEZ; ayrı bir listede "bu bilgi mülk
//    ayarlarında tutulur" diye gösterilir. Aynı gerçeğin iki kopyası ayrışır ve
//    hangisinin doğru olduğu belirsizleşir.
//
// Çıkarım DETERMİNİSTİKTİR (kelime + kalıp). Model çağrısı YOK: bu yüzden aynı
// metin her zaman aynı öneriyi verir, test edilebilir ve maliyeti sıfırdır.
// ---------------------------------------------------------------------------

/** Yer tutucu işaretleri: `{...}` · `[...]` · `<...>` · `___`. */
const PLACEHOLDER = /\{[^}]*\}|\[[^\]]*\]|<[^>]*>|_{3,}/;

/** "11:00" · "11.00" · "11" (saat bağlamında). */
const TIME = /(\b(?:[01]?\d|2[0-3]))\s*[:.]\s*([0-5]\d)\b/;

/** Metnin bu kadar karakterinden fazlası okunmaz (yapıştırma DoS'u yok). */
export const EXTRACT_MAX_CHARS = 20_000;
/** Tek öneri gövdesi için tavan — KB karakter sınırının çok altında. */
const MAX_ITEM_CHARS = 1_500;

export type KbFieldTarget = "checkInTime" | "checkOutTime";

export interface KbFieldSuggestion {
  target: KbFieldTarget;
  /** "HH:MM" biçiminde normalize edilmiş değer. */
  value: string;
  /** Kaynak satır numarası (1 tabanlı) — host nereden geldiğini görsün. */
  line: number;
  /** Kaynak cümlenin kendisi (host'un KENDİ metni; önizlemede gösterilir). */
  excerpt: string;
}

export interface KbItemSuggestion {
  category: string;
  title: string;
  content: string;
  lines: number[];
}

export type SkipReason = "placeholder" | "too_long" | "duplicate";

export interface KbSkipped {
  reason: SkipReason;
  line: number;
  excerpt: string;
}

export interface KbExtraction {
  /** Yapılandırılmış kolona ait öneriler — KB kalemi OLARAK YAZILMAZ. */
  fields: KbFieldSuggestion[];
  /** KB kalemi önerileri (kategori başına en fazla bir tane). */
  items: KbItemSuggestion[];
  /** Bilerek atlananlar — sessiz kayıp yok, host neden atlandığını görür. */
  skipped: KbSkipped[];
  /** Okunan satır sayısı (tavan yüzünden kesildiyse gerçek sayıdan küçüktür). */
  linesRead: number;
  /** Metin tavanı aşıldı mı (host'a söylenir). */
  truncated: boolean;
}

/**
 * Kategori anahtar kelimeleri. Türkçe fold'u BURADA yapılmaz — küçük harfe
 * çevirme `foldTurkishLower` ile aynı sorunu taşımasın diye `toLocaleLowerCase("tr")`
 * kullanılır (I/İ ayrımı).
 */
const CATEGORY_KEYWORDS: { category: string; title: string; words: string[] }[] = [
  { category: "wifi", title: "Wi-Fi bilgisi", words: ["wifi", "wi-fi", "kablosuz", "ssid", "ağ adı", "internet şifre"] },
  { category: "parking", title: "Otopark", words: ["otopark", "park yeri", "araç park", "otoparkı"] },
  { category: "trash", title: "Çöp ve geri dönüşüm", words: ["çöp", "geri dönüşüm", "atık"] },
  { category: "rules", title: "Ev kuralları", words: ["sigara", "evcil hayvan", "gürültü", "parti", "kural"] },
  { category: "cleaning", title: "Temizlik", words: ["temizlik", "havlu", "nevresim", "çarşaf"] },
  { category: "location", title: "Konum ve ulaşım", words: ["adres", "konum", "metro", "otobüs", "durak", "havaalanı", "havalimanı"] },
];

const CHECKOUT_WORDS = ["çıkış saat", "çıkış:", "check-out", "checkout", "çıkışta saat"];
const CHECKIN_WORDS = ["giriş saat", "giriş:", "check-in", "checkin", "girişte saat"];

function lower(s: string): string {
  return s.toLocaleLowerCase("tr");
}

function hasAny(haystack: string, words: string[]): boolean {
  return words.some((w) => haystack.includes(w));
}

/**
 * Metni satırlara böler, her satırı deterministik olarak sınıflandırır ve
 * TASLAK öneriler üretir. Hiçbir yan etkisi yoktur.
 */
export function extractKbSuggestions(raw: string): KbExtraction {
  const truncated = raw.length > EXTRACT_MAX_CHARS;
  const text = truncated ? raw.slice(0, EXTRACT_MAX_CHARS) : raw;
  const lines = text.split(/\r?\n/);

  const fields: KbFieldSuggestion[] = [];
  const skipped: KbSkipped[] = [];
  const byCategory = new Map<string, { title: string; parts: string[]; lines: number[] }>();
  const seenField = new Set<KbFieldTarget>();

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    const no = idx + 1;
    const excerpt = line.length > 160 ? `${line.slice(0, 157)}…` : line;

    // 🚨 YER TUTUCU KAPISI — her şeyden ÖNCE. Bir satırda `{isim}`/`[ŞİFRE]`
    // varsa o satırdan hiçbir "gerçek" çıkarılmaz. Atlandığı SÖYLENİR.
    if (PLACEHOLDER.test(line)) {
      skipped.push({ reason: "placeholder", line: no, excerpt });
      return;
    }
    if (line.length > MAX_ITEM_CHARS) {
      skipped.push({ reason: "too_long", line: no, excerpt });
      return;
    }

    const low = lower(line);

    // 1) Yapılandırılmış alanlar — KB kalemi OLARAK YAZILMAZ (çift kopya yasağı).
    const time = TIME.exec(line);
    if (time) {
      const value = `${time[1].padStart(2, "0")}:${time[2]}`;
      if (hasAny(low, CHECKOUT_WORDS) && !seenField.has("checkOutTime")) {
        seenField.add("checkOutTime");
        fields.push({ target: "checkOutTime", value, line: no, excerpt });
        return;
      }
      if (hasAny(low, CHECKIN_WORDS) && !seenField.has("checkInTime")) {
        seenField.add("checkInTime");
        fields.push({ target: "checkInTime", value, line: no, excerpt });
        return;
      }
      // Aynı alan ikinci kez geçtiyse ÇELİŞKİ olabilir; ilkini tutup ikincisini
      // atlanmış olarak bildiriyoruz — sessizce ezmek yanlış değeri kalıcılaştırırdı.
      if (hasAny(low, CHECKOUT_WORDS) || hasAny(low, CHECKIN_WORDS)) {
        skipped.push({ reason: "duplicate", line: no, excerpt });
        return;
      }
    }

    // 2) KB kalemi kategorileri — ilk eşleşen kategori kazanır (dar ve deterministik).
    for (const k of CATEGORY_KEYWORDS) {
      if (!hasAny(low, k.words)) continue;
      const prev = byCategory.get(k.category) ?? { title: k.title, parts: [], lines: [] };
      if (prev.parts.join("\n").length + line.length > MAX_ITEM_CHARS) {
        skipped.push({ reason: "too_long", line: no, excerpt });
        return;
      }
      prev.parts.push(line);
      prev.lines.push(no);
      byCategory.set(k.category, prev);
      return;
    }
  });

  const items: KbItemSuggestion[] = [...byCategory.entries()].map(([category, v]) => ({
    category,
    title: v.title,
    content: v.parts.join("\n"),
    lines: v.lines,
  }));

  return { fields, items, skipped, linesRead: lines.length, truncated };
}
