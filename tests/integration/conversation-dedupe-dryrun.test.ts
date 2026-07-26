import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import {
  CONVERSATION_FIELD_POLICY,
  LIVE_STATE_FIELDS,
  MESSAGE_FIELD_POLICY,
  assertPolicyCoverage,
  classifyGroup,
  formatDedupeReport,
  planConversationDedupe,
  pickKeeper,
} from "../../scripts/dryrun-conversation-dedupe";

// ---------------------------------------------------------------------------
// Faz B — DRY-RUN dedupe planlayıcı.
//
// Sözleşme: SALT OKUMA, APPLY YOK, çıktı yalnız kategori+sayı, kanıtlanamayan
// her şey FAIL-CLOSED. Bu dosya hepsini gerçek PostgreSQL'de pinler.
// Prod'a dokunulmaz; yalnız throwaway test veritabanı.
// ---------------------------------------------------------------------------

const ALLOW = { allowPrimary: true };
const EXT = "prov-res-dedupe-1";
const T0 = new Date("2026-05-30T09:00:00Z");
const T1 = new Date("2026-05-30T10:00:00Z");

type ConvOverrides = Partial<{
  externalConversationId: string | null;
  reservationId: string | null;
  status: string;
  priority: string;
  createdAt: Date;
  lastMessageAt: Date;
  channel: string;
  skippedReason: string | null;
  lastRiskLevel: string | null;
  lastRiskType: string | null;
  autoReplyHoldUntil: Date | null;
  autoReplyAttemptedAt: Date | null;
  syncCursorAt: Date | null;
}>;

async function conv(propertyId: string, o: ConvOverrides = {}) {
  return prisma.conversation.create({
    data: {
      propertyId,
      guestIdentifier: "Test Misafir",
      channel: o.channel ?? "airbnb",
      externalReservationId: EXT,
      // `??` KULLANMA: açık `null` ile "verilmedi" ayrı şeylerdir; `??` açık
      // null'ı yutup varsayılanı yazardı ve NULL senaryosu hiç test edilmezdi.
      externalConversationId: "externalConversationId" in o ? o.externalConversationId! : "prov-conv-1",
      reservationId: o.reservationId ?? null,
      status: o.status ?? "answered",
      priority: o.priority ?? "standard",
      createdAt: o.createdAt ?? T0,
      lastMessageAt: o.lastMessageAt ?? T1,
      skippedReason: o.skippedReason ?? null,
      lastRiskLevel: o.lastRiskLevel ?? null,
      lastRiskType: o.lastRiskType ?? null,
      autoReplyHoldUntil: o.autoReplyHoldUntil ?? null,
      autoReplyAttemptedAt: o.autoReplyAttemptedAt ?? null,
      syncCursorAt: o.syncCursorAt ?? null,
    },
  });
}

type MsgOverrides = Partial<{ body: string; senderName: string; aiAssisted: boolean; createdAt: Date }>;

async function msg(conversationId: string, externalId: string | null, o: MsgOverrides = {}) {
  return prisma.message.create({
    data: {
      conversationId,
      direction: "inbound",
      senderName: o.senderName ?? "Test Misafir",
      body: o.body ?? `Mesaj ${externalId ?? "x"}`,
      language: "tr",
      externalId,
      aiAssisted: o.aiAssisted ?? false,
      authorType: "guest",
      createdAt: o.createdAt ?? T0,
    },
  });
}

/** İki satırlı, mesajları BİREBİR aynı olan klasik yarış artığı. */
async function seedExactDuplicateGroup() {
  const { propertyId } = await makeOrgWithProperty();
  const a = await conv(propertyId, { createdAt: T0 });
  const b = await conv(propertyId, { createdAt: T1 });
  for (const c of [a, b]) {
    await msg(c.id, "m1");
    await msg(c.id, "m2");
    await msg(c.id, "m3");
  }
  return { propertyId, a, b };
}

