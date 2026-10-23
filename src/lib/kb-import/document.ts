import { createHash } from "crypto";
import { CHUNK_MAX_CHARS, chunkSpans } from "@/lib/ai/retrieval/chunker";
import { KB_CATEGORY, type KbCategory } from "@/lib/constants";
import { extractKbSuggestions, type KbFieldSuggestion } from "@/lib/kb-extract";
import { KB_CHARS_PER_ITEM } from "@/lib/billing/kb-item-cap";
import { kbPlaceholderTokens, leftoverGuestTokens, unfilledTemplateTokens } from "@/lib/kb-placeholders";
import { foldTurkishAscii } from "@/lib/ai/fallback";
import { gateDraft, type DraftFlag } from "@/lib/history-learn/extract";

// ---------------------------------------------------------------------------
// DOSYADAN BİLGİ TABANI TASLAĞI — ÇEKİRDEK (10-23 öğle, kurucu: "dosya olarak toplu veriler … hostlar için yazmakla uğraşmalarından
// iyidir … rag ve embeddingimiz iyi olmalı ama ona çok dikkat et"). Tasarım: `docs/TASARIM-2026-10-23-bilgi-tabani-dosya-rag-ve-tarama.md` §4.
// SAF: veritabanı, ağ, model yok; hiçbir yüzeye BAĞLI DEĞİL (ekran kurucunun cevabını bekliyor, §7-A / §7-B). Girdi: tarayıcıda çıkarılmış
// sayfa metinleri (PDF / Word dosyası sunucuda açılmaz).
//
// İKİ DEĞİŞMEZ:
//  1. MODEL BİLGİ YAZAMAZ. Taslağın içeriği belgenin paragraflarının AYNEN birleşimidir; konulara ayıran (bugün kod, ileride model) yalnız
//     "şu paragraflar şu konu" der. Başlık belgenin kendi başlığı ya da kategorinin sabit adıdır — dışarıdan verilen başlık KULLANILMAZ (kalem
//     başlığı modelin istemine "[KATEGORİ] Başlık: …" diye girer; uydurma bir başlık uydurma bilgi olurdu). `draftIsVerbatim` sınar.
//  2. HER PARAGRAF HESAP VERİR: taslağa girer ya da neden girmediği söylenir (yer tutucu · yalnız giriş / çıkış saati → daire ayarı önerisi ·
//     hiçbir konuya bağlanmadı). Sessiz kayıp yok (A5 kuralı: "atlandığı SÖYLENİR").
// Konu ayırıcı (kod ya da ileride model) karşılama / giriş talimatı / çıkış mesajı kategorisini SEÇEMEZ. "Giriş Talimatı" (`checkin`) yalnız KODUN
// erişim kapısıyla açılır (Opus 10-23 akşam KB incelemesi R1, kodla doğrulandı): otomatik mesajlar artık `AutoMessageTemplate`ten gelir, bu
// kategori ise QR sohbetinin ve rezervasyon öncesi konuşmanın GÖRMEDİĞİ kategoridir (`guest-chat.ts QR_SECRET_CATEGORIES` /
// `PREBOOKING_SECRET_CATEGORIES`) — kapı / anahtar / kilit paragrafı "Genel"e düşseydi QR misafirine ve aday misafire açılırdı.
// Her blok kayıttan ÖNCE taslak kapısından geçer (`history-learn/extract.ts gateDraft`, tek kaynak): talimat ele geçirme bloğu atlanır,
// ödeme / hassas işaretleri taslağa taşınır (inceleme ekranı tek tıkla onaya katmaz).
// Tek doğru: giriş / çıkış saati daire ayarında tutulur; yalnız onu söyleyen paragraf kalem olmaz, öneri olarak döner (A5 "çift kopya yasak").
// ---------------------------------------------------------------------------

/** Okunan toplam metin tavanı (karakter) ve sayfa tavanı. Aşan kısım okunmaz, `truncated` söylenir. */
export const KB_IMPORT_MAX_CHARS = 200_000;
export const KB_IMPORT_MAX_PAGES = 100;
/**
 * Paragraf (blok) tavanı: her blok taslak kapısından geçer (~0,3 ms); kısa ve farklı binlerce paragraflık belge (ölçüldü: 7.500 blok ≈ 2,3 sn,
 * kategoriler arasında gidip gelen 13.600 blok ≈ 4,2 sn) sunucuyu meşgul ederdi. Gerçek bir ev rehberi 100 sayfada bile birkaç yüz paragraftır;
 * aşan kısım okunmaz, `truncated` söylenir (karakter tavanıyla aynı kural).
 */
