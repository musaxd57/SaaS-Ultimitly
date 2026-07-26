import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { planConversationDedupe } from "../../scripts/dryrun-conversation-dedupe";
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
    status: string;
    createdAt: Date;
    lastMessageAt: Date;
    autoReplyHoldUntil: Date | null;
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
      status: o.status ?? "answered",
      createdAt: o.createdAt ?? T0,
      lastMessageAt: o.lastMessageAt ?? T0,
      autoReplyHoldUntil: o.autoReplyHoldUntil ?? null,
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

  it("kolon birleştirme YÖNLÜ: problem kazanır, hold MAX, cursor en ihtiyatlı", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const a = await conv(propertyId, {
      createdAt: T0,
      status: "answered",
      autoReplyHoldUntil: T0,
      syncCursorAt: T1,
    });
    const b = await conv(propertyId, {
      createdAt: T1,
      status: "problem",
      autoReplyHoldUntil: T1,
      syncCursorAt: null,
    });
    await msg(a.id, "m1");
    await msg(a.id, "m2");
    await msg(b.id, "m1");

    const plan = await planConversationDedupe(prisma, { allowPrimary: true });
    await applyConversationDedupe(prisma, {
      ...GATE,
      expectations: {
        groups: plan.groups.planned,
        losers: plan.conversations.losers_planned,
        exactDuplicates: plan.messages.planned_drop_exact_duplicate,
      },
    });

    const keeper = await prisma.conversation.findUniqueOrThrow({ where: { id: a.id } });
    expect(keeper.status).toBe("problem"); // dikkat isteyen kazandı
    expect(keeper.autoReplyHoldUntil?.getTime()).toBe(T1.getTime()); // devir penceresi kısalmadı
    expect(keeper.syncCursorAt).toBeNull(); // NULL = en ihtiyatlı
    expect(keeper.createdAt.getTime()).toBe(T0.getTime()); // en eski doğuş
    // Saf birleştirici de aynı yönü vermeli (DB'siz kanıt).
    const merged = mergedConversationFields([a, b] as never);
    expect(merged.status).toBe("problem");
    expect(merged.syncCursorAt).toBeNull();
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
        return applyConversationDedupe(prisma, {
          ...GATE,
          expectations: {
            groups: plan.groups.planned,
            losers: plan.conversations.losers_planned,
            exactDuplicates: plan.messages.planned_drop_exact_duplicate,
          },
        });
      })();
      await Promise.all([syncPromise, applyPromise]);
    } finally {
      __applyHooks.afterLocks = null;
      __importThreadHooks.afterCanonicalRead = null;
    }

    // ASIL İDDİA: apply kilit için GERÇEKTEN BEKLEDİ.
    //
    // İki ayrı JS saatiyle "apply, sync'ten sonra kilitledi" demek sınırda ±1ms
    // flake üretiyordu (DB devri anlık; iki callback aynı milisaniyeye düşüyor).
    // Bunun yerine TEK saatle apply'ın bekleme SÜRESİ ölçülüyor: kilit yoksa
    // bu süre ~0'dır, kilit varsa sync'in tutma penceresi kadardır.
    expect(syncCommittedAt).toBeGreaterThan(0);
    const waited = applyLockedAt - applyRequestedAt;
    expect(waited).toBeGreaterThanOrEqual(HOLD_MS - APPLY_DELAY_MS - 120);

    // Ve sonuç doğru: tek konuşma, sync'in mesajı KAYBOLMADI.
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(1);
    const keeper = await prisma.conversation.findFirstOrThrow({ where: { propertyId } });
    const ids = (
      await prisma.message.findMany({ where: { conversationId: keeper.id }, select: { externalId: true } })
    ).map((m) => m.externalId);
    expect(ids).toContain("m4");
    expect(ids).toHaveLength(4); // m1,m2,m3 (tekil) + m4
  });
});
