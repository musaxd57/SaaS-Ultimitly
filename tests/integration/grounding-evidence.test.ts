import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { buildKbEvidence, classifyGrounding } from "@/lib/ai/grounding";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { recordRiskEvent } from "@/lib/risk-events";

// ---------------------------------------------------------------------------
// A2 kapsam düzeltmesi (kurucu, 09-08) — İKİ ŞART:
//
// 1. `max(updatedAt)` KESİN SÜRÜM DEĞİLDİR. "Bu cevap hangi bilgiye dayandı"
//    sorusunu ancak KALEM KİMLİĞİ + o andaki SÜRÜM yanıtlar. Bu kanıt YETKİLİ
//    İÇ DENETİM içindir ve MİSAFİRE AÇILMAZ.
// 2. Hiçbir sınıf `decisive` olmadığına göre host'a giden şey KESİN TESPİT
//    değil İNCELEME ADAYIDIR; otomatik bilgi oluşturma YOK.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

function read(rel: string): string {
  return readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
}

describe("A2 — kalem sürümü kanıtı (yetkili iç denetim)", () => {
  let orgId: string;

  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("kanıt kalem KİMLİĞİ + SÜRÜMÜ taşır, İÇERİK taşımaz", () => {
    const json = buildKbEvidence({
      retrieved: [{ id: "kb_1", updatedAt: new Date("2026-09-01T10:00:00Z") }],
      usedLabels: ["kb:parking"],
    });
    const parsed = JSON.parse(String(json)) as { retrieved: unknown[]; used: string[] };
    expect(parsed.retrieved).toEqual([{ type: "kb_item", id: "kb_1", v: "2026-09-01T10:00:00.000Z" }]);
    expect(parsed.used).toEqual(["kb:parking"]);
    // İçerik/başlık asla girmez — girseydi bu, misafir metni taşımayan
    // RiskEvent sözleşmesini de delerdi.
    expect(String(json)).not.toMatch(/title|content|Otopark/i);
  });

  it("iki taraf da boşsa null — 'ölçtük, boştu' ile 'ölçmedik' karışmaz", () => {
    expect(buildKbEvidence({ retrieved: [], usedLabels: [] })).toBeNull();
  });

  it("yalnız beyan varken (kalem yok) kanıt yine yazılır", () => {
    const json = buildKbEvidence({ retrieved: [], usedLabels: ["history"] });
    expect(JSON.parse(String(json))).toEqual({ retrieved: [], used: ["history"] });
  });

  it("tavanı aşan kanıt SESSİZCE kırpılmaz — kaç kalemin düştüğü yazılır", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      id: `kb_${"x".repeat(30)}_${i}`,
      updatedAt: new Date("2026-09-01T10:00:00Z"),
    }));
    const json = String(buildKbEvidence({ retrieved: many, usedLabels: [] }));
    expect(json.length).toBeLessThanOrEqual(4000);
    const parsed = JSON.parse(json) as { retrieved: unknown[]; omitted: number };
    expect(parsed.omitted).toBe(400 - parsed.retrieved.length);
    expect(parsed.omitted).toBeGreaterThan(0);
  });

  it("bozuk giriş (kimliksiz/tarihsiz) kanıta girmez, uydurulmaz", () => {
    const json = buildKbEvidence({
      retrieved: [
        { id: "", updatedAt: new Date() },
        { id: "kb_ok", updatedAt: new Date("2026-09-01T10:00:00Z") },
      ] as { id: string; updatedAt: Date }[],
      usedLabels: ["", "kb:parking"],
    });
    const parsed = JSON.parse(String(json)) as { retrieved: { id: string }[]; used: string[] };
    expect(parsed.retrieved.map((r) => r.id)).toEqual(["kb_ok"]);
    expect(parsed.used).toEqual(["kb:parking"]);
  });

  it("RiskEvent kanıtı saklar; JSON olmayan değer YAZILMAZ", async () => {
    await recordRiskEvent({
      organizationId: orgId,
      surface: "guest_chat",
      triggerId: "ev-1",
      finalDecision: "auto_sent",
      kbEvidenceJson: buildKbEvidence({
        retrieved: [{ id: "kb_1", updatedAt: new Date("2026-09-01T10:00:00Z") }],
        usedLabels: ["kb:parking"],
      }),
    });
    const ok = await prisma.riskEvent.findFirstOrThrow({ where: { triggerId: "ev-1" } });
    expect(JSON.parse(String(ok.kbEvidenceJson))).toHaveProperty("retrieved");

    await recordRiskEvent({
      organizationId: orgId,
      surface: "guest_chat",
      triggerId: "ev-2",
      finalDecision: "auto_sent",
      kbEvidenceJson: "misafir bunu sordu: {bozuk",
    });
    const bad = await prisma.riskEvent.findFirstOrThrow({ where: { triggerId: "ev-2" } });
    // Ayrıştırılamayan gövde SAKLANMAZ: serbest metin bu kolona sızarsa
    // "PII taşımaz" sözü ilk ihlalde sessizce ölür.
    expect(bad.kbEvidenceJson).toBeNull();
  });
});

