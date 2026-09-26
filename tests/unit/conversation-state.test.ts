import { describe, it, expect, afterEach, vi } from "vitest";
import {
  buildConversationState,
  conversationStateBlock,
  conversationStateEnabled,
  decisionTopic,
  MAX_STATE_ITEMS,
  STATE_DECISION_WINDOW,
  type StateDecision,
  type StateMessage,
} from "@/lib/ai/conversation-state";

// ---------------------------------------------------------------------------
// KONUŞMA ANLAMA DURUMU v1 — dilim B (09-25). Karar kaydından (RiskEvent) açık konu durumu: ev sahibine bırakıldı /
// kararın ev sahibinde olduğu söylendi / ev sahibi yazdı / kod onayladı. Kayıt yoksa HİÇBİR ŞEY söylenmez (bilinmiyor ≠
// istek yok). Konu adı yalnız model/kod kaynaklı kapalı-küme kodlardan; kelime ağı uyarısı konu adı OLMAZ.
// ---------------------------------------------------------------------------

let seq = 0;
const guest = (id?: string): StateMessage => ({ id: id ?? `g${++seq}`, direction: "inbound", senderName: "Misafir", authorType: "guest", body: "…" });
const ai = (): StateMessage => ({ id: `a${++seq}`, direction: "outbound", senderName: "GuestOps AI", authorType: "ai", body: "cevap" });
const host = (): StateMessage => ({ id: `h${++seq}`, direction: "outbound", senderName: "Ayşe", authorType: "host", body: "cevap" });

const ev = (o: Record<string, unknown>) => JSON.stringify(o);
const decision = (triggerId: string, over: Partial<StateDecision> = {}): StateDecision => ({
  triggerId,
  surface: "auto_reply",
  finalDecision: "human_review",
  reason: "low_confidence_or_risky",
  riskType: null,
  kbEvidenceJson: null,
  ...over,
});
const stayAsk = (asked: string, stance = "none") => ev({ sc: { v: "-", ev: "-", lx: "-", d: `${asked}/${stance}`, g: "ok", u: "req" } });

