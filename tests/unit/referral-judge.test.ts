import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// S-1 — ÜÇÜNCÜ TARAF YÖNLENDİRME DENETİMİ (kurucu 10-30: "S-1 yeni model çağrıları yapabilirsin"; `ai/semantic/referral-judge.ts`, anahtar
// `AI_REFERRAL_JUDGE_ENABLED` KAPALI, yalnız kıdemli okuyucuyla). Ayrı, kısa, odaklı çağrı yalnız taslağı okur; hükmü kapının `reply_host_voice`
// tutuşuna kod yedeğiyle VEYA'lanır (yalnız TUTAR). Özel işletme + üçüncü kişi ev sahibi tutar; kamu kurumu yalnız ölçülür. Saf parçalar + çağrı
// gövdesi + okuyucu içinden paralel çağrı + kanal / QR kapı hükmü + yeniden yazma sebebi.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import {
  REFERRAL_JUDGE_JSON_SCHEMA,
  REFERRAL_JUDGE_SYSTEM_PROMPT,
  buildReferralJudgeUserContent,
  parseReferralVerdict,
  referralJudgeFlag,
  runReferralJudge,
} from "@/lib/ai/semantic/referral-judge";
import { referralHolds, rereadComplete, runAbsenceJudge, type AbsenceJudgeOutcome } from "@/lib/ai/semantic/absence-judge";
import { seniorRewriteReasons } from "@/lib/ai/semantic/senior-rewrite";
import { hostVoiceViolation } from "@/lib/ai/host-voice-guard";
import { autoReplyGateVerdict } from "@/lib/automation";
import { evaluateEscalation } from "@/lib/guest-chat-gate";

afterEach(() => {
  vi.unstubAllEnvs();
});

const verdict = (v: Partial<Record<string, unknown>> = {}) => ({
  third_party_business: false,
  third_party_public: false,
  host_third_person: false,
  business_quote: "",
  public_quote: "",
  host_quote: "",
  ...v,
});
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(data) } }] }), { status });

describe("ayrıştırma — karar yalnız açık 'evet'ten; bozuk alan → hüküm yok", () => {
  it("üç hüküm ayrı ayrı okunur", () => {
    expect(parseReferralVerdict(verdict())).toEqual({ business: false, publicBody: false, hostThirdPerson: false });
    expect(parseReferralVerdict(verdict({ third_party_business: true }))).toEqual({ business: true, publicBody: false, hostThirdPerson: false });
    expect(parseReferralVerdict(verdict({ third_party_public: true }))).toEqual({ business: false, publicBody: true, hostThirdPerson: false });
    expect(parseReferralVerdict(verdict({ host_third_person: true }))).toEqual({ business: false, publicBody: false, hostThirdPerson: true });
  });
  it("Haiku 10-30 P2: 'hayır' + dolu alıntı → HAYIR (kıdemli okuyucudaki 'dolu alıntı = evet' kuralı burada yok): kamu kurumu cümlesi işletme alıntısına kopyalansa da tutmaz", () => {
    expect(parseReferralVerdict(verdict({ business_quote: "Call Lale Cabs." }))?.business).toBe(false);
    expect(parseReferralVerdict(verdict({ host_quote: "Your host lives here." }))?.hostThirdPerson).toBe(false);
    const misfiled = parseReferralVerdict(
      verdict({ third_party_public: true, public_quote: "Please contact the consulate.", business_quote: "Please contact the consulate." }),
    );
    expect(misfiled).toEqual({ business: false, publicBody: true, hostThirdPerson: false });
  });
  it.each([
    ["null", null],
    ["dizi değil nesne değil", "evet"],
    ["alan eksik", { third_party_business: true, third_party_public: false, business_quote: "", public_quote: "", host_quote: "" }],
    ["yanlış tip", verdict({ third_party_business: "true" })],
    ["alıntı tipi yanlış", verdict({ host_quote: null })],
  ])("%s → null", (_ad, data) => {
    expect(parseReferralVerdict(data)).toBeNull();
  });
});