export const KB_IMPORT_MAX_BLOCKS = 1_500;
/** Tek kalemin içerik tavanı = plan sınırının kayıt tavanı (tek kaynak `billing/kb-item-cap.ts`); aşan konu sıralı parçalara bölünür. */
export const KB_IMPORT_ITEM_MAX_CHARS = KB_CHARS_PER_ITEM;

const TEMPLATE_CATEGORIES: ReadonlySet<string> = new Set(["welcome", "checkin", "checkout"]);
/** İçe aktarmanın açabileceği kategoriler: bilgi tabanı kategorileri eksi misafire aynen giden şablon kategorileri. */
export const KB_IMPORTABLE_CATEGORIES: readonly KbCategory[] = KB_CATEGORY.options
  .map((o) => o.value)
  .filter((c) => !TEMPLATE_CATEGORIES.has(c));
const IMPORTABLE: ReadonlySet<string> = new Set(KB_IMPORTABLE_CATEGORIES);

export interface DocPage {
  /** 1 tabanlı sayfa numarası (Word / metin dosyasında 1). */
  page: number;
  text: string;
}

export interface DocBlock {
  index: number;
  page: number;
  /** Paragrafın normalize edilmiş metni — belgenin BİTİŞİK bir dilimi. */
  text: string;
  kind: "heading" | "body";
  /** Başlık bloğunda başlığın kendisi; gövde bloğunda altında durduğu son başlık (yoksa null). */
  heading: string | null;
}

export interface SplitDocument {
  blocks: DocBlock[];
  truncated: boolean;
  /** Normalize edilmiş belgenin SHA-256 özeti (kaynak işaretçisi; içerik taşımaz). */
  docHash: string;
}

/** Görünmez biçim karakterleri + kontrol karakterleri (sekme ve satır sonu hariç). */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}⠀]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;

/** Satır sonları tek biçime iner, görünmez / kontrol karakterleri silinir, satırların iki ucu kırpılır. Metin başka DEĞİŞMEZ. */
export function normalizeDocText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .replace(/\t/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
}

const TERMINAL_PUNCT = /[.!?;,…]$/;

/**
 * Tek satırlık paragraf başlık mı: markdown "#" · sonu ":" · tamamı büyük harf. En çok 60 karakter / 5 sözcük, harf içerir, saat taşımaz.
 * Kısa düz satır ("Wi-Fi") BAŞLIK SAYILMAZ, gövdedir — kural cümlesini ("SİGARA İÇMEK YASAKTIR" gibi uzun büyük harf satırını da) başlığa
 * çevirip içerikten düşürmemek için tavanlar dar.
 */
export function headingText(para: string): string | null {
  if (para.includes("\n") || para.length > 60 || !/\p{L}/u.test(para)) return null;
  if (/\d{1,2}[:.]\d{2}/.test(para)) return null;
  let text: string | null = null;
  const md = /^#{1,6}\s+(.+)$/.exec(para);
  if (md) text = md[1].trim();
  else if (para.endsWith(":")) text = para.slice(0, -1).trim();
  else if (!TERMINAL_PUNCT.test(para) && para === para.toLocaleUpperCase("tr") && para !== para.toLocaleLowerCase("tr")) text = para;
  if (!text || text.split(/\s+/).length > 5 || TERMINAL_PUNCT.test(text)) return null;
  return text;
}