describe("dedupe dry-run — alan envanteri (Codex şart #3)", () => {
  it("Conversation'ın TÜM scalar alanlarının açık bir politikası var", () => {
    const schema = Object.keys(Prisma.ConversationScalarFieldEnum).sort();
    expect(Object.keys(CONVERSATION_FIELD_POLICY).sort()).toEqual(schema);
    // Codex denetimi B1/B2/B4 (2026-07-26) sonrası: bu alanların HİÇBİRİ
    // birleştirilmez/yazılmaz — farklıysa grup FAIL-CLOSED olur.
    expect(CONVERSATION_FIELD_POLICY.lastMessageAt).toBe("live_state");
    expect(CONVERSATION_FIELD_POLICY.syncCursorAt).toBe("live_state");
    expect(CONVERSATION_FIELD_POLICY.status).toBe("live_state");
    expect(CONVERSATION_FIELD_POLICY.autoReplyHoldUntil).toBe("live_state");
    expect(CONVERSATION_FIELD_POLICY.autoReplyAttemptedAt).toBe("live_state");
    expect(CONVERSATION_FIELD_POLICY.priority).toBe("live_state");
    expect(CONVERSATION_FIELD_POLICY.skippedReason).toBe("live_state");
    expect(CONVERSATION_FIELD_POLICY.lastRiskLevel).toBe("live_state");
    expect(CONVERSATION_FIELD_POLICY.lastRiskType).toBe("live_state");
    // createdAt/channel artık "canlı" sayılmıyor: hiçbir yazıcı create'ten
    // sonra bunları güncellemiyor, yarış riski taşımıyorlar — bilgi amaçlı.
    expect(CONVERSATION_FIELD_POLICY.createdAt).toBe("keeper_wins");
    expect(CONVERSATION_FIELD_POLICY.channel).toBe("keeper_wins");
    expect(LIVE_STATE_FIELDS.sort()).toEqual(
      [
        "status",
        "priority",
        "skippedReason",
        "lastRiskLevel",
        "lastRiskType",
        "lastMessageAt",
        "syncCursorAt",
        "autoReplyHoldUntil",
        "autoReplyAttemptedAt",
      ].sort(),
    );
  });

  it("Message'ın TÜM scalar alanlarının açık bir kıyas politikası var", () => {
    const schema = Object.keys(Prisma.MessageScalarFieldEnum).sort();
    expect(Object.keys(MESSAGE_FIELD_POLICY).sort()).toEqual(schema);
    // AI işaretleri ANLAMLI kabul edilir (aiAssisted AI-kredisi metriğini besler).
    expect(MESSAGE_FIELD_POLICY.aiAssisted).toBe("strict");
    expect(MESSAGE_FIELD_POLICY.aiSuggestedReply).toBe("strict");
    expect(MESSAGE_FIELD_POLICY.createdAt).toBe("strict");
    expect(MESSAGE_FIELD_POLICY.senderName).toBe("strict");
  });

  it("politika haritası şemadan saparsa runtime FAIL-CLOSED", () => {
    const saved = CONVERSATION_FIELD_POLICY.lastMessageAt;
    delete (CONVERSATION_FIELD_POLICY as Record<string, unknown>).lastMessageAt;
    try {
      expect(() => assertPolicyCoverage()).toThrow(/politika haritası/);
    } finally {
      (CONVERSATION_FIELD_POLICY as Record<string, unknown>).lastMessageAt = saved;
    }
    expect(() => assertPolicyCoverage()).not.toThrow();
  });

});