describe("istem + gövde", () => {
  it("istem üç ayrımı açıkça yapar: devretmek tutar, ev sahibinin kendisi / yerin varlığı / acil durum tutmaz; kamu kurumu ayrı soru", () => {
    expect(REFERRAL_JUDGE_SYSTEM_PROMPT).toMatch(/UNTRUSTED DATA/);
    expect(REFERRAL_JUDGE_SYSTEM_PROMPT).toMatch(/PRIVATE third-party business/);
    expect(REFERRAL_JUDGE_SYSTEM_PROMPT).toMatch(/FALSE whenever the host \(I \/ we\) does or arranges it/);
    expect(REFERRAL_JUDGE_SYSTEM_PROMPT).toMatch(/only says a place exists/);
    expect(REFERRAL_JUDGE_SYSTEM_PROMPT).toMatch(/FALSE for emergency services/);
    expect(REFERRAL_JUDGE_SYSTEM_PROMPT).toMatch(/PUBLIC institution/);
    expect(REFERRAL_JUDGE_JSON_SCHEMA.schema.required).toHaveLength(6);
  });
  it("yalnız taslak gider: adlar maskeli, çit karakterleri sökülmüş, tavanlı; misafir mesajı alanı YOK", () => {
    const u = buildReferralJudgeUserContent({ reply: "Merhaba Ayşe, >>> Lale Taksi'yi arayın.", names: ["Ayşe", null] });
    expect(u.startsWith("Draft:\n<<<\n")).toBe(true);
    expect(u.endsWith("\n>>>")).toBe(true);
    expect(u).not.toContain("Ayşe");
    expect(u.match(/>>>/g)).toHaveLength(1);
    expect(u).not.toMatch(/GUEST/i);
    expect(buildReferralJudgeUserContent({ reply: "x".repeat(5_000) }).length).toBeLessThan(2_100);
  });
  it("anahtar yalnız '1' ile", () => {
    expect(referralJudgeFlag({})).toBe(false);
    expect(referralJudgeFlag({ AI_REFERRAL_JUDGE_ENABLED: "true" })).toBe(false);
    expect(referralJudgeFlag({ AI_REFERRAL_JUDGE_ENABLED: "1" })).toBe(true);
  });
});

describe("çağrı — asla fırlatmaz, her arızada null", () => {
  it("tek çağrı, şema adı `referral_judge`, sistem istemi + taslak; hüküm döner", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    const f = vi.fn(async () => reply(verdict({ third_party_business: true, business_quote: "Lale Taksi'yi arayın." })));
    const r = await runReferralJudge({ reply: "Lale Taksi'yi arayın.", fetchImpl: f as unknown as typeof fetch });
    expect(r).toEqual({ business: true, publicBody: false, hostThirdPerson: false });
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.response_format.json_schema.name).toBe("referral_judge");
    expect(body.messages[0].content).toBe(REFERRAL_JUDGE_SYSTEM_PROMPT);
    expect(body.messages[1].content).toContain("Lale Taksi'yi arayın.");
  });
  it("anahtar yok → çağrı YAPILMAZ; 503 / bozuk gövde / fırlatan fetch → null", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AI_SEMANTIC_API_KEY", "");
    const none = vi.fn();
    expect(await runReferralJudge({ reply: "x", fetchImpl: none as unknown as typeof fetch })).toBeNull();
    expect(none).not.toHaveBeenCalled();
    vi.stubEnv("OPENAI_API_KEY", "k");
    expect(await runReferralJudge({ reply: "x", fetchImpl: (async () => new Response("down", { status: 503 })) as unknown as typeof fetch })).toBeNull();
    expect(await runReferralJudge({ reply: "x", fetchImpl: (async () => reply({ yanlis: 1 })) as unknown as typeof fetch })).toBeNull();
    const boom = (async () => {
      throw new Error("ağ yok");
    }) as unknown as typeof fetch;
    await expect(runReferralJudge({ reply: "x", fetchImpl: boom })).resolves.toBeNull();
  });
});

