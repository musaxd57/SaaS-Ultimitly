import "server-only";

import { prisma } from "@/lib/db";
import { deriveMessageSignal, deriveReservationSignal, type SignalDraft } from "./signals/derive";

// ---------------------------------------------------------------------------
// INGEST EVENT TÜKETİCİSİ (V1) — intelligence bounded context'in tek girişi.
//
// Sözleşme (docs/V1-PROPERTY-MEMORY-DESIGN.md §4):
//   · `IngestEvent.dispatchedAt IS NULL` satırları (occurredAt, id) sırasıyla; event PAYLOAD
//     taşımaz — canonical satır ŞİMDİKİ hâliyle okunur (sırasız/geç gelen olay son durumu
//     üretir; sinyal olay-başına olduğu için küme sıradan bağımsızdır).
//   · Her event KENDİ TX'inde: sinyal(ler) `createMany({ skipDuplicates })` (unique dedupeKey →
//     Postgres ON CONFLICT DO NOTHING; TX abort YOK) + `dispatchedAt` damgası. Yarıda kalırsa
//     damgasızlar sonraki koşuda; damgasız-ama-yazılmış (çökme) tekrar işlenir → dedupe.
//   · Kiracı: org filtresi isteğe bağlı; sinyal her zaman event'in org'u + satırın property'siyle.
//   · Hata: fırlatır — çağıran (scheduled-sync) yakalar; PMS akışı bloklanmaz.
// ---------------------------------------------------------------------------

export interface ProcessResult {
  processed: number;
  signals: number;
  /** dedupe'a takılan (mükerrer) taslak sayısı. */
  deduped: number;
  /** Canonical satırı artık olmayan (silinmiş) event — damgalanır, sinyal üretmez. */
  orphaned: number;
}

export const __intelligenceHooks: { afterEvent: ((eventId: string) => Promise<void>) | null } = { afterEvent: null };

const DEFAULT_BATCH = 500;

async function draftsFor(ev: {
  id: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  kind: string;
  occurredAt: Date;
  changedFieldsJson: string | null;
}): Promise<{ drafts: SignalDraft[]; orphaned: boolean }> {
  // `message.imported` (sağlayıcı senkronu) ve `message.received` (doğrudan kanal: QR) AYNI işlenir —
  // tüketici kaynağı okumaz, canonical satırı okur (yön/yazar satırdan).
  if (ev.entityType === "message" && (ev.kind === "message.imported" || ev.kind === "message.received")) {
    const message = await prisma.message.findFirst({
      where: { id: ev.entityId, conversation: { property: { organizationId: ev.organizationId } } },
      select: {
        id: true,
        direction: true,
        authorType: true,
        body: true,
        createdAt: true,
        conversation: { select: { id: true, propertyId: true, reservationId: true } },
      },
    });
    if (!message) return { drafts: [], orphaned: true };
    const d = deriveMessageSignal(ev.organizationId, message, ev.id);
    return { drafts: d ? [d] : [], orphaned: false };
  }
  if (ev.entityType === "reservation" && (ev.kind === "reservation.cancelled" || ev.kind === "reservation.updated")) {
    const reservation = await prisma.reservation.findFirst({
      where: { id: ev.entityId, property: { organizationId: ev.organizationId } },
      select: { id: true, propertyId: true },
    });
    if (!reservation) return { drafts: [], orphaned: true };
    let changedFields: string[] = [];
    if (ev.changedFieldsJson) {
      try {
        const parsed: unknown = JSON.parse(ev.changedFieldsJson);
        if (Array.isArray(parsed)) changedFields = parsed.filter((x): x is string => typeof x === "string");
      } catch {
        changedFields = [];
      }
    }
    const d = deriveReservationSignal(ev.organizationId, { id: ev.id, kind: ev.kind, occurredAt: ev.occurredAt, changedFields }, reservation);
    return { drafts: d ? [d] : [], orphaned: false };
  }
  // reservation.created · conversation.* → V1'de sinyal yok (yalnız damgalanır).
  return { drafts: [], orphaned: false };
}

export async function processIngestEvents(opts: { organizationId?: string; batchSize?: number } = {}): Promise<ProcessResult> {
  const out: ProcessResult = { processed: 0, signals: 0, deduped: 0, orphaned: 0 };
  const events = await prisma.ingestEvent.findMany({
    where: { dispatchedAt: null, ...(opts.organizationId ? { organizationId: opts.organizationId } : {}) },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: opts.batchSize ?? DEFAULT_BATCH,
    select: { id: true, organizationId: true, entityType: true, entityId: true, kind: true, occurredAt: true, changedFieldsJson: true },
  });
  for (const ev of events) {
    const { drafts, orphaned } = await draftsFor(ev);
    await prisma.$transaction(async (tx) => {
      if (drafts.length) {
        const r = await tx.signal.createMany({ data: drafts, skipDuplicates: true });
        out.signals += r.count;
        out.deduped += drafts.length - r.count;
      }
      // Damga: yalnız hâlâ damgasızsa (eşzamanlı ikinci tüketici aynı event'i işlemiş olabilir).
      await tx.ingestEvent.updateMany({ where: { id: ev.id, dispatchedAt: null }, data: { dispatchedAt: new Date() } });
    });
    out.processed++;
    if (orphaned) out.orphaned++;
    if (__intelligenceHooks.afterEvent) await __intelligenceHooks.afterEvent(ev.id);
  }
  return out;
}