describe("durum — karar kaydından açık konular", () => {
  it("kayıt yoksa HİÇBİR konu yok (bilinmiyor ≠ istek yok); sayılar mesajlardan", () => {
    const s = buildConversationState({ messages: [guest(), ai(), guest(), host(), guest(), guest()], decisions: [] });
    expect(s).toEqual({ outbound: 2, hostOutbound: 1, unansweredGuest: 2, items: [], lifecycleSent: [] });
  });

  it("🚨 kanal: tutulan mesajdan sonra misafire hiçbir şey gitmediyse → pending_host", () => {
    const m = guest();
    const s = buildConversationState({ messages: [guest(), ai(), m], decisions: [decision(m.id, { kbEvidenceJson: stayAsk("early_checkin") })] });
    expect(s.items).toEqual([{ topic: "early_checkin", status: "pending_host" }]);
  });

  it("tutulan mesajdan SONRA ev sahibi kendisi yazdı → host_replied", () => {
    const m = guest();
    const s = buildConversationState({ messages: [m, host()], decisions: [decision(m.id, { kbEvidenceJson: stayAsk("late_checkout") })] });
    expect(s.items).toEqual([{ topic: "late_checkout", status: "host_replied" }]);
  });

  it("kanal: tutulan mesajı sonraki bir yapay zekâ geçişi kapsadıysa kendi kaydı yok; durum O kararın kaydından (erteleme)", () => {
    const m1 = guest();
    const m2 = guest();
    const s = buildConversationState({
      messages: [m1, m2, ai()],
      decisions: [
        decision(m1.id, { kbEvidenceJson: stayAsk("early_checkin") }),
        decision(m2.id, { finalDecision: "auto_sent", reason: "gate_passed", kbEvidenceJson: stayAsk("early_checkin", "defers") }),
      ],
    });
    expect(s.items).toEqual([{ topic: "early_checkin", status: "deferred_to_host" }]);
  });

  it("🚨 kanal: kapsayan geçiş ertelemeden cevapladıysa eski tutuş 'bekliyor' SAYILMAZ (farklı konu — üzerine yazılma yok)", () => {
    // Mutasyon turu (CB20): yukarıdaki test aynı konuyu kullanıyordu; yeni karar eskisinin üstüne yazdığı için "kapsandı"
    // kuralı kaldırılsa da geçiyordu.
    const m1 = guest();
    const m2 = guest();
    const s = buildConversationState({
      messages: [m1, m2, ai()],
      decisions: [decision(m1.id, { riskType: "complaint" }), decision(m2.id, { finalDecision: "auto_sent", reason: "gate_passed" })],
    });
    expect(s.items).toEqual([]);
  });

  it("gönderilmiş erteleme + sonra ev sahibi yazdı → host_replied", () => {
    const m = guest();
    const s = buildConversationState({
      messages: [m, ai(), host()],
      decisions: [decision(m.id, { finalDecision: "auto_sent", reason: "gate_passed", kbEvidenceJson: stayAsk("extend", "defers") })],
    });
    expect(s.items).toEqual([{ topic: "extend", status: "host_replied" }]);
  });

  it("doğrulanmış erken giriş gönderildi → code_approved (ev sahibi sonra yazarsa host_replied)", () => {
    const m = guest();
    const d = decision(m.id, { finalDecision: "auto_sent", reason: "early_checkin_verified", kbEvidenceJson: ev({ ec: { s: "approvable", f: [], a: "1", n: "2" } }) });
    expect(buildConversationState({ messages: [m, ai()], decisions: [d] }).items).toEqual([{ topic: "early_checkin", status: "code_approved" }]);
    expect(buildConversationState({ messages: [m, ai(), host()], decisions: [d] }).items).toEqual([
      { topic: "early_checkin", status: "host_replied" },
    ]);
  });

  it("gönderilmiş, ertelemeyen cevap açık konu DEĞİL; kapanışa sessizlik (no_reply) açık konu DEĞİL", () => {
    const m1 = guest();
    const m2 = guest();
    const s = buildConversationState({
      messages: [m1, ai(), m2],
      decisions: [
        decision(m1.id, { finalDecision: "auto_sent", reason: "gate_passed", kbEvidenceJson: stayAsk("none", "none") }),
        decision(m2.id, { finalDecision: "no_reply", reason: "closing_ack" }),
      ],
    });
    expect(s.items).toEqual([]);
  });

  it("🚨 QR devri: misafire devir metni hemen gider → deferred_to_host (sonraki yapay zekâ mesajı 'kapsadı' SAYILMAZ)", () => {
    const m = guest();
    const s = buildConversationState({
      messages: [m, ai()],
      decisions: [decision(m.id, { surface: "guest_chat", reason: "escalate_intent", riskType: "complaint" })],
    });
    expect(s.items).toEqual([{ topic: "complaint", status: "deferred_to_host" }]);
  });

  it("aynı mesaja iki karar (tutuldu → sonra yeniden değerlendirmede gönderildi): gönderim kazanır", () => {
    const m = guest();
    const s = buildConversationState({
      messages: [m, ai()],
      decisions: [
        decision(m.id, { kbEvidenceJson: stayAsk("early_checkin") }),
        decision(m.id, { finalDecision: "auto_sent", reason: "early_checkin_verified", kbEvidenceJson: ev({ ec: { s: "approvable" } }) }),
      ],
    });
    expect(s.items).toEqual([{ topic: "early_checkin", status: "code_approved" }]);
  });

  it("konu başına EN YENİ durum; cevaplanmış bir bilgi sorusu eski ertelemeyi SİLMEZ", () => {
    const m1 = guest();
    const m2 = guest();
    const s = buildConversationState({
      messages: [m1, ai(), m2, ai()],
      decisions: [
        decision(m1.id, { finalDecision: "auto_sent", reason: "gate_passed", kbEvidenceJson: stayAsk("early_checkin", "defers") }),
        // Aynı konuda bilgi sorusu cevaplandı (politika metni) → durum yok; erteleme kalır.
        decision(m2.id, { finalDecision: "auto_sent", reason: "early_checkin_policy", kbEvidenceJson: ev({ ec: { s: "not_early" } }) }),
      ],
    });
    expect(s.items).toEqual([{ topic: "early_checkin", status: "deferred_to_host" }]);
  });

  it("sıra zamandır (en yeni sonda) ve en fazla MAX_STATE_ITEMS konu", () => {
    const kinds = ["early_checkin", "late_checkout", "extend", "date_change", "availability"];
    const msgs: StateMessage[] = [];
    const decs: StateDecision[] = [];
    for (const k of kinds) {
      const m = guest();
      msgs.push(m, host());
      decs.push(decision(m.id, { kbEvidenceJson: stayAsk(k) }));
    }
    const last = guest();
    msgs.push(last);
    decs.push(decision(last.id, { riskType: "complaint" }));
    const s = buildConversationState({ messages: msgs, decisions: decs });
    expect(s.items).toHaveLength(MAX_STATE_ITEMS);
    expect(s.items.map((i) => i.topic)).toEqual(["late_checkout", "extend", "date_change", "availability", "complaint"]);
    expect(s.items.at(-1)).toEqual({ topic: "complaint", status: "pending_host" });
  });

  it("🚨 aynı konu yeniden geçerse EN YENİ konumuna taşınır (5 sınırında yeni konu, eskinin yerine düşmez)", () => {
    // Mutasyon turu (CB22): konu tekrar etmeyen tek testte "eskiyi silip sona ekle" kaldırılınca hiçbir şey düşmüyordu.
    const m1 = guest();
    const m2 = guest();
    const m3 = guest();
    const s = buildConversationState({
      messages: [m1, host(), m2, host(), m3],
      decisions: [
        decision(m1.id, { kbEvidenceJson: stayAsk("early_checkin") }),
        decision(m2.id, { kbEvidenceJson: stayAsk("late_checkout") }),
        decision(m3.id, { kbEvidenceJson: stayAsk("early_checkin") }),
      ],
    });
    expect(s.items).toEqual([
      { topic: "late_checkout", status: "host_replied" },
      { topic: "early_checkin", status: "pending_host" },
    ]);
  });

  it(`yalnız son ${STATE_DECISION_WINDOW} misafir mesajının kaydı okunur`, () => {
    const old = guest();
    const msgs: StateMessage[] = [old];
    for (let i = 0; i < STATE_DECISION_WINDOW; i++) msgs.push(guest());
    const s = buildConversationState({ messages: msgs, decisions: [decision(old.id, { riskType: "complaint" })] });
    expect(s.items).toEqual([]);
    // KONTROL: pencere içindeyse görünür.
    expect(buildConversationState({ messages: msgs.slice(1).concat([]), decisions: [decision(msgs[1].id, { riskType: "complaint" })] }).items).toEqual([
      { topic: "complaint", status: "pending_host" },
    ]);
  });
});