describe("dedupe dry-run — kapılar", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("READ ONLY + REPEATABLE READ + zaman aşımları uygulanır", async () => {
    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.ctx.read_only).toBe("on");
    expect(r.ctx.isolation).toBe("repeatable read");
    expect(r.ctx.statement_timeout).toBe("30s");
    expect(r.ctx.lock_timeout).toBe("3s");
    expect(r.ctx.idle_tx_timeout).toBe("15s");
  });

  it("PRIMARY'de kaza eseri koşmaz", async () => {
    await expect(planConversationDedupe(prisma)).rejects.toThrow(/DEDUPE_ALLOW_PRIMARY/);
  });

  it("planlama HİÇBİR satırı değiştirmez", async () => {
    await seedExactDuplicateGroup();
    const before = {
      c: await prisma.conversation.count(),
      m: await prisma.message.count(),
    };
    await planConversationDedupe(prisma, ALLOW);
    expect(await prisma.conversation.count()).toBe(before.c);
    expect(await prisma.message.count()).toBe(before.m);
  });
});

describe("dedupe dry-run — mesaj sınıflandırması (Codex şart #2)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("tam eşit kopyalar TEK canonical'a iner; benzersiz mesaj kaybolmaz", async () => {
    await seedExactDuplicateGroup();
    const r = await planConversationDedupe(prisma, ALLOW);

    expect(r.groups.conflicting).toBe(1);
    expect(r.groups.planned).toBe(1);
    expect(r.groups.fail_closed).toBe(0);
    expect(r.messages.in_conflict_groups).toBe(6);
    expect(r.messages.planned_drop_exact_duplicate).toBe(3); // fazlalık kopyalar
    expect(r.messages.planned_move_unique).toBe(0);
    expect(r.messages.conflicting_blocking).toBe(0);
    expect(r.totals.conversations_before).toBe(2);
    expect(r.totals.conversations_after_expected).toBe(1);
    expect(r.totals.messages_before).toBe(6);
    expect(r.totals.messages_after_expected).toBe(3); // 3 BENZERSİZ olay korunur
  });

  it("kaybedende SADECE onda olan mesaj varsa TAŞINIR, düşürülmez", async () => {
    const { propertyId } = await makeOrgWithProperty();
    // keeper = ÇOK mesajlı satır (pickKeeper kuralı) → benzersiz mesajı
    // bilerek AZ mesajlı (kaybeden) satıra koyuyoruz.
    const a = await conv(propertyId, { createdAt: T0 });
    const b = await conv(propertyId, { createdAt: T1 });
    await msg(a.id, "m1");
    await msg(a.id, "m2");
    await msg(a.id, "m3");
    await msg(b.id, "m1");
    await msg(b.id, "m9"); // yalnız kaybedende

    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.groups.planned).toBe(1);
    expect(r.messages.planned_move_unique).toBe(1); // m9 taşınır
    expect(r.messages.planned_drop_exact_duplicate).toBe(1); // m1 fazlalık kopya
    expect(r.totals.messages_before).toBe(5);
    expect(r.totals.messages_after_expected).toBe(4); // m1,m2,m3,m9 — benzersizler korundu
  });

  it("externalId NULL mesajlar HER ZAMAN taşınır, asla düşürülmez", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const a = await conv(propertyId, { createdAt: T0 });
    const b = await conv(propertyId, { createdAt: T1 });
    await msg(a.id, "m1");
    await msg(a.id, "m2");
    await msg(a.id, "m3");
    await msg(a.id, "m4"); // a = keeper (4 mesaj)
    await msg(b.id, "m1");
    // Gövdesi bile aynı olsa anahtarsız mesaj güvenle eşleştirilemez → taşınır.
    await msg(b.id, null, { body: "Ayni govde" });
    await msg(b.id, null, { body: "Ayni govde" });

    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.messages.planned_move_null_external).toBe(2);
    expect(r.messages.planned_drop_exact_duplicate).toBe(1);
    expect(r.totals.messages_before).toBe(7);
    expect(r.totals.messages_after_expected).toBe(6);
  });

  it("aynı externalId + FARKLI gövde → FAIL-CLOSED, hiçbir şey planlanmaz", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const a = await conv(propertyId, { createdAt: T0 });
    const b = await conv(propertyId, { createdAt: T1 });
    await msg(a.id, "m1", { body: "Orijinal" });
    await msg(b.id, "m1", { body: "FARKLI govde" });

    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.groups.planned).toBe(0);
    expect(r.groups.fail_closed).toBe(1);
    expect(r.groups.fail_reasons.message_content_conflict).toBe(1);
    expect(r.messages.conflicting_blocking).toBe(1);
    expect(r.totals.messages_after_expected).toBe(r.totals.messages_before); // hiç düşmez
  });

  it("aynı externalId + FARKLI AI işareti → FAIL-CLOSED (AI-kredisi metriği)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const a = await conv(propertyId, { createdAt: T0 });
    const b = await conv(propertyId, { createdAt: T1 });
    await msg(a.id, "m1", { aiAssisted: true });
    await msg(b.id, "m1", { aiAssisted: false });

    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.groups.fail_closed).toBe(1);
    expect(r.groups.fail_reasons.message_content_conflict).toBe(1);
  });

  it("aynı externalId + FARKLI sağlayıcı zamanı → FAIL-CLOSED", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const a = await conv(propertyId, { createdAt: T0 });
    const b = await conv(propertyId, { createdAt: T1 });
    await msg(a.id, "m1", { createdAt: T0 });
    await msg(b.id, "m1", { createdAt: T1 });

    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.groups.fail_closed).toBe(1);
  });
});

