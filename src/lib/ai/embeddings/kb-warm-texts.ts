/* ---------------------------------------------------------------------------
 * BİR DAİRENİN ISITMADA GÖMÜLECEK KÜMELERİ — TEK KAYNAK (EMB tur 2 D3).
 *
 * Isıtma (`kb-warm.ts warmPropertyKbVectors`) ve kalıcı depo temizliği (D3, `purgeChangedPropertyVectors`) AYNI metinleri hesaplamak
 * zorunda: temizlik "hâlâ geçerli" saydığı özetleri ısıtmanın gömeceği metinlerden çıkarır. İki küme: kanal yollarının HAM kalemleri + QR'ın
 * nötr hitapla doldurulmuş kalemleri (yalnız yer tutuculu kalem varsa farklıdır; `checkin` hiç çekilmez).
 *
 * Ayrı dosya: KB yazma kancası (`kb/after-change.ts`) temizliği buradan çağırır; `kb-warm.ts`i yalnız ısıtma dışa aktarımlarıyla taklit eden
 * testler (kanca bağlantı testleri) bu yüzden bozulmaz.
 * ------------------------------------------------------------------------- */

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { fetchKnowledgeBaseForPrompt, type KbForPrompt } from "@/lib/ai/kb-fetch";
import { currentChunkHashes, purgeStaleVectorsForProperties } from "@/lib/ai/embeddings/semantic-retrieval";
import { vectorStoreEnabled, type VectorKeepItem } from "@/lib/ai/embeddings/vector-store";
import { GUEST_NAME_FALLBACK, fillGuestPlaceholdersInItems } from "@/lib/kb-placeholders";
import { QR_SECRET_CATEGORIES } from "@/lib/guest-chat";

type KbItem = KbForPrompt["items"][number];

/** Dairenin işletmesi + ısıtmanın gömeceği kümeler (ham; farklıysa QR biçimi). Daire yoksa `null`. Fırlatır (çağıran yakalar). */
export async function propertyWarmSets(propertyId: string): Promise<{ organizationId: string; sets: KbItem[][] } | null> {
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { name: true, organizationId: true } });
  if (!property) return null;
  const kb = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
  const sets: KbItem[][] = [kb.items];
  // QR: `checkin` kategorisi hiç çekilmez (`wifi` 10-11'den beri kalem bazında süzülür — ısıtma yalnız vektör üretir, metin misafire
  // gitmez), yer tutucular nötr hitapla doldurulur → yer tutuculu kalemin metni farklıdır; yalnız o zaman ikinci biçim (aynı metin zaten
  // ilk kümede).
  const qr = kb.items.filter((i) => !(QR_SECRET_CATEGORIES as readonly string[]).includes(i.category));
  const qrFilled = fillGuestPlaceholdersInItems(qr, { guestFirstName: GUEST_NAME_FALLBACK, propertyName: property.name });
  if (qrFilled.some((it, i) => it.content !== qr[i].content || it.title !== qr[i].title)) sets.push(qrFilled);
  return { organizationId: property.organizationId, sets };
}

/** Anahtar yalnız tam "1" ile açılır. */
export function vectorPurgeByHashEnabled(): boolean {
  return process.env.KB_VECTOR_PURGE_BY_HASH_ENABLED === "1";
}

/**
 * KB yazma kancasının kalıcı depo temizliği. Anahtar kapalıyken ya da kalıcı depo kapalıyken bugünkü kalem düzeyinde silme (depo kapalıyken
 * veritabanına hiç dokunulmaz). Açıkken (D3) değişen dairelerin bugünkü parça özetleri hesaplanır: değişmeyen parçanın satırı kalır ve
 * damgası yenilenir, yalnız artık geçmeyen özetler silinir. Liste hesaplanamazsa bugünkü silmeye düşer (fail-soft: yalnız bedel). Fırlatmaz.
 */
export async function purgeChangedPropertyVectors(propertyIds: readonly string[]): Promise<number> {
  if (!vectorPurgeByHashEnabled() || !vectorStoreEnabled()) return purgeStaleVectorsForProperties(propertyIds);
  let keep: VectorKeepItem[] | undefined;
  try {
    const byItem = new Map<string, { id: string; versionMs: number; hashes: Set<string> }>();
    for (const propertyId of propertyIds) {
      const ws = await propertyWarmSets(propertyId);
      for (const set of ws?.sets ?? []) {
        for (const it of currentChunkHashes(set)) {
          const entry = byItem.get(it.id) ?? { id: it.id, versionMs: it.versionMs, hashes: new Set<string>() };
          for (const h of it.hashes) entry.hashes.add(h);
          byItem.set(it.id, entry);
        }
      }
    }
    keep = [...byItem.values()].map((e) => ({ id: e.id, versionMs: e.versionMs, hashes: [...e.hashes] }));
  } catch (err) {
    void reportError("kb-vector-purge-keep", err);
    keep = undefined;
  }
  return purgeStaleVectorsForProperties(propertyIds, keep);
}
