import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { STYLE_PROFILE_MARKER, isCurrentStyleProfile, markStyleProfile, styleProfileBody } from "@/lib/ai/style-profile";
import { styleProfileForPrompt } from "@/lib/guest-chat";
import { buildReplyPrompt } from "@/lib/ai/prompts";
import { auditClaims } from "@/lib/ai/claim-support";
import { summarizeHostStyle } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// F13 (Codex denetimi 09-05, düzeltme 09-26): ÜSLUP PROFİLİ OLGU KAYNAĞI DEĞİLDİR.
//
// Profil org genelindeki son 40 host cevabından damıtılıyordu ve eski özetleyici bir "SIK SORULAN SORULAR" bölümü
// yazıyordu (otopark, bagaj, ulaşım, erken giriş / geç çıkış yaklaşımı). Cevap istemi "Bilgi Tabanı'nda yoksa bu
// bölümü temel al" diyordu → A dairesinin otopark cevabı B dairesinin misafirine OLGU diye gidebiliyordu (mülk kapsamı
// yok, sürüm yok, bilgi tabanının onay kapısı yan kapıdan atlanıyor). İddia desteği ölçümü de profili "dayanak"
// sayıyordu → böyle bir uydurma "destekli" görünüyordu.
// ---------------------------------------------------------------------------

const V2 = markStyleProfile("- Kısa ve samimi yazar\n- Mesajı 'Sevgiler' ile kapatır");
const LEGACY = "1) TARZ: kısa ve samimi.\n2) SIK SORULAN SORULAR:\n- Otopark: bina önünde ücretsiz.\n- Bagaj: 14:00'e kadar bırakılabilir.";

describe("üslup profili sürümü (saf)", () => {
  it("güncel profil: işaret İLK satır, gövde işaretsiz döner", () => {
    expect(V2.startsWith(`${STYLE_PROFILE_MARKER}\n`)).toBe(true);
    expect(isCurrentStyleProfile(V2)).toBe(true);
    expect(styleProfileBody(V2)).toBe("- Kısa ve samimi yazar\n- Mesajı 'Sevgiler' ile kapatır");
  });

  it("🚨 eski (işaretsiz) profil isteme GİRMEZ — içinde org genelinden damıtılmış olgu olabilir", () => {
    expect(isCurrentStyleProfile(LEGACY)).toBe(false);
    expect(styleProfileBody(LEGACY)).toBeNull();
  });

  it("işaret ilk satırda değilse, satırın kendisi değilse ya da gövde boşsa null; boş değerler null", () => {
    expect(styleProfileBody(`Önsöz\n${STYLE_PROFILE_MARKER}\n- Kısa yazar`)).toBeNull();
    expect(styleProfileBody(`${STYLE_PROFILE_MARKER} ek\n- Kısa yazar`)).toBeNull();
    expect(styleProfileBody(`${STYLE_PROFILE_MARKER}\n   \n`)).toBeNull();
    expect(styleProfileBody(null)).toBeNull();
    expect(styleProfileBody(undefined)).toBeNull();
    expect(styleProfileBody("")).toBeNull();
  });
});

describe("dört yüzeyin tek girişi `styleProfileForPrompt`: sürüm kuralı + sır süzgeci", () => {
  it("eski profil → null (hiçbir isteme girmez)", () => {
    expect(styleProfileForPrompt(LEGACY)).toBeNull();
  });

  it("güncel profil → gövde; işaret satırı isteme GİRMEZ; sır satırı yine süzülür, üslup satırı kalır", () => {
    const out = styleProfileForPrompt(markStyleProfile("- Kısa yazar\n- Kapı kodu: 4590\n- Siz diye hitap eder"));
    expect(out).not.toContain(STYLE_PROFILE_MARKER);
    expect(out).not.toContain("4590");
    expect(out).toContain("- Kısa yazar");
    expect(out).toContain("Siz diye hitap eder");
  });
});

const input: SuggestReplyInput = {
  guestMessage: "Otopark var mı?",
  property: { name: "Lale Suites", checkInTime: "15:00", checkOutTime: "11:00" },
  reservation: null,
  knowledgeBase: [{ category: "wifi", title: "Wi-Fi", content: "Ağ: LaleNet" }],
  history: [],
  tone: "warm",
  language: "tr",
};

describe("cevap istemi: rehber YALNIZ üsluptur", () => {
  const withGuide = buildReplyPrompt({ ...input, styleProfile: "- Kısa yazar\n- Otopark ücreti 150 TL" });

  it("🚨 rehberdeki bilgi cevaba temel yapılmaz: 'sık sorulan sorular' talimatı yok, rehber açıkça bilgi kaynağı değil", () => {
    expect(withGuide.text).toContain("EV SAHİBİ REHBERİ");
    expect(withGuide.text).not.toMatch(/sık sorulan sorular/i);
    expect(withGuide.text).not.toMatch(/o cevabı temel alarak yanıtla/i);
    expect(withGuide.text).toMatch(/BİLGİ KAYNAĞI DEĞİLDİR/);
    // Üslup yine uygulanır ve rehber yine istemde (tonu taşır).
    expect(withGuide.text).toContain("Otopark ücreti 150 TL");
  });

  it("🚨 iddia desteği: YALNIZ rehberde geçen tutar desteksizdir (profil dayanak DEĞİL); bilgi tabanındaki destekli", () => {
    const fromGuide = auditClaims("Otopark ücreti 150 TL.", withGuide.claimContext);
    expect(fromGuide.u).toBeGreaterThan(0);
    const kbBacked = buildReplyPrompt({
      ...input,
      styleProfile: "- Kısa yazar",
      knowledgeBase: [{ category: "parking", title: "Otopark", content: "Otopark ücreti 150 TL." }],
    });
    expect(auditClaims("Otopark ücreti 150 TL.", kbBacked.claimContext).u).toBe(0);
  });
});

describe("Ayarlar ekranı: yapay zekânın GERÇEKTEN kullandığı gövde gösterilir (kaynak pini)", () => {
  it("eski profil ekranda da 'öğrendiğim' diye gösterilmez; işaret satırı görünmez", () => {
    const src = readFileSync("src/app/(app)/settings/page.tsx", "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    expect(src.length, "yorum soyma dosyayı boşaltmış").toBeGreaterThan(5000);
    expect(src).toMatch(/styleProfile=\{styleProfileBody\(org\?\.aiStyleProfile\)\}/);
    expect(src).not.toMatch(/styleProfile=\{org\?\.aiStyleProfile\}/);
  });
});

describe("özetleyici: yalnız üslup ister, bilgi istemez", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("🚨 'SIK SORULAN SORULAR' bölümü istenmez; tesis bilgisi/ücret/izin yaklaşımı açıkça dışarıda", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-style-profile-0000000000");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "- Kısa yazar" } }] }), { status: 200 }),
    );
    const out = await summarizeHostStyle(["Merhaba!", "Tabii ki.", "Rica ederim 😊", "İyi tatiller!", "Görüşmek üzere."]);
    expect(out).toBe("- Kısa yazar");
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as { messages: { role: string; content: string }[] };
    const system = body.messages.find((m) => m.role === "system")!.content;
    expect(system).not.toMatch(/SIK SORULAN SORULAR/i);
    expect(system).toMatch(/YALNIZ/);
    for (const word of ["otopark", "ücret", "erken giriş"]) expect(system.toLocaleLowerCase("tr"), word).toContain(word);
    expect(system).toMatch(/BİLGİ YAZMA/);
  });
});
