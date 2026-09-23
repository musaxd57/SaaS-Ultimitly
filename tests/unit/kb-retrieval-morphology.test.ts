import { describe, it, expect } from "vitest";
import { stem, contentStems } from "@/lib/ai/retrieval/text";
import { matchConcepts, expandQuery } from "@/lib/ai/retrieval/lexicon";
import { WEAK_QUERY_TERMS } from "@/lib/ai/retrieval/select";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { neutralPadding } from "../helpers/kb-padding";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { makeSyntheticKb, TOPICS } from "../helpers/kb-retrieval-synthetic";

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

describe("WEAK_QUERY_TERMS kök uzayında YAŞAR — kök sökücü değişince liste bayatlamasın", () => {
  // 🚨 Liste KÖK yazar ama niyet YÜZEY biçimidir. Kök sökücü değiştiğinde ("aldı" → `al` iken
  // `ald` oldu) zayıf kelime sessizce GÜÇLÜ olur ve tek başına aday yapmaya başlar. Bu pin
  // yüzeyden türetir: kök kuralı her değiştiğinde kırmızı verir.
  it("🚨 MEKANİK DEĞİŞMEZ: her girdi KENDİ KÖKÜ olmalı — yüzey biçimi yazılan girdi ÖLÜDÜR", () => {
    // İnceleme 09-10: altı ölü girdi ölçüldü ("lazim"→laz, "isti"→ist, "sorun"→sor, "yardim"→yard,
    // "leave"→leav, "use"→durak). Ölü girdi = kelime GÜÇLÜ sayılır ve tek başına aday yapar; yani
    // listenin var olma sebebi sessizce delinir. Bu satır kök sökücü her değiştiğinde uyarır.
    const dead = [...WEAK_QUERY_TERMS].filter((t) => stem(t) !== t);
    expect(dead, `kök olmayan girdiler: ${dead.join(", ")}`).toEqual([]);
    // Durak kelime de ölüdür: `contentStems` onu ağırlık haritasına hiç sokmaz.
    const stops = [...WEAK_QUERY_TERMS].filter((t) => contentStems(t).length === 0);
    expect(stops, `durak kelime girdileri: ${stops.join(", ")}`).toEqual([]);
  });

  it("09-10 kök turunun ZAYIFTAN GÜÇLÜYE geçirdiği biçimler yeniden zayıf", () => {
    // `-dı/-du/-tı/-tu` taban-3 kuralı iki harfli kökleri (al/ol/et) üç harfe çıkardı.
    for (const surface of ["aldı", "etti", "çalışıyor", "lazım", "istiyorum", "sorun", "yardım"]) {
      const s = contentStems(surface)[0];
      expect(s, surface).toBeDefined();
      expect(WEAK_QUERY_TERMS.has(s), `${surface} → ${s} zayıf listede DEĞİL`).toBe(true);
    }
    // "oldu" DURAK kelimedir → ağırlık haritasına hiç girmez (listede olmasına gerek yok).
    expect(contentStems("oldu")).toEqual([]);
  });

  it("ALAN sözcükleri zayıf DEĞİL (aşırı zayıflatma kontrolü)", () => {
    for (const w of ["otopark", "havlu", "klima", "asansör", "çıkış", "kargo", "eczane"]) {
      expect(WEAK_QUERY_TERMS.has(contentStems(w)[0]), w).toBe(false);
    }
  });
});

