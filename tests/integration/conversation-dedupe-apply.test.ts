import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { planConversationDedupe } from "../../scripts/dryrun-conversation-dedupe";
import type { Row } from "../../scripts/apply-conversation-dedupe";
import {
  PHASE_A_COMMIT,
  __applyHooks,
  applyConversationDedupe,
  assertPhaseADeployed,
  assertReferenceCoverage,
  classifyApplyFailure,
  inventoryConversationReferences,
  mergedConversationFields,
  resolveExpectations,
} from "../../scripts/apply-conversation-dedupe";
import { importThread, __importThreadHooks } from "@/lib/hospitable-sync";

// ---------------------------------------------------------------------------
// Faz C — APPLY. Tek, all-or-nothing transaction.
//
// Prod'a DOKUNULMAZ; yalnız throwaway test veritabanı. Bu dosya apply'ın
// sözleşmesini pinler: kapılar, çelişkide TAM rollback, referans taşıma,
// tam-eşit collapse, benzersiz/NULL koruma, eşzamanlı sync kilidi, ikinci
// koşuda no-op.
// ---------------------------------------------------------------------------

const EXT = "prov-res-apply-1";
const T0 = new Date("2026-05-30T09:00:00Z");
const T1 = new Date("2026-05-30T10:00:00Z");
/** Testte git/deploy kapısı ayrı ayrı sınanır; senaryolarda atlanır. */
const GATE = { skipDeployGate: true as const };

async function conv(
  propertyId: string,
  o: Partial<{
    externalConversationId: string | null;
    reservationId: string | null;
    status: string;
    priority: string;
    createdAt: Date;
    lastMessageAt: Date;
    skippedReason: string | null;
    lastRiskLevel: string | null;
    lastRiskType: string | null;
    autoReplyHoldUntil: Date | null;
    autoReplyAttemptedAt: Date | null;
    syncCursorAt: Date | null;
  }> = {},
) {
  return prisma.conversation.create({
    data: {
      propertyId,
      guestIdentifier: "Test Misafir",
      channel: "airbnb",
      externalReservationId: EXT,
      externalConversationId:
        "externalConversationId" in o ? o.externalConversationId! : "prov-conv-1",
      reservationId: o.reservationId ?? null,
      status: o.status ?? "answered",
      priority: o.priority ?? "standard",
      createdAt: o.createdAt ?? T0,
      lastMessageAt: o.lastMessageAt ?? T0,
      skippedReason: o.skippedReason ?? null,
      lastRiskLevel: o.lastRiskLevel ?? null,
      lastRiskType: o.lastRiskType ?? null,
      autoReplyHoldUntil: o.autoReplyHoldUntil ?? null,
      autoReplyAttemptedAt: o.autoReplyAttemptedAt ?? null,
      syncCursorAt: o.syncCursorAt ?? null,
    },
  });
}

async function msg(conversationId: string, externalId: string | null, o: Partial<{ body: string }> = {}) {
  return prisma.message.create({
    data: {
      conversationId,
      direction: "inbound",
      senderName: "Test Misafir",
      body: o.body ?? `Mesaj ${externalId ?? "x"}`,
      language: "tr",
      externalId,
      aiAssisted: false,
      authorType: "guest",
      createdAt: T0,
    },
  });
}