describe("dedupe dry-run — konuşma alanı çelişkileri", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("farklı externalConversationId → FAIL-CLOSED (sağlayıcı iki thread demiş olabilir)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await conv(propertyId, { externalConversationId: "conv-A", createdAt: T0 });
    await conv(propertyId, { externalConversationId: "conv-B", createdAt: T1 });

    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.groups.planned).toBe(0);
    expect(r.groups.fail_reasons.external_conversation_id_conflict).toBe(1);
  });

  it("biri NULL diğeri dolu externalConversationId → çelişki DEĞİL", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await conv(propertyId, { externalConversationId: null, createdAt: T0 });
    await conv(propertyId, { externalConversationId: "conv-A", createdAt: T1 });

    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.groups.fail_reasons.external_conversation_id_conflict).toBe(0);
    expect(r.groups.planned).toBe(1);
  });

  it("farklı yerel reservationId → FAIL-CLOSED", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const mk = (name: string) =>
      prisma.reservation.create({
        data: {
          propertyId,
          guestName: name,
          arrivalDate: T0,
          departureDate: T1,
        },
      });
    const r1 = await mk("A");
    const r2 = await mk("B");
    await conv(propertyId, { reservationId: r1.id, createdAt: T0 });
    await conv(propertyId, { reservationId: r2.id, createdAt: T1 });

    const rep = await planConversationDedupe(prisma, ALLOW);
    expect(rep.groups.planned).toBe(0);
    expect(rep.groups.fail_reasons.reservation_id_conflict).toBe(1);
  });

  it("keeper_wins alanındaki fark (channel) SESSİZ geçmez — sayılır ama bloklamaz", async () => {
    // priority artık live_state (aşağıdaki describe bloğu); keeper_wins'te
    // KALAN tek örnek channel — hiçbir yazıcı create'ten sonra güncellemez,
    // yarış riski yok, bu yüzden fark SAYILIR ama grup yine PLANLANIR.
    const { propertyId } = await makeOrgWithProperty();
    await conv(propertyId, { channel: "airbnb", createdAt: T0 });
    await conv(propertyId, { channel: "booking", createdAt: T1 });

    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.groups.planned).toBe(1);
    expect(r.groups.keeper_wins_differences).toBe(1);
  });
});

