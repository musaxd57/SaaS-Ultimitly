import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { buildHostQuestion, maskedGuestQuote, QUOTE_MAX, templateSafe } from "@/lib/host-channel/question-text";
import { correlateHostReply, type PendingHostQuestion } from "@/lib/host-channel/correlate";
import { verifyMetaSignature } from "@/lib/host-channel/whatsapp/signature";
import { parseMetaWebhook, INBOUND_TEXT_CAP } from "@/lib/host-channel/whatsapp/parse";
import { checkComposedGuestReply, numberTokens } from "@/lib/host-channel/compose-check";
import { codeAnswerKind } from "@/lib/host-channel/answer-kind";
import type { HostChannelTransport, HostQuestionMessage } from "@/lib/host-channel/types";

// ---------------------------------------------------------------------------
// EV SAHİBİ SORU KANALI — dilim 1a saf parçalar (kurucu 10-30 "WhatsApp'ı hemen bağla"; tasarım
// `docs/TASARIM-2026-10-30-whatsapp-ev-sahibi-dongusu.md`). Meta bilgisi olmadan sahte göndericiyle sınanır.
// ---------------------------------------------------------------------------

describe("ev sahibine giden soru — misafir kişisel verisi gitmez", () => {
  it("ad, telefon, e-posta maskelenir; satır sonu / görünmez karakter / boşluk dizisi temizlenir", () => {
    const q = buildHostQuestion({
      propertyName: "Lale\n Daire",
      arrival: { day: 12, month: 11 },
      departure: { day: 15, month: 11 },
      guestText: "Merhaba ben Alex Smith,\n\nbebek yatağı var mı?​ Numaram +90 532 111 22 33, mail alex@example.com",
      guestNames: ["Alex Smith"],
    });
    expect(q).toEqual<HostQuestionMessage>({ property: "Lale Daire", dates: "12–15 Kas", quote: expect.any(String) });
    expect(q.quote).not.toMatch(/Alex Smith|532|alex@example\.com|\n|​/u);
    expect(q.quote).toContain("bebek yatağı var mı?");
  });

  it("alıntı en çok 160 karakter, sözcük ortasında kesilmez; ay değişen aralık iki ay adıyla", () => {
    const long = "Otopark ".repeat(60);
    const q = maskedGuestQuote(long);
    expect(q.length).toBeLessThanOrEqual(QUOTE_MAX);
    expect(q.endsWith("…")).toBe(true);
    expect(q).not.toMatch(/Otopar…$/u);
    expect(buildHostQuestion({ propertyName: "Lale", arrival: { day: 30, month: 10 }, departure: { day: 2, month: 11 }, guestText: "x" }).dates).toBe("30 Eki–2 Kas");
    expect(templateSafe("a\t\tb\r\nc")).toBe("a b c");
  });
});

const Q = (id: string, orgId: string, minutesAgo: number, ids: string[], status: PendingHostQuestion["status"] = "waiting"): PendingHostQuestion => ({
  id,
  orgId,
  status,
  createdAt: new Date(Date.UTC(2026, 9, 30, 12, 0) - minutesAgo * 60_000),
  providerMessageIds: ids,
});
const NOW = new Date(Date.UTC(2026, 9, 30, 12, 0));

describe("cevabı soruya bağlama — kiracı sınırı", () => {
  it("bağlam kimliği sorunun mesajına eşleşir → o soru; başka kiracının sorusu → yabancı (asla işlem yok)", () => {
    const qs = [Q("q1", "orgA", 5, ["wamid.A1"]), Q("q2", "orgB", 5, ["wamid.B1"])];
    expect(correlateHostReply({ contextId: "wamid.A1", senderOrgId: "orgA", questions: qs, now: NOW })).toEqual({ kind: "matched", questionId: "q1" });
    expect(correlateHostReply({ contextId: "wamid.B1", senderOrgId: "orgA", questions: qs, now: NOW })).toEqual({ kind: "foreign" });
  });

  it("kapanmış soru → kapalı (panelden cevaplandı); bağlamsız tek bekleyen → o; birden çok → en yeni 3 aday", () => {
    const closed = [Q("q1", "orgA", 5, ["wamid.A1"], "answered_elsewhere")];
    expect(correlateHostReply({ contextId: "wamid.A1", senderOrgId: "orgA", questions: closed, now: NOW })).toEqual({
      kind: "closed",
      questionId: "q1",
      status: "answered_elsewhere",
    });
    const one = [Q("q1", "orgA", 30, ["x"]), Q("q9", "orgB", 1, ["y"])];
    expect(correlateHostReply({ contextId: null, senderOrgId: "orgA", questions: one, now: NOW })).toEqual({ kind: "matched", questionId: "q1" });
    const many = [Q("a", "orgA", 40, []), Q("b", "orgA", 30, []), Q("c", "orgA", 20, []), Q("d", "orgA", 10, [])];
    expect(correlateHostReply({ contextId: null, senderOrgId: "orgA", questions: many, now: NOW })).toEqual({
      kind: "ambiguous",
      candidates: ["d", "c", "b"],
      overflow: true,
    });
  });

  it("24 saatten eski bekleyen soru düz cevaba bağlanmaz; hiç yoksa 'bekleyen soru yok'", () => {
    const old = [Q("q1", "orgA", 25 * 60, [])];
    expect(correlateHostReply({ contextId: null, senderOrgId: "orgA", questions: old, now: NOW })).toEqual({ kind: "none" });
    expect(correlateHostReply({ contextId: "wamid.unknown", senderOrgId: "orgA", questions: [], now: NOW })).toEqual({ kind: "none" });
  });
});

