import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// 51 — KANAL OTO-YANITI BAĞLANTISI (kurucu onayı 10-02 akşam: "51'e de bağlam ilkesini uygula. Açık tehlike kanıtını modelin 'tehlike
// yok' kararı geçersiz kılamasın. Tehlikesiz bağlamda alarm kaldırılabilsin; ancak 'normaldir, güvenlidir' diye kaynaksız güvence
// verilmesin. Model arızasında mevcut olası tehlike güvenli tarafta kalsın."). Cevap modeli MOCK, anlama katmanı sahte fetch, DB gerçek.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply, sendDueAlerts } from "@/lib/automation";
import { emailService } from "@/lib/email";
import { HAZARD_UNVERIFIED_EMAILS_PER_HOUR, HAZARD_UNVERIFIED_REASON } from "@/lib/hazard-unverified-alert";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

const BASE = {
  intent: "general",
  confidence: 0.92,
  reply: "Çaydanlığı ocaktan alıp soğumasını bekleyin.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
};

async function seed(body: string) {
  const org = await prisma.organization.create({
    data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: { create: [{ direction: "inbound", senderName: "Alex", body, createdAt: new Date(Date.now() - 60_000) }] },
    },
    select: { id: true },
  });
  return conversation.id;
}

function understandingFetch(intent: string) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    if (name !== "guest_message_understanding") throw new Error(`beklenmeyen şema: ${name}`);
    const verdict = {
      language: "tr",
      requests: [{ intent, query_tr: "duman", query_original: "duman" }],
      stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
    };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), {
      status: 200,
    });
  });
}

async function gateDetail(conversationId: string) {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
  return (JSON.parse(String(ev.kbEvidenceJson)) as { g?: { d?: string } }).g?.d;
}

const KETTLE = "Çaydanlıktan duman çıkıyor, normal mi?";

