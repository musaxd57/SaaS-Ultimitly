import { describe, it, expect } from "vitest";
import {
  chooseHostChannel,
  combinedQuote,
  hostAskKindOf,
  hostChannelFlagsFromEnv,
  ORG_HOURLY_QUESTION_CAP,
  type HostChannelFlags,
} from "@/lib/host-channel/routing";
import { QUOTE_MAX } from "@/lib/host-channel/question-text";

// ---------------------------------------------------------------------------
// Bildirim yönlendiricisi (WhatsApp tasarımı §3.1, §3.2, §7): hangi durum hangi tür soru olur, hangi kanaldan gider. SAF.
// ---------------------------------------------------------------------------

describe("durum → soru türü", () => {
  it("tutulan tur / cevapsız güvenli öğe / konusuz yönlendirme / kalan açık ihtiyaç / öğesiz K10 → bilgi sorusu", () => {
    for (const t of ["handoff_held", "parts_unanswered", "host_contact_notify", "stale_open", "k10_hold"] as const) {
      expect(hostAskKindOf(t, ["amenities"]), t).toBe("info");
      expect(hostAskKindOf(t), `${t} öğesiz`).toBe("info");
    }
  });
  it("karar kartı → karar sorusu; hassas öğe ve tehlike → acil bildirim (cevap kurulmaz)", () => {
    expect(hostAskKindOf("decision_card", ["early_checkin"])).toBe("decision");
    expect(hostAskKindOf("held_sensitive", ["payment_invoice"])).toBe("urgent");
    expect(hostAskKindOf("hazard")).toBe("urgent");
  });
  it("🚨 konaklama değişikliği, para / iade, şikâyet, acil, ev sahibi isteği ASLA bilgi sorusu olmaz → bugünkü e-posta", () => {
    for (const k of ["early_checkin", "late_checkout", "extend_stay", "date_change", "availability", "payment_invoice", "cancellation_refund", "complaint_issue", "emergency", "human_request"]) {
      expect(hostAskKindOf("parts_unanswered", ["wifi", k]), k).toBe("email_only");
    }
  });
  it("yalnız sessiz tür (kaynak / asistan sorusu) → hiçbir bildirim; sessiz tür yanında gerçek soru varsa bilgi sorusu", () => {
    expect(hostAskKindOf("parts_unanswered", ["about_assistant"])).toBe("silent");
    expect(hostAskKindOf("parts_unanswered", ["about_assistant", "parking"])).toBe("info");
  });
});

const ON: HostChannelFlags = { channel: true, questions: true, decisions: true, alerts: true, orgIds: new Set(["org-1"]) };
const base = { kind: "info" as const, orgId: "org-1", flags: ON, binding: "verified" as const, orgSentLastHour: 0 };

describe("kanal seçimi", () => {
  it("her şey açık + doğrulanmış numara → WhatsApp", () => {
    expect(chooseHostChannel(base)).toBe("whatsapp");
    expect(chooseHostChannel({ ...base, kind: "decision" })).toBe("whatsapp");
    expect(chooseHostChannel({ ...base, kind: "urgent" })).toBe("whatsapp");
  });
  it("biri eksikse bugünkü e-posta (anahtar, işletme listesi, numara doğrulanmamış / kaldırılmış / yok, türün anahtarı, saatlik tavan)", () => {
    expect(chooseHostChannel({ ...base, flags: { ...ON, channel: false } })).toBe("email");
    expect(chooseHostChannel({ ...base, orgId: "org-2" })).toBe("email");
    expect(chooseHostChannel({ ...base, flags: { ...ON, orgIds: new Set() } })).toBe("email");
    expect(chooseHostChannel({ ...base, binding: "pending" })).toBe("email");
    expect(chooseHostChannel({ ...base, binding: "revoked" })).toBe("email");
    expect(chooseHostChannel({ ...base, binding: null })).toBe("email");
    expect(chooseHostChannel({ ...base, flags: { ...ON, questions: false } })).toBe("email");
    expect(chooseHostChannel({ ...base, kind: "decision", flags: { ...ON, decisions: false } })).toBe("email");
    expect(chooseHostChannel({ ...base, kind: "urgent", flags: { ...ON, alerts: false } })).toBe("email");
    expect(chooseHostChannel({ ...base, orgSentLastHour: ORG_HOURLY_QUESTION_CAP })).toBe("email");
    expect(chooseHostChannel({ ...base, orgSentLastHour: ORG_HOURLY_QUESTION_CAP - 1 })).toBe("whatsapp");
  });
  it("'*' bütün işletmeler; sessiz tür hiçbir kanaldan gitmez; e-posta-yalnız tür WhatsApp açıkken de e-posta", () => {
    expect(chooseHostChannel({ ...base, orgId: "baska", flags: { ...ON, orgIds: "*" } })).toBe("whatsapp");
    expect(chooseHostChannel({ ...base, kind: "silent" })).toBe("none");
    expect(chooseHostChannel({ ...base, kind: "email_only" })).toBe("email");
  });
});

