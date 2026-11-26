import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  prisma,
  resetDb,
  dropConversationIdentityUnique,
  restoreConversationIdentityUnique,
} from "../helpers/db";
import {
  collectPreflight,
  decide,
  formatReport,
} from "../../scripts/preflight-conversation-dupes.mjs";

// MIGRATION 45 ESCAPE HATCH. The preflight exists to FIND the duplicates the
// constraint now forbids, so it can only be tested against a database where the
// index is absent — exactly the pre-migration world it was written for. Files
// run sequentially (fileParallelism: false), and the restore doubles as a check
// that the schema comes back intact.
beforeAll(dropConversationIdentityUnique);
afterAll(restoreConversationIdentityUnique);

// ---------------------------------------------------------------------------
// Preflight — GERÇEK PostgreSQL karşısında.
//
// Bu script prod'a bağlanacak; bu yüzden "salt-okuma" ve "PII basmaz" iddiaları
// TEST EDİLİR, beyan edilmez:
//   · READ ONLY'yi VERİTABANI uyguluyor mu (yazım denemesi reddediliyor mu)?
//   · Primary'de kaza eseri koşabiliyor mu?
//   · QR / Hospitable / manuel satırlar AYRI mı sayılıyor?
//   · LIMIT'li örnek listesi TAM sayıları bozuyor mu?
//   · Çıktının hiçbir yerinde ham kimlik var mı?
//
// Prod'da ÇALIŞTIRILMADI: burada yalnız throwaway test veritabanı kullanılıyor.
// ---------------------------------------------------------------------------

const ALLOW = { allowPrimary: true };

