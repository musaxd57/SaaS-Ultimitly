import { describe, it, expect } from "vitest";
import { stem, contentStems } from "@/lib/ai/retrieval/text";
import { matchConcepts, expandQuery } from "@/lib/ai/retrieval/lexicon";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { makeSyntheticKb } from "../helpers/kb-retrieval-synthetic";

// ---------------------------------------------------------------------------
// RETRIEVAL KAÇAK TURU (09-10) — kök sökücü simetrisi + ünlü-sonu iyelik + zayıf
// kök artefaktları + sözlük çarpışmaları.
//
// Kaynak: ölçek harness'ının (30/100/300) KALAN kaçakları puan dökümüyle teşhis
// edildi (Ajan A, `cc45ce6`). Dört kök neden sınıfı:
//  1. TUR TAVANI (`STEM_PASSES=3`): çekimli biçim ile yalın biçim FARKLI derinlikte
//     kalıyordu → "çıkışımızı→ciki" ≠ "çıkış→cik". text.ts'in "aşırı kök alma
//     kaçırma üretmez" varsayımı tavanla TUTMUYORDU (simetri bozuluyordu).
//  2. ÜNLÜ-SONU İYELİK EKLERİ YOK (-mız/-niz/-muz/-nuz): "ısıtmanızı", "metronuz",
//     "kargomuzu", "mikrodalganız" kök uzayında kendi konusuna inmiyordu.
//  3. ZAYIF KÖK ARTEFAKTLARI: "koyabilirim→ko" = "koduna→ko" = "koşu→ko";
//     "çalışıyor→ca" = "çalarsa→ca" — 2 harfli nadir kök yüksek IDF ile ilgisiz
//     kalemi öne çekiyordu.
//  4. SÖZLÜK ÇARPIŞMALARI: "uydu→uy" = "uymuyor→uy" (tv), "yemek→ye" (restoran
//     torbası), power = elektrik + priz karışımı.
//
// Bu dosya KIRMIZI-ÖNCE yazıldı: her `it` düzeltme öncesi düşen bir ölçümdür.
// ---------------------------------------------------------------------------

const same = (a: string, b: string) => expect(stem(a), `${a} ≟ ${b}`).toBe(stem(b));

describe("stem — SABİT NOKTA (tur tavanı yok): çekimli ve yalın biçim aynı köke iner", () => {
  it("çıkışımızı ≡ çıkış · girişimizi ≡ giriş · kesintisinde ≡ kesintisi ≡ kesinti · makinesinin ≡ makine", () => {
    same("cikisimizi", "cikis");
    same("girisimizi", "giris");
    same("kesintisinde", "kesinti");
    same("kesintisi", "kesinti");
    same("makinesinin", "makine");
  });

  it("dilim 1–2 pinleri korunur (otobusun/otobus, blog, bus, 12:00) ve patolojik belirteç sonlanır", () => {
    expect(stem("otobusun")).toBe(stem("otobus"));
    expect(stem("otobusun")).not.toBe("otobu");
    expect(stem("blog")).toBe("blog");
    expect(stem("bus")).toBe("bus");
    expect(stem("12:00")).toBe("12:00");
    // Sabit nokta sınırı: "aaaa…" gibi her turda ek söken belirteç bile en fazla
    // sınırlı tur görür ve MIN_STEM altına inmez.
    const s = stem("a".repeat(40));
    expect(s.length).toBeGreaterThanOrEqual(2);
  });
});

describe("stem — ÜNLÜ-SONU İYELİK (-mız/-miz/-muz/-müz, -nız/-niz/-nuz/-nüz)", () => {
  it("ısıtmanızı ≡ ısıtma · metronuz ≡ metro · kargomuzu ≡ kargo · mikrodalganız ≡ mikrodalga · klimanızı ≡ klima · eczaneniz ≡ eczane", () => {
    same("isitmanizi", "isitma");
    same("metronuz", "metro");
    same("kargomuzu", "kargo");
    same("mikrodalganiz", "mikrodalga");
    same("klimanizi", "klima");
    same("eczaneniz", "eczane");
  });

  it("kök tabanı 3: deniz/omuz/domuz/yıldız sökülmez; kiranız ≡ kira", () => {
    expect(stem("deniz")).toBe("deniz");
    same("denize", "deniz");
    expect(stem("omuz")).toBe("omuz");
    expect(stem("domuz")).toBe("domuz");
    expect(stem("yildiz")).toBe("yildiz");
    same("kiraniz", "kira");
  });
});

