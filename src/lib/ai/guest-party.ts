// ---------------------------------------------------------------------------
// REZERVASYON KİŞİ SAYILARI → MODEL BAĞLAMI (migration 86; kurucu 10-23 akşam: "kimlerin geldiğini kaç kişi evcil hayvan var mı onu görsün").
// Yalnız BİLİNEN sayılar yazılır; hiçbiri bilinmiyorsa satır YOK (istem bayt bayt eski). Sayılar kanalın kendi alanından gelir, tahmin
// edilmez. YAPRAK modül.
// ---------------------------------------------------------------------------

export interface GuestPartyCounts {
  guestAdults?: number | null;
  guestChildren?: number | null;
  guestInfants?: number | null;
  guestPets?: number | null;
}

const known = (v: number | null | undefined): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Cevap istemi (Türkçe): "Kişi sayısı (rezervasyon): 2 yetişkin, 1 çocuk · evcil hayvan: 1". Hiçbiri bilinmiyorsa boş dize. */
export function guestPartyLineTr(r: GuestPartyCounts | null | undefined): string {
  if (!r) return "";
  const people = [
    known(r.guestAdults) ? `${r.guestAdults} yetişkin` : null,
    known(r.guestChildren) ? `${r.guestChildren} çocuk` : null,
    known(r.guestInfants) ? `${r.guestInfants} bebek` : null,
  ].filter(Boolean);
  const pets = known(r.guestPets) ? (r.guestPets === 0 ? "evcil hayvan: yok" : `evcil hayvan: ${r.guestPets}`) : null;
  if (people.length === 0 && !pets) return "";
  return `Kişi sayısı (rezervasyonda kayıtlı): ${[people.join(", "), pets].filter(Boolean).join(" · ")}`;
}

/** Okuyucu (İngilizce): " Booking party: 2 adults, 1 child; pets: 1." Hiçbiri bilinmiyorsa boş dize. */
export function guestPartySentenceEn(r: GuestPartyCounts | null | undefined): string {
  if (!r) return "";
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  const people = [
    known(r.guestAdults) ? n(r.guestAdults, "adult", "adults") : null,
    known(r.guestChildren) ? n(r.guestChildren, "child", "children") : null,
    known(r.guestInfants) ? n(r.guestInfants, "infant", "infants") : null,
  ].filter(Boolean);
  const pets = known(r.guestPets) ? `pets on the booking: ${r.guestPets}` : null;
  if (people.length === 0 && !pets) return "";
  return ` Booking party: ${[people.join(", "), pets].filter(Boolean).join("; ")}.`;
}