/** Sayfaları paragraf bloklarına böler. Uzun paragraf parçalayıcının cümle sınırından bölünür (dilimler bitişik, metin aynen). */
export function splitDocument(pages: readonly DocPage[]): SplitDocument {
  const raw: Omit<DocBlock, "index" | "heading">[] = [];
  const headings = new Map<number, string>();
  let total = 0;
  let truncated = pages.length > KB_IMPORT_MAX_PAGES;
  outer: for (const page of pages.slice(0, KB_IMPORT_MAX_PAGES)) {
    for (const para of normalizeDocText(page.text).split(/\n{2,}/)) {
      const text = para.trim();
      if (!text) continue;
      if (total + text.length > KB_IMPORT_MAX_CHARS || raw.length >= KB_IMPORT_MAX_BLOCKS) {
        truncated = true;
        break outer;
      }
      total += text.length;
      const h = headingText(text);
      if (h !== null) {
        headings.set(raw.length, h);
        raw.push({ page: page.page, text, kind: "heading" });
      } else if (text.length > CHUNK_MAX_CHARS) {
        for (const s of chunkSpans(text)) {
          if (raw.length >= KB_IMPORT_MAX_BLOCKS) {
            truncated = true;
            break outer;
          }
          raw.push({ page: page.page, text: text.slice(s.start, s.end), kind: "body" });
        }
      } else {
        raw.push({ page: page.page, text, kind: "body" });
      }
    }
  }
  // Altında gövde olmayan başlık (art arda iki başlık ya da belge sonu) içeriği taşıyabilir → gövde sayılır, düşmez.
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].kind === "heading" && raw[i + 1]?.kind !== "body") {
      raw[i] = { ...raw[i], kind: "body" };
      headings.delete(i);
    }
  }
  let current: string | null = null;
  const blocks: DocBlock[] = raw.map((b, index) => {
    if (b.kind === "heading") current = headings.get(index) ?? null;
    return { ...b, index, heading: b.kind === "heading" ? (headings.get(index) ?? null) : current };
  });
  const docHash = createHash("sha256")
    .update(blocks.map((b) => b.text).join("\n\n"))
    .digest("hex");
  return { blocks, truncated, docHash };
}

/**
 * Kategori sözcükleri (Türkçe + İngilizce + Almanca; küçük harfe Türkçe yerelle iner). Bilinçli DAR: yanlış kategori kalemi yanlış yerde
 * gösterir ama içeriği değiştirmez; eşleşmeyen "Genel" olur. Şablon kategorileri burada YOK.
 */
const CATEGORY_WORDS: readonly { category: KbCategory; words: readonly string[] }[] = [
  { category: "wifi", words: ["wi-fi", "wifi", "wlan", "kablosuz", "internet", "ssid", "ağ adı", "modem"] },
  { category: "parking", words: ["otopark", "park yeri", "park alanı", "garaj", "parking", "garage", "parkplatz", "stellplatz"] },
  { category: "trash", words: ["çöp", "geri dönüşüm", "atık", "garbage", "trash", "rubbish", "recycling", "müll"] },
  {
    category: "rules",
    words: ["kural", "sigara", "evcil", "gürültü", "parti", "sessizlik", "house rules", "smoking", "pets", "noise", "party", "quiet hours", "hausordnung", "rauchen"],
  },
  { category: "cleaning", words: ["temizlik", "havlu", "nevresim", "çarşaf", "cleaning", "towel", "linen", "sheets", "reinigung", "handtuch"] },
  {
    category: "location",
    words: ["adres", "konum", "ulaşım", "metro", "otobüs", "durak", "havaalanı", "havalimanı", "taksi", "address", "directions", "airport", "location", "anfahrt"],
  },
  {
    category: "local_tips",
    words: ["restoran", "kafe", "market", "eczane", "plaj", "gezilecek", "restaurant", "cafe", "supermarket", "pharmacy", "beach", "things to do", "sightseeing"],
  },
  { category: "faq", words: ["sık sorulan", "faq", "frequently asked"] },
];

const DEFAULT_TITLES: Readonly<Record<string, string>> = Object.fromEntries(KB_CATEGORY.options.map((o) => [o.value, o.label]));

/**
 * Kategori sözcüğü SÖZCÜK BAŞINDA aranır; 7 harften kısa sözcük yalnız kendisi ya da sınırlı bir Türkçe / İngilizce çekim ekiyle eşleşir
 * (Opus 10-23 akşam R / CLAUDE.md "parti TAM SÖZCÜK" sınıfı: "particular" parti, "taksit" taksi, "marketing" market DEĞİL; "çöpleri", "taksiye",
 * "kuralları" eşleşir). Uzun sözcük kök gibi davranır ("otoparkı", "internetiniz"). Sabit sözcük listesi, sınırlı ek → doğrusal.
 */