describe("stem — KAYNAŞTIRMA 'y' kökün parçasıysa sökülmez (çay/su/koy); 'su' düzensiz kökü", () => {
  it("çayı ≡ çay · kapıyı ≡ kapı · odayı ≡ oda · arabayla ≡ araba · koyabilirim ≡ koy", () => {
    same("cayi", "cay");
    expect(stem("cayi")).toBe("cay");
    same("kapiyi", "kapi");
    same("odayi", "oda");
    same("arabayla", "araba");
    expect(stem("koyabilirim")).toBe("koy");
  });

  it("su: suyu / suyunuz / suyumuz / suya / suyla hepsi 'su'", () => {
    for (const w of ["suyu", "suyunuz", "suyumuz", "suya", "suyla"]) expect(stem(w), w).toBe("su");
    expect(stem("su")).toBe("su");
    // Düzensiz eşleme yalnız 'suy' içindir: başka kök dokunulmaz.
    expect(stem("boyu")).toBe("boy");
  });

  it("ünsüz-sonu -sı/-su/-dı/-du kök 2 harfe inecekse sökülmez: kodu ≡ kod, duşu ≡ duş, kediyi ≡ kedi; geldi/kapısı etkilenmez", () => {
    same("kodu", "kod");
    expect(stem("kodu")).toBe("kod");
    same("koduna", "kod");
    same("dusu", "dus");
    same("kediyi", "kedi");
    same("geldi", "gel");
    same("kapisi", "kapi");
    same("odasi", "oda");
  });
});

describe("select — zayıf kök 'ca' (çalışıyor/çalarsa artefaktı) tek başına ilgisiz kalemi öne çekmez", () => {
  const T0 = Date.UTC(2026, 8, 1, 10, 0, 0);
  const item = (i: number, title: string, content: string, category = "faq") => ({ id: `w_${i}`, category, title, content, updatedAt: new Date(T0 + i * 60_000), supersededById: null });
  const filler = Array.from({ length: 14 }, (_, i) => item(i, `Bilgi ${i}`, `Genel bilgi paragrafı ${i}: havlular dolapta, çöp yeşil konteynere, kahve kapsülleri çekmecede.`));
  // Yalnız BM25 (n-gram kapalı): zayıf kök kuralı BM25 ağırlığı/aday şartıdır, n-gram kosinüsü ölçümü bulandırır.
  const bm25Only = { ngram: false as const };
  const kb = [
    ...filler,
    // Yangın kalemi "ca" kökünü İKİ kez taşır (çalarsa ×2), asansör kalemi "asansor"u BİR kez: "ca" güçlü sayılsaydı
    // (tf 2 × nadir IDF) yangın kalemi öne geçerdi; zayıf "ca" tek başına aday bile yapmaz.
    item(20, "Yangın", "Yangın alarmı çalarsa merdiveni kullanın; sistem testinde de çalarsa panik yapmayın.", "general"),
    item(21, "Asansör", "Asansör tüm katlara çıkar; bebek arabası için giriş rampası vardır."),
  ];

  it("'Asansörünüz çalışıyor mu?' → asansör kalemi önde; yangın kalemi 'çalarsa'→ca ile aday olmaz", () => {
    const r = selectKbForPrompt({ items: kb, guestMessage: "Asansörünüz çalışıyor mu?", mode: "hybrid", sources: bm25Only });
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items[0].id).toBe("w_21");
    expect(r.items.some((i) => i.id === "w_20")).toBe(false);
  });

  it("zayıf kök puana yine de GİRER (ağırlık 0 değil): 'Jakuzi var mı?' → 'var'lı, DAHA ESKİ ve DAHA UZUN jakuzi kalemi yeni olanın önüne geçer", () => {
    const items = [
      ...filler,
      // Eski + uzun: 'var' içerir. Yeni + kısa: içermez. Ağırlık 0 olsaydı yalnız 'jakuzi' puanlanır,
      // uzunluk normuyla kısa/yeni kalem önde olurdu.
      item(30, "Jakuzi", "Jakuzi terasta, kullanımı var; kapağını kapatın."),
      item(31, "Jakuzi (2)", "Jakuzi terasta; kapağını kapatın."),
    ];
    const r = selectKbForPrompt({ items, guestMessage: "Jakuzi var mı?", mode: "hybrid", sources: bm25Only });
    expect(r.items[0].id).toBe("w_30");
  });
});

describe("lexicon — dar düzeltmeler (ölçülen çarpışmalar)", () => {
  const ids = (q: string) => matchConcepts(contentStems(q)).map((m) => m.concept.id);

  it("'Fişim uymuyor, adaptör?' → socket; TV'ye DÜŞMEZ (eski çarpışma uydu→uy = uymuyor→uy; kök düzeltmesiyle uydu→uyd)", () => {
    const m = ids("Fişim uymuyor, adaptör var mı?");
    expect(m).toContain("socket");
    expect(m).not.toContain("tv");
    // Çarpışma KÖKTE çözüldü: "uydu" artık -du'yu sökmez (kök 2 harfe inecekti) → "uyd" ≠ "uy".
    expect(stem("uydu")).not.toBe(stem("uymuyor"));
    expect(ids("Uydu kanalları var mı?")).toContain("tv");
    expect(ids("Televizyon nasıl açılıyor?")).toContain("tv");
  });

  it("'plug adapter' → socket (priz ailesi); 'Elektrikler gitti' → power (sigorta ailesi); ikisi KARIŞMAZ", () => {
    const en = ids("Do you have a plug adapter?");
    expect(en).toContain("socket");
    expect(en).not.toContain("power");
    const tr = expandQuery(contentStems("Elektrikler gitti ne yapayım?"));
    expect(tr.matched.map((m) => m.concept.id)).toContain("power");
    // Genişletme anahtarları KÖK uzayındadır ("sigorta" → stem).
    expect(tr.expansion.has(stem("sigorta"))).toBe(true);
    expect(tr.expansion.has(stem("priz"))).toBe(false);
    expect(tr.expansion.has(stem("adaptor"))).toBe(false);
  });

  it("'Yemek ısıtabileceğim…' → microwave; restoran torbasına DÜŞMEZ; restoran soruları korunur", () => {
    const m = ids("Yemek ısıtabileceğim bir şey var mı?");
    expect(m).toContain("microwave");
    expect(m).not.toContain("restaurant");
    expect(ids("Nerede yemek yiyebiliriz?")).toContain("restaurant");
    expect(ids("Restoran önerir misiniz?")).toContain("restaurant");
    expect(ids("Any restaurant recommendations?")).toContain("restaurant");
  });
});