describe("A2 — kanıt MİSAFİRE açılmaz", () => {
  it("QR rotası bağlam nesnesini serileştirmez (kanıt/sayaç yanıta girmez)", () => {
    const src = read("src/app/api/chat/[token]/route.ts");
    // Yanıtlar açık nesne literalleridir; `...ctx` / `jsonOk(ctx)` gibi toplu
    // yayma tek satırda tüm iç alanları misafire açardı.
    expect(src).not.toMatch(/jsonOk\(\s*ctx\s*\)/);
    expect(src).not.toMatch(/\.\.\.ctx\b/);
    expect(src).not.toMatch(/kbEvidenceJson\s*[,)]?\s*\}\s*\)/);
  });

  it("misafire dönen alan adları kanıt/sayaç adlarını İÇERMEZ", () => {
    const src = read("src/app/api/chat/[token]/route.ts");
    // Misafire dönen her gövde (`finalize(...)` / `jsonOk(...)` argümanı) ayrı ayrı çıkarılır ve taranır. Eski pin "adlar
    // yalnız İLK `recordRiskEvent` çağrısından sonra görünür" diyordu; kanıt alanları ortak bir yardımcıya taşınınca
    // (09-25, kapanış kaydı) yalnız sıralama sayesinde geçiyordu — gövdeleri doğrudan taramak sıralamaya bağlı değil.
    const bodies: string[] = [];
    for (const m of src.matchAll(/\b(?:finalize|jsonOk)\(/g)) {
      let depth = 0;
      let i = (m.index ?? 0) + m[0].length - 1;
      const start = i;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")" && --depth === 0) break;
      }
      bodies.push(src.slice(start, i + 1));
    }
    expect(bodies.length, "anti-vakum: misafire dönen gövde bulunamadı").toBeGreaterThan(8);
    for (const body of bodies) {
      for (const field of ["kbEvidenceJson", "srcDeclared", "srcVerified", "kbPendingApproval", "auditFields", "buildKbEvidence"]) {
        expect(body, field).not.toContain(field);
      }
    }
    // Kanıt yine de YAZILIYOR (vakum değil): karar kaydı çağrılarında.
    expect(src.slice(src.indexOf("await recordRiskEvent({"))).toContain("kbEvidenceJson");
  });

  it("istem paketleyicisi kalem kimliğini/sürümünü MODELE göndermez (DAVRANIŞSAL)", () => {
    // ⚠️ Bu bir dönem YAPISAL pindi (`k.id` arama) ve mutasyon testinde HAYATTA
    // KALDI: `(k as { id?: string }).id` yazımı regex'i atlıyordu. Kaynak
    // taraması tek yönlüdür — kimliğin istem METNİNDE olmadığı ölçülüyor.
    const text = packKnowledgeBase([
      {
        id: "kb_gizli_kimlik_123",
        category: "parking",
        title: "Otopark",
        content: "Bina altı.",
        updatedAt: new Date("2026-09-01T10:00:00Z"),
      },
    ] as unknown as { category: string; title: string; content: string }[]).text;
    expect(text).toContain("Otopark");
    expect(text).not.toContain("kb_gizli_kimlik_123");
    expect(text).not.toContain("2026-09-01");
  });
});

describe("A2 — host'a giden şey TESPİT değil İNCELEME ADAYI", () => {
  it("hiçbir sınıf decisive DEĞİL — `absent` dahil", () => {
    const cases = [
      {},
      { kbRetrieved: 0, kbPendingApproval: 0, kbDropped: 0 },
      { kbRetrieved: 0, kbPendingApproval: 3 },
      { kbRetrieved: 5, srcDeclared: 0, srcVerified: 0 },
      { kbRetrieved: 5, srcDeclared: 2, srcVerified: 0 },
      { kbRetrieved: 5, srcDeclared: 2, srcVerified: 2 },
      { kbRetrieved: 30, kbDropped: 9, srcDeclared: 0, srcVerified: 0 },
    ];
    for (const c of cases) {
      expect(classifyGrounding(c).decisive, JSON.stringify(c)).toBe(false);
    }
  });

  it("`absent` yalnız İNCELEME ADAYI üretir (alan adı da bunu söyler)", () => {
    const v = classifyGrounding({ kbRetrieved: 0, kbPendingApproval: 0, kbDropped: 0 });
    expect(v.label).toBe("absent");
    expect(v.reviewCandidate).toBe(true);
    expect(v.decisive).toBe(false);
    // Eski ad "şu kalemi ekle" gibi bir kesinlik vaat ediyordu; geri gelmesin.
    expect(v).not.toHaveProperty("suggestsNewItem");
  });

  it("sınıflandırma HİÇBİR yerde kalem OLUŞTURMAZ (otomatik bilgi üretimi yok)", () => {
    const src = read("src/lib/ai/grounding.ts");
    expect(src).not.toMatch(/knowledgeBaseItem/);
    expect(src).not.toMatch(/prisma/);
    // Modül saf: DB'ye erişimi olmayan bir dosya, yanlışlıkla bile kalem yazamaz.
    expect(src).not.toMatch(/from "@\/lib\/db"/);
  });
});
