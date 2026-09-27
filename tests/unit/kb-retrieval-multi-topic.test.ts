import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { selectKbForPrompt, splitQuestions, MAX_SUBQUERIES } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { kbForStayScope } from "@/lib/guest-chat";
import { neutralPadding } from "../helpers/kb-padding";

// ---------------------------------------------------------------------------
// #208 ÇOK KONULU MESAJ (kurucu 09-27: "Havlu/çarşaf/yastık/battaniye + Wi‑Fi: Mesajın iki konusunu da aramalı. Wi‑Fi bilgisini
// bulması, onu rezervasyonsuz misafire açıklayabileceği anlamına gelmez; sır filtresi korunmalı."). Hata ayıklama ajanı ölçtü (A5 F3):
// virgüllü liste dört alt sorgu yuvasını doldurup ARKADAN gelen Wi-Fi sorusunu hiç sorgulatmıyordu; V01'de ilk sorunun üç cümleciği
// çamaşır ipi sorusunu tavanın dışına itiyordu (B6). Artık yuvalar soru bölümleri (?, satır, ;) arasında sırayla, EŞİT dağıtılır;
// bölüm içinde cümlecikler yazıldığı sırayla alınır (sezgisel "soru cümleciği önce" ölçülüp REDDEDİLDİ — bağlam cümleciğini düşürdü).
// ---------------------------------------------------------------------------

const TOWELS_WIFI = "Temiz havlu, yedek çarşaf, ek yastık ve kalın battaniye nerede? Wifi şifresi ne?";
const V01 =
  "Arabayla uğraşmak istemiyoruz, limandaki o küçük dükkâna evden yürümek ne kadar sürer ve gün içinde açık mı olur? " +
  "Ayrıca Denizden getirdiğimiz çarşafları dışarıda asmak daha rahat olur, binanın dış kısmında kıyafetleri gererek asabileceğimiz sabit bir yer var mı?";

describe("alt sorgu yuvaları: her soru bölümü en az bir yuva", () => {
  it("🚨 virgüllü liste arkadan gelen soruyu yuvadan atmaz (Wi-Fi sorgulanır)", () => {
    const q = splitQuestions(TOWELS_WIFI);
    expect(q).toHaveLength(MAX_SUBQUERIES);
    expect(q).toContain("wifi sifresi ne");
    // Aynı mesaj ters sırada da iki konuyu taşır.
    expect(splitQuestions("Wifi şifresi ne? Temiz havlu, yedek çarşaf, ek yastık ve kalın battaniye nerede?")).toContain("wifi sifresi ne");
  });

  it("🚨 yuvalar sorular arasında EŞİT dağıtılır (V01: iki soru ikişer yuva; çamaşır ipi sorusu dahil)", () => {
    expect(splitQuestions(V01)).toEqual([
      "arabayla ugrasmak istemiyoruz",
      "limandaki o kucuk dukkâna evden yurumek ne kadar surer",
      "denizden getirdigimiz carsaflari disarida asmak daha rahat olur",
      "binanin dis kisminda kiyafetleri gererek asabilecegimiz sabit bir yer var mi",
    ]);
  });

  it("🚨 bölüm içinde cümlecikler yazıldığı sırayla alınır: bağlam cümleciği ('dört kişi geleceğiz') soru cümleciği uğruna düşmez", () => {
    const q = splitQuestions(
      "Hafta sonu çok soğuk olacak gibi, ortamı ısıtmak için kumandada hangi seçeneği açalım?\n" +
        "Dört kişi geleceğiz, kaç tane kurulama bezi hazırlanmış olacak ve uzun kalırsak ne zaman yenilenir?",
    );
    expect(q).toEqual([
      "hafta sonu cok soguk olacak gibi",
      "ortami isitmak icin kumandada hangi secenegi acalim",
      "dort kisi gelecegiz",
      "kac tane kurulama bezi hazirlanmis olacak",
    ]);
  });

  it("eşit pay: kısa soru fazla yuvayı bırakır, uzun soru alır (1 + 3); beşinci bölüm tavanın dışında kalır", () => {
    expect(splitQuestions("Wifi şifresi ne? Havlu, çarşaf, yastık, battaniye nerede?")).toEqual([
      "wifi sifresi ne",
      "havlu",
      "carsaf",
      "yastik",
    ]);
    expect(splitQuestions("Wifi? Otopark? Havuz? Sauna? Kahvaltı?")).toEqual(["wifi", "otopark", "havuz", "sauna"]);
  });

  it("KONTROL — tavan aşılmıyorsa parçalar ve sıraları eski bölücüyle BİREBİR", () => {
    expect(splitQuestions("Wifi şifresi ne, otopark var mı?")).toEqual(["wifi sifresi ne", "otopark var mi"]);
    expect(splitQuestions("Havuz saat kaçta açılıyor? Otopark ücretli mi; kahvaltı var mı")).toEqual([
      "havuz saat kacta aciliyor",
      "otopark ucretli mi",
      "kahvalti var mi",
    ]);
    expect(splitQuestions("Merhaba")).toEqual([]);
  });

  it("KONTROL — tek bölümde soru biçimi yoksa ilk dört parça (eski davranış)", () => {
    expect(splitQuestions("Kahvaltı, havuz, otopark, spor salonu, sauna")).toEqual(["kahvalti", "havuz", "otopark", "spor salonu"]);
  });
});