describe("konu adı — yalnız model/kod kaynaklı kapalı küme", () => {
  const d = (o: Partial<StateDecision>) => decision("x", o);

  it("öncelik: erken giriş akışı > beyan > niyet etiketi > anlama riski > model niyeti > model risk etiketi > kayıt riskType", () => {
    expect(decisionTopic(d({ kbEvidenceJson: ev({ ec: { s: "pending" }, sc: { d: "late_checkout/none" } }) }))).toBe("early_checkin");
    expect(decisionTopic(d({ kbEvidenceJson: ev({ sc: { d: "late_checkout/none", ri: "early_checkin" } }) }))).toBe("late_checkout");
    expect(decisionTopic(d({ kbEvidenceJson: ev({ sc: { d: "none/none", ri: "early_checkin" } }) }))).toBe("early_checkin");
    expect(decisionTopic(d({ kbEvidenceJson: ev({ ir: { v: "understanding_risk", ev: "understanding_risk", k: "emergency" } }) }))).toBe("emergency");
    expect(decisionTopic(d({ kbEvidenceJson: ev({ g: { lx: [], mi: "refund" } }) }))).toBe("refund");
    expect(decisionTopic(d({ kbEvidenceJson: ev({ g: { lx: [], mt: "safety_emergency" } }) }))).toBe("emergency");
    expect(decisionTopic(d({ riskType: "human_request" }))).toBe("human");
  });

  it("🚨 kelime ağı uyarısı konu adı OLMAZ (düşük kesinlik) → 'other'", () => {
    expect(decisionTopic(d({ kbEvidenceJson: ev({ g: { d: "lexical_intent", lx: ["complaint"] } }) }))).toBe("other");
  });

  it("bozuk / tanınmayan kanıt çökertmez → 'other'; beyan 'absent' konu değildir", () => {
    expect(decisionTopic(d({ kbEvidenceJson: "{bozuk" }))).toBe("other");
    expect(decisionTopic(d({ kbEvidenceJson: ev({ sc: { d: "absent" } }) }))).toBe("other");
    expect(decisionTopic(d({ kbEvidenceJson: ev({ sc: { d: "toString/none" } }) }))).toBe("other");
    expect(decisionTopic(d({ kbEvidenceJson: "[1,2]", riskType: "not_a_type" }))).toBe("other");
  });
});

