import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/ai/provider-health", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/provider-health")>()),
  noteModelProviderPersistentFailure: vi.fn(async () => {}),
  noteModelProviderSuccess: vi.fn(),
}));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));
import { REPLY_SYSTEM_PROMPT, REPLY_SYSTEM_PROMPT_DERIVATION_MISSING, replySystemPromptFor } from "@/lib/ai/prompts";
import { replyRequestIdentity } from "@/lib/ai";
import { complaintFollowupRuleEnabled } from "@/lib/ai/complaint-followup";
import {
  UNDERSTANDING_COMPLAINT_FOLLOWUP_ADDENDUM,
  UNDERSTANDING_ITEMS_PROMPT_ADDENDUM,
  UNDERSTANDING_RELATION_ADDENDUM,
  UNDERSTANDING_SYSTEM_PROMPT,
  __resetUnderstandingCache,
  understandGuestMessages,
  understandingSystemPromptFor,
} from "@/lib/ai/semantic/understand";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// ŞİKÂYET TAKİBİ KURALI (kök neden, kurucu kararı 10-01; anahtar `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` VARSAYILAN KAPALI): cevap istemi
// şikâyet edene kural hatırlatmaz, 112'yi yalnız gerçek can güvenliğinde önerir; anlama katmanı şikâyete bağlı yardım sorusunu ayrı
// istek saymaz. Kapalıyken iki istem bayt bayt aynı.
// ---------------------------------------------------------------------------

const input: SuggestReplyInput = {
  guestMessage: "Gürültü yüzünden uyuyamadık, yine olursa ne yapacağız?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  reservation: null,
  knowledgeBase: [],
  history: [],
  tone: "warm",
  language: "tr",
};
const RULE = "ŞİKÂYET EDENE KURAL HATIRLATMASI YAZMA";

beforeEach(() => __resetUnderstandingCache());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const RAW = {
  language: "tr",
  requests: [{ intent: "complaint_issue", query_tr: "gürültü şikâyeti", query_original: "gürültü şikâyeti" }],
  stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
};
function modelReturns(content: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200 }),
  );
}
const bodyOf = (f: ReturnType<typeof modelReturns>, i = 0) =>
  JSON.parse(String((f.mock.calls[i] as unknown as [string, RequestInit])[1].body));

describe("şikâyet takibi — cevap istemi katmanı", () => {
  it("🚨 kapalıyken ('true' / '0' dahil) sistem istemi bayt bayt taban", () => {
    for (const k of ["AI_CODE_GREETING_ENABLED", "AI_KB_FEE_RULE_ENABLED", "AI_STAY_DEFERRAL_PLAIN_ENABLED", "AI_ACCESS_CODE_COMPLETE_ENABLED"]) {
      vi.stubEnv(k, "");
    }
    for (const v of ["", "0", "true", "yes", " 1"]) {
      vi.stubEnv("AI_COMPLAINT_FOLLOWUP_RULE_ENABLED", v);
      expect(complaintFollowupRuleEnabled(), JSON.stringify(v)).toBe(false);
      expect(replyRequestIdentity(input).system).toBe(REPLY_SYSTEM_PROMPT);
    }
    expect(REPLY_SYSTEM_PROMPT).not.toContain(RULE);
  });

  it("açıkken iki kural girer; fark yalnız empati satırının ardı", () => {
    for (const k of ["AI_CODE_GREETING_ENABLED", "AI_KB_FEE_RULE_ENABLED", "AI_STAY_DEFERRAL_PLAIN_ENABLED", "AI_ACCESS_CODE_COMPLETE_ENABLED"]) {
      vi.stubEnv(k, "");
    }
    vi.stubEnv("AI_COMPLAINT_FOLLOWUP_RULE_ENABLED", "1");
    const sys = replyRequestIdentity(input).system;
    expect(sys).toBe(replySystemPromptFor({ codeGreeting: false, kbFeeRule: false, stayDeferralPlain: false, complaintFollowup: true }));
    expect(sys).toContain(RULE);
    expect(sys).toContain("Gürültü, arıza, temizlik, konfor şikâyetinde 112 / polis / acil servis ÖNERME.");
    const anchor = "  - Empati/özür EN FAZLA BİR cümle; hemen çözüme geç.\n";
    const at = REPLY_SYSTEM_PROMPT.indexOf(anchor) + anchor.length;
    expect(at).toBeGreaterThan(anchor.length);
    expect(sys.slice(0, at)).toBe(REPLY_SYSTEM_PROMPT.slice(0, at));
    expect(sys.endsWith(REPLY_SYSTEM_PROMPT.slice(at))).toBe(true);
  });

  it("tüm katman birleşimlerinde kayıp çapa YOK (128 birleşim — öğe kipi alanı + bırakılan istek önceliği 10-02)", () => {
    const missing = REPLY_SYSTEM_PROMPT_DERIVATION_MISSING();
    expect(Object.keys(missing)).toHaveLength(128);
    for (const [name, m] of Object.entries(missing)) expect(m, name).toEqual([]);
  });
});

