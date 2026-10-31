import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { prisma as realPrisma, resetDb } from "../helpers/db";
import { isTriageStale } from "@/lib/ai/triage";

// ---------------------------------------------------------------------------
// m48 — `count === 0` PENCERESİ: ESKİ SNAPSHOT "GÜNCEL ANALİZ" GİBİ GÖSTERİLMEZ
//
// 🚨 CODEX'İN BULDUĞU BOŞLUK (08-09). `applyInboundMessageRules`'ta status
// yazması KOŞULSUZ, triyaj yazması ise tazelik çapasına KOŞULLU. Araya yeni bir
// mesaj girmişse triyaj `count === 0` alır ve YAZILMAZ — ama status YİNE
// `"problem"` olur. Sonuç: konuşma sorunlu listesine girer ve üzerinde ÖNCEKİ
// escalation'ın analizi durur.
//
// "Her escalation atomik yenilenir" iddiası bu istisnayı AÇIKLAMADAN doğru
// değildi. Doğrusu:
//   · Yazma GERÇEKLEŞİRSE altı alan BİRLİKTE yenilenir (tek `updateMany` —
//     kısmi güncelleme yapısal olarak imkânsız).
//   · Yazma GERÇEKLEŞMEZSE (`count === 0`) altı alan da ESKİ hâlinde kalır ve
//     korumayı OKUMA YÜZEYİ üstlenir: tetikleyici mesaj ile mevcut son inbound
//     mesaj uyuşmadığı için satır BAYAT işaretlenir.
//
// Bu dosya o zinciri UÇTAN UCA kanıtlıyor: gerçek fonksiyon, gerçek `count=0`,
// gerçek DB durumu, sonra okuma yüzeyinin verdiği hüküm.
// ---------------------------------------------------------------------------

/** Bayat çapa anahtarı — `true` iken `findUnique` satırı ESKİ bir
 *  `lastMessageAt` ile döndürür, yani "okuduktan sonra dünya değişti" hâlinin
 *  kod açısından ayırt edilemez eşleniği. */
const staleRead = { on: false };

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  const base = actual.prisma;
  // ⚠️ MODÜL MOCK'U, `vi.spyOn` DEĞİL. Prisma istemcisi proxy tabanlı; delegate
  // üzerinde `spyOn` + `mockRestore` onu KALICI bozuyor (ölçüldü: sonraki testte
  // "findUnique is not a function"). Modül düzeyinde sarmalamak yan etkiyi bu
  // DOSYAYLA sınırlar.
  const conversation = new Proxy(base.conversation, {
    get(target, prop, receiver) {
      if (prop === "findUnique" && staleRead.on) {
        return async (args: unknown) => {
          const row = (await (target as never as { findUnique: (a: unknown) => Promise<unknown> }).findUnique(
            args,
          )) as { lastMessageAt?: Date } | null;
          return row && row.lastMessageAt ? { ...row, lastMessageAt: new Date(0) } : row;
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  const proxied = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "conversation") return conversation;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { ...actual, prisma: proxied };
});

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { applyInboundMessageRules } from "@/lib/automation";

const COMPLAINT = "Klima çalışmıyor ve daire çok pis, berbat durumda.";

/** Önceki bir escalation'dan kalan ALTI alan (model yolu). */
const OLD_TRIAGE = {
  aiActionSuggestion: "ESKİ ANALİZ: ekibi yönlendirin, fotoğraf isteyin.",
  aiMissingInfoJson: JSON.stringify(["eski-foto", "eski-oda"]),
  aiConfidence: 0.91,
  aiTriageSource: "model",
  aiTriagedAt: new Date("2026-08-01T00:00:00.000Z"),
};

async function seed() {
  const org = await realPrisma.organization.create({ data: { name: "Org" } });
  const property = await realPrisma.property.create({
    data: { organizationId: org.id, name: "Lale 7" },
  });
  // ESKİ mesaj (m1) — önceki triyajın tetikleyicisi.
  const conv = await realPrisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      lastMessageAt: new Date("2026-08-01T00:00:00.000Z"),
      messages: {
        create: [
          {
            direction: "inbound",
            senderName: "Alex",
            body: "İlk mesaj",
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
          },
        ],
      },
    },
    include: { messages: true },
  });
  const m1 = conv.messages[0];
  await realPrisma.conversation.update({
    where: { id: conv.id },
    data: { ...OLD_TRIAGE, aiTriageTriggerMessageId: m1.id },
  });
  // YENİ mesaj (m2) — triyaj ondan SONRA gelmiş.
  const m2 = await realPrisma.message.create({
    data: {
      conversationId: conv.id,
      direction: "inbound",
      senderName: "Alex",
      body: COMPLAINT,
      createdAt: new Date("2026-08-05T00:00:00.000Z"),
    },
  });
  await realPrisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date("2026-08-05T00:00:00.000Z") },
  });
  return { convId: conv.id, m1Id: m1.id, m2Id: m2.id };
}

