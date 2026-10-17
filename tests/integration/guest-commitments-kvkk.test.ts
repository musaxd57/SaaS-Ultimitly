import { describe, it, expect, beforeEach, vi } from "vitest";
import { subMonths } from "date-fns";
import { prisma, resetDb } from "../helpers/db";
import { eraseReservationData } from "@/lib/erasure";
import { purgeExpiredGuestCommitments } from "@/lib/guest-commitments";
import { buildOrganizationDataExport } from "@/lib/data-export";

// ---------------------------------------------------------------------------
// MİSAFİR SÖZÜ — KVKK (Haiku denetimi B3, 10-10). Söz metin taşımaz ama konaklamaya bağlı davranış kaydıdır: misafir silmesinde o
// konaklamanın sözleri silinir; saklama sınırından eski sözler süpürülür. Gerçek PostgreSQL.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

async function stayWithCommitment(orgId?: string) {
  const org = orgId ?? (await prisma.organization.create({ data: { name: "Org" } })).id;
  const property = await prisma.property.create({ data: { organizationId: org, name: "Daire" } });
  const reservation = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Ayşe Yılmaz", arrivalDate: subMonths(new Date(), 2), departureDate: subMonths(new Date(), 1), status: "completed" },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, reservationId: reservation.id, channel: "airbnb", guestIdentifier: "Ayşe Yılmaz" },
  });
  const task = await prisma.task.create({ data: { propertyId: property.id, title: "Misafire söz: Havlu / çarşaf", type: "laundry" } });
  const commitment = await prisma.guestCommitment.create({
    data: { organizationId: org, conversationId: conversation.id, taskId: task.id, kind: "towels", dueAt: subMonths(new Date(), 1) },
  });
  return { orgId: org, reservationId: reservation.id, commitmentId: commitment.id, taskId: task.id };
}

describe("misafir sözü — KVKK", () => {
  beforeEach(resetDb);

  it("🚨 misafir silmesi o konaklamanın sözlerini siler; başka konaklamanın sözü ve bağlı görev KALIR", async () => {
    const a = await stayWithCommitment();
    const b = await stayWithCommitment(a.orgId);
    expect(await eraseReservationData(a.orgId, a.reservationId)).not.toBeNull();
    expect(await prisma.guestCommitment.count({ where: { id: a.commitmentId } })).toBe(0);
    expect(await prisma.guestCommitment.count({ where: { id: b.commitmentId } })).toBe(1);
    expect(await prisma.task.count({ where: { id: a.taskId } })).toBe(1); // ev sahibinin işi (başlıkta yalnız tür)
  });

  it("🚨 saklama: son anı sınırdan eski söz (durumdan bağımsız) silinir, yenisi kalır", async () => {
    const old = await stayWithCommitment();
    const fresh = await stayWithCommitment(old.orgId);
    await prisma.guestCommitment.update({ where: { id: old.commitmentId }, data: { dueAt: subMonths(new Date(), 30), status: "done" } });
    const openOld = await prisma.guestCommitment.create({
      data: { organizationId: old.orgId, conversationId: (await prisma.guestCommitment.findUniqueOrThrow({ where: { id: fresh.commitmentId } })).conversationId, kind: "cleaning", dueAt: subMonths(new Date(), 25) },
    });
    const cutoff = subMonths(new Date(), 24);
    expect(await purgeExpiredGuestCommitments(cutoff)).toEqual({ deleted: 2 });
    expect(await prisma.guestCommitment.findMany({ select: { id: true } })).toEqual([{ id: fresh.commitmentId }]);
    expect(await prisma.guestCommitment.count({ where: { id: openOld.id } })).toBe(0);
  });

  it("🚨 saklama: oluşturulma anı sınırdan eski söz, son anı (görev tarihiyle) İLERİ taşınmış olsa da silinir (Haiku incelemesi)", async () => {
    const moved = await stayWithCommitment();
    const fresh = await stayWithCommitment(moved.orgId);
    // Görev tarihi ileri taşınınca söz de taşınır (`syncCommitmentsForTaskDueAt`); kayıt yine iki buçuk yıl önce oluşturuldu.
    await prisma.guestCommitment.update({
      where: { id: moved.commitmentId },
      data: { createdAt: subMonths(new Date(), 30), dueAt: new Date(Date.now() + 365 * 86_400_000) },
    });
    expect(await purgeExpiredGuestCommitments(subMonths(new Date(), 24))).toEqual({ deleted: 1 });
    expect(await prisma.guestCommitment.findMany({ select: { id: true } })).toEqual([{ id: fresh.commitmentId }]);
  });

  it("🚨 dışa aktarma: ev sahibinin işaretlediği sözler dökümde (metin yok — tür, konu, son an, durum, kimlikler); başka işletmeninki yok", async () => {
    const a = await stayWithCommitment();
    await stayWithCommitment(); // başka işletme
    const exported = await buildOrganizationDataExport(a.orgId);
    expect(exported?.guestCommitments).toHaveLength(1);
    expect(Object.keys(exported!.guestCommitments[0]).sort()).toEqual(
      // Migration 75 (söz → görev otomatik): kesinlik / dilim / kaynak / kaynak mesaj / önceki son an / kapanış nedeni — metin YOK.
      // Migration 76: sözü yapan (visit · delivery) — metin YOK.
      [
        "actor",
        "closedAt",
        "closedReason",
        "conversationId",
        "createdAt",
        "dayPart",
        "dueAt",
        "duePrecision",
        "id",
        "kind",
        "previousDueAt",
        "source",
        "sourceMessageId",
        "status",
        "taskId",
        "topic",
      ].sort(),
    );
    expect(exported!.guestCommitments[0]).toMatchObject({ id: a.commitmentId, kind: "towels", status: "open", taskId: a.taskId });
  });
});
