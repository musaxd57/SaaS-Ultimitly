import { describe, it, expect } from "vitest";
import {
  mergeSentPage,
  compareSentRows,
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
const keyOf = (r: Row) => r.id;
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
      keyOf,
    );
    // 3. sayfa = 101–150. arası oto-yanıtlar; eski davranışta bunlar erişilemezdi.
    expect(ids(got)).toEqual(ids(replies.slice(100, 150)));
  });

  it("kaynakları zamana göre örer — eski bir satır asla yeninin ÜSTÜNDE çıkmaz", () => {
    const a = series("a", 4, 0); // a1(en yeni) … a4, dakika başlarında
    const b = series("b", 4, 0.5); // b1 … b4, tam a'ların ARASINA düşüyor
    const got = mergeSentPage([a, b], 1, 8, whenOf, keyOf);
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
    // Referans, kodun kullandığı TAM sıra olmalı (when DESC, id DESC) — zaman-yalnız
    // bir referans, eşitlikte sort kararlılığına bel bağlar ve testi kırılgan yapar.
    const truth = [...a, ...b].sort((x, y) =>
      compareSentRows({ when: x.when, id: x.id, rank: 0 }, { when: y.when, id: y.id, rank: 0 }),
    );
    for (let page = 1; page <= 4; page++) {
      const got = mergeSentPage(
        [a.slice(0, page * size), b.slice(0, page * size)],
        page,
        size,
        whenOf,
        keyOf,
      );
      expect(ids(got)).toEqual(ids(truth.slice((page - 1) * size, page * size)));
    }
  });

  it("son sayfa kısa olabilir, taşan sayfa boş döner (çökmez)", () => {
    const a = series("a", 12, 0);
    expect(ids(mergeSentPage([a], 2, 10, whenOf, keyOf))).toEqual(ids(a.slice(10, 12)));
    expect(mergeSentPage([a], 5, 10, whenOf, keyOf)).toEqual([]);
    expect(mergeSentPage([[]], 1, 10, whenOf, keyOf)).toEqual([]);
  });

  it("EŞİT damgalı farklı türler sayfalar arasında ne TEKRARLANIR ne KAYBOLUR", () => {
    // Codex: zaman tek başına sıra vermez. Toplu import (createMany) ya da aynı
    // saniyede atılan iki damga aynı `when`i taşır; böyle bir kümede sıra
    // "herhangi biri" olursa satır 1. sayfada da 2. sayfada da çıkabilir ya da
    // hiçbirinde çıkmaz. Tam sıra (when DESC, id DESC) bunu imkânsız kılar.
    const same = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    const replies = Array.from({ length: 30 }, (_, i) => ({ id: `msg-${String(i).padStart(3, "0")}`, when: same }));
    const welcomes = Array.from({ length: 30 }, (_, i) => ({ id: `res-${String(i).padStart(3, "0")}`, when: same }));
    const size = 10;
    const seen: string[] = [];
    for (let page = 1; page <= 6; page++) {
      // Ekranın davranışı: her kaynaktan sayfa*boyut satır — DB de aynı tam sırayı
      // (ORDER BY <kolon> DESC, "id" DESC) uyguladığı için dilimler bu sırada gelir.
      const src = (rows: Row[]) => [...rows].sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, page * size);
      seen.push(...ids(mergeSentPage([src(replies), src(welcomes)], page, size, whenOf, keyOf)));
    }
    expect(seen).toHaveLength(60); // 6 sayfa × 10 — hiç eksik yok
    expect(new Set(seen).size).toBe(60); // hiç tekrar yok
    expect(new Set(seen)).toEqual(new Set([...replies, ...welcomes].map((r) => r.id)));
    // Sıra da deterministik: id DESC → "res-*" (r>m) önce, sonra "msg-*".
    expect(seen[0]).toBe("res-029");
    expect(seen[59]).toBe("msg-000");
  });

  it("global sıra, her kaynağın KENDİ sırasıyla örtüşür (over-fetch kanıtının ön koşulu)", () => {
    // Kanıt "bir satır kendi kaynağının en yenilerinden düşmüşse global pencereye
    // giremez" der. Bu ancak global karşılaştırıcı, kaynak-içi sırayla AYNI ise
    // geçerlidir. Önekli görüntü id'siyle (welcome-… / r-…) sıralamak bunu bozardı.
    const same = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    const source: Row[] = [
      { id: "b", when: same },
      { id: "c", when: same },
      { id: "a", when: same },
    ];
    const sqlOrder = [...source].sort((x, y) => (x.id < y.id ? 1 : -1)).map((r) => r.id); // id DESC
    const merged = ids(mergeSentPage([[...source]], 1, 10, whenOf, keyOf));
    expect(merged).toEqual(sqlOrder);
  });

  it("aynı when VE aynı ham id — kaynak sırası son anahtar olarak sırayı TAM yapar", () => {
    // Ham id'ler AYRI TABLOLARDAN geliyor; veritabanı iki farklı tablodaki satırın
    // aynı id'yi taşımasını yasaklamıyor (pratikte cuid ile ihtimali yok denecek
    // kadar düşük, ama tanımsız sıra bırakmak istemiyoruz). Kaynak sırası EN SON
    // anahtar: kaynak içinde sabit olduğu için SQL sırasına dokunmaz.
    const same = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    const collide = "identical-id";
    const first: Row[] = [{ id: collide, when: same }];
    const second: Row[] = [{ id: collide, when: same }];
    // Deterministik: önce gelen KAYNAK önce çıkar, ve iki koşuda da aynı sonuç.
    const run = () => mergeSentPage([first, second], 1, 10, whenOf, keyOf);
    expect(run()).toEqual([first[0], second[0]]);
    expect(run()).toEqual([first[0], second[0]]);
    // Ters kaynak sırası → ters sonuç (yani rank GERÇEKTEN belirleyici).
    expect(mergeSentPage([second, first], 1, 10, whenOf, keyOf)).toEqual([second[0], first[0]]);
    // Karşılaştırıcı doğrudan: rank yalnız when ve id eşitken devreye girer.
    const k = (rank: number) => ({ when: same, id: collide, rank });
    expect(compareSentRows(k(0), k(1))).toBeLessThan(0);
    expect(compareSentRows(k(1), k(0))).toBeGreaterThan(0);
    expect(compareSentRows(k(0), k(0))).toBe(0);
    // Farklı id'de rank hiç konuşmaz (kaynak-içi SQL sırası korunur).
    expect(
      compareSentRows({ when: same, id: "b", rank: 9 }, { when: same, id: "a", rank: 0 }),
    ).toBeLessThan(0); // id DESC → "b" önce, rank'e rağmen
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
