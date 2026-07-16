import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { recordShadowVerdict, parseShadowVerdict, shadowAiEnabled } from "@/lib/shadow-ai";

// GLM gölge Aşama-1 sözleşmeleri: default KAPALI · karar yetkisi SIFIR (asla
// fırlatmaz, dönüşü kullanılmaz) · hüküm kapalı sete clamp'lenir · mesaj gövdesi
// modele gider ama tabloya ASLA yazılmaz · pilot tavanı dolunca sessizce durur ·
// aynı mesajın ikinci gölgesi dedupe ile düşer.

const GUEST_MSG = "Klima çalışmıyor ve paramı geri istiyorum, yoksa kötü yorum yazacağım!";

function glmResponse(body: unknown) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: typeof body === "string" ? body : JSON.stringify(body) } }] }),
    { status: 200 },
  );
}

async function seedOrg() {
  return prisma.organization.create({ data: { name: "Gölge Org" } });
}

describe("recordShadowVerdict — GLM gölge Aşama-1", () => {
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
      async () => glmResponse({ verdict: "escalate", riskType: "money_refund", confidence: 0.92 }),
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
    expect(row.agrees).toBe(true); // kapı insana verdi, GLM de escalate dedi
    expect(row.error).toBeNull();
    expect(row.model).toContain("GLM");
    // KVKK: satırın HİÇBİR alanında misafir metni yok.
    expect(JSON.stringify(row)).not.toContain("paramı geri");
  });

  it("ayrışma yönü: kapı GÖNDERDİ + GLM escalate → agrees=false (GLM daha sıkı)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => glmResponse({ verdict: "escalate", riskType: "complaint", confidence: 0.8 })));
    const org = await seedOrg();
    await recordShadowVerdict({
      organizationId: org.id, triggerId: "m2", guestMessage: "Wifi şifresi?", gateDecision: "auto_sent",
    });
    const row = await prisma.shadowVerdict.findFirstOrThrow();
    expect(row.agrees).toBe(false);
    expect(row.gateDecision).toBe("auto_sent");
  });

  it("API hatasında ASLA fırlatmaz: satır verdict=NULL + redakte error ile yazılır", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED api.akashml.com"); }));
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
    vi.stubGlobal("fetch", vi.fn(async () => glmResponse("Elbette! Bu mesaj güvenli görünüyor.")));
    const org = await seedOrg();
    await recordShadowVerdict({ organizationId: org.id, triggerId: "m4", guestMessage: "x", gateDecision: "auto_sent" });
    const row = await prisma.shadowVerdict.findFirstOrThrow();
    expect(row.verdict).toBeNull();
    expect(row.error).toBe("unparseable_verdict");
  });

  it("pilot tavanı: cap dolunca yeni çağrı/satır YOK (sessiz durur)", async () => {
    vi.stubEnv("SHADOW_AI_SAMPLE_CAP", "1");
    const org = await seedOrg();
    await prisma.shadowVerdict.create({
      data: { organizationId: org.id, triggerId: "önceki", gateDecision: "auto_sent", model: "x" },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await recordShadowVerdict({ organizationId: org.id, triggerId: "m5", guestMessage: "x", gateDecision: "auto_sent" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.shadowVerdict.count()).toBe(1);
  });

  it("dedupe: aynı mesajın ikinci gölgesi sessizce düşer (tek satır)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => glmResponse({ verdict: "allow", riskType: "none", confidence: 0.9 })));
    const org = await seedOrg();
    const input = { organizationId: org.id, triggerId: "m6", guestMessage: "Wifi?", gateDecision: "auto_sent" as const };
    await recordShadowVerdict(input);
    await recordShadowVerdict(input);
    expect(await prisma.shadowVerdict.count()).toBe(1);
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