const SHORT_SUFFIX =
  "(?:l[ae]r(?:[ıiuü]n?|d[ae]n?|[ae])?|[ıiuü]n?|y[ıiuü]|s[ıiuü]n?|n[ıiuü]n|y[ae]|[ae]|n[ae]|n?d[ae]n?|n?t[ae]n?|y?l[ae]|m[ıiuü]z|c[ıi]|ç[ıi]|s|es)?";
const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CATEGORY_RES: readonly { category: KbCategory; res: readonly RegExp[] }[] = CATEGORY_WORDS.map(({ category, words }) => ({
  category,
  res: words.map((w) =>
    w.length >= 7
      ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}`, "u")
      : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}${SHORT_SUFFIX}(?![\\p{L}\\p{N}])`, "u"),
  ),
}));

/** Metnin en çok sözcük eşleşen kategorisi (eşitlikte listedeki sıra); hiçbiri yoksa null. */
export function importCategoryOf(text: string): KbCategory | null {
  const low = text.toLocaleLowerCase("tr");
  let best: KbCategory | null = null;
  let bestHits = 0;
  for (const { category, res } of CATEGORY_RES) {
    const hits = res.filter((re) => re.test(low)).length;
    if (hits > bestHits) {
      best = category;
      bestHits = hits;
    }
  }
  return best;
}

export interface DraftSection {
  category: string;
  /** Gövde blok numaraları. Geçersiz / tekrar eden numara bütün bölümü düşürür (yarım konu taslak olmaz). */
  blocks: readonly number[];
  /** Kalemin başlığı olacak BELGE başlığı bloğu (yalnız başlık bloğu kabul edilir; yoksa kategorinin sabit adı). */
  headingBlock?: number;
}

/**
 * Deterministik konu ayırma (modelsiz; model düşerse / kapalıysa da çalışır). Başlığın altındaki İLK gövde bloğu o konudur; sonrakiler yalnız
 * başlığın kategorisindeyse (kategorisiz başlıkta: aynı sayfadaysa) eklenir — başlık bir kez yazılıp unutulan belgelerde sonraki her paragraf
 * ("Otopark:" altında çöp, kurallar, havuz) o konuya yapışmasın. Başlıktan kopan ve başlıksız bloklar kategoriye göre toplanır; eşleşmeyen "Genel".
 */
export function sectionByHeadings(doc: SplitDocument): DraftSection[] {
  type Open = { category: KbCategory | null; headingBlock?: number; blocks: number[] };
  const sections = new Map<string, Open>();
  let cur: { key: string; category: KbCategory | null; page: number; first: boolean } | null = null;
  let generalRun: { key: string; page: number; last: number } | null = null;
  for (const b of doc.blocks) {
    if (b.kind === "heading") {
      generalRun = null;
      cur = { key: `h:${b.index}`, category: importCategoryOf(b.heading ?? ""), page: b.page, first: true };
      sections.set(cur.key, { category: cur.category, headingBlock: b.index, blocks: [] });
      continue;
    }
    const own = importCategoryOf(b.text);
    // Kategorili başlık ("Otopark:") yalnız kendi kategorisindeki paragrafı alır; kategorisiz paragraf ("Havuz 09:00-20:00") ona yapışmaz
    // (Haiku 10-23 öğle: havuz saati "Otopark" kalemine giriyordu) — "Genel"e düşer, içerik kaybolmaz. Kategorisiz başlık ("Ayrıntılar:")
    // aynı sayfadaki paragrafları alır.
    const joins =
      cur !== null && (cur.first || (own !== null && own === cur.category) || (b.page === cur.page && cur.category === null));
    if (cur && joins) {
      generalRun = null;
      const s: Open = sections.get(cur.key)!;
      s.blocks.push(b.index);
      if (s.category === null && own !== null) s.category = own;
      cur = { ...cur, category: s.category, page: b.page, first: false };
      continue;
    }
    cur = null;
    const category = own ?? "general";
    // Kategorisiz ("Genel") paragraflar yalnız BİTİŞİK ve aynı sayfadaysa birleşir (Opus 10-23 akşam R1: bütün belgenin başlıksız paragrafları
    // tek "Genel" kalemine toplanıyordu; içindeki tek bir sorunlu paragraf — sır, ele geçirme — kalemin tamamını QR'dan ve rezervasyon
    // öncesinden düşürürdü, ilgisiz konular da tek parçada getirilirdi). Kategorili paragraflar belge boyunca konularında toplanır.
    let key = `c:${category}`;
    if (category === "general") {
      if (!generalRun || generalRun.page !== b.page || generalRun.last !== b.index - 1) generalRun = { key: `g:${b.index}`, page: b.page, last: b.index };
      generalRun.last = b.index;
      key = generalRun.key;
    } else {
      generalRun = null;
    }
    const s = sections.get(key) ?? { category, blocks: [] };
    s.blocks.push(b.index);
    sections.set(key, s);
  }
  return [...sections.values()]
    .filter((s) => s.blocks.length > 0)
    .map((s) => ({ category: s.category ?? "general", blocks: s.blocks, ...(s.headingBlock !== undefined ? { headingBlock: s.headingBlock } : {}) }));
}