describe("Meta imzası — ham gövde, sabit süreli karşılaştırma", () => {
  const body = '{"object":"whatsapp_business_account","entry":[]}';
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  it("doğru imza geçer; gövdenin tek baytı değişirse, anahtar yanlışsa, başlık eksik / bozuksa RET", () => {
    expect(verifyMetaSignature(body, sig, "s3cret")).toBe(true);
    expect(verifyMetaSignature(body.replace("[]", "[ ]"), sig, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, sig, "other")).toBe(false);
    expect(verifyMetaSignature(body, null, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, sig, "")).toBe(false);
  });
});

describe("Meta web kancası ayrıştırma — güvenilmez gövde", () => {
  const payload = (messages: unknown[], statuses: unknown[] = []) => ({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PNID" }, messages, statuses } }] }],
  });
  it("metin, düğme (etkileşimli + şablon), desteklenmeyen medya ve bağlam kimliği; bozuk öğe partiyi düşürmez", () => {
    const r = parseMetaWebhook(
      payload(
        [
          { from: "905321112233", id: "w1", timestamp: "1793361600", type: "text", text: { body: "var, dolapta" }, context: { id: "wamid.Q1" } },
          { from: "905321112233", id: "w2", type: "interactive", interactive: { button_reply: { id: "hq.q1.1.send", title: "Gönder" } } },
          { from: "905321112233", id: "w3", type: "button", button: { payload: "hq.q1.1.self", text: "Ben yazacağım" } },
          { from: "905321112233", id: "w4", type: "audio", audio: {} },
          { id: "w5", type: "text", text: { body: "göndereni yok" } },
          "çöp",
        ],
        [{ id: "wamid.Q1", status: "failed", recipient_id: "905321112233", timestamp: "1793361600", errors: [{ code: 131047 }] }],
      ),
    );
    expect(r.phoneNumberIds).toEqual(["PNID"]);
    expect(r.messages.map((m) => [m.kind, m.providerMessageId, m.contextId])).toEqual([
      ["text", "w1", "wamid.Q1"],
      ["button", "w2", null],
      ["button", "w3", null],
      ["unsupported", "w4", null],
    ]);
    expect(r.statuses).toEqual([{ providerMessageId: "wamid.Q1", status: "failed", recipient: "905321112233", at: expect.any(Date), errorCode: 131047 }]);
  });
  it("başka nesne türü / boş gövde → hiçbir şey; uzun metin kesilir", () => {
    expect(parseMetaWebhook({ object: "page", entry: [] }).messages).toEqual([]);
    expect(parseMetaWebhook(null).messages).toEqual([]);
    const r = parseMetaWebhook(payload([{ from: "1", id: "w", type: "text", text: { body: "a".repeat(10_000) } }]));
    expect(r.messages[0]).toMatchObject({ kind: "text" });
    expect((r.messages[0] as { text: string }).text.length).toBe(INBOUND_TEXT_CAP);
  });
});

