import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { importThread, __importThreadHooks } from "@/lib/hospitable-sync";
import { isUniqueViolation } from "@/lib/db-errors";
import type { HospitableMessage, HospitableReservation } from "@/lib/hospitable";

// ---------------------------------------------------------------------------
// FAZ A — sync tarafı, unique HENÜZ YOKKEN yarışı önlüyor mu?
//
// 2026-07-26 prod preflight'ı 7 çakışan grup buldu; hepsi TAM 2 satır ve
// hepsinde `externalConversationId` AYNI. Yani sağlayıcı tek thread verdi,
// iki satırı BİZ açtık: `importThread`in çıplak findFirst → create'i iki
// eşzamanlı koşucuda ikisi de "yok" görüp ikisi de yaratabiliyordu.
//
// Bu dosya kilidi GERÇEK PostgreSQL'de kanıtlar. Kilit olmadan bu testler
// kırmızıdır (mutasyonla doğrulandı): iki konuşma + iki kat mesaj oluşur.
//
// PROD'A DOKUNULMAZ: yalnız throwaway test veritabanı. Dedupe/migration YOK.
// ---------------------------------------------------------------------------

const EXT_RES = "prov-res-uuid-1";
const IDENTITY_INDEX = "test_only_conv_identity_uq";

function reservation(): HospitableReservation {
  return {
    id: EXT_RES,
    code: "ABC123",
    platform: "airbnb",
    conversation_id: "prov-conv-uuid-1",
    last_message_at: "2026-07-20T10:00:00Z",
    guest: { id: "g1", full_name: "Test Misafir" },
  };
}

function messages(): HospitableMessage[] {
  return [1, 2, 3].map((n) => ({
    id: `msg-${n}`,
    body: `Misafir mesaji ${n}`,
    created_at: `2026-07-20T0${n}:00:00Z`,
    sender_type: "guest",
    sender: { full_name: "Test Misafir" },
  }));
}

/** One-shot delay: only the FIRST importer sleeps, so the second isn't slowed. */
function delayOnce(ms: number): () => Promise<void> {
  let fired = false;
  return async () => {
    if (fired) return;
    fired = true;
    await new Promise((r) => setTimeout(r, ms));
  };
}

/** Run one importThread in its own transaction — a standalone sync runner. */
function runImport(propertyId: string) {
  return prisma.$transaction(
    (tx) => importThread(tx, propertyId, reservation(), messages(), null),
    { timeout: 30_000, maxWait: 15_000 },
  );
}

describe("sync — conversation identity lock (Faz A)", () => {
  beforeEach(async () => {
    await resetDb();
    __importThreadHooks.afterCanonicalRead = null;
  });

  afterEach(async () => {
    __importThreadHooks.afterCanonicalRead = null;
    // Test-local DDL temizliği — migration DEĞİL, yalnız bu dosyanın kurduğu index.
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${IDENTITY_INDEX}"`);
  });

  it("iki PARALEL importThread → TEK conversation, TEK mesaj seti", async () => {
    const { propertyId } = await makeOrgWithProperty();
    // Kanonik okuma ile yazma arasındaki pencereyi yapay olarak aç: kilit
    // olmasaydı ikinci koşucu tam buradan içeri girip ikinci satırı açardı.
    __importThreadHooks.afterCanonicalRead = delayOnce(250);

    const a = runImport(propertyId);
    await new Promise((r) => setTimeout(r, 50)); // A kilidi kesin önce alsın
    const b = runImport(propertyId);
    await Promise.all([a, b]);

    const convs = await prisma.conversation.findMany({
      where: { propertyId, externalReservationId: EXT_RES },
      select: { id: true },
    });
    expect(convs).toHaveLength(1);
    expect(await prisma.message.count({ where: { conversationId: convs[0].id } })).toBe(3);
    // Hiçbir mesaj başka bir konuşmaya kaçmamış olmalı.
    expect(await prisma.message.count()).toBe(3);
  });

  it("ikinci koşucu mesaj KAYBETTİRMEZ — yeni gelen mesaj yine yazılır", async () => {
    // Kilit "ikinciyi sustur" demek değil: kanonik satırı bulup ONA yazmalı.
    const { propertyId } = await makeOrgWithProperty();
    await runImport(propertyId);

    const extra = [...messages(), {
      id: "msg-4",
      body: "Sonradan gelen mesaj",
      created_at: "2026-07-20T04:00:00Z",
      sender_type: "guest",
      sender: { full_name: "Test Misafir" },
    }];
    await prisma.$transaction((tx) => importThread(tx, propertyId, reservation(), extra, null), {
      timeout: 30_000,
      maxWait: 15_000,
    });

    const convs = await prisma.conversation.findMany({
      where: { propertyId, externalReservationId: EXT_RES },
      select: { id: true },
    });
    expect(convs).toHaveLength(1);
    expect(await prisma.message.count({ where: { conversationId: convs[0].id } })).toBe(4);
  });

  it("AYNI rezervasyon kimliği FARKLI mülkte ayrı konuşmadır (kilit fazla kilitlemiyor)", async () => {
    const one = await makeOrgWithProperty();
    const two = await makeOrgWithProperty();
    await Promise.all([runImport(one.propertyId), runImport(two.propertyId)]);
    expect(await prisma.conversation.count()).toBe(2);
  });
});

