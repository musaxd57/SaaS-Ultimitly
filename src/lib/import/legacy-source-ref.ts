import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { acquireErasureLock, loadErasureGuard } from "@/lib/erasure";

// ---------------------------------------------------------------------------
// UZUN KİMLİĞİN ESKİ BİÇİMİ → YENİ BİÇİM (takvim C1, Codex 11-10). 200 karakterden uzun kimlik eskiden 200'e kesilerek saklanıyordu;
// artık "baş + ~ + özet" (`source-ref.ts`). Eski biçimle kalmış izler iki türdür ve iki ingress yolu da (takvim aboneliği, dosyadan içe
// aktarma) satırlara bakmadan ÖNCE burada yeni biçime bağlanır — sonraki bütün aramalar yalnız yeni kimlikle çalışır:
//  1. SİLME (KVKK) KAYDI eski kimlikle tutulan konaklama: o satırlar bu aktarımda hiç işlenmez (silinen konaklama yeniden içe alınmaz).
//  2. Eski kimlikle saklanan REZERVASYON satırı: kimliği yeni biçime çevrilir — aynı satır (mesajları, görevleri, geçmişiyle) yaşamaya
//     devam eder, kopya açılmaz. İki FARKLI uzun kimlik aynı eski kimliğe düşüyorsa (asıl hata buydu: iki rezervasyon tek satırda
//     birleşmişti) satır, tarihleri birebir uyan TEK adaya verilir; öyle bir aday yoksa dokunulmaz (otomatik birleştirme / tahmin yok —
//     satır artık hiçbir kimlikle eşleşmez, yeni kimlikler kendi satırlarını açar).
//     · TEK aday varken tarih aranmaz (Haiku incelemesi 11-11 sordu): olağan durum budur — tek bir uzun kimlik, tarihi değişmiş olabilir
//       (misafir uzattı) ve satır onun satırıdır. Eski hatada iki kimliğin birleştiği satır zaten "son yazanın" verisini taşıyordu;
//       beslemede yalnız biri kaldıysa satırın ona kalması eski davranışın devamıdır. Tahmin YASAĞI birden çok aday içindir.
//     · Hiçbir adaya verilmeyen eski satır beslemede artık hiçbir kimlikle görünmez: "beslemeden kayboldu" uzlaştırması açıksa o kuralla
//       iptal edilir, kapalıysa öteki kaybolan satırlar gibi yerinde kalır (bu modül satır silmez / iptal etmez).
// Kısa kimlikli (neredeyse bütün) beslemelerde hiçbir sorgu çalışmaz.
// ---------------------------------------------------------------------------

export interface LegacyAwareRow {
  sourceReference?: string | null;
  legacySourceReference?: string | null;
  arrivalDate: Date;
  departureDate: Date;
}

export async function reconcileLegacySourceReferences(opts: {
  organizationId: string;
  propertyId: string;
  /** Eski satırın arandığı EK kapsam (ör. `{ calendarSourceId }` — yalnız bu ingress yolunun kendi satırları). */
  scope: Prisma.ReservationWhereInput;
  rows: readonly LegacyAwareRow[];
  /** Önizleme: HİÇBİR ŞEY yazılmaz (yalnız silme kayıtlarına bakılır). */
  readOnly?: boolean;
}): Promise<{ erased: Set<string>; adopted: number }> {
  // eski kimlik → o kimliğe düşen (yeni kimlik başına tek) adaylar
  const byLegacy = new Map<string, Map<string, LegacyAwareRow>>();
  for (const r of opts.rows) {
    if (!r.sourceReference || !r.legacySourceReference) continue;
    let group = byLegacy.get(r.legacySourceReference);
    if (!group) byLegacy.set(r.legacySourceReference, (group = new Map()));
    if (!group.has(r.sourceReference)) group.set(r.sourceReference, r);
  }
  const erased = new Set<string>();
  if (byLegacy.size === 0) return { erased, adopted: 0 };

  let adopted = 0;
  await prisma.$transaction(
    async (tx) => {
      await acquireErasureLock(tx, opts.organizationId);
      const guard = await loadErasureGuard(opts.organizationId, tx);
      for (const [legacy, group] of byLegacy) {
        if (!guard.isEmpty && guard.blocksSourceReference(legacy)) {
          for (const ref of group.keys()) erased.add(ref);
          continue;
        }
        if (opts.readOnly) continue;
        const row = await tx.reservation.findFirst({
          where: { AND: [opts.scope, { propertyId: opts.propertyId, sourceReference: legacy }] },
          select: { id: true, arrivalDate: true, departureDate: true },
        });
        if (!row) continue;
        const candidates = [...group.entries()];
        const sameDates = candidates.filter(
          ([, r]) => r.arrivalDate.getTime() === row.arrivalDate.getTime() && r.departureDate.getTime() === row.departureDate.getTime(),
        );
        const target = candidates.length === 1 ? candidates[0] : sameDates.length === 1 ? sameDates[0] : null;
        if (!target) continue;
        // Yeni kimlik bu dairede zaten varsa (dairede kimlik tekildir) dokunulmaz — satır yazan öteki yollar da aynı silme kilidini alır,
        // bu okuma ile yazma arasına giremezler. (İşlem içinde tekillik hatası yakalanamaz: işlemi bozar.)
        const taken = await tx.reservation.findFirst({ where: { propertyId: opts.propertyId, sourceReference: target[0] }, select: { id: true } });
        if (taken) continue;
        const renamed = await tx.reservation.updateMany({ where: { id: row.id, sourceReference: legacy }, data: { sourceReference: target[0] } });
        adopted += renamed.count;
      }
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
  return { erased, adopted };
}
