import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { NEW_ORG_AUTO_REPLY_WINDOW } from "@/lib/constants";

// ---------------------------------------------------------------------------
// İKİ KULLANICI KARARI (2026-07-31) — ikisi de müşteriye verilen sözü kodla
// eşitliyor.
//
// 1. GÜNLÜK AI KOTASI OTO-YANITI DA KAPSAR. Kota panelde "günde N AI işlemi"
//    diye satılıyordu ama en büyük harcama kalemi — misafire giden otomatik
//    yanıt — sayaca HİÇ dokunmuyordu. Hem söylenen tavan uygulanmıyordu hem de
//    maliyet korumasının asıl hedefi kapsam dışıydı.
//
// 2. YENİ İŞLETME "TÜM GÜN" AÇIK DOĞAR. Şema varsayılanı 00:00–09:00 idi (yalnız
//    gece), oysa satış sayfası üç yerde "7/24" diyor: host toggle'ı açıyor,
//    gündüz gelen hiçbir mesaja cevap gitmiyordu.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/messaging", async (orig) => {
  const actual = await orig<typeof import("@/lib/messaging")>();
  return { ...actual, sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "m1" })) };
});

import { suggestReply } from "@/lib/ai";
import { applyChannelAutoReply, runDueChannelAutoReplies } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);

/** Kapıdan GEÇEN, güvenle otomatik gönderilebilir bir model hükmü. */
const cleanVerdict = {
  intent: "wifi",
  confidence: 0.95,
  reply: "Wi-Fi ağı LaleApt, şifre 12345678.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
};

async function seed() {
  const org = await prisma.organization.create({
    data: { name: "Org", autoReplyHospitable: true, ...NEW_ORG_AUTO_REPLY_WINDOW },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale 7" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: "res-1",
      status: "new",
      lastMessageAt: new Date(),
      messages: {
        create: [
          {
            direction: "inbound",
            senderName: "Alex",
            body: "Wifi şifresi nedir?",
            createdAt: new Date(),
          },
        ],
      },
    },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

describe("oto-yanıt günlük AI kotasına bağlı", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(cleanVerdict);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("kota İÇİNDEYKEN normal gönderir (regresyon pini)", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "50");
    const { conversationId } = await seed();
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
  });

  it("kota DOLUNCA gönderilmez ve MODEL HİÇ ÇAĞRILMAZ (asıl maliyet korumasi)", async () => {
    // Tavan 1: ilk çağrı kotayı doldurur, ikincisi reddedilir.
    vi.stubEnv("AI_DAILY_CALL_CAP", "1");
    const { conversationId } = await seed();

    const first = await applyChannelAutoReply(conversationId);
    expect(first.sent).toBe(true);

    // İkinci konuşma aynı org'da.
    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { propertyId: true },
    });
    const second = await prisma.conversation.create({
      data: {
        propertyId: conv.propertyId,
        channel: "airbnb",
        guestIdentifier: "Bea",
        externalReservationId: "res-2",
        status: "new",
        lastMessageAt: new Date(),
        messages: {
          create: [
            { direction: "inbound", senderName: "Bea", body: "Çöp nereye?", createdAt: new Date() },
          ],
        },
      },
    });

    mockSuggest.mockClear();
    const out = await applyChannelAutoReply(second.id);

    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("daily_budget");
    // KRİTİK: kota kontrolü model çağrısının ÖNÜNDE — yoksa "maliyet tavanı"
    // maliyeti harcadıktan sonra devreye girerdi.
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it("kota dolduğunda sebep host'a GÖRÜNÜR yazılır", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "1");
    const { conversationId } = await seed();
    await applyChannelAutoReply(conversationId); // kotayı doldur

    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { propertyId: true },
    });
    const second = await prisma.conversation.create({
      data: {
        propertyId: conv.propertyId,
        channel: "airbnb",
        guestIdentifier: "Bea",
        externalReservationId: "res-2",
        status: "new",
        lastMessageAt: new Date(),
        messages: {
          create: [
            { direction: "inbound", senderName: "Bea", body: "Çöp nereye?", createdAt: new Date() },
          ],
        },
      },
    });
    await applyChannelAutoReply(second.id);

    const after = await prisma.conversation.findUniqueOrThrow({
      where: { id: second.id },
      select: { skippedReason: true, status: true, autoReplyAttemptedAt: true },
    });
    expect(after.skippedReason).toBe("daily_budget");
    // Konuşma "new" KALIR ve damgalanmaz → pencere dönünce normal yanıtlanır.
    // Damgalansaydı misafir hiç cevap alamazdı: kayıp, gecikme değil.
    expect(after.status).toBe("new");
    expect(after.autoReplyAttemptedAt).toBeNull();
  });

  it("ÖNİZLEME (dryRun) kotadan düşmez — çifte cezalandırma yok", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "1");
    const { conversationId } = await seed();

    await applyChannelAutoReply(conversationId, { dryRun: true });
    await applyChannelAutoReply(conversationId, { dryRun: true });
    await applyChannelAutoReply(conversationId, { dryRun: true });

    // Üç önizlemeden sonra GERÇEK gönderim hâlâ mümkün olmalı.
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true);
  });
});