describe("select — zayıf kök 'ca' (çalışıyor/çalarsa artefaktı) tek başına ilgisiz kalemi öne çekmez", () => {
  const T0 = Date.UTC(2026, 8, 1, 10, 0, 0);
  const item = (i: number, title: string, content: string, category = "faq") => ({ id: `w_${i}`, category, title, content, updatedAt: new Date(T0 + i * 60_000), supersededById: null });
  // + nötr dolgu: üretimde ≤30 kalemlik KB'de seçim yapılmaz; mekanik 30'u aşan KB'de sınanır (kb-padding.ts).
  const filler = [
    ...Array.from({ length: 14 }, (_, i) => item(i, `Bilgi ${i}`, `Genel bilgi paragrafı ${i}: havlular dolapta, çöp yeşil konteynere, kahve kapsülleri çekmecede.`)),
    ...neutralPadding(17).map((p) => ({ ...p, supersededById: null })),
  ];
  // Yalnız BM25 (n-gram kapalı): zayıf kök kuralı BM25 ağırlığı/aday şartıdır, n-gram kosinüsü ölçümü bulandırır.
  // ⚠️ DÜRÜSTLÜK ETİKETİ (inceleme 09-10): bu CANLI varsayılandan (`auto`) bir SAPMADIR. Pinlenen iki sonucun
  // `auto` ile de birebir tuttuğu ÖLÇÜLDÜ (asansör ilk + yangın aday değil; jakuzi w_30 ilk) — yani test
  // üretimde geçersiz bir şey pinlemiyor. Sapmanın sebebi MUTASYON DUYARLILIĞI: `WEAK_QUERY_WEIGHT = 0`
  // mutantı `ngram:false` ile jakuzi pinini DÜŞÜRÜR, `auto` ile hayatta kalır.
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

  it("TAŞINAN zayıf kök PUANA GİRER (ağırlık 0 değil): ince soruda geçmişten gelen 'var' sıralamayı etkiler", () => {
    // İnce sorgu ("Ücretli mi?") önceki MİSAFİR mesajından kök taşır (`carryStems`). Taşınan zayıf
    // kök hiç puanlamasaydı, "var"sız kısa kalem öne geçerdi (ölçüldü: ağırlık 0 → w_40 ilk).
    //
    // 🚨 BİLİNEN SINIR — 0.25 ↔ 0.5 AYIRT EDİLEMİYOR (inceleme 09-10): üç ayrı fikstürde (kısa/uzun
    // kalem, 1–4 "var" tekrarı) iki ağırlık BİREBİR aynı sıralamayı verdi; fark ancak 772 senaryoluk
    // taramada ve yalnız KUYRUK sırasında görünüyor. Kod yine `min(carry, weak)` kullanıyor çünkü
    // eski hâl İLİŞKİYİ TERSİNE çeviriyordu (misafirin şu an yazdığı kelime, geçmişten taşınandan
    // hafif kalıyordu) — ama bu satır o farkı DEĞİL, yalnız "sıfır değil"i pinler.
    const items = [
      ...filler,
      item(40, "Jakuzi", "Jakuzi terasta."),
      item(41, "Jakuzi alanı", "Jakuzi alanında havlu var, duş var, dolap var, şezlong var."),
    ];
    const r = selectKbForPrompt({
      items,
      guestMessage: "Ücretli mi?",
      mode: "hybrid",
      sources: bm25Only,
      history: [{ direction: "inbound", body: "Jakuzi var mı?" }],
    });
    expect(r.items[0]?.id, `ilk: ${r.items[0]?.id}`).toBe("w_41");
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

describe("stem — SABİT NOKTA FRENLERİ (inceleme 09-10): havalimanı sınıfı HAVLU kovasına düşmez", () => {
  it("havalimanından/havalimanında/havalimanını ≡ havalimanı; havaalanından ≡ havaalanı", () => {
    for (const w of ["havalimanindan", "havalimaninda", "havalimanini", "havalimanina", "havalimaniniza"]) {
      same(w, "havalimani");
    }
    same("havaalanindan", "havaalani");
    same("havaalanina", "havaalani");
  });

  it("🚨 HAVLU ÇARPIŞMASI YOK: havalimanı ailesi 'hav' kovasında DEĞİL (havlu/hava orada kalır)", () => {
    expect(stem("havlu")).toBe(stem("hava")); // pre-existing birleşme, dokunulmadı
    for (const w of ["havalimani", "havalimanindan", "havaalanindan"]) {
      expect(stem(w), w).not.toBe(stem("havlu"));
    }
  });

  it("FREN tamlayan: '-nin' İLK turda sökülür (makinesinin ≡ makine korunur), fiil biçimleri ETKİLENMEZ", () => {
    same("makinesinin", "makine");
    same("kesintisinde", "kesinti");
    same("odanin", "oda");
    // Optatif ve diğer fiil çekimleri dokunulmaz (fren YALNIZ tamlayanda).
    expect(stem("gidelim")).toBe("gid");
    expect(stem("bakalim")).toBe("bak");
    expect(stem("yapalim")).toBe("yap");
  });

  it("kısa kökler korunur (aşırı kök alma kontrolü)", () => {
    expect(stem("hava")).toBe("hav");
    expect(stem("su")).toBe("su");
    expect(stem("cop")).toBe("cop");
  });

  it("🚨 ÖLÇEK HARNESS'I bu sınıfa KÖR OLMAMALI: airport morph sorusu kaynaştırma-n biçiminde", () => {
    // Eski soru "Havalimanınıza servisiniz var mı?" idi; o biçim `havaliman`a iniyor, yani kaçak
    // sınıfının DIŞINDA kalıyordu ve metrik gerilemeyi göremiyordu (inceleme 09-10).
    // ⚠️ `\b` ASCII tabanlıdır: `/havalimanın(dan|da|ı)\b/` eski soruyu ("Havalimanınıza…") da
    // eşleştiriyordu (ı|z sınırı) → mutant hayatta kalmıştı. Hâl eki AÇIKÇA aranır.
    const airport = TOPICS.find((t) => t.key === "airport")!;
    expect(airport.questions.morph.toLocaleLowerCase("tr")).toMatch(/havalimanın(dan|da)/);
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
    // 🚨 FİKSTÜR AYIRT EDİCİ OLMALI (inceleme 09-10): "Uydu kanalları var mı?" terimi silinse de
    // `tv` tetikler ("kanal" zaten tv terimi) → o cümle "uydu"yu KORUMAZ. Yalnız-uydu cümlesi şart.
    expect(ids("Uydu yayını var mı?")).toContain("tv");
    expect(ids("Uydu alıcısı nerede?")).toContain("tv");
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
        // `items` PARÇA başınadır (`id` kaynak KALEM kimliği). 0. konumda tekilleştirme gereksiz;
        // hit@3'e genişletilirse ölçek harness'ındaki gibi `orderedIds` tekilleştirilmeli — aynı
        // kalemin iki ardışık parçası ilk üçü doldurabilir (inceleme 09-10).
        expect(r.items.length).toBeGreaterThan(0);
        expect(gold.has(r.items[0].id), `ilk kalem ${r.items[0]?.id}`).toBe(true);
      }
    });
  }
});
