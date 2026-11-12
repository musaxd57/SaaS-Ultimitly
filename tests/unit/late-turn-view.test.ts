import { describe, it, expect, afterEach, vi } from "vitest";
import { LATE_MESSAGE_MAX_AGE_MS, lateMessageReplyEnabled, lateTurnView } from "@/lib/late-turn";

// ---------------------------------------------------------------------------
// S2 (kurucu kararı 11-11; anahtar `AI_LATE_MESSAGE_REPLY_ENABLED` KAPALI): geç içeri alınan misafir mesajı, otomatik cevap akışının OKUDUĞU
// dizide kaçırdığı yapay zekâ cevabının ARDINA gelir → konumsal tur sınırı onu cevapsız tur sayar. Şartlar sağlanmıyorsa dizi AYNEN.
// Saf fonksiyon; bağlantısı `tests/integration/late-message-auto-reply.test.ts`.
// ---------------------------------------------------------------------------

const T = (min: number) => new Date(Date.UTC(2026, 10, 12, 10, min));
const NOW = T(10);
type Row = { id: string; direction: "inbound" | "outbound"; authorType: string | null; body: string; createdAt: Date; ingestedAt: Date | null };
const guest = (id: string, created: number, ingested: number | null, body = "Otopark var mı?"): Row => ({
  id, direction: "inbound", authorType: "guest", body, createdAt: T(created), ingestedAt: ingested === null ? null : T(ingested),
});
const ours = (id: string, created: number, authorType: string | null = "ai", body = "Wi-Fi şifresi Lale2024."): Row => ({
  id, direction: "outbound", authorType, body, createdAt: T(created), ingestedAt: null,
});
const providerReply = (id: string, created: number, ingested: number): Row => ({
  id, direction: "outbound", authorType: "host", body: "Wi-Fi şifresi Lale2024.", createdAt: T(created), ingestedAt: T(ingested),
});
/** Akışın verdiği sıra: yazılma anı ARTAN. */
const thread = (...rows: Row[]) => [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
const ids = (rows: readonly Row[]) => rows.map((r) => r.id);

describe("anahtar", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("yalnız tam '1' açar; boş / 'true' / '0' kapalı", () => {
    for (const [value, on] of [["", false], ["0", false], ["true", false], ["1 ", false], ["1", true]] as const) {
      vi.stubEnv("AI_LATE_MESSAGE_REPLY_ENABLED", value);
      expect([value, lateMessageReplyEnabled()]).toEqual([value, on]);
    }
  });
});