describe("şikâyet takibi — anlama katmanı eki", () => {
  it("ek yalnız şikâyete bağlı yardım sorusunu birleştirir; bağımsız soru ayrı kalır (örnekler)", () => {
    expect(UNDERSTANDING_COMPLAINT_FOLLOWUP_ADDENDUM).toContain("is PART of that complaint");
    expect(UNDERSTANDING_COMPLAINT_FOLLOWUP_ADDENDUM).toContain("requests [complaint_issue, wifi]");
    expect(UNDERSTANDING_SYSTEM_PROMPT).not.toContain("COMPLAINT FOLLOW-UPS");
  });
});

describe("şikâyet takibi — anlama katmanı çağrısı", () => {
  it("complaintFollowup: true → istem eki; aynı içerik kapalı kipte AYRI çağrı (önbellek karışmaz)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    const f = modelReturns(RAW);
    await understandGuestMessages({ guestMessage: input.guestMessage, complaintFollowup: true, fetchImpl: f });
    expect(bodyOf(f).messages[0].content).toBe(`${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_COMPLAINT_FOLLOWUP_ADDENDUM}`);
    await understandGuestMessages({ guestMessage: input.guestMessage, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 1).messages[0].content).toBe(UNDERSTANDING_SYSTEM_PROMPT);
  });

  it("karar noktası kb-retrieve: yalnız tam '1' iken ek gider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    const f = modelReturns(RAW);
    vi.stubGlobal("fetch", f);
    const base = { items: [], guestMessage: input.guestMessage, history: [] };
    await (await retrieveKbForPrompt(base)).understanding;
    expect(bodyOf(f).messages[0].content).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    __resetUnderstandingCache();
    vi.stubEnv("AI_COMPLAINT_FOLLOWUP_RULE_ENABLED", "1");
    await (await retrieveKbForPrompt(base)).understanding;
    expect(bodyOf(f, 1).messages[0].content).toBe(`${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_COMPLAINT_FOLLOWUP_ADDENDUM}`);
    __resetUnderstandingCache();
    vi.stubEnv("AI_COMPLAINT_FOLLOWUP_RULE_ENABLED", "true");
    await (await retrieveKbForPrompt(base)).understanding;
    expect(bodyOf(f, 2).messages[0].content).toBe(UNDERSTANDING_SYSTEM_PROMPT);
  });
});

describe("ilişki kipi — öğe kipi + şikâyet takibi BİRLİKTE (kurucu kararı 10-01 sabah, Sabah Kararları 17 + 18 a)", () => {
  it("istem: ilişki eki eski şikâyet takibi ekinin YERİNE geçer; yalnız biri açıkken bugünkü istem", () => {
    expect(understandingSystemPromptFor({ items: true, complaintFollowup: true })).toBe(
      `${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_ITEMS_PROMPT_ADDENDUM}\n${UNDERSTANDING_RELATION_ADDENDUM}`,
    );
    expect(understandingSystemPromptFor({ complaintFollowup: true })).toBe(`${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_COMPLAINT_FOLLOWUP_ADDENDUM}`);
    expect(understandingSystemPromptFor({ items: true })).toBe(`${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_ITEMS_PROMPT_ADDENDUM}`);
    // Ek iade / iptal ve ev sahibi talebini de kapsar (kurucu) ve dört işareti tanımlar.
    for (const s of ["cancellation_refund", "human_request", "own_topic", "fix_request", "follow_up", "unclear", "Klima çalışmıyor; çöp konteyneri nerede?"]) {
      expect(UNDERSTANDING_RELATION_ADDENDUM, s).toContain(s);
    }
  });

  it("karar 23 (onaylı 18. madde): soru SORMADAN arıza bildirimi de ayrı bir arıza çözümü isteği alır; arıza olmayan şikâyet almaz", () => {
    expect(UNDERSTANDING_RELATION_ADDENDUM).toContain("even when no question is asked");
    expect(UNDERSTANDING_RELATION_ADDENDUM).toContain('"The internet stopped working an hour ago." -> [complaint_issue own_topic, wifi fix_request]');
    expect(UNDERSTANDING_RELATION_ADDENDUM).toContain('"Daire çok kirli." -> [complaint_issue own_topic]');
    // Eski şikâyet takibi eki (öğe kipi kapalıyken) DEĞİŞMEDİ — bayt bayt.
    expect(UNDERSTANDING_COMPLAINT_FOLLOWUP_ADDENDUM).not.toContain("even when no question is asked");
  });

  it("çağrı: şema her istekte 'relation' ister; çözücü işareti taşır (önbellek kipi ayrı)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    const body = "İnternet iki saattir yok, modemi nasıl resetleriz?";
    const f = modelReturns({
      language: "tr",
      requests: [
        { intent: "complaint_issue", query_tr: "internet yok", query_original: "internet yok", message: 1, relation: "own_topic" },
        { intent: "wifi", query_tr: "modem yeniden başlatma", query_original: "modem yeniden başlatma", message: 1, relation: "fix_request" },
      ],
      stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
      withdrawn: [],
    });
    const out = await understandGuestMessages({
      guestMessage: body,
      history: [{ id: "m1", direction: "inbound", body }],
      items: true,
      complaintFollowup: true,
      fetchImpl: f,
    });
    const sent = bodyOf(f);
    expect(sent.messages[0].content).toBe(understandingSystemPromptFor({ items: true, complaintFollowup: true }));
    expect(sent.response_format.json_schema.schema.properties.requests.items.required).toContain("relation");
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.value.requests.map((r) => r.relation)).toEqual(["own_topic", "fix_request"]);
  });
});