describe("ortam", () => {
  it("bayraklar yalnız '1' ile; liste boşsa hiçbir işletme, '*' hepsi, virgüllü liste kırpılır", () => {
    expect(hostChannelFlagsFromEnv({})).toMatchObject({ channel: false, questions: false, decisions: false, alerts: false });
    expect(hostChannelFlagsFromEnv({ HOST_CHANNEL_ENABLED: "true", HOST_QUESTIONS_ENABLED: "yes" })).toMatchObject({ channel: false, questions: false });
    const f = hostChannelFlagsFromEnv({ HOST_CHANNEL_ENABLED: "1", HOST_QUESTIONS_ENABLED: "1", HOST_CHANNEL_ORG_IDS: " org-1 , org-2 ,," });
    expect(f).toMatchObject({ channel: true, questions: true });
    expect([...(f.orgIds as Set<string>)]).toEqual(["org-1", "org-2"]);
    expect(hostChannelFlagsFromEnv({ HOST_CHANNEL_ORG_IDS: "*" }).orgIds).toBe("*");
    expect((hostChannelFlagsFromEnv({}).orgIds as Set<string>).size).toBe(0);
  });
});

describe("tur başına tek mesaj — birleşik alıntı", () => {
  it("tek soru aynen; birden çok soru numaralı", () => {
    expect(combinedQuote(["Bebek yatağı var mı?"])).toBe("Bebek yatağı var mı?");
    expect(combinedQuote(["Bebek yatağı var mı?", "Otopark var mı?"])).toBe("1) Bebek yatağı var mı? 2) Otopark var mı?");
    expect(combinedQuote([])).toBe("");
    expect(combinedQuote(["  ", "Otopark?"])).toBe("Otopark?");
  });
  it("sığmayan soru sayıyla belirtilir, sonuç ASLA şablon sınırını aşmaz (her uzunlukta)", () => {
    const long = "Merhaba, daireye ulaştığımızda otoparkın hangi katta olduğunu ve kaç araç sığdığını öğrenebilir miyiz lütfen, iki arabayla geliyoruz.";
    const out = combinedQuote([long, long, "Havlu var mı?"]);
    expect(out.length).toBeLessThanOrEqual(QUOTE_MAX);
    expect(out).toMatch(/^1\) Merhaba/);
    expect(out).toMatch(/\+2 soru daha$/);
    for (let n = 2; n <= 12; n++) {
      for (const len of [5, 40, 80, 159, 160]) {
        const r = combinedQuote(Array.from({ length: n }, (_, i) => `${"x".repeat(len - 1)}${i}`));
        expect(r.length, `${n}×${len}`).toBeLessThanOrEqual(QUOTE_MAX);
        expect(r.startsWith("1) "), `${n}×${len}`).toBe(true);
      }
    }
  });
  it("satır sonu / sekme / görünmez karakter şablona gitmez", () => {
    expect(combinedQuote(["Bebek\nyatağı​ var mı?", "Otopark\t?"])).toBe("1) Bebek yatağı var mı? 2) Otopark ?");
  });
});