/**
 * placeholder = doldurulmamış alan ("[ŞİFRE]", "{kod}", "____") ya da misafire giden şablon metni ("Sayın {isim}, …") · property_field = yalnız
 * giriş / çıkış saati (daire ayarı önerisi) · hijack = talimat ele geçirme ("ignore previous instructions …"; kayıt olmaz, ev sahibine
 * gösterilir) · unassigned = hiçbir konuya bağlanmadı.
 */
export type SkipReason = "placeholder" | "property_field" | "hijack" | "unassigned";
/** Taslak işaretleri: taslak kapısının işaretleri + `access` (kapı / anahtar / kilit bilgisi; misafire yalnız onaylı konaklamada verilir). */
export type ImportDraftFlag = DraftFlag | "access";

export interface ImportDraft {
  category: KbCategory;
  title: string;
  content: string;
  /** İçeriği oluşturan blokların numaraları (belge sırasıyla). */
  blocks: number[];
  pages: { first: number; last: number };
  /** PII'siz kaynak işaretçisi (`KnowledgeBaseItem.sourceRef`): belge özeti + sayfa aralığı. */
  sourceRef: string;
  /** İçerikte giriş / çıkış saati de geçiyor (daire ayarıyla karşılaştırılmalı). */
  mentionsPropertyField: boolean;
  /** Taslak kapısının bloklarda bulduğu işaretler (ödeme, hassas veri …) + erişim; boşsa sorun yok. İşaretli taslak tek tıkla onaya girmez. */
  flags: ImportDraftFlag[];
}

export interface ImportPlan {
  drafts: ImportDraft[];
  skipped: { block: number; reason: SkipReason }[];
  /** Daire ayarına öneri (kalem DEĞİL): giriş / çıkış saati. */
  fields: (KbFieldSuggestion & { block: number })[];
  /** Kullanılamayan bölümler (geçersiz kategori / blok) — blokları `skipped`te "unassigned" olarak da görünür. */
  problems: { section: number; reason: "invalid_category" | "invalid_block" }[];
}

/**
 * Yer tutucu TEK KAYNAKTAN (`kb-placeholders.ts`; Bilgi Tabanı ekranının "Doldurulmamış alan" rozeti, istem notu ve gönderim kapısı da aynı
 * yüklemi okur): doldurulmamış alan ya da misafire giden şablon belirteci ("{isim}", "{daire}" — o metin otomatik mesajdır, bilgi değil).
 */
/** Kapı sonucu ya da metin erişim / ele geçirme izi taşıyor mu (paragraf paragraf ayırma gerekir). */
function hasAccessTrace(gate: ReturnType<typeof gateDraft>, text: string): boolean {
  return !gate.ok || gate.flags.includes("door_mention") || ACCESS_WORDS.test(foldTurkishAscii(text));
}

function hasPlaceholder(text: string): boolean {
  return kbPlaceholderTokens(text).length > 0 || unfilledTemplateTokens(text).length > 0 || leftoverGuestTokens(text).length > 0;
}

/**
 * Erişim bilgisi (kod olmasa da): anahtar / kilit / anahtar kutusu / tuş takımı. Taslak kapısının kapı kodu ve "kapı / kutu + kod / şifre"
 * okuyucusuna EK — "Anahtar saksının altında." kod taşımaz ama yine QR misafirine ve aday misafire açılmamalı. Katlanmış metinde sözcük başı,
 * sınırlı ek (doğrusal).
 */
