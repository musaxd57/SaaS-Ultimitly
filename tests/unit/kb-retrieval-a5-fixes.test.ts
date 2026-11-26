import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { chunkText } from "@/lib/ai/retrieval/chunker";
import { kbPlaceholderTokens } from "@/lib/kb-placeholders";

// ---------------------------------------------------------------------------
// #208 A5 hata ayıklama ajanı (09-27; kurucu kararı "getirme hatalarını ölçerek düzelt"). Her blok ajanın kanıt betiğinin
// (scratchpad/agents/A5/sN.ts) sabitlenmiş hâlidir; kurgusal "Lale" dairesi.
// ---------------------------------------------------------------------------

const T0 = Date.UTC(2026, 0, 1);
let t = 0;
const mk = (id: string, category: string, title: string, content: string) => ({ id, category, title, content, updatedAt: new Date(T0 - (t++) * 60_000) });
const pads = (n: number, prefix = "pad") => Array.from({ length: n }, (_, i) => mk(`${prefix}_${i}`, "general", `Qzx ${i}`, `Qzxw vbnm plkj ${i}.`));

beforeEach(() => {
  __resetKbIndexCache();
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "");
  vi.stubEnv("KB_RERANK_ENABLED", "");
  vi.stubEnv("AI_UNDERSTANDING_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("F1 — sorulmayan alandaki çelişki bloğu doldurmaz: her farklı saat değeri için TEK temsilci", () => {
  const filler = "Daire içinde sigara içilmez, evcil hayvan kabul edilmez, parti yapılmaz ve komşulara saygı gösterilir. ";
  const oldRules = () =>
    Array.from({ length: 12 }, (_, i) => mk(`eski_kural_${i}`, "rules", `Ev kuralları (eski sürüm ${i})`, `Lale dairesi kuralları ${i}. Çıkış saati 12:00. ${filler.repeat(4)}`));
  const airport = () => mk("havalimani", "transport", "Havalimanı ulaşımı", "Havalimanına Havaist otobüsüyle gidilir; durak binaya 200 metre, sefer her 30 dakikada bir.");
  const MSG = "Wifi şifresi ne? Havalimanına nasıl giderim?";

  it("🚨 rehber çıkış saati taşısa da havalimanı cevabı blokta; iki değer de görünür, not yok", () => {
    const rehber = mk("rehber", "general", "Lale ev rehberi", "Wifi ağı LaleNet, şifresi lale2024. Çıkış saati 11:00.");
    const r = selectKbForPrompt({ items: [rehber, airport(), ...oldRules(), ...pads(25)], guestMessage: MSG, mode: "hybrid", now: T0 });
    const ids = r.items.map((i) => i.id);
    expect(ids).toContain("havalimani");
    expect(ids).toContain("rehber");
    // Çelişkinin öbür değeri (12:00) TEK temsilciyle blokta: model iki kaynağı görür, not gerekmez.
    expect(ids.filter((id) => id.startsWith("eski_kural_"))).toHaveLength(1);
    expect(r.evidence?.conf).toBe(1);
    expect(r.evidence?.confDropped).toBe(0);
    expect(r.notes).toEqual([]);
  });

  it("🚨 temsilci önce SEÇİLENLERDEN: soruyla ilgili 12:00 kalemi (Y) temsil eder, en yeni ilgisiz kopya (X) bloğa çekilmez", () => {
    // Rehber wifi sorusunun 1. adayı (çapa, 11:00); Y 2. aday (12:00, seçilir); X en yeni ama ilgisiz kopya (12:00, aday değil).
    const rehber = mk("rehber", "general", "Wifi ve ev rehberi", "Wifi ağı LaleNet, şifresi lale2024. Çıkış saati 11:00.");
    const X = { ...mk("X", "rules", "Kurallar", "Lale dairesi kuralları. Çıkış saati 12:00."), updatedAt: new Date(T0 + 60_000) };
    const Y = mk("Y", "general", "Modem", "Wifi modemi salonda duruyor. Çıkış saati 12:00.");
    // >30 kalem: küçük-KB yolu (tamamı gider) değil, seçim.
    const r = selectKbForPrompt({ items: [rehber, X, Y, airport(), ...pads(40)], guestMessage: MSG, mode: "hybrid", now: T0 });
    expect(r.evidence?.fb).toBe("none");
    const ids = r.items.map((i) => i.id);
    expect(ids).toContain("Y");
    expect(ids).not.toContain("X");
  });

  it("KONTROL — rehber çıkış saati taşımıyorsa sonuç zaten doğruydu", () => {
    const rehber = mk("rehber", "general", "Lale ev rehberi", "Wifi ağı LaleNet, şifresi lale2024.");
    const r = selectKbForPrompt({ items: [rehber, airport(), ...oldRules(), ...pads(25)], guestMessage: MSG, mode: "hybrid", now: T0 });
    expect(r.items.map((i) => i.id)).toContain("havalimani");
  });

  it("🚨 üç FARKLI değer: her değer TEK temsilciyle blokta (11:00 çapa + 12:00 + 12:30; 12 kopya değil)", () => {
    const rehber = mk("rehber", "general", "Lale ev rehberi", "Wifi ağı LaleNet, şifresi lale2024. Çıkış saati 11:00.");
    const k1230 = mk("kural_1230", "rules", "Kurallar (not)", "Çıkış saati 12:30.");
    const r = selectKbForPrompt({ items: [rehber, airport(), k1230, ...oldRules(), ...pads(25)], guestMessage: MSG, mode: "hybrid", now: T0 });
    const ids = r.items.map((i) => i.id);
    expect(ids).toContain("kural_1230");
    expect(ids.filter((id) => id.startsWith("eski_kural_"))).toHaveLength(1);
  });
});

