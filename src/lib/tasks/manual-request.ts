import "server-only";

import { Prisma } from "@prisma/client";
import { TASK_DEDUPE_LOCK_NS } from "./create";

// ---------------------------------------------------------------------------
// ELLE GÖREV — İSTEK KİMLİĞİ (E2, Codex 11-17 / kurucu 11-18; ŞEMASIZ). Form başına istemcinin ürettiği kimlik (`newKbRequestId`, biçim
// `KB_REQUEST_ID_RE`) görev satırının var olan `dedupeKey` kolonuna `manual-req:<işletme>:<kimlik>` olarak yazılır. Aynı kimlikle gelen
// ikinci istek (cevabı ağda kaybolmuş başarılı isteğin tekrarı) İKİNCİ görev açmaz, ilk görevi döndürür. Kalıcı: kayıt görev satırının
// kendisidir (süre yok); bitmiş görev de tekrar sayılır (durum süzgeci YOK).
// Çakışmazlık: akıllı görev anahtarı `<mülk kimliği>:<tür>:…` (`detect.ts`) — mülk kimliği "manual-req:" ile başlayamaz; öneri yükleyici
// (`ai-suggestions/load.ts`) tam anahtar arar; yaşam döngüsü / onarım yolları `dedupeKey` okumaz (`origin: "system"` ile seçer).
// ---------------------------------------------------------------------------

const MANUAL_REQUEST_PREFIX = "manual-req:";

export function manualTaskRequestKey(organizationId: string, requestId: string): string {
  return `${MANUAL_REQUEST_PREFIX}${organizationId}:${requestId}`;
}

/**
 * Kimliğin "aynı görev" sayıldığı alanlar: görevin kimliğini belirleyenler (daire / tür / başlık). Tutmazsa açık hata (kurucu 10-15: "aynı
 * kimlik, farklı içerik → eski kayıt sessizce dönmez"). Durum / atanan / vade / açıklama sonradan değişebilir (temizlikçi başlar, yönetici
 * yeniden atar) — o farklar tekrarı reddettirmez, var olan görev döner.
 * BİLİNEN SINIR (bilinçli, pinli): kıyas KAYITLI satırla yapılır (şemasız — özgün istek ayrıca saklanmaz). Görev açıldıktan sonra başlığı /
 * türü düzenlendiyse aynı isteğin geç tekrarı "uyuşmazlık" (400) görür; ikinci görev yine açılmaz. Arayüz bu duruma pratikte düşmez (tekrar
 * saniyeler içinde, aynı sekmeden gelir; düzenleme formu yok).
 */
export function sameManualTaskRequest(
  stored: { propertyId: string; type: string; title: string },
  incoming: { propertyId: string; type: string; title: string },
): boolean {
  return stored.propertyId === incoming.propertyId && stored.type === incoming.type && stored.title === incoming.title;
}

export type ManualTaskOutcome<T> = { kind: "created"; task: T } | { kind: "replayed"; task: T } | { kind: "mismatch" };

/**
 * Kilit → "bu kimlikle görev var mı?" → yoksa yaz; tek işlemde. Aynı kimlikli eşzamanlı iki istek kilitte sıraya girer, ikincisi birincinin
 * yazdığını görür (akıllı görevin ad alanı 45 paylaşılır — anahtar farklı; çakışma yalnız özet çarpışmasında, o da yalnız sıralar).
 */
export async function findOrCreateManualTask<T extends { propertyId: string; type: string; title: string }>(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    requestId: string;
    incoming: { propertyId: string; type: string; title: string };
    create: (dedupeKey: string) => Promise<T>;
    find: (dedupeKey: string) => Promise<T | null>;
  },
): Promise<ManualTaskOutcome<T>> {
  const key = manualTaskRequestKey(args.organizationId, args.requestId);
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${TASK_DEDUPE_LOCK_NS}::int4, hashtext(${key}))`);
  const prior = await args.find(key);
  if (prior) return sameManualTaskRequest(prior, args.incoming) ? { kind: "replayed", task: prior } : { kind: "mismatch" };
  if (__manualTaskHooks.afterPriorRead) await __manualTaskHooks.afterPriorRead();
  return { kind: "created", task: await args.create(key) };
}

/** Yanıttan iç anahtarı ayıklar (CLAUDE.md "API yanıtında gizli / iç alan yok"). */
export function withoutDedupeKey<T extends { dedupeKey?: unknown }>(task: T): Omit<T, "dedupeKey"> {
  const copy: Partial<T> = { ...task };
  delete copy.dedupeKey;
  return copy as Omit<T, "dedupeKey">;
}

/** Yalnız testler: kilitli bölgede "var mı?" okumasından SONRA bekleme noktası (eşzamanlılık testi şansa kalmasın). */
export const __manualTaskHooks: { afterPriorRead: null | (() => Promise<void>) } = { afterPriorRead: null };
