import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// ÖNCE / SONRA — "boş bilgi tabanı" ile "A5 akışıyla doldurulmuş bilgi tabanı"
// arasındaki ÖLÇÜLEN fark (kurucu isteği, 09-08).
//
// 🚨 BU BİR MODEL KALİTE EVAL'İ DEĞİLDİR ve öyle sunulmamalı. Model burada
// MOCK'LU. Ölçülen üç şey GERÇEK ve deterministiktir:
//   1. MODELE GİDEN BAĞLAM — istemde "(bilgi tabanı boş)" mu yazıyor, yoksa
//      host'un gerçeği mi? Cevap kalitesini belirleyen ASIL girdi budur.
//   2. ÜRÜNÜN KARARI — devir mi, cevap mı.
//   3. İZLENEBİLİRLİK — `RiskEvent` sayaçları ve sınıf (`absent` → `grounded`).
// Modelin KENDİ CÜMLESİNİN kalitesi ancak gerçek anahtarla `evals/` koşusunda
// ölçülür; bu dosya onun yerine GEÇMEZ.
//
// Test ayrıca insan-okunur bir rapor yazar: `docs/olcum/kb-once-sonra.md`.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));

import { NextRequest } from "next/server";
import { POST as CHAT } from "@/app/api/chat/[token]/route";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { classifyGrounding } from "@/lib/ai/grounding";
import { findKbGaps } from "@/modules/intelligence/recommendations/kb-gaps";
import { extractKbSuggestions } from "@/lib/kb-extract";

const DAY = 86_400_000;
const QUESTION = "Otopark var mı?";

/** Host'un elindeki gerçek metin — karşılama şablonu + ev rehberi karışımı. */
const HOST_TEXT = [
  "Merhaba {isim}, dairemize hoş geldiniz!",
  "Otopark bina altındadır ve misafirlerimiz için ücretsizdir.",
  "Çöpleri binanın yan sokağındaki konteynere bırakabilirsiniz.",
  "Çıkış saati 11:00'dir.",
].join("\n");

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Test Misafir",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      currency: "EUR",
    },
  });
  return { orgId, propertyId, token };
}

let seq = 0;
/**
 * QR sohbeti konaklamayı İLK cihaza kilitler (bearer QR'ın fotoğrafını çeken
 * eski misafir/temizlikçi devralamasın). Aynı "cihaz" olarak devam etmek için
 * ilk yanıtın konaklama çerezi taşınır — aksi hâlde ikinci soru
 * `boundElsewhere` ile reddedilir.
 */
