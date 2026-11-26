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

/**
 * Yanıttan iç alanı ayıklar (Opus 10-15 B3; CLAUDE.md "API yanıtında gizli / iç alan yok"): `clientRequestId` yalnız sunucunun tekrar
 * kontrolü içindir (kopyada `copy:<kaynak>:<kimlik>`); istemciye gitmez.
 */
export function withoutClientRequestId<T extends { clientRequestId?: unknown; copiedFromId?: unknown; copiedContentHash?: unknown }>(
  item: T,
): Omit<T, "clientRequestId" | "copiedFromId" | "copiedContentHash"> {
  const copy: Partial<T> = { ...item };
  delete copy.clientRequestId;
  // Kopyanın kaynak bağı ve içerik izi (kurucu D2, migration 68) de yalnız sunucunun kopyalama kararı içindir; istemciye gitmez.
  delete copy.copiedFromId;
  delete copy.copiedContentHash;
  return copy as Omit<T, "clientRequestId" | "copiedFromId" | "copiedContentHash">;
}

/**
 * TEKRAR GÜVENLİĞİNDE UYUŞMAZLIK (kurucu 10-15: "aynı kimlik, farklı içerik → eski kayıt sessizce dönmemeli; açık uyuşmazlık hatası").
 * Aynı istek kimliği daha önce FARKLI bir kalemle kullanıldıysa sunucu eski kalemi döndürmez, 409 + bu kodla cevap verir; istemci kimliği
 * bırakır (bilerek yeniden deneme = YENİ işlem). Metin müşteriye gider — sade.
 */
export const KB_IDEMPOTENCY_CONFLICT = "idempotency_conflict" as const;
export const KB_CREATE_CONFLICT_MESSAGE = "Bu bilgi az önce farklı bir içerikle kaydedildi. Sayfayı yenileyip kontrol edin.";
export const KB_COPY_CONFLICT_MESSAGE = "Kaynak bilgi bu arada değişti. Sayfayı yenileyip yeniden kopyalayın.";

/** İki kalemin içerik alanları aynı mı (durum alanları — aktif / pasif, onay — içerik değildir). */
export function sameKbContent(
  a: { category: string; title: string; content: string; language: string },
  b: { category: string; title: string; content: string; language: string },
): boolean {
  return a.category === b.category && a.title === b.title && a.content === b.content && a.language === b.language;
}