const SENIOR_NOTHING = {
  admits_missing_info: false,
  quote: "",
  pays_host_off_platform: false,
  payment_quote: "",
  off_platform_contact: false,
  contact_quote: "",
  apology_or_fault: false,
  apology_quote: "",
  names_internal_source: false,
  source_quote: "",
};
/** Şema adına göre sahte okuyucu: kıdemli okuyucu her şeye "hayır", denetim verilen hükmü verir (ya da düşer). */
function readers(referral: Record<string, unknown> | "down") {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    if (name === "senior_reader") return reply(SENIOR_NOTHING);
    if (name === "referral_judge") return referral === "down" ? new Response("down", { status: 503 }) : reply(referral);
    throw new Error(`beklenmeyen şema: ${name}`);
  });
}
const schemas = (f: ReturnType<typeof readers>) =>
  f.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).response_format.json_schema.name as string).sort();

describe("okuyucunun içinden paralel çağrı", () => {
  const DRAFT = "Check-in is from 15:00. For dinner tonight, Copper Hearth Bistro takes reservations by phone, so book early.";

  it("anahtar KAPALI: yalnız iki okuma (bugünkü davranış, çağrı sayısı aynı); hükümde `referral` yok", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    const f = readers(verdict({ third_party_business: true }));
    const out = await runAbsenceJudge({ guestMessage: "q", reply: DRAFT, fetchImpl: f as unknown as typeof fetch });
    expect(schemas(f)).toEqual(["senior_reader", "senior_reader"]);
    expect(out.status === "ok" && out.referral).toBeFalsy();
    expect(referralHolds(out)).toBe(false);
  });
  it("anahtar açık ama kıdemli okuyucu kapalı (yalnız bilgim-yok hakemi): denetim KOŞMAZ", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("AI_REFERRAL_JUDGE_ENABLED", "1");
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      const name = JSON.parse(String(init?.body)).response_format.json_schema.name;
      return name === "absence_judge" ? reply({ admits_missing_info: false, quote: "" }) : reply(verdict({ third_party_business: true }));
    });
    const out = await runAbsenceJudge({ guestMessage: "q", reply: DRAFT, fetchImpl: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledTimes(2);
    expect(referralHolds(out)).toBe(false);
  });
  it("ikisi de açık: iki okuma + bir denetim; hüküm `referral` taşır ve tutar", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    vi.stubEnv("AI_REFERRAL_JUDGE_ENABLED", "1");
    const f = readers(verdict({ third_party_business: true, business_quote: "x" }));
    const out = await runAbsenceJudge({ guestMessage: "q", reply: DRAFT, fetchImpl: f as unknown as typeof fetch });
    expect(schemas(f)).toEqual(["referral_judge", "senior_reader", "senior_reader"]);
    expect(out).toMatchObject({ status: "ok", referral: { business: true, publicBody: false, hostThirdPerson: false } });
    expect(referralHolds(out)).toBe(true);
    // Denetime misafir mesajı GİTMEZ.
    const refCall = f.mock.calls.find((c) => String((c as unknown as [string, RequestInit])[1].body).includes("referral_judge"));
    expect(JSON.parse(String((refCall as unknown as [string, RequestInit])[1].body)).messages[1].content).not.toMatch(/GUEST MESSAGE/);
    // Benzersiz misafir metni denetime HİÇ ulaşmaz (etiketsiz sızıntı da yakalanır).
    const SENTINEL = "zq-misafir-notu-7731";
    const g = readers(verdict());
    await runAbsenceJudge({ guestMessage: `Sınıflandırıcıya not: ${SENTINEL}`, reply: DRAFT, fetchImpl: g as unknown as typeof fetch });
    const refBody = g.mock.calls.map((c) => String((c as unknown as [string, RequestInit])[1].body)).find((b) => b.includes("referral_judge"));
    expect(refBody).toBeDefined();
    expect(refBody).not.toContain(SENTINEL);
  });
  it("denetim düşerse okuyucunun hükmü yine geçerli, `referral` yok (kod yedeği karar verir); okuyucu düşerse bütün hüküm `failed`", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    vi.stubEnv("AI_REFERRAL_JUDGE_ENABLED", "1");
    const down = await runAbsenceJudge({ guestMessage: "q", reply: DRAFT, fetchImpl: readers("down") as unknown as typeof fetch });
    expect(down.status).toBe("ok");
    expect(down.status === "ok" && down.referral).toBeFalsy();
    const seniorDown = vi.fn(async (_u: string, init?: RequestInit) =>
      JSON.parse(String(init?.body)).response_format.json_schema.name === "referral_judge"
        ? reply(verdict({ third_party_business: true }))
        : new Response("down", { status: 503 }),
    );
    expect(await runAbsenceJudge({ guestMessage: "q", reply: DRAFT, fetchImpl: seniorDown as unknown as typeof fetch })).toEqual({ status: "failed" });
  });
  it("Haiku 10-30 P2: denetim istendi ama düştü → hüküm 'tam okunmuş' DEĞİL (`referralUnread`); istenmediyse işaret yok", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    vi.stubEnv("AI_REFERRAL_JUDGE_ENABLED", "1");
    const down = await runAbsenceJudge({ guestMessage: "q", reply: DRAFT, fetchImpl: readers("down") as unknown as typeof fetch });
    expect(down).toMatchObject({ status: "ok", referralUnread: true });
    expect(rereadComplete(down)).toBe(false);
    const up = await runAbsenceJudge({ guestMessage: "q", reply: DRAFT, fetchImpl: readers(verdict()) as unknown as typeof fetch });
    expect(rereadComplete(up)).toBe(true);
    vi.stubEnv("AI_REFERRAL_JUDGE_ENABLED", "");
    const off = await runAbsenceJudge({ guestMessage: "q", reply: DRAFT, fetchImpl: readers("down") as unknown as typeof fetch });
    expect(off.status === "ok" && off.referralUnread).toBeFalsy();
    expect(rereadComplete(off)).toBe(true);
    expect(rereadComplete({ status: "failed" })).toBe(false);
  });

  it("girdi `referral: true` anahtarı ezer (ölçer); `referral: false` kapatır", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    const on = readers(verdict({ host_third_person: true }));
    expect(referralHolds(await runAbsenceJudge({ guestMessage: "q", reply: DRAFT, referral: true, fetchImpl: on as unknown as typeof fetch }))).toBe(true);
    vi.stubEnv("AI_REFERRAL_JUDGE_ENABLED", "1");
    const off = readers(verdict({ third_party_business: true }));
    await runAbsenceJudge({ guestMessage: "q", reply: DRAFT, referral: false, fetchImpl: off as unknown as typeof fetch });
    expect(schemas(off)).toEqual(["senior_reader", "senior_reader"]);
  });
});