describe("F4 — ek sorgu, bütçede yeri olan özgün adayı düşüremez", () => {
  const long = (seed: string, word: string) => {
    let c = `${seed}. `;
    while (c.length < 890) c += `Bu bölümde ${word} ile ilgili ayrıntılar anlatılır ve misafirlerin dikkat etmesi gereken noktalar sıralanır. `;
    return c.slice(0, 890);
  };
  const items = () => [
    ...[0, 1, 2, 3].map((i) => mk(`B${i}`, "general", `Bisiklet notu ${i}`, `Bisiklet bisiklet bisiklet yolu ${i} sahil boyunca uzanır.`)),
    mk(
      "CEVAP",
      "general",
      "Kiralık ekipman",
      "Lale dairesinde iki adet katlanır bisiklet ve pedal seti ücretsiz kullanılabilir; anahtar vestiyerde asılıdır, kask dolapta. Bisikletleri kullandıktan sonra lütfen apartman girişindeki bisiklet park alanına kilitleyin; lastik pompası da aynı dolaptadır. Hasar olursa ev sahibine haber verin, pedal seti sadece bu bisikletlere uyar ve sahil yolunda kullanım için idealdir.",
    ),
    mk("S0", "general", "Scooter rehberi", long("Scooter rehberi", "scooter")),
    mk("S1", "general", "Kaykay rehberi", long("Kaykay rehberi", "kaykay")),
    ...pads(30),
  ];
  const extras = [
    { text: "scooter kiralama", turkish: true },
    { text: "kaykay kiralama", turkish: true },
    { text: "pedal seti", turkish: true },
  ];

  it("🚨 'pedal seti' ek sorgusu cevabı önce seçse de cevap blokta kalır", () => {
    const r = selectKbForPrompt({ items: items(), guestMessage: "Bisiklet var mı?", mode: "hybrid", extraQueries: extras, now: T0 });
    expect(r.items.map((i) => i.id)).toContain("CEVAP");
  });

  it("KONTROL — ek sorgu yokken cevap blokta", () => {
    const r = selectKbForPrompt({ items: items(), guestMessage: "Bisiklet var mı?", mode: "hybrid", now: T0 });
    expect(r.items.map((i) => i.id)).toContain("CEVAP");
  });
});