describe("sync — unique KURULDUKTAN sonraki dünya provası", () => {
  beforeEach(async () => {
    await resetDb();
    __importThreadHooks.afterCanonicalRead = null;
  });

  afterEach(async () => {
    __importThreadHooks.afterCanonicalRead = null;
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${IDENTITY_INDEX}"`);
  });

  /**
   * Gelecekteki `@@unique([propertyId, externalReservationId])` kısıtını YALNIZ
   * test veritabanında, YALNIZ bu testin ömrü boyunca kurar. Migration DEĞİL:
   * prisma/migrations altına hiçbir şey yazılmaz, prod'a dokunulmaz.
   */
  async function createIdentityIndex() {
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "${IDENTITY_INDEX}" ON "Conversation" ("propertyId", "externalReservationId")`,
    );
  }

  it("kısıt VARKEN iki paralel importThread hâlâ TEK satır üretir (P2002 hiç olmaz)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await createIdentityIndex();
    __importThreadHooks.afterCanonicalRead = delayOnce(250);

    const a = runImport(propertyId);
    await new Promise((r) => setTimeout(r, 50));
    const b = runImport(propertyId);
    // Kilit sırayı zorladığı için ikisi de HATASIZ biter — P2002 yolu hiç
    // tetiklenmez. (Tetiklenseydi burada throw olurdu.)
    await expect(Promise.all([a, b])).resolves.toHaveLength(2);

    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(1);
    expect(await prisma.message.count()).toBe(3);
  });

  it("kilidi ATLAYAN bir yazıcı P2002 üretir; hata doğru sınıflanır ve tekrar deneme yakınsar", async () => {
    // Kilide uymayan bir yazıcı (legacy yol / elle düzeltme) yarışı kazanırsa
    // importThread'in create'i P2002 alır ve PostgreSQL TÜM transaction'ı iptal
    // eder — bu yüzden kurtarma TX'in İÇİNDE olamaz, çağırandaki tek seferlik
    // RETRY'dir. Burada hem tetikleyicinin doğru sınıflandığını hem de
    // retry'nin yakınsadığını pinliyoruz.
    const { propertyId } = await makeOrgWithProperty();
    await createIdentityIndex();

    __importThreadHooks.afterCanonicalRead = delayOnce(1); // pencere yeterli
    // Kanonik satırı importThread'den ÖNCE, kilit dışından yaz.
    await prisma.conversation.create({
      data: {
        propertyId,
        guestIdentifier: "Test Misafir",
        channel: "airbnb",
        externalReservationId: EXT_RES,
      },
    });
    // Aynı satır zaten var → importThread onu bulur ve UPDATE eder, P2002 olmaz.
    await runImport(propertyId);
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(1);
    expect(await prisma.message.count()).toBe(3);

    // Şimdi gerçek P2002: kilidin göremeyeceği bir çakışma (aynı anahtar, ham SQL).
    let caught: unknown = null;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Conversation" ("id","propertyId","guestIdentifier","channel","externalReservationId","lastMessageAt","createdAt","updatedAt")
         VALUES ('kacak_satir', $1, 'X', 'airbnb', $2, now(), now(), now())`,
        propertyId,
        EXT_RES,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();

    // Prisma'nın P2002 sınıflandırması, çağırandaki retry koşuluyla BİREBİR aynı
    // kolon kümesini görmeli — görmezse retry sessizce hiç tetiklenmez.
    let p2002: unknown = null;
    try {
      await prisma.conversation.create({
        data: {
          propertyId,
          guestIdentifier: "Y",
          channel: "airbnb",
          externalReservationId: EXT_RES,
        },
      });
    } catch (err) {
      p2002 = err;
    }
    expect(isUniqueViolation(p2002, ["propertyId", "externalReservationId"])).toBe(true);
    // Yabancı bir kısıtla karıştırılmamalı.
    expect(isUniqueViolation(p2002, ["conversationId", "externalId"])).toBe(false);

    // Retry'nin etkisi: yeni bir importThread kanonik satırı bulur, ikinci satır
    // AÇMAZ ve mesajları kaybetmez.
    await runImport(propertyId);
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(1);
    expect(await prisma.message.count()).toBe(3);
  });
});