const ok = (referral?: { business: boolean; publicBody: boolean; hostThirdPerson: boolean }): AbsenceJudgeOutcome => ({
  status: "ok",
  admits: false,
  quote: "",
  checks: { payHost: false, contact: false, apology: false, internalSource: false },
  ...(referral ? { referral } : {}),
});
const NONE = { business: false, publicBody: false, hostThirdPerson: false };

describe("tutma hükmü — yalnız özel işletme ve üçüncü kişi ev sahibi; kamu kurumu tutmaz", () => {
  it("referralHolds", () => {
    expect(referralHolds(undefined)).toBe(false);
    expect(referralHolds({ status: "failed" })).toBe(false);
    expect(referralHolds(ok())).toBe(false);
    expect(referralHolds(ok(NONE))).toBe(false);
    expect(referralHolds(ok({ ...NONE, business: true }))).toBe(true);
    expect(referralHolds(ok({ ...NONE, hostThirdPerson: true }))).toBe(true);
    expect(referralHolds(ok({ ...NONE, publicBody: true }))).toBe(false);
  });
  it("yeniden yazma sebebi: denetimin tutuşu da 'hostVoice'", () => {
    const checks = { payHost: false, contact: false, apology: false, internalSource: false };
    expect(seniorRewriteReasons(checks, { contactHolds: false, apologyRule: false, hostVoiceJudged: true })).toEqual(["hostVoice"]);
    expect(seniorRewriteReasons(checks, { contactHolds: false, apologyRule: false, hostVoiceJudged: false })).toEqual([]);
    // Kod yedeği + denetim aynı turda: sebep TEK kez.
    expect(seniorRewriteReasons(checks, { contactHolds: false, apologyRule: false, hostVoiceLexical: true, hostVoiceJudged: true })).toEqual([
      "hostVoice",
    ]);
  });
});