/** Prod'un ölçülmüş şekli: 2 satır, mesajlar birebir aynı. */
async function seedRaceArtifact() {
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

describe("apply — kapılar (varsayılan KAPALI)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("beklenen sayılar eksikse fail-closed", () => {
    expect(() => resolveExpectations({})).toThrow(/DEDUPE_EXPECT_GROUPS/);
    expect(() =>
      resolveExpectations({ DEDUPE_EXPECT_GROUPS: "1", DEDUPE_EXPECT_LOSERS: "1" }),
    ).toThrow(/DEDUPE_EXPECT_EXACT_DUPES/);
    expect(() =>
      resolveExpectations({
        DEDUPE_EXPECT_GROUPS: "-1",
        DEDUPE_EXPECT_LOSERS: "1",
        DEDUPE_EXPECT_EXACT_DUPES: "1",
      }),
    ).toThrow(/negatif olmayan/);
  });

  // Kapı GERÇEK `git merge-base --is-ancestor` üzerinde sınanır — davranış
  // MOCK'LANMAZ. Sahte bir git runner yalnız kendi dallanmamızı ölçer ve boş
  // güvence üretirdi. Bunun yerine geçici, gerçek bir depo kurulur:
  //   base ──▶ phaseA ──▶ descendant        (ayrı dalda: unrelated)
  it("gerçek git deposunda ancestry doğru sınıflanır ve shallow YANLIŞ YEŞİL üretemez", () => {
    const repo = mkdtempSync(join(tmpdir(), "phase-a-gate-"));
    const shallow = mkdtempSync(join(tmpdir(), "phase-a-shallow-"));
    const g = (args: string[], cwd = repo) =>
      execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    try {
      g(["init", "-q", "-b", "main"]);
      g(["config", "user.email", "t@example.com"]);
      g(["config", "user.name", "T"]);
      const commit = (m: string) => {
        writeFileSync(join(repo, "f.txt"), m);
        g(["add", "."]);
        g(["commit", "-q", "-m", m]);
        return g(["rev-parse", "HEAD"]);
      };
      const base = commit("base");
      const phaseA = commit("phaseA");
      const descendant = commit("descendant");
      // Aynı temelden AYRI dal → phaseA'yı içermez.
      g(["checkout", "-q", "-b", "other", base]);
      const unrelated = commit("unrelated");
      g(["checkout", "-q", "main"]);

      const opts = { cwd: repo, requiredCommit: phaseA };
      // 1) Faz A'yı İÇEREN SHA kabul edilir.
      expect(() => assertPhaseADeployed(descendant, opts)).not.toThrow();
      expect(() => assertPhaseADeployed(phaseA, opts)).not.toThrow(); // kendisi de ata
      // 2) ESKİ (non-ancestor) SHA reddedilir.
      expect(() => assertPhaseADeployed(base, opts)).toThrow(/İÇERMİYOR/);
      // 3) Farklı daldaki (non-ancestor) SHA reddedilir.
      expect(() => assertPhaseADeployed(unrelated, opts)).toThrow(/İÇERMİYOR/);
      // 4) Repoda BULUNMAYAN SHA fail-closed reddedilir.
      expect(() => assertPhaseADeployed("0".repeat(40), opts)).toThrow(/BİLİNMİYOR|shallow/);

      // 5) SIĞ GEÇMİŞ YANLIŞ YEŞİL ÜRETEMEZ: depth=1 klonda phaseA nesnesi
      //    yoktur; kapı "kabul" DEĞİL, fail-closed vermelidir.
      execFileSync("git", ["clone", "-q", "--depth", "1", `file://${repo}`, shallow], {
        encoding: "utf8",
      });
      const shallowHead = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: shallow,
        encoding: "utf8",
      }).trim();
      expect(shallowHead).toBe(descendant);
      expect(() =>
        assertPhaseADeployed(shallowHead, { cwd: shallow, requiredCommit: phaseA }),
      ).toThrow(/BİLİNMİYOR|shallow/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(shallow, { recursive: true, force: true });
    }
  });

  it("deploy SHA verilmezse DURUR", () => {
    expect(() => assertPhaseADeployed(undefined)).toThrow(/APPLY_PHASE_A_DEPLOYED_SHA/);
    expect(() => assertPhaseADeployed("   ")).toThrow(/APPLY_PHASE_A_DEPLOYED_SHA/);
  });

  it("beklenen Faz A commit'i sabittir", () => {
    expect(PHASE_A_COMMIT).toBe("3effd99");
  });

  // "Hiçbir değişiklik yapılmadı" bir İDDİADIR ve her hatada kurulamaz.
  // Commit anındaki bağlantı kaybı BELİRSİZDİR; orada bu cümleyi kurmak
  // operatörü apply'ı TEKRAR çalıştırmaya iter — asıl tehlike budur.
  describe("hata sınıflandırması — belirsizlik gizlenmez", () => {
    it("kapı hatası (transaction hiç açılmadı) → kesin: değişiklik yok", () => {
      const v = classifyApplyFailure(false, new Error("APPLY_PHASE_A_DEPLOYED_SHA yok"));
      expect(v.ambiguous).toBe(false);
      expect(v.exitCode).toBe(1);
      expect(v.lines.join("\n")).toContain("hiçbir değişiklik yapılmadı");
      expect(v.lines.join("\n")).toContain("transaction hiç açılmadı");
    });

    it("transaction içi guard → rollback, değişiklik yok", () => {
      const v = classifyApplyFailure(true, new Error("grup 8 ≠ beklenen 7 — rollback"));
      expect(v.ambiguous).toBe(false);
      expect(v.exitCode).toBe(1);
      expect(v.lines.join("\n")).toContain("rollback etti");
    });

    it("bağlantı kaybı → BELİRSİZ; 'değişiklik yok' DENMEZ ve retry YASAK", () => {
      const err = Object.assign(new Error("Connection terminated unexpectedly"), {
        name: "PrismaClientKnownRequestError",
      });
      const v = classifyApplyFailure(true, err);
      const text = v.lines.join("\n");
      expect(v.ambiguous).toBe(true);
      expect(v.exitCode).toBe(3); // deterministik hatadan AYRI kod
      expect(text).toContain("SONUÇ BELİRSİZ");
      expect(text).toContain("TEKRAR ÇALIŞTIRMA");
      expect(text).toContain("dry-run");
      expect(text).not.toContain("hiçbir değişiklik yapılmadı");
      // Ham hata metni (bağlantı dizesi taşıyabilir) basılmaz — yalnız tip.
      expect(text).not.toContain("Connection terminated");
    });
  });

  it("beklenen sayı TUTMAZSA hiçbir yazma yapılmaz", async () => {
    await seedRaceArtifact();
    await expect(
      applyConversationDedupe(prisma, {
        ...GATE,
        expectations: { groups: 1, losers: 1, exactDuplicates: 99 }, // yanlış
      }),
    ).rejects.toThrow(/tam-eşit-duplicate .* ≠ beklenen/);
    expect(await prisma.conversation.count()).toBe(2);
    expect(await prisma.message.count()).toBe(6);
  });
});

