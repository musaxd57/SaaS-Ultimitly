// ---------------------------------------------------------------------------
// "UYUŞMAYAN SAATLER" — host'a bilgi tabanındaki saat çelişkileri (P4-b'nin ikinci yarısı, 09-23).
//
// Kurucu kararı (P4-b, 09-09): KB ile mülk ayarı (ya da iki KB kalemi) farklı saat söylüyorsa
// misafire kesin saat verilmez → soru insana gider. Ama host bunu HİÇBİR yerde görmüyordu: AI
// sessizce devrediyor, sebebi ekranda yoktu. Bu modül çelişkiyi DÜZELTMENİN YAPILACAĞI YERDE
// (Bilgi Tabanı sayfası) gösterir.
//
// Kural TEK KAYNAK: `retrieval/time-fields.ts` (retrieval + istem bloğu aynı kuralı kullanır).
// Burada yalnız CÜMLECİĞİN KENDİSİNİN adlandırdığı saatler sayılır (`via === "clause"`): başlık
// ödüncü host raporunda ölçülmüş yanlış alarm üretiyordu (kapı kilidi / resepsiyon saati / çıkış
// günü bagaj). Misafir yolu temkinli tarafta kalır (ödünç DAHİL) — rapor ile istem arasındaki bu
// fark BİLİNÇLİDİR: host'a "yanlışsın" demek için daha güçlü kanıt istenir.
//
// SAF: DB yok. Misafir verisi YOK (yalnız host'un kendi KB metni ve mülk ayarı).
// ---------------------------------------------------------------------------

import {
  fieldTimeHits,
  normalizePropertyTime,
  propertyTimeMismatch,
  timeSetsConflict,
  PROPERTY_TIME_FIELDS,
} from "@/lib/ai/retrieval/time-fields";
import { TIME_FIELD_LABELS } from "@/lib/ai/retrieval/lexicon";
import { dropSuperseded } from "@/lib/ai/retrieval/rerank";
import { isAiReadableReviewState } from "@/lib/kb-review";

export interface KbTimeConflictItem {
  id: string;
  title: string;
  category: string;
  content: string;
}

export interface KbTimeConflictSide {
  itemId: string;
  title: string;
  values: string[];
  /** Saatin geçtiği cümle — host neden işaretlendiğini görsün. */
  sentence: string;
  /** Kalem otomatik giriş/çıkış mesajı olarak misafire AYNEN gidiyor mu. */
  sentAutomatically: boolean;
}

export interface KbTimeConflictRow {
  field: string;
  kind: "property" | "items";
  propertyValue?: string;
  sides: KbTimeConflictSide[];
  /** Host'a gösterilecek sade cümle. */
  text: string;
}

/** Otomatik mesaj olarak misafire AYNEN giden kategoriler (modelden geçmez). */
const AUTO_SENT = new Set(["checkin", "checkout"]);

function capital(s: string): string {
  return s.charAt(0).toLocaleUpperCase("tr") + s.slice(1);
}
/** Satır başlığı: "Çıkış saati", "Sessiz saatler" ("Sessiz saat saati" değil). */
function heading(field: string): string {
  if (field === "quiet_hours") return "Sessiz saatler";
  return `${capital(TIME_FIELD_LABELS[field] ?? field)} saati`;
}

function perItemFieldTimes(item: KbTimeConflictItem): Map<string, { times: Set<string>; sentence: string }> {
  const out = new Map<string, { times: Set<string>; sentence: string }>();
  for (const h of fieldTimeHits(item.title, item.content)) {
    if (h.via !== "clause") continue;
    const cur = out.get(h.field) ?? { times: new Set<string>(), sentence: h.clause };
    cur.times.add(h.time);
    out.set(h.field, cur);
  }
  return out;
}

