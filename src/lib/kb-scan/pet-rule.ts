import { kbForbidsPets } from "@/lib/conversation-items/pet-policy";
import type { ScanKbItem } from "./same-value";

// ---------------------------------------------------------------------------
// BİLGİ TABANI TARAMASI — EVCİL HAYVAN "YASAK" KALEMİ (kurucu 10-23 akşam 4.4, seçenek A, aynen: "'Yasak' yazıyorsa da cevap gitmez, size
// kalır; ayrıca bilgi tabanı uyarısı"). Airbnb'de hizmet / yardımcı hayvan reddedilemez ve evcil hayvan ücreti alınamaz; ilanda evcil hayvanı
// kapatan ev sahibi de misafir ücret ödeyip hayvan ekleyemesin diye ilan ayarını kontrol etmeli. SAF ve hiçbir yüzeye BAĞLI DEĞİL: bilgi
// tabanı taramasının (tasarım `docs/TASARIM-2026-10-23-bilgi-tabani-dosya-rag-ve-tarama.md` §5) ADAY bulgusu; ev sahibine gösterim ikinci
// aşama (kalıcı soru kaydı migration ister).
// ---------------------------------------------------------------------------

/** Ev sahibine gösterilecek uyarı (kurucunun seçtiği A seçeneğinin metni). */
export const PET_FORBIDDEN_WARNING =
  "Bilgi tabanınızda evcil hayvanın yasak olduğu yazıyor. Yardımcı hayvanlar (ör. görme engelli rehber köpeği) her durumda kabul edilmeli; " +
  "ilan ayarınızla uyumlu mu kontrol edin.";

export interface PetForbiddenFinding {
  propertyId: string;
  itemIds: string[];
}

/** Daire başına "evcil hayvan yasak" yazan kalemler (daire ve kalem kimliğine göre sıralı). Saf. */
export function petForbiddenFindings(items: readonly ScanKbItem[]): PetForbiddenFinding[] {
  const byProperty = new Map<string, string[]>();
  for (const it of items) {
    if (!kbForbidsPets([{ title: it.title, content: it.content }])) continue;
    byProperty.set(it.propertyId, [...(byProperty.get(it.propertyId) ?? []), it.id]);
  }
  return [...byProperty.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([propertyId, itemIds]) => ({ propertyId, itemIds: [...itemIds].sort() }));
}