describe("dedupe dry-run — CANLI DURUM farkları (Codex denetimi B1/B2/B4)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("closed + new HİÇBİR KOŞULDA 'new' üretmez — fail-closed, rank/tahmin YOK", async () => {
    // B1: eski rank (problem>new>waiting>answered>closed) closed+new'de "new"
    // veriyordu — auto-reply cron'u tam olarak status:"new" seçtiği için host'un
    // kapattığı bir thread'i yeniden silahlandırıyordu. Artık heuristik YOK.
    const { propertyId } = await makeOrgWithProperty();
    const closed = await conv(propertyId, { status: "closed", createdAt: T0 });
    const isNew = await conv(propertyId, { status: "new", createdAt: T1 });

    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.groups.planned).toBe(0);
    expect(r.groups.fail_closed).toBe(1);
    expect(r.groups.fail_reasons.live_state_conflict).toBe(1);
    expect(r.groups.live_state_diff_by_field.status).toBe(1);

    // Ve gerçekten HİÇBİR ŞEY değişmedi — özellikle "closed" asla "new" olmadı.
    const rows = await prisma.conversation.findMany({ where: { propertyId } });
    expect(rows.find((x) => x.id === closed.id)?.status).toBe("closed");
    expect(rows.find((x) => x.id === isNew.id)?.status).toBe("new");
  });

  it("escalation BEŞLİSİ parçalanmaz: biri farklıysa TÜMÜ fail-closed'a düşer", async () => {
    // B4: eskiden yalnız status taşınıyordu, priority/skippedReason/
    // lastRiskLevel/lastRiskType taşınmıyordu — "yarım escalation". Artık
    // beşi de AYNI politika (live_state): fark varsa hiçbiri aktarılmaz,
    // grup bütünüyle fail-closed olur.
    const { propertyId } = await makeOrgWithProperty();
    await conv(propertyId, {
      status: "answered",
      priority: "standard",
      skippedReason: null,
      lastRiskLevel: null,
      lastRiskType: null,
      createdAt: T0,
    });
    await conv(propertyId, {
      status: "problem",
      priority: "urgent",
      skippedReason: "complaint",
      lastRiskLevel: "high",
      lastRiskType: "complaint",
      createdAt: T1,
    });

    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.groups.planned).toBe(0);
    expect(r.groups.fail_reasons.live_state_conflict).toBe(1);
    // Beşi de fark listesinde — hiçbiri "sessizce" geçmiyor.
    for (const f of ["status", "priority", "skippedReason", "lastRiskLevel", "lastRiskType"]) {
      expect(r.groups.live_state_diff_by_field[f]).toBe(1);
    }
  });

  it.each(LIVE_STATE_FIELDS)("live_state alanı '%s' farklıysa grup fail-closed olur", async (field) => {
    const { propertyId } = await makeOrgWithProperty();
    const isDate =
      field === "lastMessageAt" ||
      field === "autoReplyHoldUntil" ||
      field === "autoReplyAttemptedAt" ||
      field === "syncCursorAt";
    // conv()'in kendi varsayılanları alan-alan FARKLI (lastMessageAt→T1,
    // diğer tarihler→null, status→"answered", priority→"standard") — sadece
    // ONE tarafı override etmek bazı alanlarda (örn. lastMessageAt) YANLIŞLIKLA
    // iki tarafı da AYNI değere getirebilirdi. Bu yüzden HER iki satırın da
    // hedef alanı AÇIKÇA ve FARKLI değerlerle yazılıyor.
    const baseline: unknown = isDate ? T0 : field === "status" ? "answered" : field === "priority" ? "standard" : null;
    const changed: unknown = isDate ? T1 : field === "status" ? "problem" : field === "priority" ? "urgent" : "farkli-deger";
    const a = await conv(propertyId, { createdAt: T0, [field]: baseline } as unknown as ConvOverrides);
    await conv(propertyId, { createdAt: T1, [field]: changed } as unknown as ConvOverrides);

    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.groups.fail_reasons.live_state_conflict).toBe(1);
    expect(r.groups.live_state_diff_by_field[field]).toBe(1);
    // Hiçbir konuşma silinmedi/değişmedi.
    expect(await prisma.conversation.count({ where: { id: a.id } })).toBe(1);
  });

  it("classifyGroup saf seviyede: canlı durum eşitse grup PLANLANIR (yazma yok ama izin var)", () => {
    const rows = [
      { id: "a", propertyId: "p", externalReservationId: "e", reservationId: null, externalConversationId: "c",
        status: "answered", priority: "standard", skippedReason: null, lastRiskLevel: null, lastRiskType: null,
        lastMessageAt: T0, syncCursorAt: null, autoReplyHoldUntil: null, autoReplyAttemptedAt: null,
        guestIdentifier: "M", channel: "airbnb", createdAt: T0 },
      { id: "b", propertyId: "p", externalReservationId: "e", reservationId: null, externalConversationId: "c",
        status: "answered", priority: "standard", skippedReason: null, lastRiskLevel: null, lastRiskType: null,
        lastMessageAt: T0, syncCursorAt: null, autoReplyHoldUntil: null, autoReplyAttemptedAt: null,
        guestIdentifier: "M", channel: "airbnb", createdAt: T1 },
    ];
    const plan = classifyGroup(rows, []);
    expect(plan.failed).toBeNull();
    expect(plan.liveStateDiffFields).toEqual([]);
  });
});

