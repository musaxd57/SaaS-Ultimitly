import { describe, it, expect, vi, afterEach } from "vitest";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { SEMANTIC_QUALIFY_MIN } from "@/lib/ai/retrieval/semantic";

// ---------------------------------------------------------------------------
// ANLAMSAL KAYNAK HAZIRLIĞI — EMBEDDING'DEN ÖNCE KAPATILAN İKİ TUZAK
// (inceleme turu, 2026-09-11). İkisinin de BUGÜN ETKİSİ YOK: üretimde hiçbir
// yüzey seçiciye `semantic` vermiyor (ayrı pin). Gerçek embedding bağlandığı
// GÜN sessizce patlayacaklardı, o yüzden önce kapatıldı.
//
// ① `hasEvidence` anlamsal için `> 0` yetiyordu. Kosinüs benzerliği PRATİKTE
//    HER PARÇADA > 0'dır → her parça "kanıtlı" sayılır → `no_lexical_hits`
//    geri çekilmesi bir daha ASLA tetiklenmez (ürünün dürüstlük dalı ölür).
// ② CombSUM min-max normalize edilmiş PUANLARI toplar. BM25 SEYREK, kosinüs
//    YOĞUN → normalize edilince her parça 0,6–1,0 katkı alır ve sözcüksel sıra
//    SİLİNİR. RRF yalnız SIRAYA bakar, bu sorunu yaşamaz.
// ---------------------------------------------------------------------------

const T0 = Date.UTC(2026, 0, 1);
/** Hibritin devreye girmesi için küçük-KB eşiğinin ÜSTÜNDE bir taban gerekir. */
const mk = (i: number, over: Partial<{ category: string; title: string; content: string }> = {}) => ({
  id: `k${i}`,
  category: "faq",
  title: `Başlık ${i}`,
  // 🚨 İÇERİK UZUN OLMAK ZORUNDA: küçük KB (≤12 parça VE ≤6.000 karakter)
  // seçiciyi `small_kb` dalına düşürür ve hiç seçim yapılmaz. Bu dosyanın
  // ölçtüğü her şey seçim yolundadır.
  content: `Bu kalem ${i} hakkında uzunca bir açıklama içerir ve konuyla ilgisi yoktur. ${
    `Dolgu metni ${i} devam eder ve yeterli uzunluğa ulaşması için tekrarlanır. `.repeat(6)
  }`,
  updatedAt: new Date(T0 + i * 60_000),
  ...over,
});
const bigKb = (n = 20) => Array.from({ length: n }, (_, i) => mk(i));

/** Her parçaya AYNI değeri veren yoğun harita — gerçek kosinüsün davranışı. */
const denseMap = (items: ReturnType<typeof bigKb>, value: number) =>
  new Map(items.map((it) => [`${it.id}#0`, value]));

describe("anlamsal kaynak — aday eşiği", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 EŞİK ALTI anlamsal puan TEK BAŞINA aday yapmaz — `no_lexical_hits` dürüstlüğü korunur", () => {
    const items = bigKb(20);
    const r = selectKbForPrompt({
      items,
      // Sözcüksel isabeti OLMAYAN bir sorgu (KB tamamen "kalem N" metni).
      guestMessage: "Vapur iskelesine yürüyerek ne kadar sürer?",
      semantic: denseMap(items, SEMANTIC_QUALIFY_MIN - 0.1),
      mode: "hybrid",
    });
    expect(r.evidence?.fb).toBe("no_lexical_hits");
  });

  it("EŞİK ÜSTÜ anlamsal puan aday YAPAR (aşırı uygulama kontrolü — eşik her şeyi elemiyor)", () => {
    const items = bigKb(20);
    const r = selectKbForPrompt({
      items,
      guestMessage: "Vapur iskelesine yürüyerek ne kadar sürer?",
      semantic: denseMap(items, SEMANTIC_QUALIFY_MIN + 0.1),
      mode: "hybrid",
    });
    expect(r.evidence?.fb).not.toBe("no_lexical_hits");
    expect(r.evidence?.srcs).toContain("semantic");
  });

  it("anlamsal harita HİÇ verilmezse davranış bugünküyle aynı (fail-open yapısal)", () => {
    const items = bigKb(20);
    const withMap = selectKbForPrompt({
      items,
      guestMessage: "Vapur iskelesine yürüyerek ne kadar sürer?",
      mode: "hybrid",
    });
    expect(withMap.evidence?.srcs ?? []).not.toContain("semantic");
    expect(withMap.evidence?.fb).toBe("no_lexical_hits");
  });
});

describe("anlamsal kaynak — birleşim", () => {
  it("🚨 anlamsal kaynak VARKEN birleşim RRF'e geçer (CombSUM yoğun kosinüsle ezilir)", () => {
    const items = [
      ...bigKb(20),
      mk(99, { category: "parking", title: "Otopark", content: "Bina altı otopark ücretsizdir." }),
    ];
    // Çağıran AÇIKÇA "sum" diyor; anlamsal kaynak bunu EZER.
    const forcedSum = selectKbForPrompt({
      items,
      guestMessage: "Otopark var mı?",
      semantic: denseMap(items as ReturnType<typeof bigKb>, 0.9),
      sources: { fusion: "sum" },
      mode: "hybrid",
    });
    const rrf = selectKbForPrompt({
      items,
      guestMessage: "Otopark var mı?",
      semantic: denseMap(items as ReturnType<typeof bigKb>, 0.9),
      sources: { fusion: "rrf" },
      mode: "hybrid",
    });
    // 🚨 ETKİN birleşim kanıtta YAZILI (`fus`). Bu alan bu turda EKLENDİ çünkü
    // anahtar aksi hâlde DIŞARIDAN GÖZLEMLENEMİYORDU: ilk yazımda pin yalnız
    // "sum ve rrf aynı sonucu verdi" diyordu ve bu girdi için ikisi ZATEN aynı
    // sonucu veriyordu → anahtarı silen mutasyon HAYATTA KALDI (ölçüldü).
    expect(forcedSum.evidence?.fus).toBe("rrf");
    expect(rrf.evidence?.fus).toBe("rrf");
    expect(forcedSum.items.map((i) => i.id)).toEqual(rrf.items.map((i) => i.id));
    // Anti-vakum: seçim gerçekten yapıldı ve sözcüksel isabet HÂLÂ öndedir —
    // yoğun kosinüs onu silmedi.
    expect(forcedSum.selection).toBe("retrieved");
    expect(forcedSum.items[0]?.id).toBe("k99");
  });

  it("anlamsal YOKKEN çağıranın `sum` tercihi KORUNUR (aşırı uygulama kontrolü)", () => {
    const items = [
      ...bigKb(20),
      mk(99, { category: "parking", title: "Otopark", content: "Bina altı otopark ücretsizdir." }),
    ];
    const sum = selectKbForPrompt({ items, guestMessage: "Otopark var mı?", sources: { fusion: "sum" }, mode: "hybrid" });
    expect(sum.evidence?.srcs ?? []).not.toContain("semantic");
    // 🚨 TERS YÖN: anlamsal yokken "sum" GERÇEKTEN koşar. Bu satır olmadan
    // "her zaman rrf" mutantı hayatta kalırdı.
    expect(sum.evidence?.fus).toBe("sum");
    expect(sum.items[0]?.id).toBe("k99");
  });
});