describe("yazar — authorType; yoksa eski ad kuralı; sistem olayı ve boş gövde sayılmaz", () => {
  it("🚨 sistem olayı işareti yazar alanından BAĞIMSIZ elenir (yazarı boş, adı ev sahibi gibi) — sayım kuralıyla parite", () => {
    // Mutasyon turu (CB28): yazar çözümleyici yazarı boş satırda işarete değil ADA bakar; işaret kontrolü kalkınca böyle
    // bir satır "ev sahibi yazdı" sayılıyordu. `countPriorOperatorReplies` de işaretli her satırı eler.
    const sys: StateMessage = { id: "s1", direction: "outbound", senderName: "Ayşe", authorType: null, systemEventType: "guest_chat_ai_resumed", body: "x" };
    const s = buildConversationState({ messages: [guest(), sys], decisions: [] });
    expect(s).toMatchObject({ outbound: 0, hostOutbound: 0, unansweredGuest: 1 });
  });

  it("eski satırlar: 'GuestOps AI' yapay zekâ, başka ad ev sahibi; sistem olayı/boş gövde mesaj değil", () => {
    const legacyAi: StateMessage = { id: "l1", direction: "outbound", senderName: "GuestOps AI", body: "x" };
    const legacyHost: StateMessage = { id: "l2", direction: "outbound", senderName: "Ayşe", body: "x" };
    const sys: StateMessage = { id: "l3", direction: "outbound", senderName: "x", authorType: "system", systemEventType: "guest_chat_ai_resumed", body: "" };
    const empty: StateMessage = { id: "l4", direction: "outbound", senderName: "Ayşe", authorType: "host", body: "  " };
    const s = buildConversationState({ messages: [guest(), legacyAi, legacyHost, sys, empty, guest()], decisions: [] });
    expect(s).toMatchObject({ outbound: 2, hostOutbound: 1, unansweredGuest: 1 });
  });

  it("eski QR 'yeniden başlatıldı' işareti (gövdeli, systemEventType'sız eski satır) giden mesaj DEĞİL; tutulan mesajı 'kapsamaz'", () => {
    const m = guest();
    const legacyResume: StateMessage = { id: "r1", direction: "outbound", senderName: "__lixus_ai_resumed__", body: "AI yeniden açıldı" };
    const s = buildConversationState({ messages: [m, legacyResume], decisions: [decision(m.id, { riskType: "complaint" })] });
    expect(s.outbound).toBe(0);
    expect(s.items).toEqual([{ topic: "complaint", status: "pending_host" }]);
  });
});

describe("politika metni", () => {
  it("bilgi sorusuna koddan politika metni gitti → açık konu değil (beyan 'defers' olsa bile)", () => {
    const m = guest();
    const s = buildConversationState({
      messages: [m, ai()],
      decisions: [
        decision(m.id, { finalDecision: "auto_sent", reason: "early_checkin_policy", kbEvidenceJson: stayAsk("early_checkin", "defers") }),
      ],
    });
    expect(s.items).toEqual([]);
  });
});

describe("istem bloğu", () => {
  it("söylenecek bir şey yoksa boş (ilk temas, kayıt yok, otomatik mesaj yok)", () => {
    expect(conversationStateBlock(undefined)).toBe("");
    expect(conversationStateBlock({ outbound: 0, hostOutbound: 0, unansweredGuest: 1, items: [], lifecycleSent: [] })).toBe("");
  });

  it("açık konular ETİKET olarak, kural satırıyla; otomatik bilgilendirmeler adıyla", () => {
    const b = conversationStateBlock({
      outbound: 3,
      hostOutbound: 1,
      unansweredGuest: 2,
      items: [
        { topic: "early_checkin", status: "pending_host" },
        { topic: "late_checkout", status: "deferred_to_host" },
        { topic: "extend", status: "host_replied" },
        { topic: "other", status: "code_approved" },
      ],
      lifecycleSent: ["welcome", "checkin"],
    });
    expect(b.startsWith("\n\nKONUŞMA KAYITLARI (kodda, kalıcı kayıtlardan kuruldu):")).toBe(true);
    expect(b).toContain("misafire giden mesaj: 3 (ev sahibinin kendisinin yazdığı: 1)");
    expect(b).toContain("misafirin yazdığı mesaj: 2.");
    expect(b).toContain("Otomatik gönderilmiş bilgilendirme: karşılama, giriş bilgileri.");
    expect(b).toContain("ETİKETİDİR, olgu değil");
    expect(b).toContain("· erken giriş: ev sahibine bırakıldı; o mesajdan sonra misafire hiçbir mesaj gitmedi.");
    expect(b).toContain("· geç çıkış: misafire kararın ev sahibinde olduğu söylendi; ev sahibi henüz yazmadı.");
    expect(b).toContain("· konaklama uzatma: bu konu açıldıktan sonra ev sahibi kendisi yazdı (onun cevabı esastır).");
    expect(b).toContain("· etiketsiz bir önceki mesaj: kod doğrulayıp onayladı; onay mesajı misafire gitti.");
    expect(b).toContain("karar VERME, söz VERME, sonuç UYDURMA");
  });

  it("açık konu yoksa kural satırı da yok (yalnız sayılar)", () => {
    const b = conversationStateBlock({ outbound: 2, hostOutbound: 0, unansweredGuest: 1, items: [], lifecycleSent: [] });
    expect(b).toContain("misafire giden mesaj: 2");
    expect(b).not.toContain("karar VERME");
    expect(b).not.toContain("Önceki konular");
  });
});

describe("bayrak", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("yalnız tam '1' açar (varsayılan kapalı)", () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "");
    expect(conversationStateEnabled()).toBe(false);
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "true");
    expect(conversationStateEnabled()).toBe(false);
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    expect(conversationStateEnabled()).toBe(true);
  });
});