describe("m48 — `count === 0` penceresi (Codex şartı)", () => {
  beforeEach(async () => {
    await resetDb();
    staleRead.on = false;
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => {
    staleRead.on = false;
    vi.unstubAllEnvs();
  });

  it("🚨 ÇAPA KAYDI: status 'problem' olur, ESKİ altı alan AYNEN kalır (kısmi yazma YOK)", async () => {
    const { convId, m1Id } = await seed();
    staleRead.on = true; // okuma bayat çapa döndürür → koşullu yazma 0 satır etkiler

    const out = await applyInboundMessageRules(convId, COMPLAINT);
    expect(out.isComplaint).toBe(true); // KONTROL: escalate dalı gerçekten koştu

    const c = await realPrisma.conversation.findUniqueOrThrow({ where: { id: convId } });
    // Mevcut davranış korundu: status koşulsuz yazıldı.
    expect(c.status).toBe("problem");
    expect(c.priority).toBe("urgent");
    // 🚨 ALTI ALAN DA ESKİ HÂLİNDE — hiçbiri kısmen güncellenmedi. Tek
    // `updateMany` olduğu için "üçü yeni, üçü eski" durumu YAPISAL olarak
    // imkânsız; bu iddia burada ölçülüyor.
    expect(c.aiActionSuggestion).toBe(OLD_TRIAGE.aiActionSuggestion);
    expect(c.aiMissingInfoJson).toBe(OLD_TRIAGE.aiMissingInfoJson);
    expect(c.aiConfidence).toBe(OLD_TRIAGE.aiConfidence);
    expect(c.aiTriageSource).toBe("model"); // "keyword"e DÖNMEDİ
    expect(c.aiTriagedAt?.toISOString()).toBe(OLD_TRIAGE.aiTriagedAt.toISOString());
    expect(c.aiTriageTriggerMessageId).toBe(m1Id); // hâlâ ESKİ mesajı işaret ediyor
  });

  it("🚨 VE OKUMA YÜZEYİ BUNU BAYAT SAYAR — eski snapshot 'güncel' gibi gösterilmez", async () => {
    const { convId, m2Id } = await seed();
    staleRead.on = true;
    await applyInboundMessageRules(convId, COMPLAINT);
    staleRead.on = false;

    // `/inbox` panelinin okuduğu ŞEKLİN aynısı: satır + son inbound mesaj.
    const row = await realPrisma.conversation.findUniqueOrThrow({
      where: { id: convId },
      select: {
        lastMessageAt: true,
        aiTriagedAt: true,
        aiTriageTriggerMessageId: true,
        messages: {
          where: { direction: "inbound" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { id: true },
        },
      },
    });
    expect(row.messages[0].id).toBe(m2Id); // KONTROL: son inbound gerçekten m2

    const stale = isTriageStale({
      triggerMessageId: row.aiTriageTriggerMessageId,
      latestInboundMessageId: row.messages[0]?.id ?? null,
      triagedAt: row.aiTriagedAt,
      lastMessageAt: row.lastMessageAt,
    });
    // ⬅️ ZİNCİRİN SON HALKASI: tetikleyici (m1) ile mevcut son mesaj (m2)
    //    uyuşmuyor → satır BAYAT işaretlenir ve panel "Bu analizden sonra yeni
    //    mesaj geldi" rozetini çizer. Yani host eski öneriyi GÜNCEL sanmaz.
    expect(stale).toBe(true);
  });

  it("ZİNCİRİN SON HALKASI: `/inbox` bayatlığı panele GEÇİRİYOR", () => {
    // Yukarıdaki iki test "veri bayat" diyor; bu test o hükmün EKRANA
    // ulaştığını pinler. Aksi hâlde dedektör doğru çalışır ama panel rozeti
    // hiç çizmez ve host eski öneriyi güncel sanar — zincir sessizce kopardı.
    const page = readFileSync("src/app/(app)/inbox/page.tsx", "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    const at = page.indexOf("<ProblemTriagePanel");
    expect(at, "triyaj paneli sayfadan kaldırılmış").toBeGreaterThan(-1);
    const block = page.slice(at, page.indexOf("/>", at));
    // `stale` prop'u DOĞRUDAN dedektörden besleniyor (sabit `false` DEĞİL).
    expect(block).toMatch(/stale:\s*isTriageStale\(/);
    // Ve dedektöre gerçek iki taraf veriliyor: tetikleyici + son inbound mesaj.
    expect(block).toMatch(/triggerMessageId:\s*r\.aiTriageTriggerMessageId/);
    expect(block).toMatch(/latestInboundMessageId:\s*r\.messages\[0\]\?\.id/);
  });

  it("KONTROL: çapa TUTARSA altı alan YENİLENİR ve satır BAYAT olmaz", async () => {
    // Bu olmadan "her zaman bayat" ya da "hiç yazma" mutasyonları da yeşil
    // geçerdi ve yukarıdaki iki testin ikisi de anlamsızlaşırdı.
    const { convId, m2Id } = await seed();
    staleRead.on = false; // normal akış

    await applyInboundMessageRules(convId, COMPLAINT);

    const c = await realPrisma.conversation.findUniqueOrThrow({
      where: { id: convId },
      select: {
        lastMessageAt: true,
        aiTriagedAt: true,
        aiTriageSource: true,
        aiActionSuggestion: true,
        aiConfidence: true,
        aiTriageTriggerMessageId: true,
        messages: {
          where: { direction: "inbound" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { id: true },
        },
      },
    });
    // Altı alan YENİLENDİ: kelime yolu analizi NULL'lar, kaynağı "keyword" yapar.
    expect(c.aiTriageSource).toBe("keyword");
    expect(c.aiActionSuggestion).toBeNull();
    expect(c.aiConfidence).toBeNull();
    expect(c.aiTriageTriggerMessageId).toBe(m2Id);
    expect(
      isTriageStale({
        triggerMessageId: c.aiTriageTriggerMessageId,
        latestInboundMessageId: c.messages[0]?.id ?? null,
        triagedAt: c.aiTriagedAt,
        lastMessageAt: c.lastMessageAt,
      }),
    ).toBe(false);
  });
});