describe("ev sahibinin cevabından kurulan misafir cevabı — kod denetimi", () => {
  it("yalnız ev sahibinin sözü + bilgi tabanındaki sayılar; 20 ≠ 200; ev sahibinin sesi; yönlendirme / iletişim değeri yok", () => {
    expect(checkComposedGuestReply({ reply: "Yes, there is a baby cot in the bedroom wardrobe.", hostAnswer: "var, yatak odası dolabında" })).toBeNull();
    expect(checkComposedGuestReply({ reply: "Parking costs 200 TL per day.", hostAnswer: "otopark günlük 20 TL" })).toBe("number_not_in_source");
    expect(checkComposedGuestReply({ reply: "Parking costs 20 TL per day.", hostAnswer: "otopark günlük 20 TL" })).toBeNull();
    expect(checkComposedGuestReply({ reply: "Check-in is at 15:00.", hostAnswer: "evet", kbTexts: ["Giriş 15:00"] })).toBeNull();
    expect(checkComposedGuestReply({ reply: "Your host says there is a cot.", hostAnswer: "var" })).toBe("host_voice");
    expect(checkComposedGuestReply({ reply: "There is a cot. If you need anything else, message your host.", hostAnswer: "var" })).not.toBeNull();
    expect(checkComposedGuestReply({ reply: "Call me on +90 532 111 22 33.", hostAnswer: "beni ara +90 532 111 22 33" })).toBe("contact_value");
    expect(checkComposedGuestReply({ reply: "  ", hostAnswer: "var" })).toBe("empty");
    expect(numberTokens("14:00 ve 1.250,50 TL")).toEqual(["14:00", "1.250,50"]);
    // Tam saat denkliği (gerçek model denemesi 10-30): "en geç 13" → "13:00" geçer; dakika uydurulamaz; "13" "130" değildir.
    expect(checkComposedGuestReply({ reply: "Check-out is possible until 13:00 at the latest.", hostAnswer: "14 olmaz, en geç 13" })).toBeNull();
    expect(checkComposedGuestReply({ reply: "Check-out is possible until 13:30.", hostAnswer: "en geç 13" })).toBe("number_not_in_source");
    expect(checkComposedGuestReply({ reply: "The fee is 130 TL.", hostAnswer: "ücret 13" })).toBe("number_not_in_source");
    expect(checkComposedGuestReply({ reply: "Check-in from 09:00.", hostAnswer: "9da gelebilir" })).not.toBe("number_not_in_source");
  });
});

describe("cevap türü — modelden önce kodla", () => {
  it.each([
    [{ kind: "text" as const, text: "DUR" }, "opt_out"],
    [{ kind: "text" as const, text: "stop" }, "opt_out"],
    [{ kind: "text" as const, text: "Tamam, ben yazarım" }, "host_takes_over"],
    [{ kind: "text" as const, text: "I'll handle it" }, "host_takes_over"],
    [{ kind: "button" as const, buttonId: "hq.q1.1.self" }, "host_takes_over"],
    [{ kind: "unsupported" as const }, "unsupported"],
    [{ kind: "text" as const, text: "dur bir dakika, otopark 20 TL" }, null],
    [{ kind: "text" as const, text: "var, dolapta" }, null],
  ])("%j → %s", (event, kind) => {
    expect(codeAnswerKind(event)).toBe(kind);
  });
});

describe("sahte gönderici — sağlayıcıdan bağımsız arayüz", () => {
  it("çekirdek yalnız arayüzü bilir: soru + serbest metin, yanıt kimliğiyle", async () => {
    const sent: unknown[] = [];
    const fake: HostChannelTransport = {
      provider: "fake",
      async sendQuestion(to, message) {
        sent.push({ to, message });
        return { ok: true, providerMessageId: `fake.${sent.length}` };
      },
      async sendText(to, text, replyTo) {
        sent.push({ to, text, replyTo });
        return { ok: true, providerMessageId: `fake.${sent.length}` };
      },
    };
    const r = await fake.sendQuestion("905321112233", { property: "Lale", dates: "12–15 Kas", quote: "Bebek yatağı var mı?" });
    expect(r.providerMessageId).toBe("fake.1");
    await fake.sendText("905321112233", "Gönderildi ✓", r.providerMessageId);
    expect(sent).toHaveLength(2);
  });
});

describe("misafir alıntısı — ad parçaları ve rakam yazısı (Haiku 10-30 P2-1 / P2-2 / P3-2)", () => {
  it.each([
    "Merhaba ben Ayşe, bebek yatağı var mı?",
    "AYŞE YILMAZ burada, bebek yatağı var mı?",
    "ayşe yılmaz: bebek yatağı var mı?",
    "Ayşe'nin bebeği için yatak var mı?",
  ])("ad parçası büyük / küçük harf ve ekle de silinir: %j", (t) => {
    const q = maskedGuestQuote(t, ["Ayşe Yılmaz"]);
    expect(q).not.toMatch(/ay[şs]e|y[ıi]lmaz/iu);
    expect(q).toMatch(/yata[kğ]/u);
  });
  it("ad parçası başka sözcüğün içinde silinmez (Ayşegül ≠ Ayşe)", () => {
    expect(maskedGuestQuote("Ayşegül Hanım da gelecek.", ["Ayşe Yılmaz"])).toContain("Ayşegül");
  });
  it.each(["Numaram ٠٥٣٢١١١٢٢٣٣, bebek yatağı?", "Numaram ０５３２１１１２２３３, bebek yatağı?"])("başka rakam yazısıyla telefon da maskelenir: %j", (t) => {
    const q = maskedGuestQuote(t);
    expect(q).not.toMatch(/5321112233|٥٣٢|５３２/u);
  });
  it("kısaltma vekil çifti ortadan bölmez", () => {
    const q = maskedGuestQuote(`${"a".repeat(158)}😀 sonra`);
    expect(q).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
    expect([...q].length).toBeLessThanOrEqual(QUOTE_MAX);
  });
});

