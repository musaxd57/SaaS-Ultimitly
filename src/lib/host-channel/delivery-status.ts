import "server-only";

import { prisma } from "@/lib/db";
import type { HostDeliveryStatus } from "./types";

// ---------------------------------------------------------------------------
// TESLİM / OKUNDU DURUMU (tasarım §3.12, kurucu 10-31 hibrit acil akış: "10 dk içinde okunmazsa e-posta"). Sağlayıcının durum bildirimleri
// bugüne kadar ATILIYORDU; artık `HostQuestion.deliveredAt / readAt` yazılır (sütunlar migration 88'de vardı, yazan yoktu).
//  · HAM SQL bilinçli: Prisma `update` `updatedAt`i tazelerdi — düz mesaj kuralı (`answer.ts` "soru akışı bildirimden sonra ilerledi mi")
//    ona bakıyor; okundu bilgisi soru akışını İLERLETMEZ. Durum / sürüm (CAS) sütunlarına dokunulmaz.
//  · EN ERKEN AN KAZANIR (LEAST): sıra, tekrar, yeniden deneme sonucu değiştirmez; "okundu" önce gelirse "iletildi" de o anla dolar; bir an
//    yalnız geriye gider, hiç silinmez. Gönderimden önceki an `sentAt`e kırpılır (saat kayması "gönderilmeden okundu" yazmasın).
//  · Bozuk / 1970 / gelecek zaman damgası ŞİMDİYE kırpılır: en erken kazanır kuralında 1970 kalıcı "zamanında okundu" yalanı olurdu.
//  · Yalnız sağlayıcı kimliğiyle eşlenir (genelde tekil; Meta'nın o işletmenin gönderimine verdiği kimlik). Yetki: imza + numara kimliği
//    süzgeci (`route.ts`, `parse.ts`). Eşleşmeyen durum (önizleme / düz metin / bilinmeyen kimlik, ya da kimlik henüz yazılmadan gelen durum)
//    sessizce sayılır — kayıp "okundu" e-postayı ERTELEMEZ, yalnız gereksiz bir e-posta doğurur (güvenli yön).
// ---------------------------------------------------------------------------

/** Bir teslimattaki en çok durum (sınırsız gövde aşağı akışta sınırsız sorgu olmasın). */
export const MAX_STATUSES_PER_DELIVERY = 200;

/** Durum anı: geçersiz, 1970 (eksik damga) ya da gelecek → şimdi. */
export function statusInstant(at: Date, now: Date): Date {
  const t = at.getTime();
  return Number.isFinite(t) && t > 0 && t <= now.getTime() ? at : now;
}

export interface DeliveryStatusOutcome {
  recorded: number;
  unmatched: number;
  ignored: number;
  /** "failed" bildirilen kimlikler (çağıran ertelenmiş acil e-postayı öne çeker — §3.12). */
  failedIds: string[];
}

export async function recordHostDeliveryStatuses(statuses: readonly HostDeliveryStatus[], now: Date = new Date()): Promise<DeliveryStatusOutcome> {
  const out: DeliveryStatusOutcome = { recorded: 0, unmatched: 0, ignored: 0, failedIds: [] };
  for (const s of statuses.slice(0, MAX_STATUSES_PER_DELIVERY)) {
    if (s.status === "failed") {
      out.failedIds.push(s.providerMessageId);
      continue;
    }
    if (s.status !== "delivered" && s.status !== "read") {
      out.ignored++;
      continue;
    }
    const iso = statusInstant(s.at, now).toISOString();
    const n =
      s.status === "read"
        ? await prisma.$executeRaw`
            UPDATE "HostQuestion" SET
              "readAt" = LEAST("readAt", GREATEST((${iso}::timestamptz AT TIME ZONE 'UTC'), "sentAt")),
              "deliveredAt" = LEAST("deliveredAt", GREATEST((${iso}::timestamptz AT TIME ZONE 'UTC'), "sentAt"))
            WHERE "providerMessageId" = ${s.providerMessageId}
              AND ("readAt" IS NULL OR "deliveredAt" IS NULL
                OR "readAt" > GREATEST((${iso}::timestamptz AT TIME ZONE 'UTC'), "sentAt")
                OR "deliveredAt" > GREATEST((${iso}::timestamptz AT TIME ZONE 'UTC'), "sentAt"))`
        : await prisma.$executeRaw`
            UPDATE "HostQuestion" SET
              "deliveredAt" = LEAST("deliveredAt", GREATEST((${iso}::timestamptz AT TIME ZONE 'UTC'), "sentAt"))
            WHERE "providerMessageId" = ${s.providerMessageId}
              AND ("deliveredAt" IS NULL OR "deliveredAt" > GREATEST((${iso}::timestamptz AT TIME ZONE 'UTC'), "sentAt"))`;
    if (n > 0) out.recorded++;
    else out.unmatched++;
  }
  return out;
}