describe("lateTurnView — geç mesaj kaçırdığı yapay zekâ cevabının ardına", () => {
  it("🚨 cevabımızdan ÖNCE yazılıp SONRA içeri alınan misafir mesajı cevabın ardına gelir (son mesaj artık o)", () => {
    // 10:00 M1 (10:01'de alındı) · 10:02 M2 platformda yazıldı · 10:03 yapay zekâ cevabı · 10:05 senkron M2'yi aldı.
    const rows = thread(guest("m1", 0, 1), guest("m2", 2, 5), ours("ai", 3));
    expect(ids(rows)).toEqual(["m1", "m2", "ai"]); // bugünkü sıra: son mesaj giden → already_answered
    const out = lateTurnView(rows, NOW);
    expect(ids(out.messages)).toEqual(["m1", "ai", "m2"]);
    expect(ids(out.late)).toEqual(["m2"]);
    // Satırın kendisi aynı nesne: yazılma anı değişmez (tarih okuması mesajın yazıldığı ana göre kalır).
    expect(out.messages[2]).toBe(rows[1]);
    expect(out.messages[2].createdAt).toEqual(T(2));
  });

  it("birden çok geç mesaj yazılma sırasını korur ve cevaptan SONRA yazılmış mesajların ÖNÜNE gelir", () => {
    const rows = thread(guest("m1", 0, 1), guest("late1", 2, 6), guest("late2", 2.5, 6), ours("ai", 3), guest("after", 7, 8));
    const out = lateTurnView(rows, NOW);
    expect(ids(out.messages)).toEqual(["m1", "ai", "late1", "late2", "after"]);
    expect(ids(out.late)).toEqual(["late1", "late2"]);
  });

  it("KONTROL: geç mesaj yoksa AYNI dizi nesnesi döner (akış bayt bayt bugünkü)", () => {
    const rows = thread(guest("m1", 0, 1), ours("ai", 3), guest("m2", 4, 5));
    const out = lateTurnView(rows, NOW);
    expect(out.messages).toBe(rows);
    expect(out.late).toEqual([]);
    // Cevaptan önce içeri alınmış mesaj geç değildir (cevap onu gördü); aynı milisaniye de geç değildir.
    const seen = thread(guest("m1", 0, 1), guest("m2", 2, 3), ours("ai", 3));
    expect(lateTurnView(seen, NOW).messages).toBe(seen);
    // Hiç cevap yok / boş dizi.
    const noReply = thread(guest("m1", 0, 1));
    expect(lateTurnView(noReply, NOW).messages).toBe(noReply);
    expect(lateTurnView([] as Row[], NOW).late).toEqual([]);
  });

  it("🚨 şart 1 — kaçırılan cevap yapay zekânın değilse (ev sahibi panelden / platformdan, yazarı bilinmeyen) dizi AYNEN", () => {
    const late = guest("m2", 2, 5);
    for (const reply of [ours("host", 3, "host"), ours("legacy", 3, null), ours("system", 3, "system"), providerReply("app", 3, 4)]) {
      const rows = thread(guest("m1", 0, 1), late, reply);
      expect([reply.id, lateTurnView(rows, NOW).messages === rows]).toEqual([reply.id, true]);
    }
    // KONTROL: aynı dizilim yapay zekâ cevabıyla taşınır.
    expect(ids(lateTurnView(thread(guest("m1", 0, 1), late, ours("ai", 3)), NOW).messages)).toEqual(["m1", "ai", "m2"]);
  });

  it("🚨 şart 1 — yapay zekâ cevabından SONRA ev sahibi yazdıysa (en yeni cevap onun) dizi AYNEN", () => {
    const rows = thread(guest("m1", 0, 1), guest("m2", 2, 6), ours("ai", 3), ours("host", 5, "host"));
    expect(lateTurnView(rows, NOW).messages).toBe(rows);
  });

  it("🚨 şart 2 — geç mesaj ile yapay zekâ cevabı arasında ev sahibi (ya da yazarı bilinmeyen) cevap varsa dizi AYNEN", () => {
    for (const between of [ours("host", 2.5, "host"), ours("legacy", 2.5, null)]) {
      const rows = thread(guest("m1", 0, 1), guest("m2", 2, 6), between, ours("ai", 3));
      expect([between.id, lateTurnView(rows, NOW).messages === rows]).toEqual([between.id, true]);
    }
    // KONTROL: aradaki mesaj otomatik şablonsa (karşılama / giriş — cevap değildir) ya da önceki yapay zekâ cevabıysa taşınır.
    const template = thread(guest("m1", 0, 1), guest("m2", 2, 6), ours("auto", 2.5, "automation"), ours("ai", 3));
    expect(ids(lateTurnView(template, NOW).messages)).toEqual(["m1", "auto", "ai", "m2"]);
    const earlierAi = thread(guest("m1", 0, 1), guest("m2", 2, 6), ours("ai0", 2.5), ours("ai", 3));
    expect(ids(lateTurnView(earlierAi, NOW).messages)).toEqual(["m1", "ai0", "ai", "m2"]);
  });

  it("🚨 şart 3 — 24 saatten önce yazılmış geç mesaj taşınmaz; sınırın kendisi taşınır; biri bile aşıyorsa hiçbiri taşınmaz", () => {
    const rows = thread(guest("m1", 0, 1), guest("m2", 2, 5), ours("ai", 3));
    const written = T(2).getTime();
    expect(ids(lateTurnView(rows, new Date(written + LATE_MESSAGE_MAX_AGE_MS)).messages)).toEqual(["m1", "ai", "m2"]);
    const tooLate = new Date(written + LATE_MESSAGE_MAX_AGE_MS + 1);
    expect(lateTurnView(rows, tooLate).messages).toBe(rows);
    expect(LATE_MESSAGE_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    // İki geç mesajdan eskisi sınırı aşıyor → tur buraya girmez (yenisi tek başına taşınmaz).
    const two = thread(guest("old", 1, 6), guest("fresh", 2, 6), ours("ai", 3));
    expect(lateTurnView(two, new Date(T(1).getTime() + LATE_MESSAGE_MAX_AGE_MS + 1)).messages).toBe(two);
    expect(ids(lateTurnView(two, new Date(T(1).getTime() + LATE_MESSAGE_MAX_AGE_MS)).messages)).toEqual(["ai", "old", "fresh"]);
  });

  it("🚨 şart 1 — ev sahibinin TESLİM EDİLEMEMİŞ denemesi (görünümden süzülmüş, ham dizide) geç mesajdan sonraysa dizi AYNEN", () => {
    // Görünüm: m1, m2 (geç), ai. Ham dizide 10:04'te ev sahibinin kuyrukta başarısız olmuş cevabı da var → turu o almak istedi.
    const view = thread(guest("m1", 0, 1), guest("m2", 2, 6), ours("ai", 3));
    const failedHost = ours("host-failed", 4, "host");
    expect(lateTurnView(view, NOW, thread(...view, failedHost)).messages).toBe(view);
    // Yazarı bilinmeyen teslim edilememiş giden de "bizim değil" sayılır (şüphede taşınmaz).
    expect(lateTurnView(view, NOW, thread(...view, ours("legacy-failed", 4, null))).messages).toBe(view);
    // KONTROL: teslim edilememiş YAPAY ZEKÂ taslağı engel değil; geç mesajdan ÖNCEKİ ev sahibi denemesi de (o tur kapandı).
    expect(ids(lateTurnView(view, NOW, thread(...view, ours("ai-failed", 4))).messages)).toEqual(["m1", "ai", "m2"]);
    expect(ids(lateTurnView(view, NOW, thread(...view, ours("host-early", 1.5, "host"))).messages)).toEqual(["m1", "ai", "m2"]);
    // Geç mesajla AYNI anda yazılmış ev sahibi denemesi de sayılır (eşitlikte şüphe → taşınmaz).
    expect(lateTurnView(view, NOW, thread(...view, ours("host-same", 2, "host"))).messages).toBe(view);
    // Otomatik şablon (karşılama / giriş) cevap değildir → ham dizide de engel değil.
    expect(ids(lateTurnView(view, NOW, thread(...view, ours("auto", 4, "automation"))).messages)).toEqual(["m1", "ai", "m2"]);
  });

  it("🚨 şart 3 — geç mesajdan SONRA yazılıp cevabımızın gördüğü misafir mesajı varsa dizi AYNEN (kuyruk vetosu geç mesajı 'geçilmiş' sayardı)", () => {
    // 10:02:00 "Bir de havuz var mı?" (sağlayıcı geciktirdi, 10:06'da alındı) · 10:02:30 "Wi-Fi şifresi?" (hemen alındı) · 10:03 cevabımız.
    const rows = thread(guest("late", 2, 6), guest("seen", 2.5, 2.6), ours("ai", 3));
    expect(lateTurnView(rows, NOW).messages).toBe(rows);
    // Gövdesiz misafir satırı (yalnız fotoğraf) da sayılır — veto gövdeye bakmaz.
    const photo = thread(guest("late", 2, 6), guest("photo", 2.5, 2.6, ""), ours("ai", 3));
    expect(lateTurnView(photo, NOW).messages).toBe(photo);
    // İki geç mesajın arasına düşen görülmüş mesaj da aynı hüküm.
    const between = thread(guest("late1", 2, 6), guest("seen", 2.3, 2.4), guest("late2", 2.6, 6), ours("ai", 3));
    expect(lateTurnView(between, NOW).messages).toBe(between);
    // KONTROL: görülmüş mesaj geç mesajdan ESKİYSE taşınır (geç mesaj cevaptan önceki en yeni misafir mesajı).
    const older = thread(guest("seen", 1.5, 1.6), guest("late", 2, 6), ours("ai", 3));
    expect(ids(lateTurnView(older, NOW).messages)).toEqual(["seen", "ai", "late"]);
    // KONTROL: aradaki satır önceki yapay zekâ cevabıysa (misafir mesajı değil) taşınır.
    const aiBetween = thread(guest("late", 2, 6), ours("ai0", 2.5), ours("ai", 3));
    expect(ids(lateTurnView(aiBetween, NOW).messages)).toEqual(["ai0", "ai", "late"]);
  });

  it("🚨 şart 4 — cevabımız soru ya da teklifle bitiyorsa dizi AYNEN (geç 'Evet lütfen' o teklifin kabulü gibi okunmasın)", () => {
    const late = guest("m2", 2, 6, "Evet lütfen");
    for (const body of [
      "Havlu dolapta; isterseniz ekstra havlu da bırakabilirim.",
      "Kaç kişi olacaksınız?",
      "The towels are in the closet. Would you like me to send the directions as well?",
    ]) {
      const rows = thread(guest("m1", 0, 1, "Havlu var mı?"), late, ours("ai", 3, "ai", body));
      expect([body, lateTurnView(rows, NOW).messages === rows]).toEqual([body, true]);
    }
    // Cevaptan sonra yazılmış yeni mesaj olsa da aynı hüküm (geç mesaj yine teklifin hemen ardına düşerdi).
    const withAfter = thread(guest("m1", 0, 1), late, ours("ai", 3, "ai", "İsterseniz ekstra havlu da bırakabilirim."), guest("after", 7, 8));
    expect(lateTurnView(withAfter, NOW).messages).toBe(withAfter);
    // KONTROL: düz bilgi cevabı taşınır; teklif ÖNCEKİ cevaptaysa da taşınır (o teklifin kabulü olarak okunması doğru okumadır).
    const plain = thread(guest("m1", 0, 1), late, ours("ai", 3, "ai", "Havlular banyodaki dolapta."));
    expect(ids(lateTurnView(plain, NOW).messages)).toEqual(["m1", "ai", "m2"]);
    const earlierOffer = thread(ours("ai0", 0.5, "ai", "Kapı kodunu şimdi gönderebilirim, ister misiniz?"), guest("m1", 1, 1.2), late, ours("ai", 3, "ai", "Havlular banyodaki dolapta."));
    expect(ids(lateTurnView(earlierOffer, NOW).messages)).toEqual(["ai0", "m1", "ai", "m2"]);
  });

  it("içeri alınma anı bilinmeyen misafir satırı geç sayılmaz; sağlayıcıda yazılmış eski cevabın gördüğü mesajlar da", () => {
    const unknown = thread(guest("m1", 0, 1), guest("m2", 2, null), ours("ai", 3));
    expect(lateTurnView(unknown, NOW).messages).toBe(unknown);
    // 10:01 ev sahibi platformdan yazdı (10:02'de alındı) → ondan ESKİ misafir mesajını gördü; sonraki geç mesaj yine taşınır.
    const rows = thread(guest("m0", 0, 6), providerReply("app", 1, 2), guest("m2", 2, 6), ours("ai", 3));
    expect(ids(lateTurnView(rows, NOW).messages)).toEqual(["m0", "app", "ai", "m2"]);
  });
});
