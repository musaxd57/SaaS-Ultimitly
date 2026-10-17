import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// BİLGİ TABANI ATFI → KATEGORİ ETİKETİ (10-01 öğlen, karar 23 kör doğrulaması). İstem kalemleri "- [FAQ] Klima: …" satırıyla gösterir ve
// "kb:<kategori>" ister; modeller kalemi çoğu zaman BAŞLIĞIYLA gösteriyor. Teşhis koşusu (set 4, 5.1, dört doğru tarif): beyan
// "kb:klima" ve "kb:FAQ_Televizyon_ve_kumanda" — doğrulama yalnız harfi harfine kategori adını kabul ettiği için dördünde de beyan 1,
// doğrulanan 0 → arıza tarifi "kaynaksız" sayılıp tutuluyordu (items_fix_unverified). Gerçek kaleme denk gelen atıf o kalemin
// kategorisine iner; uydurma atıf yine DÜŞER.
// ---------------------------------------------------------------------------

function openAiReturns(usedSources: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    intent: "general",
                    confidence: 0.9,
                    reply: "Kumandadaki MODE tuşuna basıp COOL seçin.",
                    risk: null,
                    priority: "standard",
                    actionSuggestion: null,
                    riskLevel: "none",
                    detectedLanguage: "tr",
                    riskType: null,
                    missingInfo: [],
                    statedCheckoutTime: null,
                    usedSources,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    ),
  );
}

const KB = [
  { category: "faq", title: "Klima", content: "Klima soğutmuyorsa MODE tuşuna basıp COOL seçin." },
  { category: "faq", title: "Televizyon ve kumanda", content: "Sinyal yoksa SOURCE tuşuna basıp HDMI 2'yi seçin." },
  { category: "wifi", title: "İnternet yoksa: modemi yeniden başlatma ve ışıkların anlamı", content: "Modemi kapatıp 30 saniye bekleyin." },
  { category: "faq", title: "Çamaşır makinesi", content: "Program bitince kapak 2 dakika kilitli kalır." },
  { category: "general", title: "TV", content: "Kumandanın kırmızı tuşu." },
];

function input(): SuggestReplyInput {
  return {
    guestMessage: "Klima sıcak üflüyor.",
    property: { name: "Lale 7", checkInTime: "15:00", checkOutTime: "11:00" },
    knowledgeBase: KB,
    reservation: null,
    history: [],
    tone: "warm",
    language: "tr",
  } as SuggestReplyInput;
}

async function verified(usedSources: string[]) {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  openAiReturns(usedSources);
  const r = await suggestReply(input());
  expect(r.source).toBe("openai");
  return { used: r.usedSources, audit: r.sourceAudit };
}

describe("bilgi tabanı atfı kalemin KATEGORİSİNE iner (gerçek kaleme denk gelirse)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("🚨 teşhis koşusunun gerçek beyanları: kalem başlığı ve 'KATEGORİ_başlık' biçimi doğrulanır", async () => {
    expect((await verified(["kb:klima"])).used).toEqual(["kb:faq"]);
    expect((await verified(["kb:FAQ_Televizyon_ve_kumanda"])).used).toEqual(["kb:faq"]);
  });

  it("büyük harfli kategori ('[FAQ]' satırından kopya), boşluklu / noktalamalı başlık, büyük harfli önek", async () => {
    expect((await verified(["kb:FAQ"])).used).toEqual(["kb:faq"]);
    expect((await verified(["kb:Televizyon ve kumanda"])).used).toEqual(["kb:faq"]);
    expect((await verified(["KB:wifi"])).used).toEqual(["kb:wifi"]);
  });

  it("KONTROL: tam kategori adı aynen; aynı kaleme iki biçimde atıf tek etiket (beyan 2, doğrulanan 1)", async () => {
    expect((await verified(["kb:wifi"])).used).toEqual(["kb:wifi"]);
    const twice = await verified(["kb:klima", "kb:faq"]);
    expect(twice.used).toEqual(["kb:faq"]);
    expect(twice.audit).toEqual({ declared: 2, verified: 1 });
  });

  it("60 karakter tavanında kesilmiş uzun başlık atfı da kaleme iner (başlıkla ortak ayırt edici sözcük)", async () => {
    const long = `kb:${KB[2].title}`.slice(0, 60);
    expect(long.length).toBe(60);
    expect((await verified([long])).used).toEqual(["kb:wifi"]);
  });

  it("ikinci teşhis koşusunun beyanları (5.1): kategori önekli kısa etiket ve başlıkla ortak ayırt edici sözcük", async () => {
    expect((await verified(["kb:FAQ_tv_remote"])).used).toEqual(["kb:faq"]);
    expect((await verified(["kb:internet_restart"])).used).toEqual(["kb:wifi"]);
    expect((await verified(["kb:kumanda"])).used).toEqual(["kb:faq"]);
  });

  it("kısa başlık yalnız BİREBİR eşleşir (ortak sözcük kuralı ≥5 harf ister): 'kb:tv' → TV kalemi", async () => {
    expect((await verified(["kb:tv"])).used).toEqual(["kb:general"]);
  });

  it("🚨 uydurma atıf yine DÜŞER: isteme girmeyen konu, olmayan kategori, yalnız genel sözcük", async () => {
    // "makinesi" GENEL sözcüktür: "Çamaşır makinesi" kalemi varken "kb:kahve_makinesi" kahve kalemi diye doğrulanmaz.
    expect((await verified(["kb:kahve_makinesi"])).used).toEqual([]);
    expect((await verified(["kb:jacuzzi_reset"])).used).toEqual([]);
    expect((await verified(["kb:parking"])).used).toEqual([]);
    expect((await verified(["kb:Kahve makinesi tamiri"])).used).toEqual([]);
    expect((await verified(["kb:machine_troubleshooting"])).used).toEqual([]);
    expect((await verified(["kb:"])).used).toEqual([]);
  });

  it("KONTROL: bilgi tabanı dışındaki beyanlar eski kuralla (gerçek mülk alanı kalır, uydurma alan düşer)", async () => {
    expect((await verified(["property:checkInTime", "property:door_code", "kb:klima"])).used).toEqual(["property:checkInTime", "kb:faq"]);
  });
});