describe("dedupe dry-run — keeper determinizmi", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("konaklama bağı olan satır keeper olur", () => {
    const counts = new Map<string, number>();
    const rows = [
      { id: "b", reservationId: null, createdAt: T0 },
      { id: "a", reservationId: "res-1", createdAt: T1 },
    ];
    expect(pickKeeper(rows, counts).id).toBe("a");
  });

  it("her şey eşitse en küçük id kazanır — beraberlik imkânsız", () => {
    const counts = new Map<string, number>([
      ["zzz", 2],
      ["aaa", 2],
    ]);
    const rows = [
      { id: "zzz", reservationId: null, createdAt: T0 },
      { id: "aaa", reservationId: null, createdAt: T0 },
    ];
    expect(pickKeeper(rows, counts).id).toBe("aaa");
    // Sıra değişse de sonuç DEĞİŞMEZ (plan tekrar üretilebilir olmalı).
    expect(pickKeeper([...rows].reverse(), counts).id).toBe("aaa");
  });
});

describe("dedupe dry-run — çıktı hijyeni (Codex şart #4)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rapor YALNIZ kategori + sayı basar; hiçbir kimlik/gövde yok", async () => {
    const { propertyId, a, b } = await seedExactDuplicateGroup();
    const r = await planConversationDedupe(prisma, ALLOW);
    const rendered = [JSON.stringify(r), formatDedupeReport(r).join("\n")].join("\n");

    for (const secret of [propertyId, a.id, b.id, EXT, "prov-conv-1", "Test Misafir", "Mesaj m1"]) {
      expect(rendered).not.toContain(secret);
    }
  });

  it("rapor uzunluğu veri hacminden BAĞIMSIZ", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const base = formatDedupeReport(await planConversationDedupe(prisma, ALLOW)).length;
    for (let i = 0; i < 8; i++) {
      for (const t of [T0, T1]) {
        await prisma.conversation.create({
          data: {
            propertyId,
            guestIdentifier: "M",
            channel: "airbnb",
            externalReservationId: `bulk-${i}`,
            externalConversationId: `bulk-conv-${i}`,
            createdAt: t,
            lastMessageAt: t,
          },
        });
      }
    }
    const r = await planConversationDedupe(prisma, ALLOW);
    expect(r.groups.conflicting).toBe(8);
    expect(formatDedupeReport(r).length).toBe(base);
  });

  it("apply yolu yok — rapor bunu açıkça söyler", async () => {
    const r = await planConversationDedupe(prisma, ALLOW);
    const text = formatDedupeReport(r).join("\n");
    expect(text).toContain("APPLY YOK");
    expect(text).toContain("Hiçbir satır değiştirilmedi");
  });
});
