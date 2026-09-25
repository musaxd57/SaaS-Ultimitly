// `hasOpenHostWork` (kapanışta gizleme kapısı, inceleme 09-25) — karar mantığının SAF pinleri. Veritabanı sahte: satır
// seçimi (en güçlü karar), erteleme okuması, doğrulanmış onay muafiyeti, pencere (son EV SAHİBİ mesajından sonra) ve
// okuma hatasında AÇIK sayma. Mutasyon turu (09-25) ölçtü: entegrasyon testleri yalnız `human_review` ve kiracı kapsamını
// sınıyordu; bu beş bacak hayatta kalıyordu. Sorgu şekli (kiracı + yüzey) entegrasyonda pinli (`closing-silence.test.ts`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { riskEvent: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

import { hasOpenHostWork } from "@/lib/conversation-attention";

const ORG = "org_1";
const guest = (id: string) => ({ id, direction: "inbound", senderName: "Misafir", body: "Teşekkürler" });
const ai = (id: string) => ({ id, direction: "outbound", senderName: "GuestOps AI", authorType: "ai", body: "Cevap." });
const host = (id: string) => ({ id, direction: "outbound", senderName: "Ev sahibi", authorType: "host", body: "Cevap." });
const row = (triggerId: string, finalDecision: string, extra: { reason?: string; d?: string; raw?: string } = {}) => ({
  triggerId,
  finalDecision,
  reason: extra.reason ?? "ok",
  kbEvidenceJson: extra.raw ?? (extra.d ? JSON.stringify({ sc: { d: extra.d } }) : null),
});
const queriedIds = () => (findMany.mock.calls[0][0] as { where: { triggerId: { in: string[] } } }).where.triggerId.in;

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

describe("hasOpenHostWork — pencere", () => {
  it("yalnız son EV SAHİBİ mesajından sonraki misafir mesajları sorulur (ev sahibi cevabı eski işi kapatır)", async () => {
    await hasOpenHostWork(ORG, [guest("g1"), host("h1"), guest("g2")]);
    expect(queriedIds()).toEqual(["g2"]);
  });

  it("yapay zekânın cevabı pencereyi KAPATMAZ (bırakılmış iş ev sahibinindir)", async () => {
    await hasOpenHostWork(ORG, [guest("g1"), ai("a1"), guest("g2")]);
    expect(queriedIds()).toEqual(["g1", "g2"]);
  });

  it("ev sahibinden sonra misafir mesajı yoksa sorgu atılmaz, açık iş yok", async () => {
    expect(await hasOpenHostWork(ORG, [guest("g1"), host("h1")])).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("pencere tavanı 200 misafir mesajı: uzun ev sahibisiz dizide eski tutulan soru da sorulur (en yeni 200)", async () => {
    // Mutasyon turu (ikinci inceleme 09-25): tavan 50'ye indirilince hiçbir test düşmüyordu.
    await hasOpenHostWork(ORG, Array.from({ length: 120 }, (_, i) => guest(`g${i + 1}`)));
    expect(queriedIds()).toHaveLength(120);
    expect(queriedIds()[0]).toBe("g1");
    findMany.mockClear();
    await hasOpenHostWork(ORG, Array.from({ length: 250 }, (_, i) => guest(`g${i + 1}`)));
    expect(queriedIds()).toHaveLength(200);
    expect(queriedIds()[0]).toBe("g51");
  });
});

describe("hasOpenHostWork — karar okuması", () => {
  it("tutulan (human_review) mesaj açık iştir", async () => {
    findMany.mockResolvedValue([row("g1", "human_review")]);
    expect(await hasOpenHostWork(ORG, [ai("a0"), guest("g1")])).toBe(true);
  });

  it("gönderilmiş ama kararı ev sahibine BIRAKAN cevap (beyan …/defers) açık iştir; cevaplayan cevap değildir", async () => {
    findMany.mockResolvedValue([row("g1", "auto_sent", { d: "early_checkin/defers" })]);
    expect(await hasOpenHostWork(ORG, [ai("a0"), guest("g1")])).toBe(true);
    findMany.mockResolvedValue([row("g1", "auto_sent", { d: "none/none" })]);
    expect(await hasOpenHostWork(ORG, [ai("a0"), guest("g1")])).toBe(false);
  });

  it("doğrulanmış erken giriş onayı / politika metni erteleme DEĞİLDİR (kanıttaki model beyanı 'defers' olsa da)", async () => {
    for (const reason of ["early_checkin_verified", "early_checkin_policy"]) {
      findMany.mockResolvedValue([row("g1", "auto_sent", { reason, d: "early_checkin/defers" })]);
      expect(await hasOpenHostWork(ORG, [ai("a0"), guest("g1")])).toBe(false);
    }
  });

  it("aynı mesajın EN GÜÇLÜ kararı okunur: önce tutulup sonra gönderilen (yeniden değerlendirme) açık iş değildir — sıra fark etmez", async () => {
    findMany.mockResolvedValue([row("g1", "human_review"), row("g1", "auto_sent", { d: "none/none" })]);
    expect(await hasOpenHostWork(ORG, [ai("a0"), guest("g1")])).toBe(false);
    findMany.mockResolvedValue([row("g1", "auto_sent", { d: "none/none" }), row("g1", "human_review")]);
    expect(await hasOpenHostWork(ORG, [ai("a0"), guest("g1")])).toBe(false);
    // KONTROL: yalnız kapanış kaydı (no_reply) + tutulma → tutulma kazanır.
    findMany.mockResolvedValue([row("g1", "no_reply"), row("g1", "human_review")]);
    expect(await hasOpenHostWork(ORG, [ai("a0"), guest("g1")])).toBe(true);
  });

  it("bozuk kanıt JSON'u erteleme sayılmaz (yalnız gönderilmiş kayıtta)", async () => {
    findMany.mockResolvedValue([row("g1", "auto_sent", { raw: "{bozuk" })]);
    expect(await hasOpenHostWork(ORG, [ai("a0"), guest("g1")])).toBe(false);
  });

  it("🚨 okuma hatası → AÇIK sayılır (gizleme yok = güvenli yön)", async () => {
    findMany.mockRejectedValue(new Error("db down"));
    expect(await hasOpenHostWork(ORG, [ai("a0"), guest("g1")])).toBe(true);
  });
});
