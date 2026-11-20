// QR tek cevap kipinin saf çekirdeği (F4-b): kayıt anı hükmü, tur ayrımı, uzun cevabı iki mesaja bölme.
import { describe, it, expect } from "vitest";
import {
  QR_REPLY_PART_MIN,
  QR_REPLY_SPLIT_OVER,
  QR_TURN_FRESH_MS,
  QR_TURN_MAX_CHARS,
  QR_TURN_MAX_MESSAGES,
  mergeQrTurnText,
  partitionQrTurn,
  qrTurnCommitVerdict,
  qrTurnKeyOf,
  qrTurnTooLarge,
  splitQrReply,
} from "@/lib/guest-chat-turn-core";

describe("qrTurnCommitVerdict — kayıt anı hükmü", () => {
  const base = { ownId: "b", seenIds: ["a", "b"], hasReply: true, escalated: false };

  it("tur değişmediyse cevap yazılır, görülen bütün satırların kararı verilir", () => {
    expect(qrTurnCommitVerdict({ ...base, openIds: ["a", "b"] })).toEqual({ action: "commit", rowIds: ["a", "b"], writeReply: true, heldInstead: false });
  });

  it("🚨 daha yeni açık mesaj varsa cevap ve sessiz kapanış BIRAKILIR (bayat)", () => {
    expect(qrTurnCommitVerdict({ ...base, openIds: ["a", "b", "c"] })).toEqual({ action: "drop" });
    expect(qrTurnCommitVerdict({ ...base, hasReply: false, openIds: ["a", "b", "c"] })).toEqual({ action: "drop" });
  });

  it("🚨 devir kararı daha yeni mesaj varken de yazılır — yalnız görülen satırlar için, metinsiz", () => {
    expect(qrTurnCommitVerdict({ ...base, escalated: true, openIds: ["a", "b", "c"] })).toEqual({
      action: "commit",
      rowIds: ["a", "b"],
      writeReply: false,
      heldInstead: false,
    });
    // Daha yeni mesaj yoksa devirle birlikte gidecek kod metni (acil numara) yazılır.
    expect(qrTurnCommitVerdict({ ...base, escalated: true, openIds: ["a", "b"] })).toMatchObject({ action: "commit", writeReply: true });
  });

  it("kendi satırının kararı başka istekte verildiyse hiçbir şey yazılmaz (devir dahil)", () => {
    expect(qrTurnCommitVerdict({ ...base, openIds: ["a"] })).toEqual({ action: "drop" });
    expect(qrTurnCommitVerdict({ ...base, escalated: true, openIds: [] })).toEqual({ action: "drop" });
  });

  it("görülen eski satır bu arada ev sahibine bırakıldıysa cevap gitmez, kalan satır ev sahibine kalır (kısmi gönderim yok)", () => {
    expect(qrTurnCommitVerdict({ ...base, openIds: ["b"] })).toEqual({ action: "commit", rowIds: ["b"], writeReply: false, heldInstead: true });
    // Devir kararında aynı durumda metin yazılmaz ama karar düşmez.
    expect(qrTurnCommitVerdict({ ...base, escalated: true, openIds: ["b"] })).toEqual({ action: "commit", rowIds: ["b"], writeReply: false, heldInstead: false });
  });

  it("cevapsız karar (sessiz kapanış) tur değişmediyse yazılır", () => {
    expect(qrTurnCommitVerdict({ ...base, hasReply: false, openIds: ["a", "b"] })).toEqual({ action: "commit", rowIds: ["a", "b"], writeReply: false, heldInstead: false });
  });
});

describe("tur ayrımı ve birleşik metin", () => {
  const at = (msAgo: number) => new Date(Date.UTC(2030, 0, 1, 12, 0, 0) - msAgo);
  const own = { id: "own", body: "son", createdAt: at(0) };

  it("taze açık satırlar turda, sahipsiz (eski) olanlar ayrı; kendi satırı hep turda", () => {
    const rows = [
      { id: "old", body: "dünkü", createdAt: at(QR_TURN_FRESH_MS + 1) },
      { id: "edge", body: "sınırda", createdAt: at(QR_TURN_FRESH_MS) },
      { id: "fresh", body: "az önce", createdAt: at(2_000) },
      own,
    ];
    const { turn, stale } = partitionQrTurn(rows, own);
    expect(stale.map((r) => r.id)).toEqual(["old"]);
    expect(turn.map((r) => r.id)).toEqual(["edge", "fresh", "own"]);
  });

  it("birleşik metin yazılış sırasıyla, satır sonuyla; boş parça atlanır", () => {
    expect(mergeQrTurnText(["Wi-Fi şifresi ne? ", "", " Otopark var mı?"])).toBe("Wi-Fi şifresi ne?\nOtopark var mı?");
    expect(mergeQrTurnText(["tek"])).toBe("tek");
  });

  it("tur büyüklük sınırı: mesaj sayısı ve birleşik uzunluk", () => {
    expect(qrTurnTooLarge(Array.from({ length: QR_TURN_MAX_MESSAGES }, () => "a"))).toBe(false);
    expect(qrTurnTooLarge(Array.from({ length: QR_TURN_MAX_MESSAGES + 1 }, () => "a"))).toBe(true);
    expect(qrTurnTooLarge(["x".repeat(QR_TURN_MAX_CHARS)])).toBe(false);
    expect(qrTurnTooLarge(["x".repeat(QR_TURN_MAX_CHARS), "y"])).toBe(true);
  });

  it("satır işaretinden istek kimliği", () => {
    expect(qrTurnKeyOf("qr-open:abc-123")).toBe("abc-123");
    expect(qrTurnKeyOf("qr:abc-123")).toBe("abc-123");
    expect(qrTurnKeyOf("hospitable-9")).toBeNull();
    expect(qrTurnKeyOf(null)).toBeNull();
    expect(qrTurnKeyOf("qr:")).toBeNull();
  });
});