/** Testlerin kullandığı ham kimlikler — çıktıda ASLA görünmemeli. */
const IDS = {
  same: "res-uuid-same-0000",
  mixed: "res-uuid-mixed-000",
  allNull: "res-uuid-allnull-0",
  conflict: "res-uuid-conflict",
  clean: "res-uuid-clean-000",
  convA: "conv-uuid-aaaa",
  convB: "conv-uuid-bbbb",
  convC: "conv-uuid-cccc",
  convD: "conv-uuid-dddd",
};

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Preflight Org" } });
  const propA = await prisma.property.create({
    data: { organizationId: org.id, name: "Daire A" },
  });
  const propB = await prisma.property.create({
    data: { organizationId: org.id, name: "Daire B" },
  });

  const mkRes = (name: string) =>
    prisma.reservation.create({
      data: {
        propertyId: propA.id,
        guestName: name,
        arrivalDate: new Date("2026-08-01T00:00:00Z"),
        departureDate: new Date("2026-08-05T00:00:00Z"),
      },
    });
  const resQrClean = await mkRes("QR Temiz");
  const resQrLegacy = await mkRes("QR Legacy");

  const conv = (data: {
    channel?: string;
    externalReservationId?: string | null;
    externalConversationId?: string | null;
  }) =>
    prisma.conversation.create({
      data: {
        propertyId: propA.id,
        guestIdentifier: "Misafir",
        channel: data.channel ?? "airbnb",
        externalReservationId: data.externalReservationId ?? null,
        externalConversationId: data.externalConversationId ?? null,
      },
    });

  // Manuel: externalReservationId NULL. PostgreSQL'de NULL'lar distinct sayılır,
  // dolayısıyla bunlar kısıtlamayı HİÇ ilgilendirmez — iki tane var, çakışma değil.
  await conv({ channel: "manual", externalReservationId: null });
  await conv({ channel: "manual", externalReservationId: null });

  // Hospitable — tekil (çakışma yok).
  await conv({ externalReservationId: IDS.clean, externalConversationId: IDS.convA });

  // Hospitable — kesin yarış artığı: iki satır, AYNI conversation id.
  await conv({ externalReservationId: IDS.same, externalConversationId: IDS.convA });
  await conv({ externalReservationId: IDS.same, externalConversationId: IDS.convA });

  // Hospitable — karışık: bir satırda değer var, diğerinde NULL.
  await conv({ externalReservationId: IDS.mixed, externalConversationId: IDS.convB });
  await conv({ externalReservationId: IDS.mixed, externalConversationId: null });

  // Hospitable — sağlayıcı kanıtı yok: her iki satır da NULL.
  await conv({ externalReservationId: IDS.allNull, externalConversationId: null });
  await conv({ externalReservationId: IDS.allNull, externalConversationId: null });

  // Hospitable — ÇELİŞKİ: sağlayıcı iki FARKLI thread id'si vermiş.
  const conflictKeeper = await conv({
    externalReservationId: IDS.conflict,
    externalConversationId: IDS.convC,
  });
  await conv({ externalReservationId: IDS.conflict, externalConversationId: IDS.convD });

  // AYNI externalReservationId, FARKLI mülk → bileşik anahtar bunları ayırır,
  // çakışma DEĞİLDİR (tek-kolon unique yanlış olurdu — bu satır onu pinler).
  await prisma.conversation.create({
    data: {
      propertyId: propB.id,
      guestIdentifier: "Misafir",
      channel: "airbnb",
      externalReservationId: IDS.same,
      externalConversationId: IDS.convA,
    },
  });

  // QR — deterministik id, tek satır (çakışma yok).
  await prisma.conversation.create({
    data: {
      id: `qrconv_${resQrClean.id}`,
      propertyId: propA.id,
      guestIdentifier: "QR Temiz",
      channel: "chat",
      reservationId: resQrClean.id,
      externalReservationId: `qr-chat:${propA.id}:${resQrClean.id}`,
    },
  });

  // QR — LEGACY çift satır: deterministik-id düzeltmesinden ÖNCEKİ rastgele-id'li
  // satır aynı marker'ı paylaşıyor. Bu tek başına unique migration'ı patlatır.
  await prisma.conversation.create({
    data: {
      id: `qrconv_${resQrLegacy.id}`,
      propertyId: propA.id,
      guestIdentifier: "QR Legacy",
      channel: "chat",
      reservationId: resQrLegacy.id,
      externalReservationId: `qr-chat:${propA.id}:${resQrLegacy.id}`,
    },
  });
  await prisma.conversation.create({
    data: {
      propertyId: propA.id, // rastgele cuid — legacy satır
      guestIdentifier: "QR Legacy",
      channel: "chat",
      reservationId: resQrLegacy.id,
      externalReservationId: `qr-chat:${propA.id}:${resQrLegacy.id}`,
    },
  });

  // Bağlı kayıtlar — dedupe'un taşıması gereken hacim (FK'lı ve FK'sız).
  await prisma.message.createMany({
    data: [
      { conversationId: conflictKeeper.id, direction: "inbound", senderName: "M", body: "a" },
      { conversationId: conflictKeeper.id, direction: "outbound", senderName: "H", body: "b" },
      { conversationId: conflictKeeper.id, direction: "inbound", senderName: "M", body: "c" },
    ],
  });
  await prisma.messageOutbox.create({
    data: {
      organizationId: org.id,
      conversationId: conflictKeeper.id,
      channel: "airbnb",
      body: "kuyrukta",
      idempotencyKey: "preflight-test-1",
    },
  });
  await prisma.riskEvent.create({
    data: {
      organizationId: org.id,
      conversationId: conflictKeeper.id,
      surface: "auto_reply",
      triggerId: "trig-1",
      finalDecision: "human_review",
    },
  });
  await prisma.shadowVerdict.create({
    data: {
      organizationId: org.id,
      conversationId: conflictKeeper.id,
      triggerId: "trig-1",
      gateDecision: "human_review",
      model: "test",
    },
  });

  return { orgId: org.id, propA: propA.id, propB: propB.id };
}

describe("preflight — güvenlik kapıları", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("READ ONLY'yi VERİTABANI uygular ve doğrular", async () => {
    const stats = await collectPreflight(prisma, ALLOW);
    expect(stats.ctx.read_only).toBe("on");
    expect(stats.ctx.isolation).toBe("repeatable read");
  });

  it("aynı kapı altında bir YAZIM denemesi sunucu tarafından reddedilir", async () => {
    // "Yalnız SELECT yazdım" bir niyet beyanıdır. Kapının gerçek olduğunun
    // kanıtı: read-only transaction içinde bir DELETE'in PATLAMASI.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.$executeRawUnsafe(`DELETE FROM "Conversation" WHERE id = 'yok-boyle-bir-satir'`);
      }),
    ).rejects.toThrow(/read-only|only.*transaction/i);
  });

  it("zaman aşımları gerçekten uygulanır ve hiçbiri sınırsız değil", async () => {
    const stats = await collectPreflight(prisma, ALLOW);
    for (const v of [
      stats.ctx.statement_timeout,
      stats.ctx.lock_timeout,
      stats.ctx.idle_tx_timeout,
    ]) {
      expect(v).not.toBe("0"); // 0 = sınırsız = kilit kuyruğu riski geri gelir
    }
    expect(stats.ctx.statement_timeout).toBe("30s");
    expect(stats.ctx.lock_timeout).toBe("3s");
    expect(stats.ctx.idle_tx_timeout).toBe("15s");
  });

  it("PRIMARY'de kaza eseri koşmaz — bilinçli onay ister", async () => {
    // Test veritabanı bir primary (pg_is_in_recovery = false), tıpkı prod gibi.
    await expect(collectPreflight(prisma)).rejects.toThrow(/PREFLIGHT_ALLOW_PRIMARY/);
  });
});