describe("yeni işletme TÜM GÜN açık doğar (7/24 sözü)", () => {
  it("sabit değer: başlangıç == bitiş == 0 → kod bunu 'tüm gün' sayar", async () => {
    expect(NEW_ORG_AUTO_REPLY_WINDOW.autoReplyStartHour).toBe(
      NEW_ORG_AUTO_REPLY_WINDOW.autoReplyEndHour,
    );
    const { isWithinActiveHours } = await import("@/lib/automation");
    for (let h = 0; h < 24; h++) {
      expect(
        isWithinActiveHours(
          NEW_ORG_AUTO_REPLY_WINDOW.autoReplyStartHour,
          NEW_ORG_AUTO_REPLY_WINDOW.autoReplyEndHour,
          h,
        ),
        `saat ${h}`,
      ).toBe(true);
    }
  });

  it("ESKİ varsayılan (0–9) gündüzü kapatıyordu — kırmızı-önce kanıtı", async () => {
    const { isWithinActiveHours } = await import("@/lib/automation");
    expect(isWithinActiveHours(0, 9, 14)).toBe(false); // öğleden sonra: cevap YOK
    expect(isWithinActiveHours(0, 9, 3)).toBe(true); // gece: cevap var
  });

  it("org yaratan İKİ yol da bu sabiti kullanıyor (kaynak-tarama pini)", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    for (const rel of [
      "src/app/api/auth/register/route.ts",
      "src/app/api/admin/customers/route.ts",
    ]) {
      const src = readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
      expect(src, rel).toContain("NEW_ORG_AUTO_REPLY_WINDOW");
    }
  });
});

// ---------------------------------------------------------------------------
// ORG GEÇİŞİNİ SONLANDIRAN KOL — daha önce HİÇ test edilmiyordu (denetim, 08-01).
//
// Yukarıdaki dört test tek KONUŞMA seviyesinde koşuyor (`applyChannelAutoReply`).
// Kotanın org geçişini kestiği yer ise yalnız RUN seviyesinde var: tavana
// çarpınca `break` edilir ve kalan adaylara sebep yazılır. O daldaki
// "GERÇEK SEBEBİ EZME" koşulu (08-01'de eklendi — `human_hold` /
// `reservation_ended` satırlarına `daily_budget` yazmak host'a YALAN söylüyordu)
// tek bir assertion tarafından korunmuyordu.
// ---------------------------------------------------------------------------
describe("günlük kota — org geçişini sonlandıran kol", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(cleanVerdict);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  /**
   * Sıra DETERMİNİSTİK olmalı: geçiş `lastMessageAt asc` (en eski önce) işler.
   * Yaşları açıkça veriyoruz ki hangi konuşmanın nerede olduğu belli olsun.
   *   A (en eski) → yanıtlanır, kotayı tüketir
   *   B          → kotaya çarpar, geçiş BURADA durur
   *   C, D       → hiç işlenmez; toplu `updateMany` ile sebep alır
   */
  async function seedFour(propertyId: string) {
    const ids: Record<string, string> = {};
    const ages: [string, number][] = [["A", 10], ["B", 8], ["C", 6], ["D", 4]];
    for (const [label, minutesAgo] of ages) {
      const when = new Date(Date.now() - minutesAgo * 60_000);
      const c = await prisma.conversation.create({
        data: {
          propertyId,
          channel: "airbnb",
          guestIdentifier: label,
          externalReservationId: `res-${label}`,
          status: "new",
          lastMessageAt: when,
          messages: {
            create: [
              { direction: "inbound", senderName: label, body: "Wifi şifresi nedir?", createdAt: when },
            ],
          },
        },
      });
      ids[label] = c.id;
    }
    return ids;
  }

  async function orgWithProperty() {
    const org = await prisma.organization.create({
      data: { name: "Org", autoReplyHospitable: true, ...NEW_ORG_AUTO_REPLY_WINDOW },
    });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Lale 7" },
    });
    return { orgId: org.id, propertyId: property.id };
  }

  it("tavana çarpınca geçiş DURUR ve HİÇ İŞLENMEYEN adaylara sebep yazılır", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "1"); // tek çağrılık tavan
    const { orgId, propertyId } = await orgWithProperty();
    const id = await seedFour(propertyId);

    const out = await runDueChannelAutoReplies(orgId);
    expect(out.sent).toBe(1); // yalnız A gönderildi

    const a = await prisma.conversation.findUniqueOrThrow({ where: { id: id.A } });
    expect(a.status).toBe("answered");

    // C ve D hiç işlenmedi: sebep TOPLU yazma ile geldi, damga YOK.
    for (const label of ["C", "D"]) {
      const c = await prisma.conversation.findUniqueOrThrow({ where: { id: id[label] } });
      expect(`${label}:${c.skippedReason}`).toBe(`${label}:daily_budget`);
      expect(`${label}:${c.status}`).toBe(`${label}:new`); // hâlâ cevap bekliyor
      // ⚠️ DAMGALANMAZ: pencere dönünce normal şekilde yanıtlanmalı.
      expect(`${label}:${c.autoReplyAttemptedAt}`).toBe(`${label}:null`);
    }
  });

  it("GERÇEK sebebi EZMEZ: zaten sebebi olan aday 'daily_budget' etiketi almaz", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "1");
    const { orgId, propertyId } = await orgWithProperty();
    const id = await seedFour(propertyId);
    // C hiç işlenmeyecek adaylardan biri ve ZATEN gerçek bir sebep taşıyor.
    // Kota kolu onu ezerse host'a "sınır yenilenince yanıtlanacak" YALANI söylenir
    // — oysa o konuşma sınır yenilense de asla yanıtlanmayacak.
    await prisma.conversation.update({
      where: { id: id.C },
      data: { skippedReason: "reservation_ended" },
    });

    await runDueChannelAutoReplies(orgId);

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: id.C } });
    expect(c.skippedReason).toBe("reservation_ended"); // ⬅️ ezilirse KIRMIZI
    const d = await prisma.conversation.findUniqueOrThrow({ where: { id: id.D } });
    expect(d.skippedReason).toBe("daily_budget"); // sebebi olmayan satır etiketlenir
  });
});