// Kod yedeğinin KAÇIRDIĞI gerçek bir yönlendirme (10-30 kör setinden; gerçek denetim tuttu, kod tutmadı): kapı yalnız denetimin hükmüyle tutabilir.
const MISSED = "Check-in is from 15:00. For dinner tonight, Copper Hearth Bistro takes reservations by phone, so book early because they fill up fast.";
const model = (r: string) =>
  ({
    intent: "general",
    confidence: 0.95,
    reply: r,
    source: "openai",
    priority: "standard",
    riskLevel: "none",
    detectedLanguage: "en",
    usedSources: ["kb:dining"],
  }) as Parameters<typeof autoReplyGateVerdict>[0];

describe("kapı bağlantısı — kanal ve QR aynı ayrıntıyla tutar", () => {
  it("ön koşul: kod yedeği bu metni tutmuyor (yoksa test denetimi sınamaz)", () => {
    expect(hostVoiceViolation(MISSED)).toBeNull();
  });
  it("kanal: denetim 'özel işletme' → reply_host_voice; kamu kurumu / denetim yok / başka metnin hükmü → tutmaz", () => {
    const ctx = (o: AbsenceJudgeOutcome, text = MISSED) => ({ absenceJudge: { reply: text, outcome: o } });
    expect(autoReplyGateVerdict(model(MISSED), "Where can we eat tonight?", ctx(ok({ ...NONE, business: true })))?.detail).toBe("reply_host_voice");
    expect(autoReplyGateVerdict(model(MISSED), "Where can we eat tonight?", ctx(ok({ ...NONE, hostThirdPerson: true })))?.detail).toBe("reply_host_voice");
    expect(autoReplyGateVerdict(model(MISSED), "Where can we eat tonight?", ctx(ok({ ...NONE, publicBody: true })))).toBeNull();
    expect(autoReplyGateVerdict(model(MISSED), "Where can we eat tonight?", ctx(ok()))).toBeNull();
    expect(autoReplyGateVerdict(model(MISSED), "Where can we eat tonight?")).toBeNull();
    // Hüküm OKUNDUĞU metne bağlıdır: başka metnin "evet"i bu metni tutmaz.
    expect(autoReplyGateVerdict(model(MISSED), "Where can we eat tonight?", ctx(ok({ ...NONE, business: true }), "başka metin"))).toBeNull();
  });
  it("kanal: acil durdurma (`AI_HOST_VOICE_GUARD_DISABLED=1`) denetimin tutuşunu da kapatır; teşhis kipinde atlanır", () => {
    const ctx = { absenceJudge: { reply: MISSED, outcome: ok({ ...NONE, business: true }) } };
    // Pozitif kontrol (Haiku 10-30 P3: aşağıdaki iki "null" boşta da geçmesin): aynı bağlam anahtarsız / teşhissiz TUTAR.
    expect(autoReplyGateVerdict(model(MISSED), "Where can we eat tonight?", ctx)?.detail).toBe("reply_host_voice");
    expect(autoReplyGateVerdict(model(MISSED), "Where can we eat tonight?", { ...ctx, skipOutputVetoForDiagnosis: true })).toBeNull();
    vi.stubEnv("AI_HOST_VOICE_GUARD_DISABLED", "1");
    expect(autoReplyGateVerdict(model(MISSED), "Where can we eat tonight?", ctx)).toBeNull();
  });
  it("QR: aynı hüküm aynı sebep (yüksek güven ve bilgi bandı); kamu kurumu tutmaz", () => {
    const qr = (o: AbsenceJudgeOutcome, confidence = 0.95) =>
      evaluateEscalation({ ...model(MISSED), reply: MISSED, usedSources: ["kb:dining"], confidence }, "Where can we eat tonight?", undefined, undefined, {
        absenceJudge: { reply: MISSED, outcome: o },
      });
    expect(qr(ok({ ...NONE, business: true }))).toEqual({ escalate: true, reason: "reply_host_voice" });
    expect(qr(ok({ ...NONE, publicBody: true }))).toEqual({ escalate: false, reason: null });
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "1");
    expect(qr(ok({ ...NONE, business: true }), 0.6)).toEqual({ escalate: true, reason: "reply_host_voice" });
    expect(qr(ok(NONE), 0.6)).toEqual({ escalate: false, reason: "informational_low_confidence" });
  });
});