describe("apply — referans envanteri", () => {
  it("Conversation'a referans veren TÜM modeller biliniyor", () => {
    expect(inventoryConversationReferences()).toEqual([
      "Message",
      "MessageOutbox",
      "RiskEvent",
      "ShadowVerdict",
    ]);
    expect(() => assertReferenceCoverage()).not.toThrow();
  });
});

describe("apply — başarı yolu", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("tam-eşit kopyalar collapse olur, tek konuşma kalır", async () => {
    const { propertyId } = await seedRaceArtifact();
    const plan = await planConversationDedupe(prisma, { allowPrimary: true });
    expect(plan.groups.planned).toBe(1);

    const out = await applyConversationDedupe(prisma, {
      ...GATE,
      expectations: {
        groups: plan.groups.planned,
        losers: plan.conversations.losers_planned,
        exactDuplicates: plan.messages.planned_drop_exact_duplicate,
      },
    });

    expect(out.noop).toBe(false);
    expect(out.groups).toBe(1);
    expect(out.losers).toBe(1);
    expect(out.messagesDropped).toBe(3);
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(1);
    expect(await prisma.message.count()).toBe(3);
    // Dry-run'ın beklediği "sonrası" ile gerçek sonuç BİREBİR aynı olmalı.
    expect(await prisma.conversation.count()).toBe(plan.totals.conversations_after_expected);
    expect(await prisma.message.count()).toBe(plan.totals.messages_after_expected);
    expect(out.conversationsAfter).toBe(out.conversationsBefore - out.losers);
    expect(out.messagesAfter).toBe(out.messagesBefore - out.messagesDropped);
  });

  it("BENZERSİZ ve externalId NULL mesajlar TAŞINIR, düşürülmez", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const a = await conv(propertyId, { createdAt: T0 });
    const b = await conv(propertyId, { createdAt: T1 });
    await msg(a.id, "m1");
    await msg(a.id, "m2");
    await msg(a.id, "m3");
    await msg(a.id, "m4"); // a = keeper (4 mesaj)
    await msg(b.id, "m1"); // tam kopya → düşer
    await msg(b.id, "m9"); // benzersiz → taşınır
    await msg(b.id, null, { body: "Anahtarsiz" }); // NULL → taşınır

    const plan = await planConversationDedupe(prisma, { allowPrimary: true });
    const out = await applyConversationDedupe(prisma, {
      ...GATE,
      expectations: {
        groups: plan.groups.planned,
        losers: plan.conversations.losers_planned,
        exactDuplicates: plan.messages.planned_drop_exact_duplicate,
      },
    });

    expect(out.messagesMovedUnique).toBe(1);
    expect(out.messagesMovedNull).toBe(1);
    expect(out.messagesDropped).toBe(1);
    const keeper = await prisma.conversation.findFirstOrThrow({ where: { propertyId } });
    const bodies = (
      await prisma.message.findMany({ where: { conversationId: keeper.id }, select: { externalId: true } })
    ).map((m) => m.externalId);
    expect(bodies.filter((e) => e === null)).toHaveLength(1); // anahtarsız korundu
    expect(bodies).toContain("m9"); // benzersiz korundu
    expect(await prisma.message.count()).toBe(6); // 7 − 1 fazlalık
  });

  it("FK'sız referanslar keeper'a TAŞINIR (dangling kalmaz)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const org = await prisma.property.findFirstOrThrow({ where: { id: propertyId } });
    const a = await conv(propertyId, { createdAt: T0 });
    const b = await conv(propertyId, { createdAt: T1 });
    await msg(a.id, "m1");
    await msg(a.id, "m2");
    await msg(b.id, "m1");
    await prisma.messageOutbox.create({
      data: {
        organizationId: org.organizationId,
        conversationId: b.id,
        channel: "airbnb",
        body: "kuyrukta",
        idempotencyKey: "apply-test-1",
      },
    });
    await prisma.riskEvent.create({
      data: {
        organizationId: org.organizationId,
        conversationId: b.id,
        surface: "auto_reply",
        triggerId: "t1",
        finalDecision: "human_review",
      },
    });
    await prisma.shadowVerdict.create({
      data: {
        organizationId: org.organizationId,
        conversationId: b.id,
        triggerId: "t1",
        gateDecision: "human_review",
        model: "test",
      },
    });

    const plan = await planConversationDedupe(prisma, { allowPrimary: true });
    const out = await applyConversationDedupe(prisma, {
      ...GATE,
      expectations: {
        groups: plan.groups.planned,
        losers: plan.conversations.losers_planned,
        exactDuplicates: plan.messages.planned_drop_exact_duplicate,
      },
    });

    expect(out.refsRepointed).toEqual({ messageOutbox: 1, riskEvent: 1, shadowVerdict: 1 });
    expect(await prisma.messageOutbox.count({ where: { conversationId: a.id } })).toBe(1);
    expect(await prisma.riskEvent.count({ where: { conversationId: a.id } })).toBe(1);
    expect(await prisma.shadowVerdict.count({ where: { conversationId: a.id } })).toBe(1);
    expect(await prisma.messageOutbox.count({ where: { conversationId: b.id } })).toBe(0);
  });

  it("IDENTITY-ONLY: canlı durum eşitse hiçbir şey yazılmaz, kimlik alanı eksikse aktarılır", async () => {
    // Codex denetimi B1/B2/B4 sonrası: mergedConversationFields artık YALNIZ
    // single_non_null (kimlik) alanlarına dokunur. Burada status/priority/vb.
    // HER İKİ satırda da eşit (conv()'in varsayılanları) — apply hiçbir
    // canlı-durum yazmaz. NOT: reservationId burada KULLANILMAZ — pickKeeper
    // reservationId'si OLAN satırı keeper seçtiği için (identity-önce tie-break),
    // "keeper'da eksik, loser'da dolu" senaryosu reservationId için asla
    // gerçekleşemez; externalConversationId ise pickKeeper'ı ETKİLEMEZ, o yüzden
    // transfer testi bu alanla yapılır. a daha çok mesajlıdır → keeper a olur,
    // externalConversationId'si NULL'dur; b'deki değer a'ya aktarılır.
    const { propertyId } = await makeOrgWithProperty();
    const a = await conv(propertyId, { createdAt: T0, externalConversationId: null }); // kimlik YOK
    const b = await conv(propertyId, { createdAt: T1, externalConversationId: "prov-conv-1" });
    await msg(a.id, "m1");
    await msg(a.id, "m2");
    await msg(b.id, "m1");

    const plan = await planConversationDedupe(prisma, { allowPrimary: true });
    expect(plan.groups.planned).toBe(1); // canlı durum eşit -> fail-closed DEĞİL
    await applyConversationDedupe(prisma, {
      ...GATE,
      expectations: {
        groups: plan.groups.planned,
        losers: plan.conversations.losers_planned,
        exactDuplicates: plan.messages.planned_drop_exact_duplicate,
      },
    });

    const keeper = await prisma.conversation.findUniqueOrThrow({ where: { id: a.id } });
    expect(keeper.externalConversationId).toBe("prov-conv-1"); // kimlik aktarıldı
    expect(keeper.status).toBe("answered"); // conv() varsayılanı — YAZILMADI, değişmedi
    expect(keeper.createdAt.getTime()).toBe(T0.getTime()); // dokunulmadı (yalnız identity yazılır)
  });

  it("saf mergedConversationFields: keeper doluysa dokunmaz, boşsa loser'dan aktarır", () => {
    const keeper = { id: "a", reservationId: null } as unknown as Row;
    const loser = { id: "b", reservationId: "res-1" } as unknown as Row;
    const merged = mergedConversationFields([keeper, loser], keeper);
    expect(merged.reservationId).toBe("res-1");

    const keeperFilled = { id: "a", reservationId: "res-existing" } as unknown as Row;
    const merged2 = mergedConversationFields([keeperFilled, loser], keeperFilled);
    expect(merged2.reservationId).toBeUndefined(); // zaten dolu — dokunulmaz
  });
});