describe("preflight — sınıflandırma ve sayım", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("QR / Hospitable / manuel satırları AYRI sayar", async () => {
    await seed();
    const s = await collectPreflight(prisma, ALLOW);

    expect(s.totals.total).toBe(15);
    expect(s.totals.manual_null).toBe(2); // kısıtlamayı ilgilendirmez (NULL distinct)
    expect(s.totals.qr).toBe(3);
    expect(s.totals.hospitable).toBe(10);
    // Legacy = deterministik qrconv_ id'sini TAŞIMAYAN QR satırı: 3 QR satırından 1'i.
    expect(s.qr.qr_total).toBe(3);
    expect(s.qr.qr_legacy).toBe(1);
  });

  it("çakışan grupları kanıt gücüne göre kovalara ayırır", async () => {
    await seed();
    const s = await collectPreflight(prisma, ALLOW);

    expect(s.groups.hosp_groups).toBe(4);
    expect(s.groups.hosp_same).toBe(1); // hepsi aynı conv id → kesin yarış artığı
    expect(s.groups.hosp_mixed).toBe(1); // değer + NULL → belirsiz
    expect(s.groups.hosp_all_null).toBe(1); // sağlayıcı kanıtı yok
    expect(s.groups.hosp_conflicting).toBe(1); // farklı conv id → ÇELİŞKİ
    expect(s.groups.qr_groups).toBe(1); // legacy QR çifti AYRI kovada
    expect(s.groups.max_group_rows).toBe(2);
    // Grup büyüklüğü dağılımı: dedupe'un "keeper seç + N-1 birleştir" işi.
    expect(s.groups.groups_of_2).toBe(5);
    expect(s.groups.groups_of_3_plus).toBe(0);
  });

  it("marker'ını paylaşmayan legacy QR satırı çakışma SAYILMAZ", async () => {
    // Codex düzeltmesinin canlı-veri karşılığı: eski-id'li tek bir QR satırı
    // unique'i ihlal etmez, dolayısıyla dedupe gerektirmez.
    const org = await prisma.organization.create({ data: { name: "Tek Legacy" } });
    const prop = await prisma.property.create({
      data: { organizationId: org.id, name: "Daire" },
    });
    const res = await prisma.reservation.create({
      data: {
        propertyId: prop.id,
        guestName: "Misafir",
        arrivalDate: new Date("2026-08-01T00:00:00Z"),
        departureDate: new Date("2026-08-05T00:00:00Z"),
      },
    });
    await prisma.conversation.create({
      data: {
        // rastgele cuid = legacy (qrconv_ deseninde DEĞİL), ama TEK satır
        propertyId: prop.id,
        guestIdentifier: "Misafir",
        channel: "chat",
        reservationId: res.id,
        externalReservationId: `qr-chat:${prop.id}:${res.id}`,
      },
    });

    const s = await collectPreflight(prisma, ALLOW);
    expect(s.qr.qr_legacy).toBe(1); // legacy VAR
    expect(s.groups.qr_groups).toBe(0); // ama çakışma YOK
    expect(decide(s)).toEqual({ code: "TEMIZ", exitCode: 0 });
  });

  it("aynı externalReservationId farklı mülkteyse çakışma DEĞİLDİR", async () => {
    const { propB } = await seed();
    const before = await collectPreflight(prisma, ALLOW);
    // B mülkündeki tekil satırı silmek grup sayısını DEĞİŞTİRMEMELİ — bileşik
    // anahtar zaten onu ayırıyordu.
    await prisma.conversation.deleteMany({ where: { propertyId: propB } });
    const after = await collectPreflight(prisma, ALLOW);
    expect(after.groups.hosp_groups).toBe(before.groups.hosp_groups);
    expect(after.totals.total).toBe(before.totals.total - 1);
  });

  it("dedupe'un taşıyacağı bağlı kayıt hacmini FK'sız tablolar dahil ölçer", async () => {
    await seed();
    const s = await collectPreflight(prisma, ALLOW);

    expect(s.impact.conversations).toBe(10); // 8 Hospitable + 2 QR
    expect(s.impact.qr_conversations).toBe(2);
    expect(s.impact.messages).toBe(3); // FK cascade var
    expect(s.impact.outbox).toBe(1); // FK YOK → dangling riski
    expect(s.impact.risk_events).toBe(1); // FK YOK
    expect(s.impact.shadow_verdicts).toBe(1); // FK YOK
  });

  it("boş veritabanında hiçbir şey uydurmaz", async () => {
    const s = await collectPreflight(prisma, ALLOW);
    expect(s.totals.total).toBe(0);
    expect(s.groups.hosp_groups).toBe(0);
    expect(s.impact.conversations).toBe(0);
    expect(decide(s)).toEqual({ code: "TEMIZ", exitCode: 0 });
  });
});

