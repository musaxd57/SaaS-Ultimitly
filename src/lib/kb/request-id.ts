// ---------------------------------------------------------------------------
// BİLGİ TABANI EKLEME — İSTEK KİMLİĞİ (kurucu 10-14 "İstek kimliği", migration 67). YAPRAK modül (istemci + sunucu; hiçbir şey import etmez).
// Bağlantı tam cevap anında koparsa ya da düğmeye iki kez basılırsa AYNI kalem için AYNI kimlik gider; sunucu (`api/kb` POST) ilk isteğin
// yazdığı kalemi döndürür, ikinci kalem açılmaz. Kimlik içeriğe bağlıdır: metin değişirse yeni kimlik (bilinçli yeni kalem).
// İdempotency denetimi 10-15: içe aktarım dışındaki üç ekleme ekranı (bilgi tabanı formu, şablon önerisi, geçmiş cevap önerisi) kimlik
// göndermiyordu → çift tıkta iki aynı kalem.
// ---------------------------------------------------------------------------

/** Tahmin edilemez kimlik (`getRandomValues` her tarayıcıda ve Node 20+'da var). */
export function newKbRequestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

type KbItemKey = { propertyId: string; category: string; title?: string | null; content: string; language?: string | null };

export interface KbRequestIdStore {
  /** Aynı kalem (mülk + kategori + başlık + içerik + dil) için aynı kimlik; farklı kalem için yeni kimlik. */
  idFor(item: KbItemKey): string;
  /** Kalem başarıyla eklendikten sonra unutulur (aynı metni bilerek yeniden eklemek yeni kalem açar). */
  forget(item: KbItemKey): void;
}

const keyOf = (item: KbItemKey) =>
  JSON.stringify([item.propertyId, item.category, item.title ?? "", item.content, item.language ?? ""]);

export function createKbRequestIdStore(): KbRequestIdStore {
  const ids = new Map<string, string>();
  return {
    idFor(item) {
      const k = keyOf(item);
      let id = ids.get(k);
      if (!id) {
        id = newKbRequestId();
        ids.set(k, id);
      }
      return id;
    },
    forget(item) {
      ids.delete(keyOf(item));
    },
  };
}