describe("F6 — hiçbir tarafı bloğa girmeyen çelişki için not yazılmaz; bir tarafı girip öbürü sığmayınca YAZILIR", () => {
  it("🚨 blokta yalnız Wi-Fi parçaları varken 'çıkış saati' notu yok", () => {
    const wifi = Array.from({ length: 14 }, (_, i) => mk(`W${i}`, "wifi", `Wifi ${i}`, `Wifi agi LaleNet${i}, wifi sifresi lale${i}. Wifi modem salonda.`));
    const D = mk("D", "general", "Genel notlar", "Wifi sifresi modemin altinda yazar. Çıkış saati 11:00.");
    const Z = mk("Z", "rules", "Kurallar", "Çıkış saati 12:00. Sigara içilmez.");
    const r = selectKbForPrompt({ items: [...wifi, D, Z, ...pads(20)], guestMessage: "Wifi sifresi ne?", mode: "hybrid", now: T0 });
    const ids = r.items.map((i) => i.id);
    expect(ids.includes("D") || ids.includes("Z")).toBe(false);
    expect(r.notes).toEqual([]);
    expect(r.evidence?.confDropped).toBe(0);
  });

  it("KONTROL — BÜTÇE ÇELİŞKİYİ YUTAMAZ: çapa blokta, öbür değer sığmıyorsa not yazılır", () => {
    // Z tek parça (≤600 karakter, cümle sınırsız) ve dar bütçeye sığmıyor: çapa (D) blokta, 12:00 dışarıda → not + confDropped.
    const D = mk("D", "general", "Wifi ve çıkış", "Wifi sifresi lale2024. Çıkış saati 11:00.");
    const Z = mk("Z", "rules", "Kurallar", `Çıkış saati 12:00 ${"ve sigara içilmez ve komşulara saygı gösterilir ".repeat(8)}`.trim());
    const r = selectKbForPrompt({ items: [D, Z, ...pads(40)], guestMessage: "Wifi sifresi ne?", mode: "hybrid", now: T0, budgetChars: 300 });
    const ids = r.items.map((i) => i.id);
    expect(ids).toContain("D");
    expect(ids).not.toContain("Z");
    expect(r.notes.join(" ")).toMatch(/farklı değerler var/);
    expect(r.evidence?.confDropped).toBe(1);
  });
});

describe("F6 — çapası ek sorgu payına takılıp düşen, ORTAĞI blokta kalan çelişki de not alır", () => {
  // Çapa (A: çöp + çıkış 11:00, uzun) ek sorgudan gelir ve ek payına sığmaz; ortak (B: wifi + çıkış 12:00) özgün sorudan blokta.
  const build = () => {
    const C = mk("C", "wifi", "Wifi", "Wifi sifresi lale2024, modem salonda.");
    const B = mk("B", "general", "Wifi notu", "Wifi sifresi degisirse bildiririz. Çıkış saati 12:00.");
    const A = mk("A", "general", "Çöp", `Çöp kutusu mutfakta, çöp poşetleri dolapta. Çıkış saati 11:00. ${"Çöpü çıkarken kapıyı kapatın. ".repeat(20)}`);
    return [C, B, A, ...pads(40)];
  };
  const run = (extraShare: number) =>
    selectKbForPrompt({
      items: build(),
      guestMessage: "Wifi sifresi ne?",
      mode: "hybrid",
      now: T0,
      extraQueries: [{ text: "çöp kutusu nerede", turkish: true, request: 1 }],
      strategy: { extraShare },
    });

  it("🚨 dar payda: çapa düşer, 12:00 blokta → not yazılır", () => {
    const r = run(0.1);
    const ids = r.items.map((i) => i.id);
    expect(ids).toContain("B");
    expect(ids).not.toContain("A");
    expect(r.notes.join(" ")).toMatch(/farklı değerler var/);
    expect(r.evidence?.confDropped).toBe(1);
  });

  it("KONTROL — geniş payda iki taraf da blokta → not yok", () => {
    const r = run(0.34);
    expect(r.items.map((i) => i.id)).toEqual(expect.arrayContaining(["A", "B"]));
    expect(r.notes).toEqual([]);
  });
});