describe("uçtan uca seçim + sır filtresi", () => {
  const T0 = Date.UTC(2026, 0, 1);
  const kb = [
    { id: "towels", category: "amenities", title: "Havlular", content: "Temiz havlular ve yedek çarşaflar yatak odasındaki dolabın alt rafında.", updatedAt: new Date(T0) },
    { id: "pillows", category: "amenities", title: "Yastık ve battaniye", content: "Ek yastık ve kalın battaniye koridordaki dolaptadır.", updatedAt: new Date(T0 - 1) },
    { id: "wifi", category: "wifi", title: "Wifi", content: "Wifi ağı LaleNet, şifresi karttadır: Q7x!2mPz.", updatedAt: new Date(T0 - 2) },
    ...neutralPadding(40, T0 - 3),
  ];
  beforeEach(() => {
    __resetKbIndexCache();
    vi.stubEnv("KB_RETRIEVAL_MODE", "");
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "");
    vi.stubEnv("KB_RERANK_ENABLED", "");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 onaylı konaklamada iki konu da seçilir (havlu/battaniye VE Wi-Fi)", () => {
    const items = kbForStayScope(kb, { status: "confirmed" });
    const r = selectKbForPrompt({ items, guestMessage: TOWELS_WIFI, now: T0 });
    const ids = new Set(r.items.map((i) => i.id));
    expect(ids.has("wifi")).toBe(true);
    expect(ids.has("towels") || ids.has("pillows")).toBe(true);
  });

  it("🚨 sır filtresi korunur: rezervasyonsuz konuşmada Wi-Fi şifresi seçime HİÇ ulaşmaz; havlu konusu yine seçilir", () => {
    const items = kbForStayScope(kb, null);
    expect(items.some((i) => i.id === "wifi")).toBe(false);
    const r = selectKbForPrompt({ items, guestMessage: TOWELS_WIFI, now: T0 });
    expect(r.items.some((i) => i.content.includes("Q7x!2mPz"))).toBe(false);
    expect(r.items.some((i) => i.id === "towels" || i.id === "pillows")).toBe(true);
  });
});

describe("tekrar eden ek sorgu: karar yeniden sıralamadan ÖNCE, tek ortak baş aday yetmez (A6 #1 + B5)", () => {
  const T0 = Date.UTC(2026, 0, 1);
  const item = (id: string, title: string, content: string, age: number) => ({ id, category: "general", title, content, updatedAt: new Date(T0 - age) });
  const items = [
    item("X", "Wi-Fi", "Wi-Fi şifresi lale2024. Modem çamaşır makinesinin üstündeki raftadır.", 1000),
    item("Y", "Çamaşır makinesi", "Çamaşır makinesi kullanımı: 40 derece programını seçin, deterjan lavabonun altındadır.", 2000),
    item("Z", "Klima", "Klima kumandası komodinin çekmecesindedir.", 3000),
    ...neutralPadding(40, T0),
  ];
  const guestMessage = "Wifi şifresi nedir? Bir de dün bahsettiğim cihazı nasıl açarım?";
  const history = [
    { direction: "inbound" as const, body: "Merhaba, iyi akşamlar." },
    { direction: "outbound" as const, body: "Hoş geldiniz!" },
    { direction: "inbound" as const, body: guestMessage },
  ];
  const extraQueries = [
    { text: "wifi şifresi", turkish: true, request: 0 },
    { text: "çamaşır makinesi nasıl çalıştırılır", turkish: true, request: 1 },
  ];
  const run = (rerankScores?: Map<string, number>) => {
    __resetKbIndexCache();
    return selectKbForPrompt({ items, guestMessage, history, extraQueries, mode: "hybrid", now: T0, ...(rerankScores ? { rerankScores } : {}) }).items.map((i) => i.id);
  };
  beforeEach(() => {
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "");
    vi.stubEnv("KB_RERANK_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 yeniden sıralayıcının wifi kalemine verdiği işaret makine sorusunun listesini DÜŞÜRMEZ", () => {
    expect(run()).toContain("Y");
    expect(run(new Map([["X#0", 3]]))).toContain("Y");
    expect(run(new Map([["X#0", 3], ["Y#0", 2]]))).toContain("Y");
  });

  it("KONTROL — gerçekten aynı konuyu tekrar eden ek sorgu ('wifi şifresi') yine pay almaz; wifi kalemi seçilir", () => {
    const ids = run(new Map([["X#0", 3]]));
    expect(ids).toContain("X");
    expect(ids).not.toContain("Z");
  });
});

