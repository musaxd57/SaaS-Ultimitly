import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import {
  QR_CONVERSATION_MARKER_PREFIX,
  __guestChatHooks,
  ensureGuestChatConversation,
} from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// QR konusma KIMLIGI — planlanan @@unique([propertyId, externalReservationId])
// ile ileri-uyumluluk (Codex, 2026-07-26).
//
// Yaris eden iki "ilk tarama" AYNI iki kisiti birden ihlal eder: deterministik
// PK `qrconv_{reservationId}` VE bilesik unique. PostgreSQL hangisini
// raporlayacagini GARANTI ETMEZ — bu yuzden ikisi de "beklenen yaris" sayilir,
// baska HICBIR P2002 yutulmaz.
//
// Bilesik hedefte kazananin id'si VARSAYILMAZ: satir kimlik anahtarindan
// yeniden okunur; yoksa ya da beklenmeyen id tasiyorsa FAIL-CLOSED.
// ---------------------------------------------------------------------------

const RES = { id: "res-qr-1", guestName: "Test Misafir" };

/** Gercek Prisma P2002'sinin birebir sekli (meta.target = kolon dizisi). */
function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}

/**
 * `create` verilen hatayi firlatan, `findFirst` sirayla verilen sonuclari
 * donduren en dar sahte istemci. Ilk findFirst = kanonik okuma (null =
 * "satir yok, create dene"), ikincisi = bilesik-P2002 sonrasi yeniden okuma.
 */
function fakeDb(createError: unknown, findResults: ({ id: string } | null)[]) {
  let call = 0;
  return {
    conversation: {
      findFirst: async () => findResults[call++] ?? null,
      create: async () => {
        throw createError;
      },
    },
  } as never;
}

describe("ensureGuestChatConversation — P2002 hedef ayrimi (saf)", () => {
  it("PK P2002 → kanonik id doner (mevcut davranis korunur)", async () => {
    const id = await ensureGuestChatConversation("prop-1", RES, fakeDb(p2002(["id"]), [null]));
    expect(id).toBe("qrconv_res-qr-1");
  });

  it("BILESIK unique P2002 → kanonik id doner, 500 YOK", async () => {
    // Duzeltmeden ONCE: bu hedef `["id"]` ile eslesmedigi icin hata RETHROW
    // edilirdi ve misafir 500 alirdi. Testin kirmizi-once anlami budur.
    const id = await ensureGuestChatConversation(
      "prop-1",
      RES,
      fakeDb(p2002(["propertyId", "externalReservationId"]), [null, { id: "qrconv_res-qr-1" }]),
    );
    expect(id).toBe("qrconv_res-qr-1");
  });

  it("BILESIK P2002 ama kazanan satir BULUNAMAZ → fail-closed", async () => {
    await expect(
      ensureGuestChatConversation(
        "prop-1",
        RES,
        fakeDb(p2002(["propertyId", "externalReservationId"]), [null, null]),
      ),
    ).rejects.toThrow(/kazanan satir bulunamadi/);
  });

  it("BILESIK P2002 ama kazanan BEKLENMEYEN id tasiyor → fail-closed", async () => {
    // Kimlik modelimiz kirilmis demektir; var olmayabilecek bir id'yi sessizce
    // geri vermek yerine yuzeye cikar.
    await expect(
      ensureGuestChatConversation(
        "prop-1",
        RES,
        fakeDb(p2002(["propertyId", "externalReservationId"]), [null, { id: "legacy-random-id" }]),
      ),
    ).rejects.toThrow(/beklenmeyen satir kimligi/);
  });

  it("ILGISIZ P2002 (baska kisit) → YUTULMAZ, aynen firlatilir", async () => {
    await expect(
      ensureGuestChatConversation("prop-1", RES, fakeDb(p2002(["chatToken"]), [null])),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("P2002 OLMAYAN hata → aynen firlatilir", async () => {
    await expect(
      ensureGuestChatConversation("prop-1", RES, fakeDb(new Error("baglanti koptu"), [null])),
    ).rejects.toThrow(/baglanti koptu/);
  });
});

describe("ensureGuestChatConversation — gercek PostgreSQL yarisi", () => {
  const INDEX = "test_conversation_identity_unique";
  let indexCreated = false;

  beforeEach(async () => {
    await resetDb();
  });

  afterEach(async () => {
    __guestChatHooks.afterCanonicalRead = null;
    // Gecici index HER kosulda dusurulur — kalirsa sonraki test dosyalari
    // aciklanamayan P2002'lerle patlar.
    if (indexCreated) {
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${INDEX}"`);
      indexCreated = false;
    }
  });

  it("BILESIK unique KURULUYKEN iki esZamanli ilk-tarama TEK konusma uretir", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Test Misafir",
        arrivalDate: new Date("2026-05-30T09:00:00Z"),
        departureDate: new Date("2026-06-02T09:00:00Z"),
      },
    });

    // Gelecekteki migration'in AYNISI. Burada kurulur ki yaris, kisit CANLIYKEN
    // olcusun — migration'dan sonraki gercek uretim sartlari.
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "${INDEX}" ON "Conversation"("propertyId", "externalReservationId")`,
    );
    indexCreated = true;

    // Kanonik okuma ile create arasindaki pencereyi ac: iki cagri da "satir
    // yok" gorur, sonra ikisi de create dener → biri kaybeder.
    let released: (() => void) | null = null;
    const gate = new Promise<void>((r) => (released = r));
    let waiting = 0;
    __guestChatHooks.afterCanonicalRead = async () => {
      if (++waiting >= 2) released?.();
      await gate;
    };

    const res = { id: reservation.id, guestName: reservation.guestName };
    const [a, b] = await Promise.all([
      ensureGuestChatConversation(propertyId, res),
      ensureGuestChatConversation(propertyId, res),
    ]);

    expect(a).toBe(b);
    expect(a).toBe(`qrconv_${reservation.id}`);
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(1);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: a } });
    expect(row.externalReservationId).toBe(
      `${QR_CONVERSATION_MARKER_PREFIX}${propertyId}:${reservation.id}`,
    );
  });

  it("mevcut satir varsa create YOLU HIC kosmaz (legacy id dahil)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Test Misafir",
        arrivalDate: new Date("2026-05-30T09:00:00Z"),
        departureDate: new Date("2026-06-02T09:00:00Z"),
      },
    });
    const marker = `${QR_CONVERSATION_MARKER_PREFIX}${propertyId}:${reservation.id}`;
    // Deterministik-id duzeltmesinden ONCEKI rastgele-id'li QR satiri.
    const legacy = await prisma.conversation.create({
      data: {
        id: "legacy-random-qr-id",
        propertyId,
        channel: "chat",
        guestIdentifier: "Test Misafir",
        status: "answered",
        priority: "standard",
        lastMessageAt: new Date(),
        reservationId: reservation.id,
        externalReservationId: marker,
      },
    });

    const got = await ensureGuestChatConversation(propertyId, {
      id: reservation.id,
      guestName: reservation.guestName,
    });
    expect(got).toBe(legacy.id); // kanonik okuma bulur; fail-closed dalina HIC girilmez
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(1);
  });
});
