import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { ANON_BODY, anonymizeOldGuestData } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// SİLİNEN MİSAFİRİN OUTBOX SATIRI YENİDEN CANLANAMAZ (derin denetim, 2026-08-01
// — KRİTİK).
//
// Her iki süpürge de (açık silme + süre bazlı) outbox satırlarında gövdeyi
// ANON_BODY yapıyor, ama YALNIZCA `pending` ve `ambiguous` satırları iptal
// ediyordu. Oysa TESLİM EDİLMEMİŞ ve DİRİLTME YOLU OLAN üç durum daha var:
//
//   · `blocked`  (Hospitable 402) → `reactivateBlockedOutbox` OTOMATİK olarak
//     `pending` yapar (abonelik yenilenip senkron başarınca). Yani host
//     aboneliğini yeniledikten sonra, KVKK talebiyle silinmiş bir misafire
//     ANON_BODY sentinel'i gönderiliyordu.
//   · `failed`   → ops ekranından İNSAN eliyle `pending`'e alınabilir.
//   · `review`   → aynı şekilde `review → pending` yasal bir geçiş.
//
// "Unutulma hakkı" kullanan misafire, silinmesinden aylar sonra, üstelik
// anlamsız bir sentinel metniyle mesaj gitmesi hem söz ihlali hem utanç verici.
//
// Düzeltme: teslim edilmemiş + diriltilebilir TÜM durumlar tek kaynaktan
// (`ERASABLE_STATUSES`) iptal edilir. İSTİSNALAR bilinçli:
//   · `sent`     → gerçekten teslim edildi; teslimat geçmişi yeniden yazılmaz.
//   · `canceled` → zaten ölü.
//   · `sending`/`reconciling` → CLAIM EDİLMİŞ, uçuşta (belgeli dar istisna:
//     gövde temizlenir, durum işçiye bırakılır).
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable", () => ({
  listProperties: vi.fn(),
  listReservations: vi.fn(),
  listMessages: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { eraseReservationData } from "@/lib/erasure";
import { reactivateBlockedOutbox } from "@/lib/outbox/worker";
import { requeueFailedOutbox } from "@/lib/outbox/ops";
import { OUTBOX_STATUSES, ERASABLE_STATUSES } from "@/lib/outbox/state";

const DAY = 86_400_000;
const GUEST_TEXT = "Merhaba Ada Lovelace, kapı kodunuz 1234.";

/** Bir konaklama + her outbox durumundan bir satır. */
async function seedStayWithOutbox(opts: { ageDays: number }) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const arrival = new Date(Date.now() - opts.ageDays * DAY);
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ada Lovelace",
      guestEmail: "ada@example.com",
      guestPhone: "+90 555 123 45 67",
      guestExternalId: "guest-777",
      sourceReference: "res-1",
      arrivalDate: arrival,
      departureDate: new Date(arrival.getTime() + 3 * DAY),
      status: "completed",
      channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      reservationId: reservation.id,
      externalReservationId: "res-1",
      channel: "airbnb",
      guestIdentifier: "Ada Lovelace",
      status: "answered",
      lastMessageAt: arrival,
    },
  });
  for (const status of OUTBOX_STATUSES) {
    await prisma.messageOutbox.create({
      data: {
        organizationId: orgId,
        conversationId: conversation.id,
        reservationId: reservation.id,
        channel: "airbnb",
        body: GUEST_TEXT,
        idempotencyKey: `ob-${status}`,
        status,
        // Uçuştaki satırlar tanımı gereği claim edilmiştir.
        ...(status === "sending" || status === "reconciling"
          ? { claimedBy: "worker-1", claimExpiresAt: new Date(Date.now() + 60_000) }
          : {}),
        ...(status === "sent" ? { sentAt: new Date() } : {}),
      },
    });
  }
  return { orgId, reservationId: reservation.id };
}

const byKey = async (key: string) =>
  prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: key } });