const ACCESS_WORDS =
  /(?<![\p{L}\p{N}])(?:anahtar\p{L}{0,10}|kilit(?:li|ler|leri)?|kilid[iı]n?|(?:keybox|key box|key safe|lockbox|lock box|keypad|tus takimi|smart lock|akilli kilit|schlussel|boite a cles?)\p{L}{0,10})(?![\p{L}\p{N}])/u;

/** Paragrafta yalnız giriş / çıkış saati mi var (kalan sözcükler 12 harften az), hangi alan önerileri çıkıyor. */
function propertyFieldsOf(text: string): { fields: KbFieldSuggestion[]; fieldOnly: boolean } {
  const fields = extractKbSuggestions(text).fields;
  if (fields.length === 0) return { fields, fieldOnly: false };
  const rest = text
    .split(/[,;]|\.\s+|\s[-–—]\s|\s(?:ve|and)\s|\n/i)
    .filter((clause) => extractKbSuggestions(clause).fields.length === 0)
    .join(" ");
  return { fields, fieldOnly: (rest.match(/\p{L}/gu) ?? []).length < 12 };
}

/**
 * Bölümlerden taslak kalemler kurar. İçerik = blokların metni, belge sırasıyla, aralarında boş satır. Bölümdeki tek bir geçersiz / tekrar
 * eden / başka bölümün kullandığı blok numarası BÜTÜN bölümü düşürür (kapalı hata yönü: yarım ya da karışık konu taslak olmaz).
 */
