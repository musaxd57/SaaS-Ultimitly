import type { IcsReservation } from "@/lib/import/ics";

// ---------------------------------------------------------------------------
// AYNI UID'NİN SATIRLARI — TEK ETKİN SATIRA ÇÖZÜM (Tur 7 CAL-2, kurucu onayı 11-05; Codex görüşüyle). Saf, veritabanısız.
//
// Eski kural "bir geçişte UID başına İLK satır" idi (inceleme b1, 09-30 — çalkantıya karşı). Sıraya bağlıydı: aynı UID'nin
// STATUS:CANCELLED kopyası (tekrar örneğinin iptali ya da eski sürüm) canlı satırdan ÖNCE gelirse rezervasyon iptal oluyor / hiç
// alınmıyordu → dışa aktarılan takvim o geceleri bırakıyordu (çift rezervasyon riski). RFC 5545 VEVENT sırasını sabitlemez. Kurallar:
//  · Ana kayıt (RECURRENCE-ID'siz) ile tekrar örneği ayrı değerlendirilir. Ana kaydın KENDİ STATUS:CANCELLED'ı gerçek iptaldir.
//  · Örnek iptali yalnız o örneği etkiler: tekrar kuralı olmayan (tek seferlik) ana kaydın KENDİ başlangıcındaki örnek tek örnektir →
//    onun iptali / değişikliği rezervasyonun kendisidir. Başka tarihteki örnek ya da kurallı serinin örneği rezervasyona dokunmaz
//    (tekrarlar açılmaz; okuma zaten "tekrarlayan / eksik" işaretli, kaynak `partial` — ev sahibi görür).
//  · Birden fazla ana kayıt: yüksek SEQUENCE, eşitse daha yeni LAST-MODIFIED (yoksa DTSTAMP) kazanır. En yeni sürümde ÇELİŞKİ kalırsa
//    (eşit sürüm, farklı içerik) yıkıcı değişiklik yapılmaz: canlı (iptal olmayan) satır varsa besleme sırasındaki İLK canlı satır
//    alınır (dolu gece; tarihler geçişler arasında gidip gelmez — b1), hepsi iptalse iptal tutarlıdır.
//  · Tekrarlayan ana kayıt ilk örneğiyle DOLU gece olarak alınmaya devam eder (kurucu onayı: boş göstermek çift rezervasyon riski).
//  · Ana kaydı beslemede olmayan örnek(ler): iptal UYGULANMAZ; iptal olmayan ilk örnek dolu gece olarak alınır.
// UID'siz satırlar ve tek satırlı ana kayıtlar aynen geçer; çıktı sırası UID'nin ilk görülme sırasıdır.
// ---------------------------------------------------------------------------

const isCancelled = (r: IcsReservation) => r.status === "CANCELLED";

/** a, b'den yeni mi (>0), eski mi (<0), ayırt edilemez mi (0). */
function compareVersion(a: IcsReservation, b: IcsReservation): number {
  const sa = a.sequence ?? 0;
  const sb = b.sequence ?? 0;
  if (sa !== sb) return sa - sb;
  const ma = a.lastModified?.getTime() ?? Number.NEGATIVE_INFINITY;
  const mb = b.lastModified?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (ma === mb) return 0;
  return ma > mb ? 1 : -1;
}

const sameContent = (a: IcsReservation, b: IcsReservation) =>
  a.arrivalDate.getTime() === b.arrivalDate.getTime() &&
  a.departureDate.getTime() === b.departureDate.getTime() &&
  isCancelled(a) === isCancelled(b);

/** En yeni sürümdeki satırlar (besleme sırasıyla) arasından tek satır; çelişkide yıkıcı olmayan seçim. */
function pickNewest(candidates: IcsReservation[]): IcsReservation {
  let newest: IcsReservation[] = [];
  for (const c of candidates) {
    if (newest.length === 0) newest = [c];
    else {
      const cmp = compareVersion(c, newest[0]);
      if (cmp > 0) newest = [c];
      else if (cmp === 0) newest.push(c);
    }
  }
  if (newest.every((n) => sameContent(n, newest[0]))) return newest[0];
  return newest.find((n) => !isCancelled(n)) ?? newest[0];
}

const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime() || a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

export function resolveIcsUidGroups(events: readonly IcsReservation[]): IcsReservation[] {
  const groups = new Map<string, IcsReservation[]>();
  const order: Array<string | IcsReservation> = [];
  for (const ev of events) {
    const uid = ev.sourceReference;
    if (!uid) {
      order.push(ev);
      continue;
    }
    const g = groups.get(uid);
    if (g) g.push(ev);
    else {
      groups.set(uid, [ev]);
      order.push(uid);
    }
  }
  const out: IcsReservation[] = [];
  for (const item of order) {
    if (typeof item !== "string") {
      out.push(item);
      continue;
    }
    const group = groups.get(item)!;
    const masters = group.filter((r) => !r.recurrenceId);
    const instances = group.filter((r) => r.recurrenceId);
    if (masters.length === 0) {
      const live = instances.find((r) => !isCancelled(r));
      if (live) out.push({ ...live, recurrenceId: null });
      continue;
    }
    const master = masters.length === 1 ? masters[0] : pickNewest(masters);
    const ownOccurrence = master.hasRecurrenceRule ? [] : instances.filter((r) => sameDay(r.recurrenceId!, master.arrivalDate));
    out.push(ownOccurrence.length > 0 ? { ...pickNewest(ownOccurrence), recurrenceId: null } : master);
  }
  return out;
}
