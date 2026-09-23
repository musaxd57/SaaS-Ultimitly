// ---------------------------------------------------------------------------
// SAAT ALANLARI — TEK KAYNAK (09-23). Bir KB metnindeki saatleri ALANA (giriş / çıkış / sessiz
// saat / havuz / spor salonu / temizlik / erken giriş / geç çıkış) atfeder ve iki saat kümesinin
// ya da KB ile mülk ayarının ÇELİŞİP çelişmediğine karar verir. Üç tüketici AYNI kuralı kullanır:
//   · retrieval çelişki koruması (`rerank.preserveTimeConflicts`),
//   · istemdeki KB ↔ mülk ayarı çelişki bloğu (`prompts.findTimeConflicts`),
//   · host'a gösterilen "Uyuşmayan saatler" raporu (`kb-time-conflicts.ts`).
// Eskiden İKİ ayrı kural vardı (retrieval alan bazlı, istem KATEGORİ bazlı) ve ikisi de ölçülmüş
// yanlış pozitif üretiyordu (09-23 ajan ölçümü, 46 kalem çifti + 28 kalem↔mülk vakası):
//   · istem: "Giriş 15:00, çıkış 11:00." yazan (mülkle UYUMLU) bir giriş kalemi "giriş saati:
//     ayar 15:00, bilgi tabanı 11:00" çelişkisi üretiyor, blok "güveni 0.75 altında tut" dediği için
//     uyumlu KB'li 7 kalemlik bir mülkte Wi-Fi/otopark sorularının 3/3'ü İNSANA düşüyordu;
//   · retrieval: 46 çiftte 18 yanlış alarm (erken giriş/geç çıkış saati, "bina girişi",
//     "acil çıkış", "çıkış günü", aralık inceltmesi, "12:00. Çıkış" nokta bölmesi, "3:00 PM").
//
// SAF: DB/ağ yok. Değişiklik = canlı AI davranışı → golden set + E7/R5 kontrolü ŞART.
// ---------------------------------------------------------------------------

import { contentStems, tokenize } from "./text";
import { matchConcepts, timeFieldsIn } from "./lexicon";

/** Alan → o alana atfedilen saatler ("SS:DD"). */
export type FieldTimes = ReadonlyMap<string, ReadonlySet<string>>;

/** Tek bir saat atfı: nereden geldiği (cümlecik mi başlık mı) ve hangi cümlecikte geçtiği. */
export interface FieldTimeHit {
  field: string;
  time: string;
  /** "clause" = cümleciğin kendisi alanı adlandırıyor · "title" = başlığın alanından ödünç. */
  via: "clause" | "title" | "category";
  clause: string;
}

/**
 * Cümlecik sınırı: nokta (ardından RAKAM gelmiyorsa) / ünlem / soru / noktalı virgül / virgül / satır.
 * 🚨 Eski kalıp `(?<!\d)\.(?!\d)` rakamdan SONRA gelen noktayı sınır saymıyordu → "Giriş 15:00.
 * Çıkış 11:00." TEK cümlecik olup iki alanı birden taşıyor ve iki saat de düşüyordu. "12.00"
 * yazımı yine bölünmez (noktanın ardında rakam var).
 */
const CLAUSE_SPLIT = /\.(?!\d)|[!?;,\n]+/;
const HHMM_G = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(\s*(?:a\.m\.|p\.m\.|am|pm)(?![a-z]))?/gi;
/** "11am", "3 pm" — dakikasız 12 saat biçimi. Önünde ":"/"." varsa DEĞİL ("10:10 am"deki "10 am"). */
const HOUR_AMPM_G = /(?<![:.\d])\b(1[0-2]|0?[1-9])\s*(a\.m\.|p\.m\.|am|pm)(?![a-z])/gi;
/**
 * "saat 11'e kadar" — dakikasız Türkçe saat. YALNIZ 10–23: "saat 3" günlük dilde çoğu zaman 15:00
 * demektir; 03:00 diye okumak mülk ayarı 15:00 ile SAHTE çelişki üretirdi (belirsizde hüküm yok).
 */
const SAAT_HOUR_G = /\bsaat\s+(1\d|2[0-3])(?![\d:.])/gi;

function to24(h: number, marker: string | undefined): number {
  if (!marker) return h;
  const pm = /^p/i.test(marker.trim());
  if (pm && h < 12) return h + 12;
  if (!pm && h === 12) return 0;
  return h;
}
const pad = (h: number, m: string) => `${String(h).padStart(2, "0")}:${m}`;

/** Metindeki saatler, "SS:DD" biçiminde (am/pm 24 saate çevrilir). */
export function timesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(HHMM_G)) out.add(pad(to24(Number(m[1]), m[3]), m[2]));
  for (const m of text.matchAll(HOUR_AMPM_G)) out.add(pad(to24(Number(m[1]), m[2]), "00"));
  for (const m of text.matchAll(SAAT_HOUR_G)) out.add(pad(Number(m[1]), "00"));
  return out;
}

