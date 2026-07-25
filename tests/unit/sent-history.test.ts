import { describe, it, expect } from "vitest";
import {
  mergeSentPage,
  clampPage,
  SENT_PAGE_SIZE,
  MAX_MERGED_PAGE,
  MAX_TYPED_PAGE,
} from "@/lib/sent-history";

// "Otomatik Gönderilenler" birbirinden bağımsız DÖRT kaynaktan beslenir (oto-yanıt
// mesajları + rezervasyonun karşılama/giriş/çıkış damgaları). Eski ekran her
// kaynaktan SABİT 100 satır çekip birleştiriyordu; bu, listeyi sessizce hem
// kesiyor hem TUTARSIZ yapıyordu: 101. oto-yanıt, ekranda GÖSTERİLEN bir
// karşılamadan yeni olsa bile kayboluyordu. Buradaki testler bu iki özelliği
// (tam kapsama + doğru sıralama) sabitler.

interface Row {
  id: string;
  when: Date;
}

/** `count` satır üretir; en yeni önce, her satır bir öncekinden 1 dk eski.
 *  `startMinutesAgo` kesirli olabilir — iki kaynağı EŞİT damgaya düşürmeden
 *  birbirinin arasına örmek için (eşitlikte sıra sort'un kararlılığına kalır,
 *  bu da testi gerçek davranıştan çok uygulama detayına bağlardı). */
function series(prefix: string, count: number, startMinutesAgo: number): Row[] {
  const base = Date.UTC(2026, 0, 1, 12, 0, 0);
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    when: new Date(base - (startMinutesAgo + i) * 60_000),
  }));
}

const whenOf = (r: Row) => r.when;
const ids = (rows: Row[]) => rows.map((r) => r.id);

describe("mergeSentPage — çok kaynaklı gönderim geçmişi sayfalama", () => {
  it("derin sayfa TAM: sabit 100'lük kesmenin asla gösteremeyeceği satırları getirir", () => {
    const replies = series("r", 150, 0); // r1 en yeni … r150
    const welcomes = series("w", 2, 5000); // çok daha eski
    const page = 3;
    // Ekranın yaptığı: her kaynaktan sayfa*boyut kadar iste, birleştir, pencereyi kes.
    const got = mergeSentPage(
      [replies.slice(0, page * SENT_PAGE_SIZE), welcomes.slice(0, page * SENT_PAGE_SIZE)],
      page,
      SENT_PAGE_SIZE,
      whenOf,
    );
    // 3. sayfa = 101–150. arası oto-yanıtlar; eski davranışta bunlar erişilemezdi.
    expect(ids(got)).toEqual(ids(replies.slice(100, 150)));
  });

  it("kaynakları zamana göre örer — eski bir satır asla yeninin ÜSTÜNDE çıkmaz", () => {
    const a = series("a", 4, 0); // a1(en yeni) … a4, dakika başlarında
    const b = series("b", 4, 0.5); // b1 … b4, tam a'ların ARASINA düşüyor
    const got = mergeSentPage([a, b], 1, 8, whenOf);
    expect(ids(got)).toEqual(["a1", "b1", "a2", "b2", "a3", "b3", "a4", "b4"]);
    for (let i = 1; i < got.length; i++) {
      expect(got[i - 1].when.getTime()).toBeGreaterThanOrEqual(got[i].when.getTime());
    }
  });

  it("pencere kaynak-başına kotanın ÖTESİNE taşmaz: birleşik görünüm tam ilk N kaydı verir", () => {
    // Her kaynaktan page*size istendiğinde, GLOBAL en yeni page*size'ın tamamı
    // bu birleşimin içindedir (bir satır kendi kaynağının en yenilerinden
    // düşmüşse, o kaynakta ondan yeni page*size satır var demektir → global
    // pencereye zaten giremezdi). Bu test o değişmezi somut veriyle sabitler.
    const a = series("a", 60, 0);
    const b = series("b", 60, 30); // yarısı a'nın arasına düşüyor
    const size = 10;
    const truth = [...a, ...b].sort((x, y) => y.when.getTime() - x.when.getTime());
    for (let page = 1; page <= 4; page++) {
      const got = mergeSentPage(
        [a.slice(0, page * size), b.slice(0, page * size)],
        page,
        size,
        whenOf,
      );
      expect(ids(got)).toEqual(ids(truth.slice((page - 1) * size, page * size)));
    }
  });

  it("son sayfa kısa olabilir, taşan sayfa boş döner (çökmez)", () => {
    const a = series("a", 12, 0);
    expect(ids(mergeSentPage([a], 2, 10, whenOf))).toEqual(ids(a.slice(10, 12)));
    expect(mergeSentPage([a], 5, 10, whenOf)).toEqual([]);
    expect(mergeSentPage([[]], 1, 10, whenOf)).toEqual([]);
  });

  it("clampPage çöp/negatif/taşkın girdiyi güvenli aralığa çeker (devasa OFFSET yok)", () => {
    expect(clampPage(undefined, MAX_MERGED_PAGE)).toBe(1);
    expect(clampPage("", MAX_MERGED_PAGE)).toBe(1);
    expect(clampPage("abc", MAX_MERGED_PAGE)).toBe(1);
    expect(clampPage("0", MAX_MERGED_PAGE)).toBe(1);
    expect(clampPage("-5", MAX_MERGED_PAGE)).toBe(1);
    expect(clampPage("3", MAX_MERGED_PAGE)).toBe(3);
    expect(clampPage("999999999", MAX_MERGED_PAGE)).toBe(MAX_MERGED_PAGE);
    expect(clampPage("999999999", MAX_TYPED_PAGE)).toBe(MAX_TYPED_PAGE);
  });

  it("sayfa boyutu ve birleşik-görünüm tavanı makul sınırlar içinde", () => {
    // Tavan bilinçli: birleşik görünüm sayfa başına 4 kaynaktan sayfa*boyut satır
    // okur, yani derinlik lineer maliyet demek. Tür seçilince tek kaynak +
    // skip/take çalıştığı için TAM geçmiş orada sınırsız gezilebilir.
    expect(SENT_PAGE_SIZE).toBeGreaterThanOrEqual(20);
    expect(SENT_PAGE_SIZE * MAX_MERGED_PAGE).toBeLessThanOrEqual(2000);
  });
});
