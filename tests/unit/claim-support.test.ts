import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({ alertOnTransition: vi.fn(async () => "alerted"), clearAlertState: vi.fn(async () => {}) }));

import { auditClaims, auditClaimsSafe, CLAIM_CLASSES, type ClaimContext } from "@/lib/ai/claim-support";
import { buildReplyPrompt, buildReplyUserPrompt } from "@/lib/ai/prompts";
import { suggestReply } from "@/lib/ai";
import { buildKbEvidence } from "@/lib/ai/grounding";
import { CONTEXTS, CASES, HARD, type Case } from "../helpers/claim-battery";

// ---------------------------------------------------------------------------
// İDDİA DESTEĞİ GÖLGE ÖLÇÜMÜ (09-23). Model cevabındaki somut iddiaların (saat/tarih/para/kod/
// telefon/birimli miktar) modelin gördüğü veride harfiyen geçip geçmediği. KARAR DEĞİL: hiçbir
// kapı okumaz (mimari pin). Batarya ajan ölçümünden (sentetik); eşikler ÖLÇÜLEN değere pinli.
// ---------------------------------------------------------------------------

function contextFor(c: Case): ClaimContext {
  const base = CONTEXTS[c.ctx];
  return buildReplyPrompt({ ...base, guestMessage: c.guest, history: base.history ?? [] }).claimContext;
}

describe("batarya — dayanaklı cevapta yanlış alarm YOK, uydurma yakalanır", () => {
  it("🚨 dayanaklı cevapların HİÇBİRİ desteksiz iddia taşımıyor (ayar, KB, rezervasyon, teklif, türetilmiş gece, geçmiş)", () => {
    const legit = [...CASES, ...HARD].filter((c) => c.kind === "legit");
    expect(legit.length).toBeGreaterThanOrEqual(130);
    const offenders = legit
      .map((c) => ({ id: c.id, a: auditClaims(c.reply, contextFor(c)) }))
      .filter((x) => x.a.u > 0)
      .map((x) => `${x.id}:${x.a.uc.join("/")}`);
    expect(offenders).toEqual([]);
  });

  it("uydurma cevapların ölçülen yakalama oranı korunur (ana küme ≥43/45, zor küme ≥8/25)", () => {
    const hit = (xs: Case[]) => xs.filter((c) => c.kind === "fab" && auditClaims(c.reply, contextFor(c)).u > 0).length;
    expect(CASES.filter((c) => c.kind === "fab")).toHaveLength(45);
    expect(hit(CASES)).toBeGreaterThanOrEqual(43);
    expect(HARD.filter((c) => c.kind === "fab")).toHaveLength(25);
    expect(hit(HARD)).toBeGreaterThanOrEqual(8);
  });
});

