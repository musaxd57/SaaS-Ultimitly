/* ---------------------------------------------------------------------------
 * BİLGİ TABANI VEKTÖR ISITMASI — YAZMA ANINDA ve AÇILIŞTA (#189, 09-26 gece).
 *
 * Parça vektörleri süreç belleğinde ve YALNIZ arka planda üretilir (`semantic-retrieval.ts`); eksik parça varsa o karar
 * SÖZCÜKSEL kalır ("cold", YARIM HARİTA YOK). İki durumda misafirin İLK mesajı bu yüzden anlamsal aramasız kalıyordu:
 *  · her yayından / yeniden başlatmadan sonra (depo boş) — mülk başına ilk mesaj;
 *  · bilgi tabanı düzenlenince (değişen kalemin parçası depoda yok) — düzenlemeden sonraki ilk mesaj.
 * Sektör düzeni: dizin YAZMA zamanında kurulur. Burası iki tetik verir: KB yazma rotaları (kalem ekle/düzenle/sil/kopyala)
 * ve zamanlanmış senkronun süreç başına İLK geçişi. Isıtma, seçicinin göreceği metnin AYNISINI gömer: kanal yolları seçimi
 * HAM metinle yapar (yer tutucu ikamesi seçimden sonra), QR yolu nötr hitapla doldurulmuş metinle — yer tutucu taşıyan
 * kalem varsa ikinci biçim de ısıtılır.
 *
 * ASLA fırlatmaz, misafiri beklemez; saatlik ısıtma tavanı (`WARM_TEXTS_PER_HOUR`) ve parça tavanı aynen geçerli.
 * Anahtar kapalıyken (`KB_SEMANTIC_RETRIEVAL`) ya da legacy modda HİÇBİR ŞEY yapmaz (sorgu dahil).
 * ------------------------------------------------------------------------- */

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { kbRetrievalMode, semanticRetrievalInfo } from "@/lib/ai/retrieval/flag";
import { warmKbVectors } from "@/lib/ai/embeddings/semantic-retrieval";
import { GUEST_NAME_FALLBACK, fillGuestPlaceholdersInItems } from "@/lib/kb-placeholders";
import { QR_SECRET_CATEGORIES } from "@/lib/guest-chat";

function warmingOn(): boolean {
  return semanticRetrievalInfo().enabled && kbRetrievalMode() === "hybrid";
}

/** Tek mülkün bilgi tabanını ısıtır; kuyruğa alınan parça metni sayısını döner (test/teşhis). Fırlatmaz. */
export async function warmPropertyKbVectors(propertyId: string): Promise<number> {
  if (!warmingOn()) return 0;
  try {
    const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } });
    if (!property) return 0;
    const kb = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    let queued = warmKbVectors(kb.items);
    // QR: `checkin` kategorisi hiç çekilmez (`wifi` 10-11'den beri kalem bazında süzülür — ısıtma yalnız vektör üretir, metin
    // misafire gitmez), yer tutucular nötr hitapla doldurulur → yer tutuculu kalemin metni farklıdır; yalnız o zaman ikinci biçim
    // ısıtılır (aynı metin zaten depoda).
    const qr = kb.items.filter((i) => !(QR_SECRET_CATEGORIES as readonly string[]).includes(i.category));
    const qrFilled = fillGuestPlaceholdersInItems(qr, { guestFirstName: GUEST_NAME_FALLBACK, propertyName: property.name });
    if (qrFilled.some((it, i) => it.content !== qr[i].content || it.title !== qr[i].title)) queued += warmKbVectors(qrFilled);
    return queued;
  } catch (err) {
    void reportError("kb-semantic-warm-property", err);
    return 0;
  }
}

/** KB yazma rotaları için: beklemeden başlatır (yanıtı geciktirmez), asla fırlatmaz. */
export function warmPropertyKbVectorsBestEffort(propertyId: string | null | undefined): void {
  if (!propertyId || !warmingOn()) return;
  void warmPropertyKbVectors(propertyId);
}

let bootWarmStarted = false;

/**
 * Süreç başına BİR KEZ: aktif bilgi tabanı olan tüm mülkleri sırayla ısıtır (zamanlanmış senkronun ilk geçişi çağırır).
 * Yalnız retrieval gerçekten koşacak (legacy tavanını aşan) bilgi tabanları vektör üretir — küçük KB'de `warmKbVectors`
 * hiçbir şey yapmaz. Fırlatmaz; ikinci çağrı no-op.
 */
export function warmAllKbVectorsOnce(): void {
  if (bootWarmStarted || !warmingOn()) return;
  bootWarmStarted = true;
  void (async () => {
    try {
      const rows = await prisma.knowledgeBaseItem.groupBy({ by: ["propertyId"], where: { isActive: true }, _count: { _all: true } });
      for (const r of rows) {
        if (r.propertyId) await warmPropertyKbVectors(r.propertyId);
      }
    } catch (err) {
      void reportError("kb-semantic-warm-boot", err);
    }
  })();
}

/** Test kancası. */
export function __resetBootWarm(): void {
  bootWarmStarted = false;
}