// ---------------------------------------------------------------------------
// HARNESS KAÇAK PİNLERİ — ölçek harness'ında düzeltme ÖNCESİ düşen sorular, tek tek.
// `inPrompt` = cevap cümlesi blokta (METİN ölçüsü); `hit1` = ilk kalem gold.
// ---------------------------------------------------------------------------
type Leak = { n: 30 | 100 | 300; q: string; want: "inPrompt" | "hit1"; noFallback?: boolean; why: string };
const LEAKS: Leak[] = [
  { n: 100, q: "q_heating_morph", want: "inPrompt", why: "ısıtmanızı ≠ ısıtma (-nız yok + tavan)" },
  { n: 300, q: "q_heating_morph", want: "inPrompt", why: "aynı" },
  { n: 100, q: "q_checkout_morph", want: "inPrompt", noFallback: true, why: "çıkışımızı→ciki ≠ çıkış→cik → no_lexical_hits geri çekilmesi" },
  { n: 300, q: "q_checkout_morph", want: "inPrompt", noFallback: true, why: "aynı" },
  { n: 100, q: "q_checkin_morph", want: "inPrompt", why: "girişimizi→giri ≠ gir" },
  { n: 100, q: "q_metro_morph", want: "inPrompt", why: "metronuz (-nuz yok) → kalan kök 'uzak' otoparka gidiyordu" },
  { n: 100, q: "q_packages_morph", want: "hit1", why: "kargomuz (-muz yok) → yalnız 'görev' → kapıcı kalemi" },
  { n: 100, q: "q_plug_syn", want: "hit1", why: "uymuyor→uy = uydu→uy → TV genişletmesi" },
  { n: 100, q: "q_plug_en", want: "hit1", why: "plug power torbası → sigorta kalemi" },
  { n: 100, q: "q_guide_bike", want: "hit1", why: "koyabilirim→ko = koduna→ko (zayıf kök)" },
  { n: 300, q: "q_guide_water_cut", want: "inPrompt", why: "kesintisi→kes ≠ kesintisinde→kesinti (tavan)" },
  { n: 300, q: "q_microwave_syn", want: "inPrompt", why: "yemek→ye restoran genişletmesi 12 parçayı dolduruyordu" },
  // Zayıf kök BM25 ağırlığı (0.25): 1.0'da "Yemek ısıtabileceğim bir şey VAR mı?" sorusunda "var"lı rehber
  // parçası mikrodalga kaleminin önüne geçiyordu (ölçüldü: yalnız bu soru ve n=300 kapalı elevator_morph değişir).
  { n: 30, q: "q_microwave_syn", want: "hit1", why: "zayıf kök 'var' tam ağırlıkta rehber parçasını öne çekiyordu" },
];

describe("ölçek harness'ı — düzeltme öncesi düşen sorular artık isabet eder (varsayılan yapılandırma)", () => {
  const kbs = new Map<number, ReturnType<typeof makeSyntheticKb>>();
  const kbFor = (n: number) => kbs.get(n) ?? (kbs.set(n, makeSyntheticKb(n)), kbs.get(n)!);

  for (const leak of LEAKS) {
    it(`n=${leak.n} ${leak.q} → ${leak.want}${leak.noFallback ? " (geri çekilme yok)" : ""} — ${leak.why}`, () => {
      const kb = kbFor(leak.n);
      const q = kb.questions.find((x) => x.id === leak.q);
      expect(q, leak.q).toBeDefined();
      const r = selectKbForPrompt({ items: kb.items, guestMessage: q!.text, mode: "hybrid" });
      const text = packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes).text;
      const gold = new Set(q!.goldIds);
      if (leak.noFallback) expect(r.evidence?.fb ?? "none", "geri çekilme").toBe("none");
      if (leak.want === "inPrompt") {
        expect(q!.needles.some((nd) => text.includes(nd)), "cevap cümlesi blokta").toBe(true);
      } else {
        expect(r.items.length).toBeGreaterThan(0);
        expect(gold.has(r.items[0].id), `ilk kalem ${r.items[0]?.id}`).toBe(true);
      }
    });
  }
});
