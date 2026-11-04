import { describe, it, expect } from "vitest";
import { lateGuestMessages } from "@/lib/message-author";

// ---------------------------------------------------------------------------
// GEÇ İÇERİ ALINAN MİSAFİR MESAJI (kurucu 11-04 S1 "önerini beğendim"; derin ajan turu F2). Bizim cevabımız yazılırken misafirin
// platformda yazdığı mesaj sonraki senkronda sağlayıcı sırasında cevabımızdan ÖNCE düşüyordu → konuşma "Cevaplandı", acil ağı onu hiç
// görmüyordu. Ölçüt: cevabı BİZ yazdıysak (içe alma yolundan gelmedi, `ingestedAt` boş) ve misafir mesajı cevap yazıldıktan SONRA içeri
// alındıysa, o cevap onu görmeden yazılmıştır. Sağlayıcıda yazılmış giden (ev sahibi Airbnb uygulamasından) içeri alınmıştır: yazan
// konuşmayı sağlayıcıda gördü → geç sayılmaz.
// ---------------------------------------------------------------------------

const T = (min: number) => new Date(Date.UTC(2026, 10, 4, 10, min));
type Row = { id: string; direction: "inbound" | "outbound"; authorType: string | null; createdAt: Date; ingestedAt: Date | null };
const guest = (id: string, created: number, ingested: number | null): Row => ({
  id, direction: "inbound", authorType: "guest", createdAt: T(created), ingestedAt: ingested === null ? null : T(ingested),
});
const ours = (id: string, created: number, authorType = "ai"): Row => ({ id, direction: "outbound", authorType, createdAt: T(created), ingestedAt: null });
const providerReply = (id: string, created: number, ingested: number): Row => ({
  id, direction: "outbound", authorType: "host", createdAt: T(created), ingestedAt: T(ingested),
});
const newestFirst = (...rows: Row[]) => [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
const ids = (rows: Row[]) => rows.map((r) => r.id);

describe("lateGuestMessages", () => {
  it("🚨 cevabımız yazılırken platformda yazılan misafir mesajı (sağlayıcı sırasında cevaptan önce, cevaptan SONRA içeri alındı) geçtir", () => {
    // 10:00 M1 (10:02'de alındı) · 10:03 M2 platformda · 10:04 AI cevabı BİZDEN · 10:06 senkron M2'yi alır.
    expect(ids(lateGuestMessages(newestFirst(guest("m1", 0, 2), guest("m2", 3, 6), ours("ai", 4))))).toEqual(["m2"]);
  });

  it("KONTROL: cevaptan ÖNCE içeri alınmış misafir mesajı geç DEĞİL (cevap onu gördü)", () => {
    expect(lateGuestMessages(newestFirst(guest("m1", 0, 2), guest("m2", 3, 3), ours("ai", 4)))).toEqual([]);
  });

  it("KONTROL: cevap SAĞLAYICIDA yazıldıysa (ev sahibi Airbnb uygulamasından; içeri alınmış) geç mesaj yok — yazan konuşmayı gördü", () => {
    expect(lateGuestMessages(newestFirst(guest("m1", 0, 2), guest("m2", 3, 6), providerReply("h", 4, 6)))).toEqual([]);
  });

  it("KONTROL: otomatik şablon (karşılama) cevap sayılmaz — sınır onun arkasındaki gerçek cevaptır", () => {
    // Karşılama m2 içeri alındıktan SONRA (7) gitti: cevap sayılsaydı m2 "gördü" sayılıp geç mesaj kaybolurdu (mutasyon M3).
    const rows = newestFirst(guest("m1", 0, 2), ours("ai", 4), guest("m2", 3, 6), ours("welcome", 7, "automation"));
    expect(ids(lateGuestMessages(rows))).toEqual(["m2"]);
  });

  it("son mesaj misafirinse (cevap yok) ya da hiç cevap yoksa geç mesaj kavramı yok", () => {
    expect(lateGuestMessages(newestFirst(guest("m1", 0, 2)))).toEqual([]);
    expect(lateGuestMessages([])).toEqual([]);
  });

  it("içeri alınma anı bilinmeyen (eski / QR) misafir satırı geç sayılmaz", () => {
    expect(lateGuestMessages(newestFirst(guest("m1", 0, null), ours("ai", 4)))).toEqual([]);
  });

  it("yalnız EN YENİ cevaba bakılır: ondan sonra gelen misafir mesajı zaten cevapsız penceredir (bu fonksiyonun işi değil)", () => {
    const rows = newestFirst(guest("m1", 0, 2), guest("m2", 3, 6), ours("ai", 4), guest("m3", 7, 7));
    expect(ids(lateGuestMessages(rows))).toEqual(["m2"]);
  });
});
