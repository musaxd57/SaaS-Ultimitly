import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// HASSAS TALEP + BAŞKA SORU — KANAL AKIŞI, İLİŞKİ KİPİ (kurucu kararı 10-01 sabah, Sabah Kararları 17 + 18 "a"):
//  · bağımsız güvenli soru cevaplanır; hassas talep (şikâyet / iade / ev sahibi talebi) ev sahibinde AÇIK kalır, ev sahibine mesaj başına
//    TEK bildirim gider ve yinelenmez;
//  · bağlı soru (yanlış "bağımsız" işaretiyle gelse de) tutulur; ilişki belirsizse tutulur;
//  · arıza çözümü yalnız bilgi tabanına dayanırsa ve tehlike sınıfında değilse gider; elektrik / gaz / sıcak su cihazı → hiçbir şey gitmez,
//    tarif ev sahibinin hazır taslağında durur.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/messaging", async (orig) => {
  const actual = await orig<typeof import("@/lib/messaging")>();
  return { ...actual, sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "m1" })) };
});
vi.mock("@/lib/ai/semantic/understand", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/semantic/understand")>();
  return { ...actual, understandingEnabled: () => true, understandGuestMessages: vi.fn() };
});
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) };
});

import { emailService } from "@/lib/email";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyResult } from "@/lib/ai/types";
import { sendOnChannel } from "@/lib/messaging";
import { understandGuestMessages } from "@/lib/ai/semantic/understand";
import { parseUnderstanding, type MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { applyChannelAutoReply } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockMail = vi.mocked(emailService.sendReporting);
const mockSend = vi.mocked(sendOnChannel);
const mockUnderstand = vi.mocked(understandGuestMessages);

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
/** İlişki kipinin anlama çıktısı (öğe kipi + şikâyet takibi). */
function understood(requests: { intent: string; relation: string; q: string }[]): MessageUnderstanding {
  const u = parseUnderstanding(
    {
      language: "tr",
      requests: requests.map((r) => ({ intent: r.intent, relation: r.relation, query_tr: r.q, query_original: r.q, message: 1 })),
      stay_change: STAY_NONE,
      withdrawn: [],
    },
    { items: true, followup: true },
  );
  if (!u) throw new Error("fixture");
  return u;
}
const understands = (u: MessageUnderstanding) => mockUnderstand.mockResolvedValue({ status: "ok", value: u, ms: 1, cached: false });

function verdict(over: Partial<SuggestReplyResult> = {}): SuggestReplyResult {
  return {
    intent: "general",
    confidence: 0.95,
    reply: "Anlaşıldı.",
    risk: null,
    priority: "standard",
    source: "openai",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "tr",
    riskType: null,
    usedSources: [],
    missingInfo: [],
    statedCheckoutTime: null,
    ...over,
  };
}

async function seed(body: string, kb: readonly { category: string; title: string; content: string }[] = []) {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      alertEmail: "host@example.com",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  for (const k of kb) await prisma.knowledgeBaseItem.create({ data: { propertyId: property.id, ...k } });
  const createdAt = new Date(Date.now() - 20 * 60_000);
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: "res-1",
      status: "new",
      lastMessageAt: createdAt,
      messages: { create: [{ direction: "inbound", senderName: "Alex", authorType: "guest", body, createdAt }] },
    },
  });
  return conversation.id;
}

/** Bilgi tabanı TARİF kalemleri (sorun giderme fiili taşır) ve yalnız BİLGİ kalemleri (tarif değil — karar 23 kör doğrulaması). */
const KB_PARKING_RECIPE = { category: "parking", title: "Otopark kapısı açılmıyorsa", content: "Kumandanın 2. tuşuna 3 saniye basılı tutun." };
// Kategori "faq": Wi-Fi kategorisi doğrulanmış konaklama ister (sır kapsamı, `kbForStayScope`) — bu tohumda rezervasyon yok.
const KB_MODEM_RECIPE = {
  category: "faq",
  title: "İnternet yoksa: modemi yeniden başlatma",
  content: "Modemin arkasındaki ON/OFF düğmesine basarak kapatın, 30 saniye bekleyip yeniden açın.",
};
// Aynı konuda (internet) BİLGİ kalemi — tarif değil. (Ağ adı / şifre kalemi sır süzgecine takılır; konu aynı, sınanan kural aynı.)
const KB_INTERNET_INFO = { category: "general", title: "İnternet", content: "Dairede fiber internet var; modem TV ünitesinin alt rafında." };
const KB_COFFEE_INFO = { category: "faq", title: "Kahve makinesi", content: "Mutfakta kapsüllü kahve makinesi var; ek kapsül köşedeki marketten." };
const KB_PARKING_INFO = { category: "parking", title: "Otopark", content: "Otopark binanın arkasında, size ayrılan yer 27 numara." };