describe("kanal oto-yanıtı — bağlamla tehlike (51)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("OLASI tehlike + anlama katmanı KAPALI → güvenli taraf: gönderilmez, acil rozeti kalır (bugünkü davranış)", async () => {
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed(KETTLE);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await gateDetail(id)).toBe("lexical_risk");
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ lastRiskType: "safety_emergency" });
  });

  // Haiku 10-14 (ikinci tur): kelime ağının işaretlemediği olası tehlike ("kısa devre", kurucu kararı 10-14) anlama katmanı koşmayınca
  // yalnız cevap modelinin riskine kalıyordu — QR ile parite.
  it("🚨 OLASI tehlike, kelime ağı SESSİZ + anlama katmanı KOŞMADI → gönderilmez (model kararı yok = güvenli taraf)", async () => {
    mockSuggest.mockResolvedValue({ ...BASE, intent: "wifi", reply: "Wi-Fi ağı Lale_5G." });
    const id = await seed("Kısa devre oldu, wifi şifresi neydi?");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await gateDetail(id)).toBe("lexical_risk");
  });

  it("KONTROL: aynı mesaj + anlama katmanı 'acil değil' → olası-tehlike tutuşu YOK (karar modelin)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch("wifi"));
    mockSuggest.mockResolvedValue({ ...BASE, intent: "wifi", reply: "Wi-Fi ağı Lale_5G." });
    const id = await seed("Kısa devre oldu, wifi şifresi neydi?");
    await applyChannelAutoReply(id);
    const ev = await prisma.riskEvent.findFirst({ where: { conversationId: id, surface: "auto_reply" } });
    const d = ev ? (JSON.parse(String(ev.kbEvidenceJson)) as { g?: { d?: string } }).g?.d : undefined;
    expect(d).not.toBe("lexical_risk");
  });

  // Tur 4 (11-05, ölçüldü): anlama katmanı mesajı 1.000 karakterde keser ve en fazla 5 istek döndürür. Mesajın sonundaki tehlike modele hiç
  // ulaşmamış olabilir → "koştu ve acil değil dedi" sayılmaz; olası tehlike güvenli tarafta kalır (K-1029-C).
  it("🚨 Tur 4: anlama 'acil değil' dedi AMA mesaj tavandan uzun (kuyruk görülmedi) → olası-tehlike tutuşu KALIR", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch("wifi"));
    mockSuggest.mockResolvedValue({ ...BASE, intent: "wifi", reply: "Wi-Fi ağı Lale_5G." });
    const long = `${"Merhaba, tatilimiz çok güzel geçiyor, şehri gezdik ve akşam yemeği için güzel bir yer bulduk. ".repeat(12)}Kısa devre oldu, wifi şifresi neydi?`;
    expect(long.length).toBeGreaterThan(1_000);
    const id = await seed(long);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await gateDetail(id)).toBe("lexical_risk");
  });

  it("🚨 Tur 4: anlama 'acil değil' dedi AMA istek tavanı doldu (5 istek — altıncı görülmemiş olabilir) → tutuş KALIR", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const verdict = {
          language: "tr",
          requests: ["wifi", "parking", "checkout_time", "trash", "amenities"].map((intent) => ({ intent, query_tr: intent, query_original: intent })),
          stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
        };
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), { status: 200 });
      }),
    );
    mockSuggest.mockResolvedValue({ ...BASE, intent: "wifi", reply: "Wi-Fi ağı Lale_5G." });
    const id = await seed("Wifi şifresi? Otopark nerede? Çıkış kaçta? Çöp nereye? Fön makinesi var mı? Kısa devre oldu.");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await gateDetail(id)).toBe("lexical_risk");
  });

  it("OLASI tehlike + anlama katmanı 'acil değil' → acil rozeti kalkar ama şikâyet akışı (gönderilmez, rozet şikâyet)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch("appliance_help"));
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed(KETTLE);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ lastRiskType: "complaint" });
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId: id, surface: "auto_reply" } });
    expect(ev.riskType).toBe("complaint");
  });

  it("🚨 alarm kalksa da KAYNAKSIZ güvence gitmez (hazard_reassurance); rozet acil durum DEĞİL", async () => {
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Bina tamamen güvenlidir, endişelenmeyin; çıkış merdiveni koridorun sonunda." });
    const id = await seed("Yangın çıkarsa hangi kapıdan çıkmalıyız?");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await gateDetail(id)).toBe("hazard_reassurance");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).lastRiskType).not.toBe("safety_emergency");
    // Karar kaydının risk etiketi de bağlam kararını izler (kalkan acil etiketi kayda "acil durum" diye yazılmaz).
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId: id, surface: "auto_reply" } });
    expect(ev.riskType).not.toBe("safety_emergency");
  });

  it("model hassas dediğinde (insan talebi) yükseltme rozeti de bağlam kararını izler: anılan tehlike 'acil durum' rozeti DOĞURMAZ", async () => {
    mockSuggest.mockResolvedValue({
      ...BASE,
      intent: "human_request",
      riskLevel: "medium" as never,
      reply: "Mesajınızı ev sahibinize iletiyorum.",
    });
    const id = await seed("Yangın çıkarsa hangi kapıdan çıkmalıyız?");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    // Yükseltme yolu koştu (insan talebi ev sahibine taşındı) ve rozet anılan tehlikeyi "acil durum" yazmadı.
    expect(conv).toMatchObject({ status: "problem", skippedReason: "escalated_to_human", lastRiskType: null });
  });

  it("🚨 AÇIK tehlike: anlama katmanı 'acil değil' dese de alarm KALKMAZ", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch("appliance_help"));
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Prizi kullanmayın." });
    const id = await seed("Prizden duman çıkıyor, yanık kokuyor!");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    // Kelime ağı bu mesajı hem şikâyet niyeti hem acil etiketiyle görür; ilk kapatan kontrol niyet olabilir.
    expect(["lexical_intent", "lexical_risk"]).toContain(await gateDetail(id));
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ lastRiskType: "safety_emergency" });
  });

  it("ANILAN tehlike ('yangın çıkarsa…') anlama katmanı kapalıyken de alarm üretmez, cevap gider", async () => {
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Bina girişinin yanındaki merdivenden çıkabilirsiniz." });
    const id = await seed("Yangın çıkarsa hangi kapıdan çıkmalıyız?");
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("başka acil sınıfı (sağlık) varsa bağlam alarmı kaldıramaz", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch("appliance_help"));
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed("Çaydanlıktan duman çıkıyor ve babam bayıldı!");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// KURUCU T2 (10-21): olası tehlike + anlama katmanı koşmadı → tur bugün de tutuluyordu ama ev sahibine HİÇBİR uyarı gitmiyordu. Şimdi:
// konuşma "Sorunlu" (panelde görünür) + tek acil e-posta; aynı olay tekrar işlenince ikinci e-posta yok; işletme başına saatte en çok 3;
// sınıra takılan olay panelde kalır; YENİ ve daha ağır tehlike (kelime ağının yakaladığı) önceki olayın tekrarı sayılmaz, sınıra girmez.
// ---------------------------------------------------------------------------
describe("kurucu T2 — olası tehlike + anlama katmanı koşmadı (kanal)", () => {
  const mockMail = vi.mocked(emailService.sendReporting);
  const SHORT = "Kısa devre oldu, wifi şifresi neydi?";
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
    mockMail.mockResolvedValue({ ok: true } as never);
    mockSuggest.mockResolvedValue({ ...BASE, intent: "wifi", reply: "Wi-Fi ağı Lale_5G." });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  /** Aynı işletmede yeni konuşma (uyarı adresi dolu). */
  async function seedIn(orgId: string | null, body: string) {
    const org = orgId
      ? await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })
      : await prisma.organization.create({
          data: { name: "Test Org", alertEmail: "host@example.com", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
        });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
    const conversation = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "airbnb",
        guestIdentifier: "Alex",
        status: "new",
        externalReservationId: `res-${property.id}`,
        messages: { create: [{ direction: "inbound", senderName: "Alex", body, createdAt: new Date(Date.now() - 60_000) }] },
      },
      select: { id: true },
    });
    return { orgId: org.id, id: conversation.id };
  }

  it("🚨 konuşma Sorunlu + TEK acil e-posta (misafire yine gitmez); aynı olay tekrar işlenince ikinci e-posta YOK", async () => {
    const { id } = await seedIn(null, SHORT);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "problem", skippedReason: HAZARD_UNVERIFIED_REASON });
    expect(mockMail).toHaveBeenCalledTimes(1); // ⬅️ eskiden ev sahibine hiçbir şey gitmiyordu
    expect(String(mockMail.mock.calls[0]![2])).toContain("Kısa devre");
    await applyChannelAutoReply(id);
    await prisma.message.create({ data: { conversationId: id, direction: "inbound", senderName: "Alex", body: "Kısa devre oldu, ne yapalım?" } });
    await applyChannelAutoReply(id);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("🚨 işletme başına saatte en çok 3 e-posta; sınıra takılan olay da panelde Sorunlu görünür", async () => {
    const first = await seedIn(null, SHORT);
    await applyChannelAutoReply(first.id);
    const ids = [first.id];
    for (let i = 0; i < HAZARD_UNVERIFIED_EMAILS_PER_HOUR; i++) {
      const c = await seedIn(first.orgId, SHORT);
      await applyChannelAutoReply(c.id);
      ids.push(c.id);
    }
    expect(mockMail).toHaveBeenCalledTimes(HAZARD_UNVERIFIED_EMAILS_PER_HOUR);
    const rows = await prisma.conversation.findMany({ where: { id: { in: ids } } });
    expect(rows.every((r) => r.status === "problem" && r.skippedReason === HAZARD_UNVERIFIED_REASON)).toBe(true);
  });

  it("🚨 YENİ ve daha ağır tehlike önceki olayın tekrarı sayılmaz: sınır dolu olsa da bugünkü acil yoldan bildirilir", async () => {
    const first = await seedIn(null, SHORT);
    await applyChannelAutoReply(first.id);
    for (let i = 0; i < HAZARD_UNVERIFIED_EMAILS_PER_HOUR; i++) await applyChannelAutoReply((await seedIn(first.orgId, SHORT)).id);
    mockMail.mockClear();
    // İşaretten SONRA, aynı konuşmada kelime ağının yakaladığı açık tehlike:
    await prisma.message.create({ data: { conversationId: first.id, direction: "inbound", senderName: "Alex", body: "Prizden duman çıkıyor, yanık kokuyor!" } });
    await sendDueAlerts(first.orgId);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(String(mockMail.mock.calls[0]![2])).toContain("Prizden duman");
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: "problem", skippedReason: "complaint" });
    // KONTROL: işaretten sonra yeni mesaj yoksa ya da yeni mesaj tehlike değilse (şikâyet) yeniden bildirim yok.
    mockMail.mockClear();
    const second = await seedIn(first.orgId, SHORT);
    await applyChannelAutoReply(second.id);
    await prisma.message.create({ data: { conversationId: second.id, direction: "inbound", senderName: "Alex", body: "Oda çok kirli, iade istiyorum." } });
    await sendDueAlerts(first.orgId);
    expect(mockMail).not.toHaveBeenCalled();
  });

  it("Haiku T2: yükseltme e-postası gitmezse işaret ve işaret zamanı geri konur — sonraki geçiş aynı ağır mesajı YENİDEN dener", async () => {
    const first = await seedIn(null, SHORT);
    await applyChannelAutoReply(first.id);
    await prisma.message.create({ data: { conversationId: first.id, direction: "inbound", senderName: "Alex", body: "Prizden duman çıkıyor, yanık kokuyor!" } });
    mockMail.mockClear();
    mockMail.mockResolvedValueOnce({ ok: false } as never);
    await sendDueAlerts(first.orgId);
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: "problem", skippedReason: HAZARD_UNVERIFIED_REASON });
    await sendDueAlerts(first.orgId);
    expect(mockMail).toHaveBeenCalledTimes(2);
    expect(String(mockMail.mock.calls[1]![2])).toContain("Prizden duman");
  });

  it("Haiku T2: alıcısı olmayan işletme saatlik hakkı YAKMAZ (Sorunlu işareti yine konur)", async () => {
    const first = await seedIn(null, SHORT);
    await prisma.organization.update({ where: { id: first.orgId }, data: { alertEmail: null } });
    for (let i = 0; i < HAZARD_UNVERIFIED_EMAILS_PER_HOUR + 1; i++) await applyChannelAutoReply((await seedIn(first.orgId, SHORT)).id);
    expect(mockMail).not.toHaveBeenCalled();
    const counter = await prisma.rateLimitCounter.findFirst({ where: { key: { startsWith: "hazard-unverified-mail:" } } });
    expect(counter?.count ?? 0).toBe(0);
    expect(await prisma.conversation.count({ where: { skippedReason: HAZARD_UNVERIFIED_REASON } })).toBe(HAZARD_UNVERIFIED_EMAILS_PER_HOUR + 1);
  });

  it("KONTROL: anlama katmanı koştu ve 'acil değil' dedi → işaret yok, e-posta yok (bugünkü davranış)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch("wifi"));
    const { id } = await seedIn(null, SHORT);
    await applyChannelAutoReply(id);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).skippedReason).not.toBe(HAZARD_UNVERIFIED_REASON);
    expect(mockMail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Konuşma kontrolü G0 gölge (tasarım `docs/TASARIM-2026-11-04-konusma-kontrolu.md` §11): bugün "Sorunlu" yazan kanal yolları tehlikede bir
// ENGEL kaydı da açar; bugünkü karar "gönder" iken açık engel varsa ayrışma SAYILIR. Kararlar ve misafire giden metin DEĞİŞMEZ.
// ---------------------------------------------------------------------------
describe("konuşma kontrolü G0 gölge — kanal yolları", () => {
  const mockMail = vi.mocked(emailService.sendReporting);
  const SHORT = "Kısa devre oldu, wifi şifresi neydi?";
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("CONVERSATION_CONTROL_SHADOW_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
    mockMail.mockResolvedValue({ ok: true } as never);
    mockSuggest.mockResolvedValue({ ...BASE, intent: "wifi", reply: "Wi-Fi ağı Lale_5G." });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const blocksOf = (conversationId: string) =>
    prisma.conversationBlock.findMany({ where: { conversationId }, select: { kind: true, sourceMessageId: true, evidence: true, status: true } });
  const mismatches = () => prisma.operationalEvent.findMany({ where: { event: "conversation_control.shadow_mismatch" } });
  const firstInbound = (conversationId: string) => prisma.message.findFirstOrThrow({ where: { conversationId, direction: "inbound" }, select: { id: true } });

  it("🚨 olası tehlike (anlama koşmadı) → `hazard_unverified` engeli, kaynak mesajla; davranış bugünkü gibi (gitmez, Sorunlu)", async () => {
    const id = await seed(SHORT);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await blocksOf(id)).toEqual([{ kind: "hazard_unverified", sourceMessageId: (await firstInbound(id)).id, evidence: "code:hazard_unverified", status: "active" }]);
  });

  it("KONTROL: anahtar KAPALI → engel yazılmaz (tablo boş kalır), davranış aynı", async () => {
    vi.stubEnv("CONVERSATION_CONTROL_SHADOW_ENABLED", "");
    const id = await seed(SHORT);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.conversationBlock.count()).toBe(0);
  });

  it("🚨 model acil dedi → `safety_incident` engeli (kanıt model kodu)", async () => {
    mockSuggest.mockResolvedValue({ ...BASE, intent: "general", reply: "Hemen ilgileniyoruz.", riskLevel: "high", riskType: "safety_emergency" });
    const id = await seed("Lütfen bize hemen dönün.");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await blocksOf(id)).toEqual([{ kind: "safety_incident", sourceMessageId: (await firstInbound(id)).id, evidence: "model:safety_emergency", status: "active" }]);
  });

  it("🚨 kelime ağının açık tehlikesi (Sorunlu konuşmada yeni mesaj) → `safety_incident` engeli de açılır (eski olası tehlikeye EK satır)", async () => {
    const id = await seed(SHORT);
    await applyChannelAutoReply(id);
    const danger = await prisma.message.create({ data: { conversationId: id, direction: "inbound", senderName: "Alex", body: "Prizden duman çıkıyor, yanık kokuyor!" } });
    const orgId = (await prisma.conversation.findUniqueOrThrow({ where: { id }, select: { property: { select: { organizationId: true } } } })).property.organizationId;
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } }); // kelime yolu alıcısız işletmeyi işlemez
    await sendDueAlerts(orgId);
    const kinds = (await blocksOf(id)).map((b) => `${b.kind}:${b.sourceMessageId === danger.id ? "yeni" : "eski"}:${b.evidence}`).sort();
    expect(kinds).toEqual(["hazard_unverified:eski:code:hazard_unverified", "safety_incident:yeni:keyword:safety_emergency"]);
  });

  it("🚨 KURUCUNUN BULDUĞU HATA: tehlike kaydı açıkken konuşma 'Yeni' (host'un tek cevabı durumu düşürdü) → bugün AI gönderir, gölge SAYAR", async () => {
    const id = await seed("Wi-Fi şifresi neydi?");
    const orgId = (await prisma.conversation.findUniqueOrThrow({ where: { id }, select: { property: { select: { organizationId: true } } } })).property.organizationId;
    await prisma.conversationBlock.create({ data: { organizationId: orgId, conversationId: id, kind: "safety_incident", sourceMessageId: "onceki-tehlike", evidence: "model:safety_emergency" } });
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1); // bugünkü davranış DEĞİŞMEDİ (G0)
    const ev = await mismatches();
    expect(ev).toHaveLength(1);
    expect(JSON.parse(ev[0]!.dataJson!)).toEqual({ context: "inline", status: "new_blocks_old_sends", reason: "conversation_block", resource: "safety_incident" });
  });

  it("KONTROL: engel yokken gönderim → sayım yok; engel varken anahtar KAPALI → sayım yok (gönderim yine aynı)", async () => {
    const id = await seed("Wi-Fi şifresi neydi?");
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await mismatches()).toHaveLength(0);
    vi.stubEnv("CONVERSATION_CONTROL_SHADOW_ENABLED", "");
    const id2 = await seed("Wi-Fi şifresi neydi?");
    const orgId = (await prisma.conversation.findUniqueOrThrow({ where: { id: id2 }, select: { property: { select: { organizationId: true } } } })).property.organizationId;
    await prisma.conversationBlock.create({ data: { organizationId: orgId, conversationId: id2, kind: "safety_incident", sourceMessageId: "onceki-tehlike" } });
    await applyChannelAutoReply(id2);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(await mismatches()).toHaveLength(0);
  });
});