describe("F7 — aynı küme, kalem sırası ve önbellek durumundan bağımsız aynı seçim", () => {
  it("🚨 eşit güncellikteki iki çelişki kaleminin sırası değişince seçim değişmez", () => {
    const same = new Date(T0 - 60_000);
    const filler = "Daire icinde sigara icilmez, evcil hayvan kabul edilmez ve komsulara saygi gosterilir. ";
    const W = { id: "rehber", category: "general", title: "Lale ev rehberi", content: "Wifi sifresi lale2024. Çıkış saati 11:00.", updatedAt: new Date(T0) };
    const P1 = { id: "kural_a", category: "rules", title: "Kurallar A", content: ("Çıkış saati 12:00. " + filler.repeat(8)).slice(0, 700), updatedAt: same };
    const P2 = { id: "kural_b", category: "rules", title: "Kurallar B", content: ("Çıkış saati 12:30. " + filler.repeat(8)).slice(0, 700), updatedAt: same };
    const pad = Array.from({ length: 30 }, (_, i) => ({ id: `pad_${i}`, category: "general", title: `Qzx ${i}`, content: `Qzxw vbnm plkj ${i}.`, updatedAt: new Date(T0 - 120_000 - i * 60_000) }));
    const run = (items: typeof pad) => selectKbForPrompt({ items, guestMessage: "Wifi sifresi ne?", mode: "hybrid", budgetChars: 900, now: T0 }).items.map((i) => i.id);
    __resetKbIndexCache();
    const a = run([W, P1, P2, ...pad]);
    const bWarm = run([W, P2, P1, ...pad]);
    __resetKbIndexCache();
    const bCold = run([W, P2, P1, ...pad]);
    expect(bWarm).toEqual(a);
    expect(bCold).toEqual(a);
  });
});

describe("F8 — iç hata dalı da sürüm kuralını uygular", () => {
  it("🚨 retrieval hatasında eski sürüm ('Çıkış 12:00', yerine yenisi geçmiş) isteme gitmez", () => {
    const neu = { id: "cikis_yeni", category: "checkout", title: "Çıkış", content: "Çıkış saati 11:00.", updatedAt: new Date(T0) };
    const old = { id: "cikis_eski", category: "checkout", title: "Çıkış", content: "Çıkış saati 12:00.", updatedAt: new Date(T0 - 1000), supersededById: "cikis_yeni" };
    const pad = Array.from({ length: 33 }, (_, i) => ({ id: `pad_${i}`, category: "general", title: `Qzx ${i}`, content: `Qzxw vbnm plkj ${i}.`, updatedAt: new Date(T0 - 5000 - i * 60_000) }));
    const r = selectKbForPrompt({
      items: [neu, old, ...pad],
      guestMessage: "Çıkış saati kaç?",
      mode: "hybrid",
      now: T0,
      onCandidates: () => {
        throw new Error("simüle iç hata");
      },
    });
    expect(r.evidence?.fb).toBe("error");
    const ids = r.items.map((i) => i.id);
    expect(ids).toContain("cikis_yeni");
    expect(ids).not.toContain("cikis_eski");
  });
});

describe("F10 — sert bölme köşeli/açılı parantez içindeki yer tutucuyu ikiye ayırmaz", () => {
  it("🚨 900 karakteri aşan noktalamasız cümledeki '[ŞİFRE BURAYA]' tek parçada kalır ve tanınır", () => {
    let pre = "";
    while (pre.length < 879) pre += "misafirler lutfen kurallara uysun ";
    pre = pre.slice(0, 879);
    const content = `${pre} kasa sifresi [ŞİFRE BURAYA] olarak girilir ve kapi kilitlenir ${"lutfen tekrar kontrol edin ".repeat(4)}`;
    expect(kbPlaceholderTokens(content)).toEqual(["[ŞİFRE BURAYA]"]);
    const chunks = chunkText(content);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((c) => kbPlaceholderTokens(c))).toEqual(["[ŞİFRE BURAYA]"]);
    // Metin değişmez: parçalar birleşince (aradaki boşluklar hariç) içerik aynı.
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(content.trim().replace(/\s+/g, " "));
    // Açılı parantezli yer tutucu da bölünmez.
    const angle = content.replace("[ŞİFRE BURAYA]", "<KOD BURAYA>");
    expect(chunkText(angle).flatMap((c) => kbPlaceholderTokens(c))).toEqual(["<KOD BURAYA>"]);
  });

  it("KONTROL — kapanmayan '[' bölmeyi engellemez (patolojik girdi yine tavanda bölünür)", () => {
    const content = `[${"kelime ".repeat(300)}`;
    expect(chunkText(content).every((c) => c.length <= 900)).toBe(true);
    // Uzun süredir açık '[' (yer tutucu değil) parçayı ERKEN kesmez: son boşluktan kesilir (eski kural), küçük parça doğmaz.
    const mid = `giris metni burada [${"kelime ".repeat(300)}`;
    expect(chunkText(mid)[0].length).toBeGreaterThan(800);
  });
});