describe("preflight — karar ve çıktı hijyeni", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("çelişki varken DUR der (karar 2)", async () => {
    await seed();
    const s = await collectPreflight(prisma, ALLOW);
    expect(decide(s)).toEqual({ code: "CELISKI", exitCode: 20 });
  });

  it("çelişki kalkınca gözetimli dedupe kararına iner", async () => {
    await seed();
    await prisma.conversation.deleteMany({ where: { externalReservationId: IDS.conflict } });
    const s = await collectPreflight(prisma, ALLOW);
    expect(s.groups.hosp_conflicting).toBe(0);
    expect(decide(s)).toEqual({ code: "DEDUPE_GEREKLI", exitCode: 10 });
  });

  it("çıktı YALNIZ kategori + sayıdan oluşur; grup başına satır üretmez", async () => {
    // Rapor uzunluğu veri hacminden BAĞIMSIZ olmalı: çakışan grup sayısı
    // artınca satır sayısı artmamalı. Grup başına bir satır (veya kimlikten
    // türetilmiş bir etiket) basan her tasarım bu testte kırılır.
    const { propA } = await seed();
    const before = await collectPreflight(prisma, ALLOW);
    const beforeLines = formatReport(before, decide(before)).length;

    for (let i = 0; i < 12; i++) {
      const ext = `res-uuid-extra-${i}`;
      for (let k = 0; k < 2; k++) {
        await prisma.conversation.create({
          data: {
            propertyId: propA,
            guestIdentifier: "Misafir",
            channel: "airbnb",
            externalReservationId: ext,
            externalConversationId: `conv-extra-${i}`,
          },
        });
      }
    }

    const s = await collectPreflight(prisma, ALLOW);
    expect(s.groups.hosp_groups).toBe(16); // 4 + 12 yeni grup
    // Karar dalı iki tarafta da AYNI (çelişkili grup duruyor) → satır farkı
    // yalnız "veri hacmi rapora sızdı mı" sorusunu ölçer.
    expect(decide(s).code).toBe(decide(before).code);
    expect(formatReport(s, decide(s)).length).toBe(beforeLines); // rapor BÜYÜMEDİ
  });

  it("çıktının hiçbir yerinde ham kimlik/PII yok", async () => {
    const { orgId, propA, propB } = await seed();
    const s = await collectPreflight(prisma, ALLOW);
    const rendered = [JSON.stringify(s), formatReport(s, decide(s)).join("\n")].join("\n");

    // propA/propB QR markerının İÇİNDE gömülü ("qr-chat:{propertyId}:{resId}"),
    // dolayısıyla marker'ın herhangi bir parçasının sızması bu listeyle yakalanır.
    // JSON.stringify(s) TÜM dönüş değerini tarar: yeni bir alan kimlik taşırsa
    // yalnız raporu değil ham sonucu da yakalar.
    for (const secret of [...Object.values(IDS), orgId, propA, propB, "Misafir", "QR Legacy"]) {
      expect(rendered).not.toContain(secret);
    }
  });

  it("rapor NULL semantiği uyarısını ve zorunlu sırayı her zaman taşır", async () => {
    const s = await collectPreflight(prisma, ALLOW);
    const text = formatReport(s, decide(s)).join("\n");
    expect(text).toContain("NULLS NOT DISTINCT");
    expect(text).toContain("ZORUNLU SIRA");
  });
});