describe("silinen misafirin outbox satırı yeniden canlanamaz", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("durum listesi EKSİKSİZ bölünmüştür (yeni durum eklenirse bu test kırılır)", () => {
    // Beklenen kapsam AÇIKÇA yazılı: sabiti daraltmak bu testi kırar.
    expect([...ERASABLE_STATUSES].sort()).toEqual(
      ["ambiguous", "blocked", "failed", "pending", "review"].sort(),
    );
    // Bölünme EKSİKSİZ: kapalı kümedeki her durum ya temizlenir ya da GEREKÇELİ
    // olarak dışarıdadır. Yeni bir durum eklenirse burada karar vermek zorunlu.
    const decided = new Set<string>([
      ...ERASABLE_STATUSES,
      "sent", // teslim edildi
      "canceled", // zaten ölü
      "sending", // claim edilmiş, uçuşta
      "reconciling", // claim edilmiş, uçuşta
    ]);
    for (const s of OUTBOX_STATUSES) expect(decided.has(s)).toBe(true);
  });

  it("AÇIK SİLME: blocked/failed/review satırları da iptal edilir", async () => {
    const { orgId, reservationId } = await seedStayWithOutbox({ ageDays: 30 });
    await eraseReservationData(orgId, reservationId);

    // ⚠️ Durumlar BURADA AÇIKÇA yazılı — `ERASABLE_STATUSES` üzerinde dönmek
    // testi kendi kendine ayarlanır hâle getirirdi: biri sabiti daraltsa test
    // yine yeşil kalırdı (mutasyonda birebir bu görüldü).
    for (const status of ["pending", "ambiguous", "blocked", "failed", "review"]) {
      const row = await byKey(`ob-${status}`);
      expect(`${status}:${row.status}`).toBe(`${status}:canceled`);
      expect(row.body).toBe(ANON_BODY);
    }
  });

  it("AÇIK SİLME sonrası abonelik yenilense bile satır DİRİLMEZ", async () => {
    const { orgId, reservationId } = await seedStayWithOutbox({ ageDays: 30 });
    await eraseReservationData(orgId, reservationId);

    // Host aboneliğini yeniledi → senkron başarılı → reaktivasyon çağrılır.
    const revived = await reactivateBlockedOutbox(orgId);
    expect(revived).toBe(0);
    expect((await byKey("ob-blocked")).status).toBe("canceled");
  });

  it("teslim edilmiş ve uçuştaki satırlara DOKUNULMAZ (belgeli istisnalar)", async () => {
    const { orgId, reservationId } = await seedStayWithOutbox({ ageDays: 30 });
    await eraseReservationData(orgId, reservationId);

    expect((await byKey("ob-sent")).status).toBe("sent");
    expect((await byKey("ob-sending")).status).toBe("sending");
    expect((await byKey("ob-reconciling")).status).toBe("reconciling");
    // Gövde yine de temizlenir — istisna DURUM içindir, PII için değil.
    for (const k of ["ob-sent", "ob-sending", "ob-reconciling"]) {
      expect((await byKey(k)).body).toBe(ANON_BODY);
    }
  });

  it("SÜRE BAZLI süpürge de aynı kapsamı uygular (iki süpürge paritesi)", async () => {
    const { orgId } = await seedStayWithOutbox({ ageDays: 40 * 30 }); // ~40 ay
    await anonymizeOldGuestData();

    for (const status of ["pending", "ambiguous", "blocked", "failed", "review"]) {
      const row = await byKey(`ob-${status}`);
      expect(`${status}:${row.status}`).toBe(`${status}:canceled`);
    }
    expect((await byKey("ob-sent")).status).toBe("sent");
    expect(await reactivateBlockedOutbox(orgId)).toBe(0);
  });

  it("İKİNCİ SAVUNMA: temizlenmiş gövdeli bir blocked satırı reaktive EDİLMEZ", async () => {
    // Süpürgeler bir gün bir yolu kaçırırsa (ör. konuşma bağı kopmuş satır),
    // reaktivasyon yine de sentinel göndermemeli.
    const { orgId } = await makeOrgWithProperty();
    await prisma.messageOutbox.create({
      data: {
        organizationId: orgId,
        channel: "airbnb",
        body: ANON_BODY,
        idempotencyKey: "ob-orphan-blocked",
        status: "blocked",
      },
    });
    expect(await reactivateBlockedOutbox(orgId)).toBe(0);
    expect((await byKey("ob-orphan-blocked")).status).toBe("blocked");
  });

  it("İKİNCİ SAVUNMA: temizlenmiş gövdeli failed satırı ops ekranından da diriltilemez", async () => {
    const { orgId } = await makeOrgWithProperty();
    const row = await prisma.messageOutbox.create({
      data: {
        organizationId: orgId,
        channel: "airbnb",
        body: ANON_BODY,
        idempotencyKey: "ob-orphan-failed",
        status: "failed",
        lastErrorCode: "HTTP 422",
      },
    });
    const res = await requeueFailedOutbox(orgId, row.id);
    expect(res.outcome).toBe("not_retryable");
    expect((await byKey("ob-orphan-failed")).status).toBe("failed");
  });

  it("temizlenmemiş normal failed satırı ops ekranından NORMAL diriltilir (regresyon pini)", async () => {
    const { orgId } = await makeOrgWithProperty();
    const row = await prisma.messageOutbox.create({
      data: {
        organizationId: orgId,
        channel: "airbnb",
        body: "Merhaba, kapı kodunuz 1234.",
        idempotencyKey: "ob-live-failed",
        status: "failed",
        lastErrorCode: "HTTP 422",
      },
    });
    const res = await requeueFailedOutbox(orgId, row.id);
    expect(res.outcome).toBe("requeued");
    expect((await byKey("ob-live-failed")).status).toBe("pending");
  });

  it("temizlenmemiş normal blocked satırı NORMAL şekilde reaktive olur (regresyon pini)", async () => {
    const { orgId } = await makeOrgWithProperty();
    await prisma.messageOutbox.create({
      data: {
        organizationId: orgId,
        channel: "airbnb",
        body: "Merhaba, hoş geldiniz!",
        idempotencyKey: "ob-live-blocked",
        status: "blocked",
      },
    });
    expect(await reactivateBlockedOutbox(orgId)).toBe(1);
    expect((await byKey("ob-live-blocked")).status).toBe("pending");
  });
});
