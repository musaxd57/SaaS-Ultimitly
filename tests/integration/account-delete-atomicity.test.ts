import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// TX'İ İÇERİDEN patlatmanın tek dürüst yolu: `prisma.organization.delete`
// üzerine spy koymak İŞE YARAMAZ (transaction istemcisi AYRI bir nesnedir —
// ilk denemede tam olarak bu yüzden hiç patlamadı). `enqueueStorageDeletions`
// org silmeden SONRA ve AYNI transaction içinde çağrılıyor, yani oradan
// fırlatmak gerçek bir "commit edilmemiş TX" senaryosu üretir.
vi.mock("@/lib/storage/deletion-queue", async (orig) => {
  const actual = await orig<typeof import("@/lib/storage/deletion-queue")>();
  return { ...actual, enqueueStorageDeletions: vi.fn(actual.enqueueStorageDeletions) };
});

import { enqueueStorageDeletions } from "@/lib/storage/deletion-queue";
import { deleteAccountData } from "@/lib/data-retention";

const mockEnqueue = vi.mocked(enqueueStorageDeletions);

// ---------------------------------------------------------------------------
// WEBHOOK REDAKSİYONU + ORG SİLME ATOMİK (Codex denetimi, 2026-08-01 — madde 3).
//
// Redaksiyon eskiden transaction'dan ÖNCE koşuyordu. Silme patlarsa ortaya
// TUTARSIZ bir ara hâl çıkıyordu: org SİLİNMEMİŞ ama fatura webhook'ları
// redakte edilmiş — yani hâlâ MÜŞTERİ olan birinin kayıtları yarım budanmış ve
// bunun hiçbir yerde izi yok.
//
// Yeni sözleşme: ya İKİSİ de olur ya HİÇBİRİ.
//
// ⚠️ Gizlilik kaybı yok: silme başarısızsa kullanıcı hata alır ve yeniden dener;
// başarılı denemede redaksiyon yine yapılır. Kalıcı olarak silinemeyen bir org
// zaten hâlâ müşteridir — verisinin durması tutarlıdır.
// ---------------------------------------------------------------------------

const PII_EMAIL = "guest-billing@example.com";
const PII_NAME = "Ahmet Yılmaz";

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  await prisma.subscription.create({
    data: {
      organizationId: org.id,
      provider: "paddle",
      status: "canceled",
      planCode: "pro",
      providerRef: "sub_123",
      customerId: "ctm_123",
    },
  });
  await prisma.webhookEvent.create({
    data: {
      provider: "paddle",
      providerEventId: "evt_1",
      eventType: "transaction.completed",
      status: "processed",
      payloadJson: JSON.stringify({
        data: {
          id: "txn_1",
          subscription_id: "sub_123",
          customer_id: "ctm_123",
          custom_data: { organizationId: org.id },
          customer: { email: PII_EMAIL, name: PII_NAME },
        },
      }),
    },
  });
  // Depolama destekli bir görev fotoğrafı: `enqueueStorageDeletions`'ın TX
  // içinde çağrılmasını (ve testte oradan fırlatılabilmesini) sağlar.
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "P" },
  });
  const task = await prisma.task.create({
    data: { propertyId: property.id, title: "T", type: "cleaning", status: "todo" },
  });
  await prisma.taskUpdate.create({
    data: {
      taskId: task.id,
      // ⚠️ Anahtar şekli KATI: `org/{orgId}/task/{taskId}/{dosya}` (5 segment).
      // İlk denemede uydurma bir yol yazmıştım ve `keyFromPhotoUrl` onu
      // reddettiği için `enqueueStorageDeletions` HİÇ çağrılmıyordu — test
      // yanlış sebeple kırmızıydı (vacuous kırmızı da bir tuzaktır).
      photoUrl: `/api/storage/photo/org/${org.id}/task/${task.id}/photo.jpg`,
    },
  });
  return { orgId: org.id };
}