/**
 * Raporun kapsamı = AI'ın GERÇEKTEN okuduğu kalemler: aktif + onay kapısından geçen (`legacy` /
 * `approved`; taslak DEĞİL) + halefi kümede olmayan. Taslak ya da pasif bir kalem host'a sahte
 * çelişki göstermesin; eski sürümü halefiyle "çelişiyor" diye işaretlenmesin.
 */
export function aiReadableForConflicts<
  T extends KbTimeConflictItem & { isActive: boolean; reviewState: string; updatedAt: Date; supersededById?: string | null },
>(items: readonly T[]): T[] {
  return dropSuperseded(items.filter((i) => i.isActive && isAiReadableReviewState(i.reviewState))).kept;
}

/**
 * Bir mülkün AI'ın okuyabildiği KB kalemleri (aktif + onay kapısından geçen + halefi olmayan —
 * süzmeyi çağıran yapar) ve mülk saatleri → uyuşmayan saat satırları.
 */
export function kbTimeConflicts(
  property: { checkInTime: string | null | undefined; checkOutTime: string | null | undefined },
  items: readonly KbTimeConflictItem[],
): KbTimeConflictRow[] {
  const perItem = items.map((item) => ({ item, fields: perItemFieldTimes(item) }));
  const rows: KbTimeConflictRow[] = [];
  const comparedToProperty = new Set<string>();

  // 1) KB ↔ mülk ayarı (giriş / çıkış).
  for (const { field, property: key } of PROPERTY_TIME_FIELDS) {
    const pv = normalizePropertyTime(property[key]);
    if (!pv) continue;
    comparedToProperty.add(field);
    const sides: KbTimeConflictSide[] = [];
    for (const { item, fields } of perItem) {
      const f = fields.get(field);
      const bad = propertyTimeMismatch(f?.times, pv);
      if (bad.length === 0 || !f) continue;
      sides.push({ itemId: item.id, title: item.title, values: bad, sentence: f.sentence, sentAutomatically: AUTO_SENT.has(item.category) });
    }
    if (sides.length === 0) continue;
    const where = sides.map((s) => `“${s.title}” bilgisinde ${s.values.join(" / ")}`).join(", ");
    rows.push({
      field,
      kind: "property",
      propertyValue: pv,
      sides,
      text: `${heading(field)}: mülk ayarlarında ${pv}, ${where} yazıyor. Doğru olan hangisiyse diğerini düzeltin.`,
    });
  }

  // 2) KB ↔ KB (mülk ayarıyla karşılaştırılmayan alanlar: sessiz saat, havuz, temizlik, …).
  const fieldsSeen = new Set<string>();
  for (const { fields } of perItem) for (const f of fields.keys()) fieldsSeen.add(f);
  for (const field of [...fieldsSeen].sort()) {
    if (comparedToProperty.has(field)) continue;
    const holders = perItem
      .map(({ item, fields }) => ({ item, f: fields.get(field) }))
      .filter((x): x is { item: KbTimeConflictItem; f: { times: Set<string>; sentence: string } } => Boolean(x.f));
    const involved = new Set<number>();
    for (let i = 0; i < holders.length; i++) {
      for (let j = i + 1; j < holders.length; j++) {
        if (timeSetsConflict(holders[i].f.times, holders[j].f.times)) {
          involved.add(i);
          involved.add(j);
        }
      }
    }
    if (involved.size < 2) continue;
    const sides = [...involved].sort((a, b) => a - b).map((i) => ({
      itemId: holders[i].item.id,
      title: holders[i].item.title,
      values: [...holders[i].f.times].sort(),
      sentence: holders[i].f.sentence,
      sentAutomatically: AUTO_SENT.has(holders[i].item.category),
    }));
    const where = sides.map((s) => `“${s.title}” bilgisinde ${s.values.join(" / ")}`).join(", ");
    rows.push({
      field,
      kind: "items",
      sides,
      text: `${heading(field)}: ${where} yazıyor. Misafire yanlış saat söylenebilir; birini düzeltin.`,
    });
  }
  return rows;
}