describe("apply — CANLI DURUM farkı (Codex denetimi B1/B2/B4)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("closed + new → HİÇBİR ŞEY yazılmaz/silinmez, tam rollback", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const closed = await conv(propertyId, { status: "closed", createdAt: T0 });
    const isNew = await conv(propertyId, { status: "new", createdAt: T1 });
    await msg(closed.id, "m1");
    await msg(isNew.id, "m1");

    await expect(
      applyConversationDedupe(prisma, { ...GATE, expectations: { groups: 1, losers: 1, exactDuplicates: 1 } }),
    ).rejects.toThrow(/Kilit altında ÇELİŞKİ bulundu \(live_state_conflict/);

    // "closed" ASLA "new" olmadı, hiçbir satır silinmedi.
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(2);
    const rows = await prisma.conversation.findMany({ where: { propertyId } });
    expect(rows.find((r) => r.id === closed.id)?.status).toBe("closed");
    expect(rows.find((r) => r.id === isNew.id)?.status).toBe("new");
  });

  it("escalation beşlisi parçalanmaz: fark varsa TÜMÜ birlikte fail-closed", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const a = await conv(propertyId, {
      status: "answered",
      priority: "standard",
      skippedReason: null,
      lastRiskLevel: null,
      lastRiskType: null,
      createdAt: T0,
    });
    const b = await conv(propertyId, {
      status: "problem",
      priority: "urgent",
      skippedReason: "complaint",
      lastRiskLevel: "high",
      lastRiskType: "complaint",
      createdAt: T1,
    });
    await msg(a.id, "m1");
    await msg(b.id, "m1");

    await expect(
      applyConversationDedupe(prisma, { ...GATE, expectations: { groups: 1, losers: 1, exactDuplicates: 1 } }),
    ).rejects.toThrow(/live_state_conflict/);

    // Escalation quintet'in HİÇBİRİ kısmen taşınmadı — a hâlâ eskisi gibi.
    const keeper = await prisma.conversation.findUniqueOrThrow({ where: { id: a.id } });
    expect(keeper.status).toBe("answered");
    expect(keeper.priority).toBe("standard");
    expect(keeper.skippedReason).toBeNull();
    expect(keeper.lastRiskLevel).toBeNull();
    expect(keeper.lastRiskType).toBeNull();
  });
});