/**
 * "Bina girişi / otoparka giriş / siteye giriş / otopark çıkışı" — konaklama giriş/çıkışı değil, bir
 * KAPI. 🚨 KÖK ÖNEKİYLE eşleşir (inceleme 09-23 ölçtü): tam-kelime kümesi "otoparka", "siteye",
 * "otopark çıkışı" biçimlerini kaçırıyor ve "Otoparka giriş 23:00'ten sonra kapalıdır" mülkün giriş
 * saatiyle ÇELİŞKİ sayılıyordu → uyumlu KB'de her soru insana devrediliyordu.
 */
const PLACE_HEAD_STEMS = ["bina", "otopark", "site", "havuz", "apartman", "garaj", "park", "bahce", "lobi", "bodrum", "blok", "sokak", "resepsiyon"];
/** Kısa yön sözcükleri önek OLAMAZ ("on" → "onu", "ana" → "anahtar"): yalnız tam eşleşme. */
const PLACE_HEAD_EXACT = new Set(["ana", "arka", "on", "yan", "kat", "main", "back", "front", "side"]);
const isPlaceHead = (t: string) => PLACE_HEAD_EXACT.has(t) || PLACE_HEAD_STEMS.some((h) => t.startsWith(h));
/** Kendi çalışma saati olan yerler (kalemin konaklama saatine ödünç verilmez). */
const OWN_HOURS_STEMS = ["resepsiyon", "reception", "danisma", "concierge", "ofis", "office", "lobi", "lobby", "guvenlik", "security", "kapici"];
/** "Acil çıkış / yangın çıkışı" — konaklama ÇIKIŞI değil, bir KAPI. */
const EXIT_HEADS = new Set(["acil", "yangin", "emergency", "fire"]);
/** "Erken giriş / geç çıkış" AYRI alandır: mülkün giriş/çıkış saatiyle KIYASLANMAZ. */
const MODIFIERS: Record<string, "early" | "late"> = { erken: "early", early: "early", gec: "late", late: "late" };
const isIn = (t: string) => t.startsWith("giris") || t === "checkin" || t.startsWith("arrival");
const isOut = (t: string) => t.startsWith("cikis") || t === "checkout" || t.startsWith("departure");
const TIME_TOKEN = /^\d{2}:\d{2}$/;

function clauseFields(clause: string): { fields: string[]; otherConcept: boolean } {
  const toks = tokenize(clause);
  const keep: string[] = [];
  const extra: string[] = [];
  // Cümlecik bir KAPI / GÜN'den söz ediyorsa ("bina girişi", "acil çıkış", "çıkış günü") başka bir
  // konudan söz ediyordur: başlığın alanı ÖDÜNÇ ALINMAZ ("Giriş" başlıklı kalemde "Bina girişi
  // 23:00'te kilitlenir" giriş saati DEĞİL — ölçüldü, ödünçle sahte çelişki üretiyordu).
  let homonym = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const prev = toks[i - 1] ?? "";
    const next = toks[i + 1] ?? "";
    // Saatin hemen ardındaki kısa ek belirteci ("23:00'te" → "te") bir kavram ateşlemesin
    // ("te" → çay/tea; ölçüldü: saat yazılı her parça kahve sorusuna çekiliyordu).
    if (TIME_TOKEN.test(prev) && t.length <= 3) continue;
    if (isIn(t) || isOut(t)) {
      if (isIn(t) && (isPlaceHead(prev) || next.startsWith("kapi"))) {
        homonym = true;
        continue;
      }
      // "Çıkış kapısı" yalnız YALIN biçimde kapıdır ("Çıkışta kapıyı kilitleyin" konaklama çıkışıdır).
      if (isOut(t) && (EXIT_HEADS.has(prev) || isPlaceHead(prev) || ((t === "cikis" || t === "exit") && next.startsWith("kapi")))) {
        homonym = true;
        continue;
      }
      // "giriş günü / çıkış günü" = GÜN, saat değil.
      if (next.startsWith("gun")) {
        homonym = true;
        continue;
      }
      // "en geç çıkış" = en son çıkış saati (çıkış alanı); "geç çıkış" = ayrı alan.
      const mod = MODIFIERS[prev];
      if (mod && toks[i - 2] !== "en") {
        const f = `${mod}_${isIn(t) ? "checkin" : "checkout"}`;
        if (!extra.includes(f)) extra.push(f);
        continue;
      }
    }
    keep.push(t);
  }
  const stems = contentStems(keep.join(" "));
  const fields = [...timeFieldsIn(stems), ...extra];
  // Kendi çalışma saati olan yerler sözlükte kavram değil ama konaklama saati de DEĞİL: "Giriş"
  // başlıklı kalemde "Resepsiyon 09:00-18:00 arası açıktır" giriş saati sanılıyordu (ölçüldü 09-23).
  const ownHours = toks.some((t) => OWN_HOURS_STEMS.some((h) => t.startsWith(h)));
  const otherConcept = homonym || ownHours || matchConcepts(stems).some((m) => !m.concept.timeField);
  return { fields, otherConcept };
}