describe("F2 — isabetsiz soru, öbür sorunun isabeti yüzünden legacy'nin vereceği cevabı kaybetmez (seçenek noHitFill)", () => {
  // Cevap kalemi EN YENİ (legacy'nin en yeni-30 kümesinde); soruyla sözcük paylaşmıyor (parafraz).
  const items = () => {
    const base = Date.UTC(2026, 0, 1);
    let k = 0;
    const m = (id: string, category: string, title: string, content: string) => ({ id, category, title, content, updatedAt: new Date(base - (k++) * 60_000) });
    return [
      m("kis_sporu", "general", "Kış sporu ekipmanı", "Bodrumdaki kilitli odada kış sporu ekipmanları için askılar bulunur; oda anahtarı kapı yanındaki kutudadır."),
      m("wifi", "wifi", "Wifi", "Ağ adı LaleNet, şifre lale2024."),
      ...Array.from({ length: 34 }, (_, i) => m(`pad_${i}`, "general", `Qzx ${i}`, `Qzxw vbnm plkj ${i}.`)),
    ];
  };
  const TWO = "Wifi şifresi ne? Kayak takımımı nereye koyabilirim?";
  const has = (r: { items: { id: string }[] }) => r.items.some((i) => i.id === "kis_sporu");

  it("KONTROL — tek soru: geri çekilme, cevap blokta", () => {
    const r = selectKbForPrompt({ items: items(), guestMessage: "Kayak takımımı nereye koyabilirim?", mode: "hybrid", now: T0 });
    expect(r.evidence?.fb).toBe("no_lexical_hits");
    expect(has(r)).toBe(true);
  });

  it("🚨 iki soru tek mesajda: seçenek açıkken isabetsiz soru en yeni kalemlerden payını alır, cevap blokta", () => {
    expect(has(selectKbForPrompt({ items: items(), guestMessage: TWO, mode: "hybrid", now: T0 }))).toBe(false); // bugünkü kusur
    const r = selectKbForPrompt({ items: items(), guestMessage: TWO, mode: "hybrid", now: T0, strategy: { noHitFill: true } });
    expect(has(r)).toBe(true);
    expect(r.items.some((i) => i.id === "wifi")).toBe(true);
  });

  it("🚨 önceki cevapsız mesaj + soru: seçenek açıkken cevap blokta", () => {
    const history = [
      { direction: "outbound" as const, body: "Hoş geldiniz!" },
      { direction: "inbound" as const, body: "Wifi şifresi ne?" },
      { direction: "inbound" as const, body: "Kayak takımımı nereye koyabilirim?" },
    ];
    const r = selectKbForPrompt({ items: items(), guestMessage: "Kayak takımımı nereye koyabilirim?", history, mode: "hybrid", now: T0, strategy: { noHitFill: true } });
    expect(has(r)).toBe(true);
  });

  it("KONTROL — dolgu yalnız ÖZGÜN soruya: isabetsiz ek sorgu (anlama katmanı) legacy listesi almaz", () => {
    const msg = "Wifi şifresi ne?";
    const base = selectKbForPrompt({ items: items(), guestMessage: msg, mode: "hybrid", now: T0, strategy: { noHitFill: true } }).items.map((i) => i.id);
    __resetKbIndexCache();
    const withExtra = selectKbForPrompt({
      items: items(),
      guestMessage: msg,
      mode: "hybrid",
      now: T0,
      strategy: { noHitFill: true },
      extraQueries: [{ text: "zzqx vvqk", turkish: true, request: 0 }],
    }).items.map((i) => i.id);
    expect(withExtra).toEqual(base);
  });

  it("KONTROL — her soru isabet alıyorsa seçenek sonucu DEĞİŞTİRMEZ", () => {
    const msg = "Wifi şifresi ne? Kış sporu ekipmanı nerede?";
    const off = selectKbForPrompt({ items: items(), guestMessage: msg, mode: "hybrid", now: T0 }).items.map((i) => i.id);
    __resetKbIndexCache();
    const on = selectKbForPrompt({ items: items(), guestMessage: msg, mode: "hybrid", now: T0, strategy: { noHitFill: true } }).items.map((i) => i.id);
    expect(on).toEqual(off);
  });
});
