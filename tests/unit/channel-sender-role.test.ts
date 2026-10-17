import { describe, it, expect } from "vitest";
import { senderRoleOf } from "@/lib/channels/hospitable-ingest";
import { canonicalChannelSenderRole, isAnsweringOutbound, isChannelAutomation, notChannelAutomationWhere } from "@/lib/message-author";
import { isHostAuthored, type HistoryMessage } from "@/lib/kb-from-history";
import { buildLearnPairs } from "@/lib/history-learn/pairs";

// ---------------------------------------------------------------------------
// L5 (kurucu 10-17: "sağlayıcı otomasyonu ile ev sahibinin mesajını AYIR; Airbnb Direct'e geçişte rol kanal katmanında"). 1. faz: kanalın KENDİ
// otomatik mesajı ev sahibinin bilgisi / sesi sayılmaz; "cevap mı" kuralı DEĞİŞMEZ (2. faz kurucu sorusu Q2). Yalnız KESİN otomasyon ayrılır —
// tanınmayan rol bugünkü gibi ev sahibi.
// ---------------------------------------------------------------------------

describe("Hospitable gönderen rolü eşlemesi (açık işaret, kesin eşitlik)", () => {
  it.each([
    [{ sender_type: "guest", sender_role: "guest" }, "guest"],
    [{ sender_type: "host", sender_role: "host" }, "host"],
    [{ sender_type: "host", sender_role: "co-host" }, "host"],
    [{ sender_type: "host", sender_role: "teammate" }, "host"],
    [{ sender_type: "host" }, "host"],
    [{ sender_type: "automated" }, "automation"],
    [{ sender_type: "host", sender_role: "AI" }, "automation"],
    [{ sender_type: "host", source: "scheduled" }, "automation"],
    [{ sender_type: "host", automated: true }, "automation"],
    [{ sender_type: "host", is_automated: true }, "automation"],
    [{}, null],
    [{ sender_type: "host", sender_role: "maintainer" }, "unknown"],
    [{ sender_type: "user" }, "unknown"],
  ] as const)("%j → %s", (fields, expected) => {
    expect(senderRoleOf({ id: "m1", body: "x", ...fields })).toBe(expected);
  });

  it("aşırı uygulama yok: alt dize otomasyon sayılmaz ('mail' içinde 'ai', 'robotics' içinde 'bot'); bilinmeyen kaynak değeri rolü değiştirmez", () => {
    expect(senderRoleOf({ id: "m1", sender_type: "host", sender_role: "mail" })).toBe("unknown");
    expect(senderRoleOf({ id: "m1", sender_type: "host", sender_role: "robotics" })).toBe("unknown");
    expect(senderRoleOf({ id: "m1", sender_type: "host", source: "hospitable" })).toBe("host");
    expect(senderRoleOf({ id: "m1", sender_type: "host", automated: "true" })).toBe("host"); // yalnız gerçek boolean
  });
});

describe("çekirdek rol doğrulaması — kapalı küme + yönle tutarlılık", () => {
  it.each([
    ["inbound", "guest", "guest"],
    ["outbound", "host", "host"],
    ["outbound", "automation", "automation"],
    ["outbound", "unknown", "unknown"],
    ["inbound", null, null],
    ["outbound", undefined, null],
    ["outbound", "Automation", "unknown"], // kapalı küme büyük / küçük harf duyarlı — adaptör küçük harf verir
    ["outbound", "weird", "unknown"],
    ["inbound", "host", "unknown"], // misafir mesajı ama rol ev sahibi → tutarsız
    ["inbound", "automation", "unknown"],
    ["outbound", "guest", "unknown"],
  ] as const)("%s + %s → %s", (direction, role, expected) => {
    expect(canonicalChannelSenderRole(direction, role)).toBe(expected);
  });
});

describe("1. faz: 'cevap mı' kuralı DEĞİŞMEZ (2. faz kurucu kararı)", () => {
  it("🚨 kanal otomasyonu bugün hâlâ cevap sayılır — bilinçli değişiklik bu pini kırar", () => {
    expect(isAnsweringOutbound({ direction: "outbound", authorType: "host", channelSenderRole: "automation" } as never)).toBe(true);
  });
  it("Prisma süzgeci NULL'u da kapsar (yalnız 'automation' dışlanır)", () => {
    expect(notChannelAutomationWhere()).toEqual({ OR: [{ channelSenderRole: null }, { channelSenderRole: { not: "automation" } }] });
    expect(isChannelAutomation({ channelSenderRole: "automation" })).toBe(true);
    expect(isChannelAutomation({ channelSenderRole: "unknown" })).toBe(false);
    expect(isChannelAutomation({ channelSenderRole: null })).toBe(false);
  });
});

const at = (min: number) => new Date(Date.UTC(2026, 9, 10, 10, min));
const msg = (id: string, over: Partial<HistoryMessage>): HistoryMessage => ({
  id,
  conversationId: "c1",
  propertyId: "p1",
  direction: "outbound",
  authorType: "host",
  senderName: "Ev sahibi",
  body: "x",
  createdAt: at(0),
  ...over,
});

describe("geçmişten öğren: kanal otomasyonu ev sahibi kanıtı değil", () => {
  it("🚨 isHostAuthored: rol automation → hayır; unknown / host / NULL → bugünkü sonuç (evet)", () => {
    expect(isHostAuthored(msg("a", { channelSenderRole: "automation" }))).toBe(false);
    expect(isHostAuthored(msg("b", { channelSenderRole: "unknown" }))).toBe(true);
    expect(isHostAuthored(msg("c", { channelSenderRole: "host" }))).toBe(true);
    expect(isHostAuthored(msg("d", { channelSenderRole: null }))).toBe(true);
  });

  it("🚨 misafir sorusu → kanalın zamanlanmış 'Giriş bilgileri' şablonu → ev sahibinin gerçek cevabı: çiftin cevabı EV SAHİBİNİN (şablon bloğu tüketmez)", () => {
    const pairs = buildLearnPairs([
      msg("q", { direction: "inbound", authorType: "guest", body: "Otopark var mı?", createdAt: at(0) }),
      msg("t", { body: "Giriş bilgileri: kapı kodu yarın gönderilecek.", channelSenderRole: "automation", createdAt: at(1) }),
      msg("h", { body: "Binanın arkasında ücretsiz otopark var.", channelSenderRole: "host", createdAt: at(5) }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ question: "Otopark var mı?", answer: "Binanın arkasında ücretsiz otopark var.", answerIds: ["h"] });
  });

  it("yalnız kanal şablonu varsa çift YOK (şablon cevap değil; yapay zekâ da sayılmaz)", () => {
    const pairs = buildLearnPairs([
      msg("q", { direction: "inbound", authorType: "guest", body: "Otopark var mı?", createdAt: at(0) }),
      msg("t", { body: "Otopark binanın arkasında.", channelSenderRole: "automation", createdAt: at(1) }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("aşırı uygulama yok: rolü 'unknown' olan ev sahibi mesajı bugünkü gibi cevap olur", () => {
    const pairs = buildLearnPairs([
      msg("q", { direction: "inbound", authorType: "guest", body: "Otopark var mı?", createdAt: at(0) }),
      msg("h", { body: "Binanın arkasında ücretsiz.", channelSenderRole: "unknown", createdAt: at(2) }),
    ]);
    expect(pairs.map((p) => p.answer)).toEqual(["Binanın arkasında ücretsiz."]);
  });
});