describe("sınıflama davranışı", () => {
  const ctx = (facts: string[], extra: Partial<ClaimContext> = {}): ClaimContext => ({ facts, operator: [], guest: [], ...extra });

  it("mülk saati farklı biçimde yazılsa da desteklenir (15:00 ↔ 3 pm ↔ öğleden sonra 3 ↔ 15.00)", () => {
    const c = ctx(["Check-in saati: 15:00\nCheck-out saati: 11:00"]);
    for (const r of ["Giriş 15:00'te.", "Check-in is from 3 pm.", "Öğleden sonra 3'ten itibaren.", "Giriş 15.00'te."]) {
      expect(auditClaims(r, c).u, r).toBe(0);
    }
    expect(auditClaims("Giriş 14:00'te.", c)).toMatchObject({ u: 1, uc: ["time"] });
  });

  it("KATI birim: '5 dakika' 5 kişiyi desteklemez; '1 saat' 60 dakikayı destekler", () => {
    const c = ctx(["Market 5 dakika yürüme mesafesinde.", "Havalimanı 1 saat."]);
    expect(auditClaims("Market 5 dakikada.", c).u).toBe(0);
    expect(auditClaims("Havalimanına 60 dakikada varılır.", c).u).toBe(0);
    expect(auditClaims("Daire 5 kişilik.", c)).toMatchObject({ u: 1, uc: ["people"] });
  });

  it("🚨 telefonun parçası KOD sayılmaz; kod büyük/küçük harfe duyarlı", () => {
    const c = ctx(["Acil hat: 0532 111 22 33.", "Wi-Fi şifresi: Deniz2024!"]);
    expect(auditClaims("Kapı kodu 0532.", c)).toMatchObject({ u: 1, uc: ["code"] });
    expect(auditClaims("Wi-Fi şifresi: deniz2024!", c).uc).toContain("code");
    expect(auditClaims("Wi-Fi şifresi: Deniz2024!", c).u).toBe(0);
  });

  it("destek düzeyleri ayrı sayılır: operatör geçmişi, misafir yankısı (otorite değil), acil sabit", () => {
    const c = ctx([], { operator: ["Anahtar kutusunun kodu 5821."], guest: ["Kodum 7777 mi?"] });
    expect(auditClaims("Kod 5821.", c)).toMatchObject({ op: 1, u: 0 });
    expect(auditClaims("Evet, kod 7777.", c)).toMatchObject({ echo: 1, ec: ["code"], u: 0 });
    expect(auditClaims("Acil durumda 112'yi arayın.", c)).toMatchObject({ k: 1, u: 0 });
  });

  it("türetilmiş gece sayısı desteklenir; metinde yazmayan başka gece sayısı desteklenmez", () => {
    const c = ctx(["Giriş: 15 Eki | Çıkış: 18 Eki"], { derivedNumbers: [3] });
    expect(auditClaims("Konaklamanız 3 gece.", c).u).toBe(0);
    expect(auditClaims("Konaklamanız 4 gece.", c).u).toBe(1);
  });

  it("🚨 sistem isteminin few-shot sahte değeri ('12345678') bağlamda YOK → desteksiz (sızıntı görünür)", () => {
    const { claimContext } = buildReplyPrompt({
      property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
      reservation: null,
      knowledgeBase: [],
      guestMessage: "Wifi şifresi?",
      tone: "warm",
      language: "tr",
    });
    expect(auditClaims("Şifre: 12345678", claimContext)).toMatchObject({ u: 1, uc: ["code"] });
  });

  it("kodun yazdığı '[NOT]' satırları ve istem talimatları desteğe SAYILMAZ; KB verisi sayılır", () => {
    const input = {
      property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
      reservation: null,
      knowledgeBase: [{ category: "parking", title: "Otopark", content: "Otopark günlüğü 150 TL." }],
      knowledgeBaseNotes: ["Kaynaklarda çıkış saati için farklı değerler var (11:00 / 13:00)."],
      guestMessage: "Otopark?",
      tone: "warm" as const,
      language: "tr",
    };
    const { claimContext } = buildReplyPrompt(input);
    expect(buildReplyUserPrompt(input)).toContain("13:00"); // KONTROL: not istemde VAR
    expect(auditClaims("Otopark 150 TL.", claimContext).u).toBe(0);
    expect(auditClaims("Çıkış 13:00'te.", claimContext).u).toBe(1);
  });
});

