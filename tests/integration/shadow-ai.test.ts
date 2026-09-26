import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { recordShadowVerdict, parseShadowVerdict, shadowAiEnabled, shadowModel } from "@/lib/shadow-ai";

// Gölge Aşama-1 sözleşmeleri: default KAPALI · karar yetkisi SIFIR (asla
// fırlatmaz, dönüşü kullanılmaz) · hüküm kapalı sete clamp'lenir · mesaj gövdesi
// modele gider ama tabloya ASLA yazılmaz · pilot tavanı dolunca sessizce durur ·
// aynı mesajın ikinci gölgesi dedupe ile düşer.

const GUEST_MSG = "Klima çalışmıyor ve paramı geri istiyorum, yoksa kötü yorum yazacağım!";

function modelResponse(body: unknown) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: typeof body === "string" ? body : JSON.stringify(body) } }] }),
    { status: 200 },
  );
}

async function seedOrg() {
  return prisma.organization.create({ data: { name: "Gölge Org" } });
}

describe("recordShadowVerdict — gölge Aşama-1", () => {
  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
    vi.stubEnv("SHADOW_AI_ENABLED", "1");
    vi.stubEnv("SHADOW_AI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("DEFAULT KAPALI: flag yokken ne API çağrısı ne satır", async () => {
    vi.stubEnv("SHADOW_AI_ENABLED", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(shadowAiEnabled()).toBe(false);
    const org = await seedOrg();
    await recordShadowVerdict({
      organizationId: org.id, triggerId: "m1", guestMessage: GUEST_MSG, gateDecision: "auto_sent",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.shadowVerdict.count()).toBe(0);
  });

  it("başarılı hüküm: satır clamp'li yazılır, mesaj MODELE gider ama TABLOYA yazılmaz", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => modelResponse({ verdict: "escalate", riskType: "money_refund", confidence: 0.92 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const org = await seedOrg();
    await recordShadowVerdict({
      organizationId: org.id,
      conversationId: "c1",
      triggerId: "m1",
      guestMessage: GUEST_MSG,
      gateDecision: "human_review",
      gateRiskLevel: "high",
      gateRiskType: "money_refund",
    });

    // Modele giden istek misafir mesajını içeriyor (sınıflandırma girdisi).
    const sentBody = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(sentBody).toContain("paramı geri istiyorum");

    const row = await prisma.shadowVerdict.findFirstOrThrow();
    expect(row.verdict).toBe("escalate");
    expect(row.riskType).toBe("money_refund");
    expect(row.confidence).toBeCloseTo(0.92);
    expect(row.agrees).toBe(true); // kapı insana verdi, gölge de escalate dedi
    expect(row.error).toBeNull();
    expect(row.model).toBe(shadowModel());
    // KVKK: satırın HİÇBİR alanında misafir metni yok.
    expect(JSON.stringify(row)).not.toContain("paramı geri");
  });

  it("ayrışma yönü: kapı GÖNDERDİ + gölge escalate → agrees=false (gölge daha sıkı)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelResponse({ verdict: "escalate", riskType: "complaint", confidence: 0.8 })));
    const org = await seedOrg();
    await recordShadowVerdict({
      organizationId: org.id, triggerId: "m2", guestMessage: "Wifi şifresi?", gateDecision: "auto_sent",
    });
    const row = await prisma.shadowVerdict.findFirstOrThrow();
    expect(row.agrees).toBe(false);
    expect(row.gateDecision).toBe("auto_sent");
  });

  it("API hatasında ASLA fırlatmaz: satır verdict=NULL + redakte error ile yazılır", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED api.openai.com"); }));
    const org = await seedOrg();
    await expect(
      recordShadowVerdict({ organizationId: org.id, triggerId: "m3", guestMessage: "x", gateDecision: "auto_sent" }),
    ).resolves.toBeUndefined();
    const row = await prisma.shadowVerdict.findFirstOrThrow();
    expect(row.verdict).toBeNull();
    expect(row.agrees).toBeNull();
    expect(row.error).toContain("ECONNREFUSED");
  });

  it("çözümlenemeyen model çıktısı: verdict=NULL + unparseable_verdict", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelResponse("Elbette! Bu mesaj güvenli görünüyor.")));
    const org = await seedOrg();
    await recordShadowVerdict({ organizationId: org.id, triggerId: "m4", guestMessage: "x", gateDecision: "auto_sent" });
    const row = await prisma.shadowVerdict.findFirstOrThrow();
    expect(row.verdict).toBeNull();
    expect(row.error).toContain("unparseable_verdict");
  });

  it("BOŞ YANIT teşhis edilebilir: finish_reason satıra yazılır (tavan tükendi mi?)", async () => {
    // Reasoning modelinde gizli düşünme tavanı tüketirse content BOŞ döner. Bu
    // ayrım kaydedilmezse operatör kartta yalnız "arıza" görür ve sebebin token
    // tükenmesi olduğunu anlayamaz — pilot sessizce ölür.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] }),
      { status: 200 },
    )));
    const org = await seedOrg();
    await recordShadowVerdict({ organizationId: org.id, triggerId: "f1", guestMessage: "x", gateDecision: "auto_sent" });
    const row = await prisma.shadowVerdict.findFirstOrThrow();
    expect(row.verdict).toBeNull();
    expect(row.error).toContain("finish=length");
  });

  it("pilot tavanı: cap dolunca yeni çağrı/satır YOK (sessiz durur)", async () => {
    vi.stubEnv("SHADOW_AI_SAMPLE_CAP", "1");
    const org = await seedOrg();
    await prisma.shadowVerdict.create({
      data: { organizationId: org.id, triggerId: "önceki", gateDecision: "auto_sent", model: shadowModel() },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await recordShadowVerdict({ organizationId: org.id, triggerId: "m5", guestMessage: "x", gateDecision: "auto_sent" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.shadowVerdict.count()).toBe(1);
  });

  it("dedupe CLAIM-FIRST (Codex #2): ikinci işleyiş modele HİÇ gitmez — tek fetch + tek satır", async () => {
    const fetchMock = vi.fn(async () => modelResponse({ verdict: "allow", riskType: "none", confidence: 0.9 }));
    vi.stubGlobal("fetch", fetchMock);
    const org = await seedOrg();
    const input = { organizationId: org.id, triggerId: "m6", guestMessage: "Wifi?", gateDecision: "auto_sent" as const };
    await recordShadowVerdict(input);
    await recordShadowVerdict(input);
    expect(fetchMock).toHaveBeenCalledTimes(1); // çifte istek = çifte veri aktarımı YOK
    expect(await prisma.shadowVerdict.count()).toBe(1);
  });

  it("HTTPS zorunlu (Codex #4): http base URL → modül pasif (ne çağrı ne satır)", async () => {
    vi.stubEnv("SHADOW_AI_BASE_URL", "http://api.openai.com/v1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(shadowAiEnabled()).toBe(false);
    const org = await seedOrg();
    await recordShadowVerdict({ organizationId: org.id, triggerId: "m7", guestMessage: "x", gateDecision: "auto_sent" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.shadowVerdict.count()).toBe(0);
  });

  it("org allowlist'i (Codex): SHADOW_AI_ORG_IDS set ise liste dışı org gölgelenmez", async () => {
    vi.stubEnv("SHADOW_AI_ORG_IDS", "baska-org-id");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const org = await seedOrg();
    await recordShadowVerdict({ organizationId: org.id, triggerId: "m8", guestMessage: "x", gateDecision: "auto_sent" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.shadowVerdict.count()).toBe(0);

    // Listedeki org normal gölgelenir.
    vi.stubEnv("SHADOW_AI_ORG_IDS", `baska-org-id, ${org.id}`);
    vi.stubGlobal("fetch", vi.fn(async () => modelResponse({ verdict: "allow", riskType: "none", confidence: 0.9 })));
    await recordShadowVerdict({ organizationId: org.id, triggerId: "m8", guestMessage: "x", gateDecision: "auto_sent" });
    expect(await prisma.shadowVerdict.count()).toBe(1);
  });

  it("VERİ MİNİMİZASYONU (Codex): telefon/e-posta/ad modele HAM gitmez — placeholder gider, risk kelimeleri kalır", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => modelResponse({ verdict: "escalate", riskType: "money_refund", confidence: 0.9 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const org = await seedOrg();
    await recordShadowVerdict({
      organizationId: org.id,
      triggerId: "m10",
      guestMessage:
        "Ben Yılmaz Kayahan, paramı geri istiyorum! Beni 0532 123 45 67 numarasından veya yilmaz.k@example.com adresinden arayın.",
      guestName: "Yılmaz Kayahan",
      gateDecision: "human_review",
    });
    const sentBody = String(fetchMock.mock.calls[0]?.[1]?.body);
    // Ham tanımlayıcılar fetch gövdesinde YOK…
    expect(sentBody).not.toContain("0532 123 45 67");
    expect(sentBody).not.toContain("yilmaz.k@example.com");
    expect(sentBody).not.toContain("Yılmaz");
    // …placeholder'lar VAR ve risk anlamı bozulmadı.
    expect(sentBody).toContain("[PHONE]");
    expect(sentBody).toContain("[EMAIL]");
    expect(sentBody).toContain("[Misafir]");
    expect(sentBody).toContain("paramı geri istiyorum");
  });

  it("VERİ MİNİMİZASYONU (audit): guestIdentifier placeholder olsa bile rezervasyonun GERÇEK adı redakte edilir", async () => {
    // The identifier is a placeholder ("Rezervasyon 42") but the message names the
    // real booking guest — the reservation's real name must be redacted too, else
    // it egresses un-redacted (parity with quality-audit / the fix).
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => modelResponse({ verdict: "escalate", riskType: "complaint", confidence: 0.9 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const org = await seedOrg();
    await recordShadowVerdict({
      organizationId: org.id,
      triggerId: "m11",
      guestMessage: "Ben Ada Lovelace, dairede gürültü çok fazla.",
      guestName: "Rezervasyon 42", // placeholder identifier — drops to [Misafir]
      reservationGuestName: "Ada Lovelace", // the REAL booking name
      gateDecision: "human_review",
    });
    const sentBody = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(sentBody).not.toContain("Ada Lovelace"); // real name redacted
    expect(sentBody).not.toContain("Ada");
    expect(sentBody).toContain("gürültü"); // risk meaning preserved
  });

  it("STALE PENDING (Codex): yarım kalan claim satırı KÖR RETRY tetiklemez, 'pending' olarak görünür kalır", async () => {
    const org = await seedOrg();
    // Simüle çökme: claim yazılmış, hüküm hiç gelmemiş.
    await prisma.shadowVerdict.create({
      data: { organizationId: org.id, triggerId: "m11", gateDecision: "auto_sent", model: "x", error: "pending" },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await recordShadowVerdict({ organizationId: org.id, triggerId: "m11", guestMessage: "x", gateDecision: "auto_sent" });
    expect(fetchMock).not.toHaveBeenCalled(); // dedupe: aynı mesaj yeniden modele gitmez
    const row = await prisma.shadowVerdict.findFirstOrThrow({ where: { triggerId: "m11" } });
    expect(row.error).toBe("pending"); // sessizce silinmez/değişmez — kartta "yarım" görünür
    expect(row.verdict).toBeNull();
  });

  it("GÖVDE HAZIRLIĞI PATLARSA satır 'pending' kalmaz — arıza yazılır (sessiz ölüm yok)", async () => {
    // İstek gövdesi (redaksiyon + serileştirme) claim'den SONRA hazırlanıyor.
    // Orada bir hata dış catch'e kaçarsa satır sonsuza kadar "yarım" görünür ve
    // dedupe yüzünden bir daha asla denenmez — arıza tamamen görünmez olur.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const org = await seedOrg();
    await recordShadowVerdict({
      organizationId: org.id,
      triggerId: "p1",
      guestMessage: undefined as unknown as string, // bozuk girdi: redaksiyon zinciri patlar
      gateDecision: "auto_sent",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await prisma.shadowVerdict.findFirstOrThrow();
    expect(row.verdict).toBeNull();
    expect(row.error).not.toBe("pending"); // kartta "arıza" olarak görünür
    expect(row.error).toBeTruthy();
  });

  it("dev upstream gövdesi (Codex #4): byte tavanı aşımı belleğe alınmaz, satıra arıza yazılır", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(200_000), { status: 200 })));
    const org = await seedOrg();
    await recordShadowVerdict({ organizationId: org.id, triggerId: "m9", guestMessage: "x", gateDecision: "auto_sent" });
    const row = await prisma.shadowVerdict.findFirstOrThrow();
    expect(row.verdict).toBeNull();
    expect(row.error).toContain("response_too_large");
  });
});

// ---------------------------------------------------------------------------
// Model/endpoint sözleşmesi — gölge GPT-5.6 Luna'ya (OpenAI) taşındı.
// Eski GLM/Akash pilotu ancak operatör base URL + anahtarı AÇIKÇA verirse çalışır.
// ---------------------------------------------------------------------------
describe("gölge model/endpoint sözleşmesi — GPT-5.6 Luna (OpenAI)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
    vi.stubEnv("SHADOW_AI_ENABLED", "1");
    vi.stubEnv("SHADOW_AI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function okFetch() {
    return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => modelResponse({ verdict: "allow", riskType: "none", confidence: 0.9 }),
    );
  }

  it("VARSAYILAN endpoint OpenAI + model Luna (Akash/GLM varsayılanı kaldırıldı)", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const org = await seedOrg();
    await recordShadowVerdict({ organizationId: org.id, triggerId: "d1", guestMessage: "Wifi?", gateDecision: "auto_sent" });

    expect(shadowModel()).toBe("gpt-5.6-luna");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.model).toBe("gpt-5.6-luna");
    const row = await prisma.shadowVerdict.findFirstOrThrow();
    expect(row.model).toBe("gpt-5.6-luna");
  });

  it("REASONING GÖVDESİ: gpt-5 ailesine temperature/max_tokens/chat_template_kwargs GÖNDERİLMEZ", async () => {
    // 400 → tüm pilot arızaya döner: reasoning modelleri bu üç alanı reddeder.
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const org = await seedOrg();
    await recordShadowVerdict({ organizationId: org.id, triggerId: "d2", guestMessage: "Wifi?", gateDecision: "auto_sent" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("chat_template_kwargs");
    // Gizli düşünme token'ları da bu tavandan yendiği için 200 yetmez.
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(4000);
  });

  it("vLLM/GLM endpoint'i AÇIKÇA verilirse eski gövde korunur (temperature + max_tokens + thinking off)", async () => {
    vi.stubEnv("SHADOW_AI_BASE_URL", "https://api.akashml.com/v1");
    vi.stubEnv("SHADOW_AI_MODEL", "zai-org/GLM-5.2");
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const org = await seedOrg();
    await recordShadowVerdict({ organizationId: org.id, triggerId: "d3", guestMessage: "Wifi?", gateDecision: "auto_sent" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.akashml.com/v1/chat/completions");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(200);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body).not.toHaveProperty("max_completion_tokens");
  });

  it("ANAHTAR-SAĞLAYICI EŞLEŞMESİ: OPENAI_API_KEY yalnız OpenAI endpoint'inde devreye girer", async () => {
    vi.stubEnv("SHADOW_AI_API_KEY", ""); // gölgeye özel anahtar yok
    vi.stubEnv("OPENAI_API_KEY", "sk-ana-hesap-anahtari");

    // (a) Varsayılan endpoint OpenAI → ana anahtar kullanılabilir.
    expect(shadowAiEnabled()).toBe(true);
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const org = await seedOrg();
    await recordShadowVerdict({ organizationId: org.id, triggerId: "d4", guestMessage: "Wifi?", gateDecision: "auto_sent" });
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-ana-hesap-anahtari");

    // (b) Üçüncü taraf endpoint → ana hesabın anahtarı ORAYA ASLA gitmez; modül pasif.
    vi.stubEnv("SHADOW_AI_BASE_URL", "https://api.akashml.com/v1");
    const thirdParty = okFetch();
    vi.stubGlobal("fetch", thirdParty);
    expect(shadowAiEnabled()).toBe(false);
    await recordShadowVerdict({ organizationId: org.id, triggerId: "d5", guestMessage: "Wifi?", gateDecision: "auto_sent" });
    expect(thirdParty).not.toHaveBeenCalled();
    expect(await prisma.shadowVerdict.count({ where: { triggerId: "d5" } })).toBe(0);
  });

  it("ÖRNEKLEM TAVANI MODEL BAŞINA: eski GLM satırları yeni modelin pilotunu açılmadan bitirmez", async () => {
    vi.stubEnv("SHADOW_AI_SAMPLE_CAP", "1");
    const org = await seedOrg();
    // Eski pilotun (GLM) satırı — yeni modelin tavanını yememeli.
    await prisma.shadowVerdict.create({
      data: { organizationId: org.id, triggerId: "glm-eski", gateDecision: "auto_sent", model: "zai-org/GLM-5.2" },
    });
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await recordShadowVerdict({ organizationId: org.id, triggerId: "d6", guestMessage: "Wifi?", gateDecision: "auto_sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await prisma.shadowVerdict.count({ where: { model: "gpt-5.6-luna" } })).toBe(1);

    // …ama AYNI modelde tavan yine sert: ikinci mesaj çağrı üretmez.
    await recordShadowVerdict({ organizationId: org.id, triggerId: "d7", guestMessage: "Wifi?", gateDecision: "auto_sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await prisma.shadowVerdict.count({ where: { model: "gpt-5.6-luna" } })).toBe(1);
  });
});

describe("parseShadowVerdict — kapalı-set clamp", () => {
  it("bilinmeyen verdict/riskType/aralık-dışı güven → NULL (asla uydurma değer)", () => {
    expect(parseShadowVerdict('{"verdict":"nuke","riskType":"vibes","confidence":7}')).toEqual({
      verdict: null, riskType: null, confidence: null,
    });
    expect(parseShadowVerdict('önsöz {"verdict":"hold","riskType":"complaint","confidence":0.5} sonsöz')).toEqual({
      verdict: "hold", riskType: "complaint", confidence: 0.5,
    });
  });
});