describe("splitQrReply — uzun cevap en çok iki mesaj", () => {
  const sentence = (i: number) => `Bu ${i}. sorunuzun cevabı için gereken bilgi burada yazıyor ve yeterince uzun bir cümledir.`;

  it("eşiğe kadar olan cevap bölünmez (beş sorunun cevabı tek mesaj)", () => {
    const five = [1, 2, 3, 4, 5].map(sentence).join(" ");
    expect(five.length).toBeLessThanOrEqual(QR_REPLY_SPLIT_OVER);
    expect(splitQrReply(five)).toEqual([five]);
    expect(splitQrReply("x".repeat(QR_REPLY_SPLIT_OVER))).toHaveLength(1);
  });

  it("on sorunun cevabı iki dengeli mesaja bölünür; parçalar birleşince metin aynıdır", () => {
    const ten = Array.from({ length: 10 }, (_, i) => sentence(i + 1)).join(" ");
    const parts = splitQrReply(ten);
    expect(parts).toHaveLength(2);
    expect(parts.join(" ")).toBe(ten);
    for (const p of parts) expect(p.length).toBeGreaterThanOrEqual(QR_REPLY_PART_MIN);
    expect(Math.abs(parts[0]!.length - parts[1]!.length)).toBeLessThan(200);
  });

  it("boş satır cümle sonundan önce gelir: ortadaki bantta paragraf sınırı varsa oradan bölünür", () => {
    const a = Array.from({ length: 4 }, (_, i) => sentence(i + 1)).join(" ");
    const b = Array.from({ length: 5 }, (_, i) => sentence(i + 5)).join(" ");
    const parts = splitQrReply(`${a}\n\n${b}`);
    expect(parts).toEqual([a, b]);
  });

  it("numaralı liste maddesinin numarası cümle sonu sayılmaz; satır başından bölünür", () => {
    const items = Array.from({ length: 10 }, (_, i) => `${i + 1}. ${"madde metni ".repeat(7).trim()}`);
    const text = items.join("\n");
    const parts = splitQrReply(text);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatch(/^\d+\. madde/);
    expect(parts.join("\n")).toBe(text);
  });

  it("cümle ortasından bölünmez: sınırı olmayan uzun metin tek parça kalır; küçük harfle süren kısaltma sınır değildir", () => {
    const noBoundary = "kelime ".repeat(150).trim();
    expect(splitQrReply(noBoundary)).toEqual([noBoundary]);
    const abbreviation = `${"a".repeat(400)} vb. gibi ${"b".repeat(400)}`;
    expect(splitQrReply(abbreviation)).toEqual([abbreviation]);
  });

  it("küçük / büyük harf ayrımı olmayan yazıda (Arapça) cümle sonundan bölünür", () => {
    const ar = Array.from({ length: 12 }, () => "كلمة المرور لشبكة الواي فاي مكتوبة على البطاقة بجانب التلفاز في غرفة الجلوس.").join(" ");
    expect(ar.length).toBeGreaterThan(QR_REPLY_SPLIT_OVER);
    const parts = splitQrReply(ar);
    expect(parts).toHaveLength(2);
    expect(parts.join(" ")).toBe(ar);
  });

  it("kuyruk çok kısaysa bölünmez (üç satırlık ayrı baloncuk olmaz)", () => {
    const text = `${"a".repeat(650)}. ${"B".repeat(100)}`;
    expect(text.length).toBeGreaterThan(QR_REPLY_SPLIT_OVER);
    expect(splitQrReply(text)).toEqual([text]);
  });

  it("çok büyük / çok sınırlı metinde de sonuç verir (yığın taşması yok) ve parçalar metni korur", () => {
    expect(splitQrReply("x".repeat(200_000))).toHaveLength(1);
    const dense = "Aa. Bb".repeat(60_000);
    const parts = splitQrReply(dense);
    expect(parts).toHaveLength(2);
    expect(parts.join(" ")).toBe(dense);
    expect(splitQrReply(`a${"\n".repeat(200_000)}b`)).toHaveLength(1);
  });
});