async function itemsOf(conversationId: string) {
  const rows = await prisma.conversationItem.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { requestIndex: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => [r.kind, r.status] as const);
}

async function draftOf(conversationId: string) {
  const m = await prisma.message.findFirst({ where: { conversationId, direction: "inbound" }, select: { aiSuggestedReply: true } });
  return m?.aiSuggestedReply ?? null;
}

beforeEach(async () => {
  await resetDb();
  mockSuggest.mockReset();
  mockUnderstand.mockReset();
  mockMail.mockReset();
  mockMail.mockResolvedValue({ ok: true });
  mockSend.mockClear();
  vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("ilişki kipi — kanal akışı (kurucu kararı 10-01 sabah)", () => {
  it("🚨 'Klima çalışmıyor; çöp konteyneri nerede?' → çöp cevabı GİDER; şikâyet açık + tek e-posta; yeniden işleme bildirim YİNELEMEZ", async () => {
    const id = await seed("Klima çalışmıyor; çöp konteyneri nerede?");
    understands(
      understood([
        { intent: "complaint_issue", relation: "own_topic", q: "klima çalışmıyor arıza" },
        { intent: "trash", relation: "own_topic", q: "çöp konteyneri yeri" },
      ]),
    );
    mockSuggest.mockResolvedValue(
      verdict({ intent: "general", reply: "Çöp konteyneri binanın arka kapısının yanında.", usedSources: ["kb:trash"], answeredRequests: { ok: true, refs: ["R1"] } }),
    );
    const out = await applyChannelAutoReply(id);
    expect(out.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSuggest.mock.calls[0][0].conversationItems?.answerable.map((a) => a.kind)).toEqual(["trash"]);
    expect(await itemsOf(id)).toEqual([
      ["complaint_issue", "pending_host"],
      ["trash", "answered"],
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);
    // Aynı tur yeniden işlenirse (senkron tekrarı / ikinci geçiş): ikinci gönderim yok, ikinci e-posta yok, şikâyet hâlâ açık.
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect((await itemsOf(id))[0]).toEqual(["complaint_issue", "pending_host"]);
  });

  it("🚨 'Otopark kapısı açılmıyor, nasıl çıkacağız?' — model soruyu YANLIŞ 'kendi konusu' işaretler → hiçbir şey gitmez, tek e-posta, taslak hazır", async () => {
    const id = await seed("Otopark kapısı açılmıyor, nasıl çıkacağız?");
    understands(
      understood([
        { intent: "complaint_issue", relation: "own_topic", q: "otopark kapısı açılmıyor" },
        { intent: "parking", relation: "own_topic", q: "otoparktan nasıl çıkılır" },
      ]),
    );
    // Model cevapladığını beyan etse de (R1) bağlı soru GİTMEZ.
    mockSuggest.mockResolvedValue(
      verdict({ intent: "parking", reply: "Otopark çıkışı rampanın sonunda.", usedSources: ["kb:parking"], answeredRequests: { ok: true, refs: ["R1"] } }),
    );
    const out = await applyChannelAutoReply(id);
    expect(out.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    // Tur tamamen tutuldu → cevap modeline öğe bloğu verilmez (bugünkü kural).
    expect(mockSuggest.mock.calls[0][0]).not.toHaveProperty("conversationItems");
    expect(await itemsOf(id)).toEqual([
      ["complaint_issue", "pending_host"],
      ["parking", "open"],
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("aynı mesaj, model 'arıza çözümü' der: bilgi tabanına dayanan tarif GİDER; dayanmayan tarif GİTMEZ (items_fix_unverified)", async () => {
    const msg = "Otopark kapısı açılmıyor, nasıl çıkacağız?";
    const u = understood([
      { intent: "complaint_issue", relation: "own_topic", q: "otopark kapısı açılmıyor" },
      { intent: "parking", relation: "fix_request", q: "otopark kapısı açma yöntemi" },
    ]);
    const tarif = "Kapı açılmazsa kumandanın 2. tuşuna 3 saniye basılı tutun.";

    const okId = await seed(msg, [KB_PARKING_RECIPE]);
    understands(u);
    mockSuggest.mockResolvedValue(verdict({ intent: "parking", reply: tarif, usedSources: ["kb:parking"], answeredRequests: { ok: true, refs: ["R1"] } }));
    expect((await applyChannelAutoReply(okId)).sent).toBe(true);
    expect(mockSuggest.mock.calls[0][0].conversationItems?.answerable).toEqual([
      expect.objectContaining({ ref: "R1", kind: "parking", fix: true }),
    ]);
    expect(await itemsOf(okId)).toEqual([
      ["complaint_issue", "pending_host"],
      ["parking", "answered"],
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);

    await resetDb();
    mockSend.mockClear();
    mockMail.mockClear();
    const noKbId = await seed(msg, [KB_PARKING_RECIPE]);
    understands(u);
    mockSuggest.mockResolvedValue(verdict({ intent: "parking", reply: tarif, usedSources: [], answeredRequests: { ok: true, refs: ["R1"] } }));
    expect((await applyChannelAutoReply(noKbId)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("🚨 'Sıcak su yok, kombiyi nasıl resetleriz?' → tehlike sınıfı: hiçbir şey gitmez, tek e-posta, tarif ev sahibinin HAZIR TASLAĞINDA", async () => {
    const id = await seed("Sıcak su yok, kombiyi nasıl resetleriz?");
    understands(
      understood([
        { intent: "complaint_issue", relation: "own_topic", q: "sıcak su yok" },
        { intent: "appliance_help", relation: "fix_request", q: "kombi resetleme" },
      ]),
    );
    mockSuggest.mockResolvedValue(
      verdict({ intent: "general", reply: "Kombinin altındaki sıfırlama düğmesine 5 saniye basılı tutabilirsiniz.", usedSources: ["kb:faq"] }),
    );
    const out = await applyChannelAutoReply(id);
    expect(out.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockSuggest.mock.calls[0][0]).not.toHaveProperty("conversationItems");
    expect(await itemsOf(id)).toEqual([
      ["complaint_issue", "pending_host"],
      ["appliance_help", "open"],
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(await draftOf(id)).toContain("sıfırlama düğmesine");
  });

  it("kurucu: iade ve ev sahibi talebinde AYNI kural — bağlı soru tutulur, bağımsız Wi-Fi gider; talep açık, tek e-posta", async () => {
    const refundId = await seed("İade istiyorum, şimdi ne olacak?");
    understands(
      understood([
        { intent: "cancellation_refund", relation: "own_topic", q: "iade talebi" },
        { intent: "other", relation: "follow_up", q: "iade süreci ne olacak" },
      ]),
    );
    mockSuggest.mockResolvedValue(verdict({ intent: "general", reply: "İade süreci 5 iş günü sürer.", answeredRequests: { ok: true, refs: ["R1"] } }));
    expect((await applyChannelAutoReply(refundId)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockMail).toHaveBeenCalledTimes(1);

    await resetDb();
    mockSend.mockClear();
    mockMail.mockClear();
    const humanId = await seed("Ev sahibiyle görüşmek istiyorum. Wi-Fi şifresi neydi?");
    understands(
      understood([
        { intent: "human_request", relation: "own_topic", q: "ev sahibiyle görüşmek" },
        { intent: "wifi", relation: "own_topic", q: "wifi şifresi" },
      ]),
    );
    mockSuggest.mockResolvedValue(
      verdict({ intent: "wifi", reply: "Wi-Fi ağı Lale-5G, şifre modemin altında yazıyor.", usedSources: ["kb:wifi"], answeredRequests: { ok: true, refs: ["R1"] } }),
    );
    expect((await applyChannelAutoReply(humanId)).sent).toBe(true);
    expect(await itemsOf(humanId)).toEqual([
      ["human_request", "pending_host"],
      ["wifi", "answered"],
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("karar 23 (onaylı 18. madde): soru SORMADAN arıza bildirimi — anlama katmanı çözüm isteği eklerse tarif gider, şikâyet açık + tek e-posta", async () => {
    // Model davranışı (istemin yeni cümlesi) ücretli ölçümle sınanır; burada çözüm isteği GELDİĞİNDE akışın mekaniği pinli.
    const id = await seed("İnternet bir saattir yok.", [KB_MODEM_RECIPE]);
    understands(
      understood([
        { intent: "complaint_issue", relation: "own_topic", q: "internet yok" },
        { intent: "wifi", relation: "fix_request", q: "modem yeniden başlatma" },
      ]),
    );
    mockSuggest.mockResolvedValue(
      verdict({
        intent: "wifi",
        reply: "Modemin arkasındaki ON/OFF düğmesiyle kapatıp 30 saniye sonra yeniden açabilirsiniz.",
        usedSources: ["kb:faq"],
        answeredRequests: { ok: true, refs: ["R1"] },
      }),
    );
    expect((await applyChannelAutoReply(id)).sent).toBe(true);
    expect(await itemsOf(id)).toEqual([
      ["complaint_issue", "pending_host"],
      ["wifi", "answered"],
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("🚨 karar 23 kör doğrulaması: bilgi tabanında bu arızanın TARİFİ yoksa (yalnız bilgi kalemi) çözüm isteği modele SUNULMAZ — tur ev sahibinde, tek e-posta", async () => {
    // Kör set 4: tarifsiz arızada Luna BOŞ cevap verdi (ürün "kullanılamaz çıktı" sayıp yeniden deniyordu), 5.1 şifre kalemine dayanıp
    // "bağlantıyı kesip yeniden bağlanın" adımını uydurdu ve GÖNDERDİ. Tarif yoksa istek şikâyetle birlikte tutulur.
    const id = await seed("İnternet bir saattir yok.", [KB_INTERNET_INFO]);
    understands(
      understood([
        { intent: "complaint_issue", relation: "own_topic", q: "internet yok" },
        { intent: "wifi", relation: "fix_request", q: "internet bağlantısı nasıl düzelir" },
      ]),
    );
    mockSuggest.mockResolvedValue(
      verdict({
        intent: "wifi",
        // Kör set 4'teki 5.1 cevabının biçimi: bilgi kalemine DAYANAN (doğrulanan kaynak) ama tarifte olmayan bir adım.
        reply: "Modem TV ünitesinin alt rafında; bağlantıyı kesip yeniden bağlanmayı deneyin.",
        usedSources: ["kb:general"],
        answeredRequests: { ok: true, refs: ["R1"] },
      }),
    );
    const out = await applyChannelAutoReply(id);
    expect(out.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    // Kalem modele GERÇEKTEN gitti (yoksa test boşa geçerdi) — konu var, tarif yok.
    expect(mockSuggest.mock.calls[0][0].knowledgeBase.map((k) => k.title)).toContain("İnternet");
    // Cevaplanabilir istek kalmadı → öğe bloğu hiç verilmez (bugünkü "hepsi tutuldu" yolu).
    expect(mockSuggest.mock.calls[0][0]).not.toHaveProperty("conversationItems");
    expect(await itemsOf(id)).toEqual([
      ["complaint_issue", "pending_host"],
      ["wifi", "open"],
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("karar 23 kör doğrulaması: tarifsiz arıza + bağımsız soru → modele YALNIZ bağımsız soru sunulur (arızadan söz edilecek istek yok), cevap gider", async () => {
    // Kör set 4: "Kahve makinesi çalışmıyor. Otopark yerimiz hangisi?" — Luna arızayı da gördüğü için "kahve makinesi adımları bilgide
    // yok" yazdı ve bu cümle misafire GİTTİ. Tarif yoksa arıza isteği şikâyetle birlikte tutulur; model yalnız otopark sorusunu görür.
    const id = await seed("Kahve makinesi çalışmıyor, sadece turuncu yanıp sönüyor. Otopark yerimiz hangisi?", [KB_COFFEE_INFO, KB_PARKING_INFO]);
    understands(
      understood([
        { intent: "complaint_issue", relation: "own_topic", q: "kahve makinesi çalışmıyor" },
        { intent: "appliance_help", relation: "fix_request", q: "kahve makinesi turuncu ışık" },
        { intent: "parking", relation: "own_topic", q: "otopark yeri" },
      ]),
    );
    mockSuggest.mockResolvedValue(
      verdict({ intent: "parking", reply: "Size ayrılan otopark yeri 27 numara.", usedSources: ["kb:parking"], answeredRequests: { ok: true, refs: ["R1"] } }),
    );
    expect((await applyChannelAutoReply(id)).sent).toBe(true);
    expect(mockSuggest.mock.calls[0][0].conversationItems?.answerable).toEqual([expect.objectContaining({ ref: "R1", kind: "parking" })]);
    expect(mockSuggest.mock.calls[0][0].conversationItems?.answerable[0]).not.toHaveProperty("fix");
    expect(await itemsOf(id)).toEqual([
      ["complaint_issue", "pending_host"],
      ["appliance_help", "open"],
      ["parking", "answered"],
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("🚨 kör set 5: model bırakılan arızanın cihazına DEĞİNİRSE (uydurma adım / 'talimatım yok') cevap gitmez — tek e-posta; değinmezse gider", async () => {
    // 5.1, set 5: "bulaşık makinesi durdu + çıkış saati?" → "makineyi kapatıp fişini 1 dakika çekin… Çıkış saati 11:00" GİTTİ (adım bilgi
    // tabanında yok). Bırakılan istek için istem "değinme" der; kapı kemeri cihaz kavramıyla tutar.
    const msg = "Kahve makinesi çalışmıyor, sadece turuncu yanıp sönüyor. Otopark yerimiz hangisi?";
    const reqs = [
      { intent: "complaint_issue", relation: "own_topic", q: "kahve makinesi çalışmıyor" },
      { intent: "appliance_help", relation: "fix_request", q: "kahve makinesi turuncu ışık" },
      { intent: "parking", relation: "own_topic", q: "otopark yeri" },
    ];
    const id = await seed(msg, [KB_COFFEE_INFO, KB_PARKING_INFO]);
    understands(understood(reqs));
    mockSuggest.mockResolvedValue(
      verdict({
        intent: "parking",
        reply: "Size ayrılan otopark yeri 27 numara. Kahve makinesini kapatıp fişini 1 dakika çekip yeniden açmayı deneyin.",
        usedSources: ["kb:parking"],
        answeredRequests: { ok: true, refs: ["R1"] },
      }),
    );
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockMail).toHaveBeenCalledTimes(1);
    const ev = await prisma.riskEvent.findFirst({ where: { conversationId: id }, orderBy: { occurredAt: "desc" } });
    expect(JSON.parse(ev?.kbEvidenceJson ?? "{}").g?.d).toBe("items_held_touched");
  });

  it("🚨 ilişki belirsiz ('unclear') → o soru tutulur; bağımsızlık işareti bile kapının öteki kontrollerini atlatmaz (bilgim yok)", async () => {
    const id = await seed("Klima çalışmıyor; çöp konteyneri nerede?");
    understands(
      understood([
        { intent: "complaint_issue", relation: "own_topic", q: "klima çalışmıyor" },
        { intent: "trash", relation: "unclear", q: "çöp konteyneri yeri" },
      ]),
    );
    mockSuggest.mockResolvedValue(verdict({ reply: "Çöp konteyneri binanın arkasında." }));
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockMail).toHaveBeenCalledTimes(1);

    await resetDb();
    mockSend.mockClear();
    mockMail.mockClear();
    const id2 = await seed("Klima çalışmıyor; çöp konteyneri nerede?");
    understands(
      understood([
        { intent: "complaint_issue", relation: "own_topic", q: "klima çalışmıyor" },
        { intent: "trash", relation: "own_topic", q: "çöp konteyneri yeri" },
      ]),
    );
    // Bağımsız soru — ama cevap "bilgim yok" itirafı: kapının kendi kontrolü aynen koşar, gitmez.
    mockSuggest.mockResolvedValue(verdict({ reply: "Çöp konteyneri hakkında bilgim yok.", answeredRequests: { ok: true, refs: ["R1"] } }));
    expect((await applyChannelAutoReply(id2)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockMail).toHaveBeenCalledTimes(1);
  });
});
