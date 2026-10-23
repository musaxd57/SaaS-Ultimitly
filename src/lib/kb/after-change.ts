// ---------------------------------------------------------------------------
// BİLGİ TABANI YAZMA KANCASI — TEK KAYNAK (bilgi tabanı dosya / RAG tasarımı S1, `docs/TASARIM-2026-10-23-bilgi-tabani-dosya-rag-ve-tarama.md`
// §9 R6). Bir kalem eklendiğinde / değiştiğinde / silindiğinde / kopyalandığında / içe aktarıldığında yapılacak HER şey buradan:
//  · Mülk Hafızası eşitlemesi (`refreshPropertyMemoryBestEffort` — silinen kalem retired, çelişki uyarısı yeniden değerlendirilir);
//  · anlamsal vektör ısıtması (`warmPropertyKbVectorsBestEffort` — misafirin bir sonraki mesajı sözcüksele düşmesin);
//  · (S3, kalıcı gömme deposu açılınca) değişen kalemin artık geçmeyen vektörlerinin silinmesi — KVKK: silinen metnin vektörü kalmaz.
// Yazma yolları bu iki adımı tek tek çağırıyordu ve biri ısıtmayı unutmuştu (`ai-suggestions/act.ts` Wi-Fi önerisi onayı); yeni bir yol da
// unutabilirdi. Pin: `tests/unit/kb-write-hook-pin.test.ts` — bilgi tabanına yazan her kaynak dosya bu kancayı çağırır (gerekçeli istisna
// listesi). ASLA fırlatmaz; yazımın kendisi başarılı kalır.
// ---------------------------------------------------------------------------
import { refreshPropertyMemoryBestEffort } from "@/modules/intelligence";
import { warmPropertyKbVectorsBestEffort } from "@/lib/ai/embeddings/kb-warm";

/**
 * Kalem yazımı İŞLEM DIŞINDA bittikten sonra çağrılır. Tek mülk → hafıza o mülk kapsamında; birden çok mülk (kopyalama) → işletme kapsamında
 * bir kez. Isıtma her mülk için beklemeden başlar. Hafıza eşitlemesi beklenir (bugünkü rotalarla aynı), ısıtma beklenmez.
 */
export async function afterKbItemsChanged(input: { organizationId: string; propertyIds: readonly (string | null | undefined)[] }): Promise<void> {
  const ids = [...new Set(input.propertyIds.filter((p): p is string => typeof p === "string" && p.length > 0))];
  if (ids.length === 0) return;
  await refreshPropertyMemoryBestEffort(input.organizationId, ids.length === 1 ? ids[0] : undefined);
  for (const id of ids) warmPropertyKbVectorsBestEffort(id);
}