describe("apply — çelişkide TAM rollback", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("aynı externalId + farklı gövde → HİÇBİR grup uygulanmaz", async () => {
    // Grup 1 tertemiz, grup 2 çelişkili. All-or-nothing: ikisi de dokunulmaz.
    const { propertyId } = await makeOrgWithProperty();
    const a = await conv(propertyId, { createdAt: T0 });
    const b = await conv(propertyId, { createdAt: T1 });
    await msg(a.id, "m1");
    await msg(b.id, "m1");

    const mk = (ext: string) =>
      prisma.conversation.create({
        data: {
          propertyId,
          guestIdentifier: "X",
          channel: "airbnb",
          externalReservationId: ext,
          externalConversationId: "pc2",
          createdAt: T0,
          lastMessageAt: T0,
        },
      });
    const c = await mk("prov-res-apply-2");
    const d = await mk("prov-res-apply-2");
    await msg(c.id, "z1", { body: "Orijinal" });
    await msg(d.id, "z1", { body: "FARKLI" }); // çelişki

    await expect(
      applyConversationDedupe(prisma, { ...GATE, expectations: { groups: 2, losers: 2, exactDuplicates: 2 } }),
    // NİYETİ pinle: durduran şey kilit-altı yeniden-ölçümdeki ÇELİŞKİ tespiti
    // olmalı; aşağı akıştaki "kaybedende mesaj kaldı" ağı ikinci savunmadır.
    ).rejects.toThrow(/Kilit altında ÇELİŞKİ/);

    // HİÇBİR ŞEY değişmedi — temiz grup bile.
    expect(await prisma.conversation.count()).toBe(4);
    expect(await prisma.message.count()).toBe(4);
    expect(await prisma.conversation.count({ where: { id: b.id } })).toBe(1);
  });

  it("farklı externalConversationId → rollback", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await conv(propertyId, { externalConversationId: "conv-A", createdAt: T0 });
    await conv(propertyId, { externalConversationId: "conv-B", createdAt: T1 });

    await expect(
      applyConversationDedupe(prisma, { ...GATE, expectations: { groups: 1, losers: 1, exactDuplicates: 0 } }),
    // NİYETİ pinle: durduran şey kilit-altı yeniden-ölçümdeki ÇELİŞKİ tespiti
    // olmalı; aşağı akıştaki "kaybedende mesaj kaldı" ağı ikinci savunmadır.
    ).rejects.toThrow(/Kilit altında ÇELİŞKİ/);
    expect(await prisma.conversation.count()).toBe(2);
  });
});