export function assembleDrafts(doc: SplitDocument, sections: readonly DraftSection[]): ImportPlan {
  const used = new Set<number>();
  const drafts: ImportDraft[] = [];
  const skipped: ImportPlan["skipped"] = [];
  const fields: ImportPlan["fields"] = [];
  const problems: ImportPlan["problems"] = [];
  const hash = doc.docHash.slice(0, 16);
  const accessBlocks: number[] = [];
  const accessFlags = new Set<ImportDraftFlag>();
  // Aynı metnin kapı sonucu bir kez hesaplanır (tekrarlanan paragraf / başlık).
  const gateCache = new Map<string, ReturnType<typeof gateDraft>>();
  const gateOf = (title: string, text: string) => {
    const key = `${title}\n${text}`;
    let g = gateCache.get(key);
    if (!g) gateCache.set(key, (g = gateDraft(title, text)));
    return g;
  };
  sections.forEach((section, si) => {
    if (!IMPORTABLE.has(section.category)) {
      problems.push({ section: si, reason: "invalid_category" });
      return;
    }
    const own = new Set<number>();
    const valid = section.blocks.every((i) => {
      const ok = Number.isInteger(i) && doc.blocks[i]?.kind === "body" && !used.has(i) && !own.has(i);
      own.add(i);
      return ok;
    });
    if (!valid || section.blocks.length === 0) {
      problems.push({ section: si, reason: "invalid_block" });
      return;
    }
    const ordered = [...section.blocks].sort((a, b) => a - b);
    const candidates: number[] = [];
    const withField = new Set<number>();
    for (const i of ordered) {
      used.add(i);
      const text = doc.blocks[i].text;
      if (hasPlaceholder(text)) {
        skipped.push({ block: i, reason: "placeholder" });
        continue;
      }
      const pf = propertyFieldsOf(text);
      fields.push(...pf.fields.map((f) => ({ ...f, block: i })));
      if (pf.fieldOnly) {
        skipped.push({ block: i, reason: "property_field" });
        continue;
      }
      if (pf.fields.length > 0) withField.add(i);
      candidates.push(i);
    }
    // Taslak kapısı önce BÖLÜMÜN TAMAMINA bir kez (süre: 18.000 kısa paragraflık belge 18.000 çağrı yapıyordu); bölümde ele geçirme / kapı kodu /
    // kapı-kutu + şifre / anahtar-kilit izi YOKSA paragraflara tek tek bakılmaz (hiçbiri o izi taşıyamaz). İz varsa paragraf paragraf ayrılır.
    const title = DEFAULT_TITLES[section.category] ?? "Genel";
    const whole = candidates.map((i) => doc.blocks[i].text).join("\n\n");
    const sectionGate = candidates.length > 0 ? gateOf(title, whole) : null;
    const parts: number[] = [];
    const flags = new Set<ImportDraftFlag>();
    if (sectionGate && sectionGate.ok && !hasAccessTrace(sectionGate, whole)) {
      parts.push(...candidates);
      for (const f of sectionGate.flags) flags.add(f);
    } else {
      for (const i of candidates) {
        const text = doc.blocks[i].text;
        const gate = gateOf(title, text);
        if (!gate.ok && gate.reason === "hijack") {
          skipped.push({ block: i, reason: "hijack" });
          continue;
        }
        // Kapı kodu / kilit bağlamında kod / kapı-kutu + şifre / anahtar-kilit sözcüğü → "Giriş Talimatı" taslağına (↑dosya başı R1).
        if (hasAccessTrace(gate, text)) {
          accessBlocks.push(i);
          for (const f of gate.ok ? gate.flags : []) accessFlags.add(f);
          continue;
        }
        for (const f of gate.ok ? gate.flags : []) flags.add(f);
        parts.push(i);
      }
    }
    if (parts.length === 0) return;
    const category = section.category as KbCategory;
    const hb = section.headingBlock !== undefined ? doc.blocks[section.headingBlock] : undefined;
    const heading = hb?.kind === "heading" && hb.heading && hb.heading.length >= 2 ? hb.heading : null;
    const baseTitle = heading ?? DEFAULT_TITLES[category] ?? "Genel";
    pushDrafts(category, baseTitle, parts, parts.some((i) => withField.has(i)), [...flags]);
  });
  // Erişim blokları (bütün bölümlerden) TEK "Giriş Talimatı" taslağında, belge sırasıyla; tavanı aşarsa parçalara bölünür.
  if (accessBlocks.length > 0) {
    const ordered = [...accessBlocks].sort((a, b) => a - b);
    const mentions = ordered.some((i) => extractKbSuggestions(doc.blocks[i].text).fields.length > 0);
    pushDrafts("checkin", DEFAULT_TITLES.checkin ?? "Giriş Talimatı", ordered, mentions, ["access", ...accessFlags]);
  }
  for (const b of doc.blocks) if (b.kind === "body" && !used.has(b.index)) skipped.push({ block: b.index, reason: "unassigned" });
  skipped.sort((a, b) => a.block - b.block);
  return { drafts, skipped, fields, problems };

  function pushDrafts(category: KbCategory, baseTitle: string, parts: readonly number[], mentionsPropertyField: boolean, flags: ImportDraftFlag[]) {
    // Tavanı aşan konu blok sınırında sıralı parçalara bölünür.
    const groups: number[][] = [[]];
    let size = 0;
    for (const i of parts) {
      const len = doc.blocks[i].text.length + 2;
      if (size + len > KB_IMPORT_ITEM_MAX_CHARS && groups[groups.length - 1].length > 0) {
        groups.push([]);
        size = 0;
      }
      groups[groups.length - 1].push(i);
      size += len;
    }
    groups.forEach((g, gi) => {
      const pages = g.map((i) => doc.blocks[i].page);
      const first = Math.min(...pages);
      const last = Math.max(...pages);
      drafts.push({
        category,
        title: groups.length > 1 ? `${baseTitle} (${gi + 1}/${groups.length})` : baseTitle,
        content: g.map((i) => doc.blocks[i].text).join("\n\n"),
        blocks: g,
        pages: { first, last },
        sourceRef: `doc:${hash}:p${first}-${last}`,
        mentionsPropertyField,
        flags,
      });
    });
  }
}

/** Taslağın içeriği belgenin bloklarının AYNEN birleşimi mi (model bilgi yazamaz değişmezi; sunucu kaydetmeden önce yeniden sınar). */
export function draftIsVerbatim(doc: SplitDocument, draft: Pick<ImportDraft, "content" | "blocks">): boolean {
  if (draft.blocks.length === 0) return false;
  const texts = draft.blocks.map((i) => (doc.blocks[i]?.kind === "body" ? doc.blocks[i].text : null));
  return texts.every((t) => t !== null) && texts.join("\n\n") === draft.content;
}

/** Uçtan uca modelsiz plan: böl → başlıkla ayır → taslak. */
export function planDocumentImport(pages: readonly DocPage[]): ImportPlan & { truncated: boolean; docHash: string } {
  const doc = splitDocument(pages);
  return { ...assembleDrafts(doc, sectionByHeadings(doc)), truncated: doc.truncated, docHash: doc.docHash };
}
