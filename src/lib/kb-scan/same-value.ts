import { foldTurkishAscii } from "@/lib/ai/fallback";
import { foldForSecretScan } from "@/lib/unicode-digits";

// ---------------------------------------------------------------------------
// BİLGİ TABANI TARAMASI — AYNI DEĞER İKİ DAİREDE (T6; kurucu etiket notu 10-23 "yanlis-numara": "aynı numarada farklı daireler için varsa
// hemen kbden farkedilip hosta sorulsun … çakışma tehlikesi olabilir hostun cevabına göre sorun yok diyebilir"). Tasarım:
// `docs/TASARIM-2026-10-23-bilgi-tabani-dosya-rag-ve-tarama.md` §5. SAF ve hiçbir yüzeye BAĞLI DEĞİL: yalnız ADAY bulur; ev sahibine soru,
// günlük sınır ve "böyle kalsın" kaydı ikinci aşama (kalıcı soru kaydı migration ister).
//
// Yalnız ETİKETLİ değerler okunur — çıplak sayı değil: otopark yeri ("12 numaralı yer", "Park yeri: B-14", "parking spot 7") ve giriş kodu
// ("kapı kodu 4590", "anahtar kutusu şifresi: 1234"). Saat, tutar, süre, kat, kişi sayısı değer sayılmaz. Aynı daire içinde tekrar bulgu
// DEĞİLDİR. Her pencere sabit uzunlukta (≤ 40 karakter) → uzun metinde doğrusal.
// ---------------------------------------------------------------------------

export type SameValueKind = "parking_spot" | "access_code";

export interface ScanKbItem {
  id: string;
  propertyId: string;
  title: string;
  content: string;
}

export interface LabeledValue {
  kind: SameValueKind;
  value: string;
}

export interface SameValueFinding extends LabeledValue {
  /** Değeri taşıyan kalemler; en az iki FARKLI daire. Daire ve kalem kimliğine göre sıralı. */
  items: { propertyId: string; itemId: string }[];
}

/** Taranan metin tavanı (kalem içeriği 20.000 + başlık); üstü okunmaz. */
const SCAN_MAX_CHARS = 24_000;
const WINDOW = 40;

const PARKING_LABEL = /otopark|park yeri|park alani|park numarasi|parking(?: spot| space| place)?|garaj|garage|stellplatz|parkplatz/g;
/** Etiketten sonraki pencerede numaralandırılmış yer: "no: 12" · "12 numarali" · "B-14" · "spot 7" · "yer 12". */
const PARKING_VALUE =
  /(?:\b(?:no|nr|numara(?:si|li|miz|niz)?|number|nummer|numero|spot|space|yer(?:i|imiz)?|alan(?:i)?|platz)\s*[:.#]?\s*([a-z]?-?\d{1,4}[a-z]?)\b(?![:.,]\d)|\b(\d{1,4})\s*(?:numarali|nolu|no'lu|numbered)[a-z]{0,4}\b|(?:^|[\s,;:(])([a-z]-?\d{1,3})\b)/;
const ACCESS_LABEL =
  /kapi(?:si|nin|ni)? (?:kodu|sifresi)|giris (?:kodu|sifresi)|bina (?:kapisi )?(?:kodu|sifresi)|anahtar kutusu(?: kodu| sifresi)?|kutu (?:kodu|sifresi)|kasa (?:kodu|sifresi)|tuslu kilit|door code|gate code|entry code|building code|lock ?box(?: code)?|key ?box(?: code)?|keypad(?: code)?|turcode|tuercode/g;
/** Telefon öbeği ("0532 123 45 67") kod değildir: değerden sonra boşluk + rakam gelmez. */
const ACCESS_VALUE = /(?<![\d+])(\d{4,8})(?!\d|[:.,]\d|\s\d)/;

/** Değerin hemen arkasından gelen birim: saat / tutar / süre / kat / kişi — numara değildir. */
const NOT_A_NUMBER_AFTER = /^\s*(?:tl|try|lira|eur|euro|usd|\$|€|₺|%|dk|dakika|min|saat|hour|gun|day|gece|night|kat|floor|kisi|person|arac|car|m(?:2|²)?(?![a-z])|km|metre|meter)/;
/** Pencere ilk cümle sınırında biter ("Anahtar kutusu girişte. Wi-Fi şifresi 12345678." — Wi-Fi şifresi kod sayılmasın); "no. 12" bölünmez. */
const SENTENCE_END = /[!?\n]|\.\s+(?=\p{L}{2})/u;

function scanLabels(text: string, label: RegExp, value: RegExp, kind: SameValueKind, out: Map<string, LabeledValue>): void {
  const re = new RegExp(label.source, "g");
  for (const m of text.matchAll(re)) {
    const start = (m.index ?? 0) + m[0].length;
    const ahead = text.slice(start, start + WINDOW);
    const stop = SENTENCE_END.exec(ahead);
    const window = stop ? ahead.slice(0, stop.index) : ahead;
    const v = value.exec(window);
    if (!v) continue;
    const raw = v[1] ?? v[2] ?? v[3];
    if (!raw) continue;
    const after = window.slice((v.index ?? 0) + v[0].length);
    if (NOT_A_NUMBER_AFTER.test(after)) continue;
    const norm = raw.replace(/-/g, "").toUpperCase();
    out.set(`${kind}|${norm}`, { kind, value: norm });
  }
}

/** Metindeki etiketli değerler (tekilleştirilmiş). Unicode rakamlar ASCII'ye iner, Türkçe harfler katlanır. */
export function labeledValues(raw: string): LabeledValue[] {
  const text = foldTurkishAscii(foldForSecretScan(raw.slice(0, SCAN_MAX_CHARS)));
  const out = new Map<string, LabeledValue>();
  scanLabels(text, PARKING_LABEL, PARKING_VALUE, "parking_spot", out);
  scanLabels(text, ACCESS_LABEL, ACCESS_VALUE, "access_code", out);
  return [...out.values()];
}

/** Aynı etiketli değeri taşıyan, en az iki FARKLI dairedeki kalemler. Çağıran yalnız etkin + onaylı kalemleri verir. */
export function sameValueAcrossProperties(items: readonly ScanKbItem[]): SameValueFinding[] {
  const byValue = new Map<string, { value: LabeledValue; items: Map<string, { propertyId: string; itemId: string }> }>();
  for (const item of items) {
    for (const v of labeledValues(`${item.title}\n${item.content}`)) {
      const key = `${v.kind}|${v.value}`;
      const entry = byValue.get(key) ?? { value: v, items: new Map() };
      entry.items.set(item.id, { propertyId: item.propertyId, itemId: item.id });
      byValue.set(key, entry);
    }
  }
  const findings: SameValueFinding[] = [];
  for (const { value, items: hits } of byValue.values()) {
    const list = [...hits.values()];
    if (new Set(list.map((h) => h.propertyId)).size < 2) continue;
    list.sort((a, b) => a.propertyId.localeCompare(b.propertyId) || a.itemId.localeCompare(b.itemId));
    findings.push({ ...value, items: list });
  }
  return findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
}