describe("apply — idempotency ve eşzamanlılık", () => {
  beforeEach(async () => {
    await resetDb();
    __importThreadHooks.afterCanonicalRead = null;
    __applyHooks.afterRowLock = null;
  });

  it("İKİNCİ koşu no-op", async () => {
    await seedRaceArtifact();
    const plan = await planConversationDedupe(prisma, { allowPrimary: true });
    await applyConversationDedupe(prisma, {
      ...GATE,
      expectations: {
        groups: plan.groups.planned,
        losers: plan.conversations.losers_planned,
        exactDuplicates: plan.messages.planned_drop_exact_duplicate,
      },
    });

    // Aynı (bayat) rakamlarla ikinci koşu → çakışma yok, rakam tutmaz → DURUR.
    await expect(
      applyConversationDedupe(prisma, { ...GATE, expectations: { groups: 1, losers: 1, exactDuplicates: 3 } }),
    ).rejects.toThrow(/zaten uygulanmış olabilir/);

    // Taze (sıfır) rakamlarla ikinci koşu → temiz NO-OP.
    const second = await applyConversationDedupe(prisma, {
      ...GATE,
      expectations: { groups: 0, losers: 0, exactDuplicates: 0 },
    });
    expect(second.noop).toBe(true);
    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.message.count()).toBe(3);
  });

  it("UÇUŞTAKİ sync bitmeden apply kilitleri ALAMAZ (NS-43) ve mesaj kaybolmaz", async () => {
    // ⚠️ Bu testin ilk hâli ZAMANLAMAYA bağlıydı ve vakumdu: apply o kadar hızlı
    // bitiyordu ki gerçek çekişme hiç oluşmuyordu, dolayısıyla kilidi
    // kaldırınca bile yeşil kalıyordu. Artık sıralama DOĞRUDAN ölçülüyor:
    // sync kanonik okumayı yapıp kilidi TUTARKEN bekler; apply kilitleri
    // ancak sync commit ettikten SONRA alabilmelidir.
    const { propertyId } = await seedRaceArtifact();
    const plan = await planConversationDedupe(prisma, { allowPrimary: true });

    const reservation = {
      id: EXT,
      platform: "airbnb",
      conversation_id: "prov-conv-1",
      last_message_at: "2026-05-30T11:00:00Z",
    };
    const messages = [
      {
        id: "m4",
        body: "Sync sirasinda gelen",
        sender_type: "guest",
        sender: { full_name: "Test Misafir" },
        created_at: "2026-05-30T11:00:00Z",
      },
    ];

    const HOLD_MS = 400;
    const APPLY_DELAY_MS = 80;
    let applyRequestedAt = 0;
    let applyLockedAt = 0;
    let syncCommittedAt = 0;
    __importThreadHooks.afterCanonicalRead = async () => {
      await new Promise((r) => setTimeout(r, HOLD_MS)); // kilidi TUT
    };
    __applyHooks.afterLocks = async () => {
      applyLockedAt = Date.now();
    };

    let applyError: unknown = null;
    try {
      const syncPromise = prisma
        .$transaction((tx) => importThread(tx, propertyId, reservation, messages, null), {
          timeout: 30_000,
          maxWait: 20_000,
        })
        .then((r) => {
          syncCommittedAt = Date.now();
          return r;
        });
      const applyPromise = (async () => {
        await new Promise((r) => setTimeout(r, APPLY_DELAY_MS)); // sync kilidi önce alsın
        applyRequestedAt = Date.now();
        try {
          return await applyConversationDedupe(prisma, {
            ...GATE,
            expectations: {
              groups: plan.groups.planned,
              losers: plan.conversations.losers_planned,
              exactDuplicates: plan.messages.planned_drop_exact_duplicate,
            },
          });
        } catch (err) {
          applyError = err;
          return null;
        }
      })();
      await Promise.all([syncPromise, applyPromise]);
    } finally {
      __applyHooks.afterLocks = null;
      __importThreadHooks.afterCanonicalRead = null;
    }

    // ASIL İDDİA #1: apply kilit için GERÇEKTEN BEKLEDİ.
    //
    // İki ayrı JS saatiyle "apply, sync'ten sonra kilitledi" demek sınırda ±1ms
    // flake üretiyordu (DB devri anlık; iki callback aynı milisaniyeye düşüyor).
    // Bunun yerine TEK saatle apply'ın bekleme SÜRESİ ölçülüyor: kilit yoksa
    // bu süre ~0'dır, kilit varsa sync'in tutma penceresi kadardır.
    expect(syncCommittedAt).toBeGreaterThan(0);
    const waited = applyLockedAt - applyRequestedAt;
    expect(waited).toBeGreaterThanOrEqual(HOLD_MS - APPLY_DELAY_MS - 120);

    // ASIL İDDİA #2 (Codex B1/B4 sonrası): sync tam da bu iki-satırlık grubun
    // BİRİNİ günceller (existing bulunan satır "new"a döner, diğeri "answered"
    // kalır) — apply artık bunu rank ile SESSİZCE çözmüyor, live_state_conflict
    // ile fail-closed oluyor. Bu, tam da kullanıcı direktifinin 4. maddesi:
    // "canlı durum farkı varsa rank kullanma, grubu fail-closed bırak."
    expect(applyError).toBeInstanceOf(Error);
    expect((applyError as Error).message).toMatch(/live_state_conflict/);

    // Ve sonuç doğru: TAM rollback — iki satır da duruyor, sync'in mesajı
    // KAYBOLMADI (apply'ın reddi hiçbir şeyi silmedi/yarım bırakmadı).
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(2);
    const allIds = (
      await prisma.message.findMany({ where: { conversation: { propertyId } }, select: { externalId: true } })
    ).map((m) => m.externalId);
    expect(allIds).toContain("m4");
    expect(allIds).toHaveLength(7); // a:m1,m2,m3 + b:m1,m2,m3 + sync'in m4'ü
  });

  it("FOR UPDATE ALTINDA eşzamanlı autoReplyHoldUntil yazımı KAYBOLMAZ (Codex B2)", async () => {
    // Senaryo: apply bu grubun satırlarını FOR UPDATE ile kilitledikten hemen
    // sonra (afterRowLock), auto-reply/escalation benzeri BAŞKA bir yazıcı
    // (NS-43 ALMADAN, gerçek koddaki gibi düz bir prisma.conversation.update)
    // keeper'ın autoReplyHoldUntil'ini günceller. Bu yazım apply'ın tuttuğu
    // satır kilidinde BEKLEMELİDİR; apply commit ettikten SONRA uygulanmalı
    // VE apply'ın kendisi bu alanı hiç yazmadığı için kaybolmamalıdır.
    const { a } = await seedRaceArtifact(); // keeper = a (pickKeeper: en eski createdAt)
    const plan = await planConversationDedupe(prisma, { allowPrimary: true });
    const HOLD_MS = 300;
    const FUTURE_HOLD = new Date("2026-06-01T00:00:00Z");

    let fired = false;
    let dispatchedAt = 0;
    let completedAt = 0;
    let concurrentWrite: Promise<unknown> | null = null;
    __applyHooks.afterRowLock = async () => {
      if (fired) return;
      fired = true;
      dispatchedAt = Date.now();
      // AYRI bağlantı/oturum: apply'ın transaction'ının İÇİNDE DEĞİL — gerçek
      // eşzamanlı bir yazıcıyı taklit eder (automation.ts'in kendi yazıcıları
      // da NS-43 almadan, ayrı bir çağrı olarak yazar).
      concurrentWrite = prisma.conversation
        .update({ where: { id: a.id }, data: { autoReplyHoldUntil: FUTURE_HOLD } })
        .then(() => {
          completedAt = Date.now();
        });
      await new Promise((r) => setTimeout(r, HOLD_MS)); // apply'i kilit tutarken YAVAŞLAT
    };

    try {
      await applyConversationDedupe(prisma, {
        ...GATE,
        expectations: {
          groups: plan.groups.planned,
          losers: plan.conversations.losers_planned,
          exactDuplicates: plan.messages.planned_drop_exact_duplicate,
        },
      });
      await concurrentWrite; // apply commit ettiyse artık cozulmus olmali
    } finally {
      __applyHooks.afterRowLock = null;
    }

    // ASIL İDDİA: eşzamanlı yazıcı GERÇEKTEN BEKLEDİ (apply'ın kilidi tutmasi
    // kadar) — anında geçmedi.
    expect(completedAt).toBeGreaterThan(0);
    expect(completedAt - dispatchedAt).toBeGreaterThanOrEqual(HOLD_MS - 120);

    // VE değer KAYBOLMADI: apply autoReplyHoldUntil'e hiç dokunmadığı için
    // eşzamanlı yazıcının değeri aynen duruyor.
    const keeper = await prisma.conversation.findUniqueOrThrow({ where: { id: a.id } });
    expect(keeper.autoReplyHoldUntil?.getTime()).toBe(FUTURE_HOLD.getTime());
  });

  it("FOR UPDATE ALTINDA kaybedene gelen mesaj İNSERT'i SESSİZCE kaybolmaz (Codex B3)", async () => {
    // Senaryo: apply loser satırını kilitledikten hemen sonra, o loser'a
    // referans veren BAĞIMSIZ bir Message INSERT'i denenir (gerçek koddaki
    // manuel-yanıt/auto-reply INSERT'lerinin taklidi). Message.conversationId
    // FK'si bu INSERT için ebeveyn satırda FOR KEY SHARE ister — apply'ın
    // FOR UPDATE'iyle ÇAKIŞIR, yani INSERT apply bitene kadar BLOKLANIR.
    // Apply loser'ı SİLDİKTEN sonra bu INSERT ya (a) hâlâ bloklanıyorsa asla
    // commit olmaz, ya da (b) tam o anda serbest kalırsa FK ihlaliyle AÇIKÇA
    // reddedilir — HİÇBİR durumda "sessizce yazılıp sonra cascade ile
    // kaybolma" olmaz.
    const { b } = await seedRaceArtifact(); // loser = b (pickKeeper: b daha yeni)
    const plan = await planConversationDedupe(prisma, { allowPrimary: true });
    const HOLD_MS = 300;

    let fired = false;
    let dispatchedAt = 0;
    let settledAt = 0;
    let outcome: "resolved" | "rejected" | null = null;
    let insertPromise: Promise<unknown> | null = null;
    __applyHooks.afterRowLock = async () => {
      if (fired) return;
      fired = true;
      dispatchedAt = Date.now();
      insertPromise = prisma.message
        .create({
          data: {
            conversationId: b.id, // LOSER — apply bunu birazdan silecek
            direction: "inbound",
            senderName: "Yarış Misafiri",
            body: "Kilit sırasında gelen mesaj",
            language: "tr",
            externalId: "race-insert-1",
            aiAssisted: false,
            authorType: "guest",
          },
        })
        .then(
          () => {
            outcome = "resolved";
            settledAt = Date.now();
          },
          () => {
            outcome = "rejected";
            settledAt = Date.now();
          },
        );
      await new Promise((r) => setTimeout(r, HOLD_MS)); // apply'i kilit tutarken YAVAŞLAT
    };

    try {
      await applyConversationDedupe(prisma, {
        ...GATE,
        expectations: {
          groups: plan.groups.planned,
          losers: plan.conversations.losers_planned,
          exactDuplicates: plan.messages.planned_drop_exact_duplicate,
        },
      });
      await insertPromise;
    } finally {
      __applyHooks.afterRowLock = null;
    }

    // ASIL İDDİA: INSERT GERÇEKTEN BEKLEDİ — apply'ın satırı silmesinden ÖNCE
    // sessizce commit olmadı.
    expect(outcome).not.toBeNull();
    expect(settledAt - dispatchedAt).toBeGreaterThanOrEqual(HOLD_MS - 120);
    // Ebeveyn (loser) artık silinmiş olduğu için INSERT ya FK ihlaliyle
    // REDDEDİLİR ya da hiç commit olmamıştır — "yazıldı ama sonra sessizce
    // cascade ile silindi" senaryosu YAPISAL olarak imkânsız: reddedilen
    // bir INSERT hiçbir zaman satır üretmez.
    expect(outcome).toBe("rejected");
    expect(await prisma.message.count({ where: { externalId: "race-insert-1" } })).toBe(0);
  });
});