/**
 * SAAT → ALAN ATFI. Her saat içinde geçtiği CÜMLECİĞİN alanına bağlanır; cümlecik iki alan
 * adlandırıyorsa "ve/and/&" ile bir kez daha bölünür; hâlâ birden çoksa saat HİÇBİR alana
 * atfedilmez (belirsizde hüküm yok). Cümlecik alan adlandırmıyorsa başlığın TEK alanı ödünç
 * alınır — ama cümlecik BAŞKA bir konudan söz ediyorsa ("Kahvaltı 08:00'de") ödünç ALINMAZ.
 */
export function fieldTimeHits(title: string, text: string, category?: string | null): FieldTimeHit[] {
  const titleFields = clauseFields(title).fields;
  const titleField = titleFields.length === 1 ? titleFields[0] : null;
  // KATEGORİ ÖDÜNCÜ — en zayıf dayanak, en son (inceleme 09-23): "Varış bilgileri" başlıklı `checkin`
  // kalemindeki "14:00'ten sonra gelebilirsiniz" hiçbir alan adlandırmıyor; kategori bilgisi atılınca
  // mülkün 15:00'ı ile GERÇEK çelişki kaçıyordu. Yalnız cümlecik ve başlık alan adlandırmıyorsa ve
  // cümlecik başka bir konudan söz etmiyorsa kullanılır (başlık ödüncüyle aynı kural).
  const categoryField = category === "checkin" || category === "checkout" ? category : null;
  const clauses: string[] = [];
  // "p.m." noktaları cümlecik sınırı sanılmasın (işaret kaybolur, 15:00 → 03:00 okunurdu).
  const flat = text.replace(/\b([ap])\.m\./gi, "$1m");
  for (const c of flat.split(CLAUSE_SPLIT)) {
    if (clauseFields(c).fields.length > 1) clauses.push(...c.split(/\s(?:ve|and|&)\s/i));
    else clauses.push(c);
  }
  const hits: FieldTimeHit[] = [];
  for (const clause of clauses) {
    const ts = timesIn(clause);
    if (ts.size === 0) continue;
    const { fields, otherConcept } = clauseFields(clause);
    let field: string | null = null;
    let via: FieldTimeHit["via"] = "clause";
    if (fields.length === 1) field = fields[0];
    else if (fields.length === 0 && titleField && !otherConcept) {
      field = titleField;
      via = "title";
    } else if (fields.length === 0 && titleFields.length === 0 && categoryField && !otherConcept) {
      field = categoryField;
      via = "category";
    }
    if (!field) continue;
    for (const time of ts) hits.push({ field, time, via, clause: clause.trim() });
  }
  return hits;
}

/** Parça başına: alan → saatler (retrieval tüketicisi; başlık ödüncü DAHİL — temkinli taraf). */
export function extractFieldTimes(title: string, text: string, category?: string | null): FieldTimes {
  const out = new Map<string, Set<string>>();
  for (const h of fieldTimeHits(title, text, category)) {
    const set = out.get(h.field) ?? new Set<string>();
    set.add(h.time);
    out.set(h.field, set);
  }
  return out;
}

/**
 * İki saat kümesi ÇELİŞİR ⇔ ikisi de dolu ve hiçbiri ötekini KAPSAMIYOR. Simetrik (eski kural
 * çapa sırasına göre farklı hüküm veriyordu). "22:00-08:00" ile "22:00" çelişmez (inceltme);
 * "11:00" ile "12:00" çelişir.
 */
export function timeSetsConflict(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const aInB = [...a].every((t) => b.has(t));
  const bInA = [...b].every((t) => a.has(t));
  return !aInB && !bInA;
}

/** Mülk ayarındaki saat "SS:DD" (ya da "S:DD") değilse hüküm verilmez → null. */
export function normalizePropertyTime(value: string | null | undefined): string | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((value ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** Mülk ayarı ile karşılaştırılan alanlar — erken giriş/geç çıkış BİLEREK yok. */
export const PROPERTY_TIME_FIELDS = [
  { field: "checkin", property: "checkInTime" },
  { field: "checkout", property: "checkOutTime" },
] as const;

/**
 * KB saatleri mülk ayarıyla UYUŞMUYOR mu? Kural: alanın saat kümesi doluysa mülk ayarının
 * değeri o kümenin İÇİNDE olmalı ("15:00'ten itibaren, en geç 22:00" → {15:00, 22:00} ayarla
 * uyumlu). Uyuşmayan saatler (ayar hariç) döner.
 */
export function propertyTimeMismatch(times: ReadonlySet<string> | undefined, propertyValue: string | null): string[] {
  if (!propertyValue || !times || times.size === 0 || times.has(propertyValue)) return [];
  return [...times].filter((t) => t !== propertyValue).sort();
}