describe("deleteAccountData — redaksiyon ve silme ATOMİK", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("BAŞARILI silmede İKİSİ de olur (org gider, PII redakte edilir)", async () => {
    const { orgId } = await seed();
    await deleteAccountData(orgId);

    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0);
    const evt = await prisma.webhookEvent.findFirstOrThrow({ where: { providerEventId: "evt_1" } });
    expect(evt.payloadJson).not.toContain(PII_EMAIL);
    expect(evt.payloadJson).not.toContain(PII_NAME);
  });

  it("SİLME PATLARSA redaksiyon da GERİ SARILIR (yarım budanmış müşteri yok)", async () => {
    const { orgId } = await seed();
    mockEnqueue.mockRejectedValueOnce(new Error("simulated in-transaction failure"));

    await expect(deleteAccountData(orgId)).rejects.toThrow(/simulated in-transaction failure/);

    // Org DURUYOR…
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(1);
    // …ve payload'ı HÂLÂ TAM (⬅️ ARIZADA redakte edilmiş, org yaşıyor olurdu).
    const evt = await prisma.webhookEvent.findFirstOrThrow({ where: { providerEventId: "evt_1" } });
    expect(evt.payloadJson).toContain(PII_EMAIL);
    expect(evt.payloadJson).toContain(PII_NAME);
  });

  it("KAYNAK PİNİ: silme TX'i AÇIK süre sınırı taşır (varsayılan 5 sn YETMEZ)", async () => {
    // ⚠️ Redaksiyonu TX'e almak, işi Prisma'nın VARSAYILAN 5 saniyelik
    // interactive-transaction penceresine hapsediyor (`db.ts` `transactionOptions`
    // vermiyor). Redaksiyon `payloadJson: { contains }` ile İKİ kez indekslenemez
    // bir LIKE '%…%' taraması yapıyor ve `WebhookEvent` hiçbir yerde budanmıyor →
    // tablo büyüdükçe süre aşılır ve P2028 ile TÜM silme geri sarılır: "yarım
    // redaksiyon" hâlini düzeltirken "hesap HİÇ silinemiyor" hâlini açardık.
    // Davranışsal test için gerçekten yavaş bir TX üretmek gerekir; bu YAPISAL
    // pin, değerin sessizce düşmesini engeller (bağımsız denetim, 08-01).
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/data-retention.ts", "utf8");
    const txStart = src.indexOf("await prisma.$transaction(async (tx) => {");
    const tail = src.slice(txStart, txStart + 4000);
    expect(tail).toMatch(/timeout:\s*180_000/);
    expect(tail).toMatch(/maxWait:\s*15_000/);
    // Kardeş KVKK yollarıyla AYNI değerler (tek bir yerde sapmasın).
    const erasure = await fs.readFile("src/lib/erasure.ts", "utf8");
    expect(erasure).toMatch(/timeout:\s*180_000, maxWait:\s*15_000/);
  });

  it("KAYNAK PİNİ: redaksiyon TX'in İÇİNDEN ve org silmeden ÖNCE çağrılır", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/data-retention.ts", "utf8");
    const tx = src.slice(
      src.indexOf("await prisma.$transaction(async (tx) => {"),
      src.indexOf("// KVKK: task photos live on local disk"),
    );
    const redactAt = tx.indexOf("await redactPaddleWebhooksForOrg(tx, organizationId)");
    const deleteAt = tx.indexOf("await tx.organization.delete(");
    expect(redactAt).toBeGreaterThan(-1); // TX'in içinde
    expect(deleteAt).toBeGreaterThan(-1);
    expect(redactAt).toBeLessThan(deleteAt); // ve silmeden ÖNCE
    // TX'ten ÖNCE ikinci bir çağrı KALMADI.
    const beforeTx = src.slice(0, src.indexOf("await prisma.$transaction(async (tx) => {"));
    expect(beforeTx).not.toMatch(/await redactPaddleWebhooksForOrg\(/);
  });
});