describe("gizlilik, güvenlik, dayanıklılık", () => {
  it("🚨 özet PII'siz: yalnız sayılar + kapalı-küme sınıflar; ham değer (kod, telefon) YOK", () => {
    const a = auditClaims("Kod 4827, telefon +90 532 999 88 77, şifre GizliX9.", { facts: [], operator: [], guest: [] });
    expect(Object.keys(a).sort()).toEqual(["ctx", "ec", "echo", "k", "n", "op", "u", "uc", "v"]);
    const json = JSON.stringify(a);
    for (const raw of ["4827", "532", "GizliX9", "999"]) expect(json).not.toContain(raw);
    for (const cls of [...a.uc, ...a.ec]) expect(CLAIM_CLASSES).toContain(cls);
  });

  it("kanıt JSON'u yalnız temizlenmiş alanları taşır (sahte alan/serbest metin sızamaz)", () => {
    const dirty = { v: 1, n: 2, ctx: 1, op: 0, echo: 0, k: 0, u: 1, uc: ["code", "SIZINTI 4827"], ec: [], raw: "4827" } as never;
    const json = String(buildKbEvidence({ retrieved: [], usedLabels: [], claims: dirty, llm: { pt: 10, cpt: 4, m: "gpt-5.1", x: "sız" } as never }));
    expect(json).not.toContain("4827");
    expect(json).not.toContain("sız");
    expect(JSON.parse(json)).toMatchObject({ claims: { u: 1, uc: ["code"] }, llm: { pt: 10, cpt: 4, m: "gpt-5.1" } });
  });

  it("ölçülmediyse kanıt biçimi DEĞİŞMEZ (anahtar eklenmez)", () => {
    expect(JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: ["history"] })))).toEqual({ retrieved: [], used: ["history"] });
  });

  it("asla fırlatmaz; bağlam yoksa ölçülmedi (undefined)", () => {
    expect(auditClaimsSafe("Saat 15:00", undefined)).toBeUndefined();
    expect(auditClaimsSafe("Saat 15:00", { facts: null as never, operator: [], guest: [] })).toBeUndefined();
  });

  it("çekişmeli 24k girdi makul sürede biter (ReDoS pini)", () => {
    const evil = "1.2.3.".repeat(4000) + "a@" + "b.".repeat(2000);
    const t0 = performance.now();
    auditClaims(evil, { facts: [evil.slice(0, 8000)], operator: [], guest: [] });
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("🚨 mimari: gönderim kapıları iddia ölçümünü İÇE AKTARMAZ (gölge sessizce kapıya dönüşemez)", () => {
    for (const f of ["src/lib/ai/fallback.ts", "src/lib/guest-chat-gate.ts", "src/lib/ai/output-veto.ts", "src/lib/ai/absence.ts"]) {
      const src = readFileSync(path.resolve(__dirname, "../..", f), "utf8");
      expect(src, f).not.toMatch(/claim-support/);
    }
  });
});

describe("suggestReply — ölçüm ve kullanım sonuca taşınır", () => {
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const input = {
    property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
    reservation: null,
    knowledgeBase: [{ category: "parking", title: "Otopark", content: "Otopark günlüğü 150 TL." }],
    guestMessage: "Otopark ücreti?",
    tone: "warm" as const,
    language: "tr",
  };
  const response = (reply: string, usage?: object) =>
    new Response(
      JSON.stringify({
        model: "gpt-5.1-2026",
        usage,
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ intent: "parking", confidence: 0.9, reply, riskLevel: "none" }) } }],
      }),
      { status: 200 },
    );

  it("model cevabı → claimAudit + llmUsage (önbellek oranı gözlemlenebilir)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("Otopark günlüğü 200 TL.", { prompt_tokens: 12000, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 11000 } })),
    );
    const r = await suggestReply(input);
    expect(r.source).toBe("openai");
    expect(r.claimAudit).toMatchObject({ n: 1, u: 1, uc: ["money"] });
    expect(r.llmUsage).toEqual({ pt: 12000, ct: 80, cpt: 11000, m: "gpt-5.1-2026" });
  });

  it("dayanaklı cevap → u = 0; kullanım yoksa alan YOK (ölçülmedi, sıfır değil)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response("Otopark günlüğü 150 TL.")));
    const r = await suggestReply(input);
    expect(r.claimAudit).toMatchObject({ n: 1, ctx: 1, u: 0 });
    expect(r.llmUsage).toEqual({ m: "gpt-5.1-2026" });
  });

  it("kesilmiş (finish_reason=length) yanıt fallback'e düşer ama harcanan token GÖRÜNÜR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ usage: { prompt_tokens: 900, completion_tokens: 2000 }, choices: [{ finish_reason: "length", message: { content: "{" } }] }), { status: 200 })),
    );
    const r = await suggestReply(input);
    expect(r.source).toBe("fallback");
    expect(r.claimAudit).toBeUndefined();
    expect(r.llmUsage).toEqual({ pt: 900, ct: 2000 });
  });
});