function ask(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return CHAT(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, requestId: `r${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
}

const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? undefined;

/**
 * Modelin DAVRANIŞINI taklit eder: bağlamda dayanak varsa güvenle cevaplar,
 * yoksa düşük güvenle "bilmiyorum"a düşer. Gerçek modelin kendisi DEĞİLDİR —
 * ölçtüğümüz şey ürünün bu iki durumda ne YAPTIĞI.
 */
function modelBehavesLike(grounded: boolean) {
  mockSuggest.mockImplementation(() =>
    grounded
      ? {
          reply: "Otopark bina altındadır ve ücretsizdir.",
          intent: "parking",
          riskLevel: "none",
          riskType: null,
          confidence: 0.92,
          source: "openai",
          priority: "standard",
          risk: null,
          actionSuggestion: null,
          detectedLanguage: "tr",
          usedSources: ["kb:parking"],
          sourceAudit: { declared: 1, verified: 1 },
          missingInfo: [],
          statedCheckoutTime: null,
        }
      : {
          reply: "Bu konuda elimde kayıtlı bilgi yok.",
          intent: "parking",
          riskLevel: "none",
          riskType: null,
          confidence: 0.42,
          source: "openai",
          priority: "standard",
          risk: null,
          actionSuggestion: null,
          detectedLanguage: "tr",
          usedSources: [],
          sourceAudit: { declared: 0, verified: 0 },
          missingInfo: ["otopark"],
          statedCheckoutTime: null,
        },
  );
}

describe("ÖNCE / SONRA — bilgi tabanı kapsamının ürüne etkisi", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("boş KB → istemde 'bilgi tabanı boş', ürün DEVREDİYOR, sınıf 'absent'", async () => {
    const { orgId, propertyId, token } = await seed();
    modelBehavesLike(false);

    const before = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    const beforePrompt = packKnowledgeBase(before.items, before.dropped).text;
    expect(beforePrompt).toContain("bilgi tabanı boş");

    const res = await ask(token, QUESTION);
    const body = (await res.json()) as { escalated?: boolean; reply: string };
    expect(body.escalated).toBe(true);
    // Misafir cevabı ALMIYOR; ev sahibine devrediliyor.
    expect(body.reply).not.toContain("Otopark bina altındadır");

    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(ev.kbRetrieved).toBe(0);
    expect(classifyGrounding(ev).label).toBe("absent");

    // Host ekranında bu konu "eksik" olarak GÖRÜNÜR (kurulum listesinden).
    const gaps = await findKbGaps(orgId);
    expect(gaps.some((g) => g.category === "parking" && g.reviewCandidate)).toBe(true);
  });

  it("A5 akışıyla doldurulunca → istemde host'un gerçeği, ürün CEVAP VERİYOR, sınıf 'grounded'", async () => {
    const { orgId, propertyId, token } = await seed();

    // --- Host arayüzünün yaptığı işin AYNISI: metni yapıştır, öneri çıkar, ekle.
    const extraction = extractKbSuggestions(HOST_TEXT);
    const parking = extraction.items.find((i) => i.category === "parking");
    expect(parking).toBeTruthy();
    // 🚨 `{isim}` satırı öneriye GİRMEDİ, çıkış saati KB kalemi OLMADI.
    expect(extraction.skipped.map((s) => s.reason)).toContain("placeholder");
    expect(extraction.items.some((i) => i.category === "checkout")).toBe(false);
    expect(extraction.fields.map((f) => f.target)).toContain("checkOutTime");

    for (const item of extraction.items) {
      await prisma.knowledgeBaseItem.create({
        data: {
          propertyId,
          category: item.category,
          title: item.title,
          content: item.content,
          isActive: true,
          source: "suggestion_accepted",
          reviewState: "approved",
          approvedAt: new Date(),
        },
      });
    }

    modelBehavesLike(true);
    const after = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    const afterPrompt = packKnowledgeBase(after.items, after.dropped).text;
    expect(afterPrompt).not.toContain("bilgi tabanı boş");
    expect(afterPrompt).toContain("Otopark bina altındadır");

    const res = await ask(token, QUESTION);
    const body = (await res.json()) as { escalated?: boolean; reply: string };
    expect(body.escalated).toBeFalsy();
    expect(body.reply).toContain("Otopark bina altındadır");

    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(ev.kbRetrieved).toBeGreaterThan(0);
    expect(ev.srcVerified).toBe(1);
    expect(classifyGrounding(ev).label).toBe("grounded");

    // Host ekranında otopark satırı DÜŞTÜ.
    const gaps = await findKbGaps(orgId);
    expect(gaps.some((g) => g.category === "parking")).toBe(false);
  });

  it("ölçümü insan-okunur rapora yazar", async () => {
    const { orgId, propertyId, token } = await seed();

    modelBehavesLike(false);
    const before = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    const beforePrompt = packKnowledgeBase(before.items, before.dropped).text;
    const beforeRes = await ask(token, QUESTION);
    const stayCookie = cookieOf(beforeRes);
    const beforeBody = (await beforeRes.json()) as { escalated?: boolean; reply: string };
    const beforeEvent = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId } });
    const beforeGaps = await findKbGaps(orgId);

    const extraction = extractKbSuggestions(HOST_TEXT);
    for (const item of extraction.items) {
      await prisma.knowledgeBaseItem.create({
        data: {
          propertyId,
          category: item.category,
          title: item.title,
          content: item.content,
          isActive: true,
          source: "suggestion_accepted",
          reviewState: "approved",
          approvedAt: new Date(),
        },
      });
    }

    modelBehavesLike(true);
    const after = await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true });
    const afterPrompt = packKnowledgeBase(after.items, after.dropped).text;
    const afterRes = await ask(token, QUESTION, stayCookie);
    const afterBody = (await afterRes.json()) as { escalated?: boolean; reply: string };
    const allEvents = await prisma.riskEvent.findMany({
      where: { organizationId: orgId },
      orderBy: { occurredAt: "asc" },
    });
    expect(allEvents).toHaveLength(2);
    const afterEvent = allEvents[1];
    const afterGaps = await findKbGaps(orgId);

    const report = `# ÖLÇÜM — bilgi tabanı boşken / A5 akışıyla doldurulduktan sonra

> Bu dosya \`tests/integration/kb-coverage-before-after.test.ts\` tarafından ÜRETİLİR; elle yazılmaz.
> 🚨 **Bu bir model kalite eval'i DEĞİLDİR.** Model bu ölçümde mock'lu. Ölçülen şey: modele giden
> BAĞLAM, ürünün KARARI ve İZLENEBİLİRLİK. Modelin kendi cümlesinin kalitesi gerçek anahtarla
> \`evals/\` koşusunda ölçülür (\`docs/EVAL-CALISTIRMA.md\`).

## Host'un yaptığı iş
Tek adım: aşağıdaki metni yapıştır → "Önizle" → "Seçilenleri ekle".
Elle doldurulan form sayısı: **0** (önceden ${extraction.items.length} ayrı kayıt için ${extraction.items.length} kez form doldurmak gerekiyordu).

\`\`\`
${HOST_TEXT}
\`\`\`

Çıkarım sonucu: **${extraction.items.length} bilgi önerisi** (${extraction.items.map((i) => i.category).join(", ")}) ·
**${extraction.fields.length} mülk ayarı önerisi** (${extraction.fields.map((f) => `${f.target}=${f.value}`).join(", ")}) ·
**${extraction.skipped.length} satır atlandı** (${extraction.skipped.map((s) => s.reason).join(", ")}).

## Misafirin sorusu
> ${QUESTION}

| | ÖNCE (boş KB) | SONRA (A5 ile dolu) |
|---|---|---|
| Modele giden bilgi tabanı | \`${beforePrompt.slice(0, 90)}\` | \`${afterPrompt.split("\n")[0].slice(0, 90)}\` |
| İsteme giren kalem | ${beforeEvent.kbRetrieved} | ${afterEvent.kbRetrieved} |
| Modelin beyanı / doğrulanan | ${beforeEvent.srcDeclared} / ${beforeEvent.srcVerified} | ${afterEvent.srcDeclared} / ${afterEvent.srcVerified} |
| Temellendirme sınıfı | \`${classifyGrounding(beforeEvent).label}\` | \`${classifyGrounding(afterEvent).label}\` |
| Ürünün kararı | ${beforeBody.escalated ? "**DEVİR** (ev sahibine)" : "cevap"} | ${afterBody.escalated ? "DEVİR" : "**CEVAP** (misafire)"} |
| Misafirin gördüğü | ${JSON.stringify(beforeBody.reply)} | ${JSON.stringify(afterBody.reply)} |
| Host ekranındaki "eksik" satırı | ${beforeGaps.filter((g) => g.category === "parking").length} var | ${afterGaps.filter((g) => g.category === "parking").length} (düştü) |

## Okuma
Boş bilgi tabanında ürün **doğru olanı yapıyor** (uydurmuyor, devrediyor) — ama misafir cevap almıyor
ve host'un telefonu çalıyor. Dolu bilgi tabanında aynı soru **misafire anında** cevaplanıyor ve karar
kaydı bunun neye dayandığını (\`kbEvidenceJson\`) taşıyor. Yani asıl kazanç modelde değil, **modele ne
verildiğinde**; A5 o girdiyi doldurmanın maliyetini form doldurmaktan metin yapıştırmaya indiriyor.
`;
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "kb-once-sonra.md"), report, "utf8");

    // Raporun İDDİASI testin kendisi tarafından da doğrulanır (belge ile kod ayrışmasın).
    expect(beforeBody.escalated).toBe(true);
    expect(afterBody.escalated).toBeFalsy();
    expect(beforeEvent.kbRetrieved).toBe(0);
    expect(afterEvent.kbRetrieved).toBeGreaterThan(0);
  });
});
