import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({ alertOnTransition: vi.fn(async () => "alerted"), clearAlertState: vi.fn(async () => {}) }));

import {
  ACTION_CLAIMS_PROMPT_BLOCK,
  ACTION_CLAIM_REASONS,
  CLAIMED_ACTION_KINDS,
  actionClaimEvidence,
  actionClaimHold,
  actionClaimsEnabled,
  cleanActionClaimEvidence,
  parseClaimedActions,
  type ClaimedActionKind,
  type ClaimedActionsDeclaration,
} from "@/lib/ai/action-claims";
import { autoReplyGateFailure, autoReplyGateVerdict, gateEvidenceOf, verifiedEarlyCheckinResult } from "@/lib/automation";
import { evaluateEscalation, ESCALATION_REASONS } from "@/lib/guest-chat-gate";
import { ESCALATION_REASON_CODES } from "@/lib/risk-events";
import { cleanGateEvidence } from "@/lib/ai/gate-evidence";
import { REPLY_SYSTEM_PROMPT, buildReplyPrompt } from "@/lib/ai/prompts";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// EYLEM BEYANI — `claimedActions` (MÇ §4; bayrak `AI_ACTION_CLAIMS_ENABLED`, varsayılan KAPALI). Kurucu kuralı: makbuzsuz
// eylem iddiası ("ilettim / ayarladım / size döneceğim") misafire GİTMEZ. Kelime tabanlı çıktı vetosu bunun yedeği; burada
// cevap modeli kendi metnindeki eylemleri kapalı kümeden beyan eder. Makbuz yok → boş olmayan beyan da, istenip gelmeyen
// beyan da tutulur. Bayrak kapalıyken istem bayt bayt aynı, kapı alanı hiç görmez.
// ---------------------------------------------------------------------------

const declared = (...actions: ClaimedActionKind[]): ClaimedActionsDeclaration => ({ status: "declared", actions });
const UNKNOWN: ClaimedActionsDeclaration = { status: "unknown" };

const GUEST = "What is the wifi password?";
const passing = {
  intent: "wifi",
  riskLevel: "none",
  confidence: 0.92,
  source: "openai",
  riskType: null,
  reply: "The Wi-Fi network is Lale-5G and the password is Lale2025.",
  usedSources: ["kb:wifi"],
};

describe("parseClaimedActions — STRICT (eksik/bozuk izin vermez)", () => {
  it.each([
    ["alan yok", undefined],
    ["null", null],
    ["dizi değil (metin)", "forwarded_to_host"],
    ["dizi değil (nesne)", { kind: "forwarded_to_host" }],
    ["metin olmayan öğe", [1]],
    ["nesne öğe", [{ kind: "forwarded_to_host" }]],
    ["karışık: biri bozuk", ["forwarded_to_host", null]],
  ])("%s → unknown", (_label, raw) => {
    expect(parseClaimedActions(raw)).toEqual(UNKNOWN);
  });

  it("boş liste = eylem iddiası yok", () => {
    expect(parseClaimedActions([])).toEqual(declared());
  });

  it("kümedeki kod aynen; tanınmayan metin → other (tanınmayan eylem de eylemdir)", () => {
    expect(parseClaimedActions(["forwarded_to_host"])).toEqual(declared("forwarded_to_host"));
    expect(parseClaimedActions(["Forwarded_To_Host"])).toEqual(declared("other"));
    expect(parseClaimedActions(["called_the_plumber"])).toEqual(declared("other"));
    expect(parseClaimedActions([""])).toEqual(declared("other"));
  });

  it("tekrar tekilleşir, sıra kümenin sırası, kenar boşluğu kırpılır", () => {
    expect(parseClaimedActions(["will_follow_up", " forwarded_to_host ", "will_follow_up"])).toEqual(
      declared("forwarded_to_host", "will_follow_up"),
    );
  });
});

describe("actionClaimHold — kapı yüklemi", () => {
  it("beyan istenmedi (alan yok) → kural koşmaz", () => {
    expect(actionClaimHold(undefined)).toBeNull();
    expect(actionClaimHold(null)).toBeNull();
  });
  it("boş liste geçer; boş olmayan liste action_claim; unknown action_claim_undeclared", () => {
    expect(actionClaimHold(declared())).toBeNull();
    expect(actionClaimHold(declared("will_follow_up"))).toBe("action_claim");
    expect(actionClaimHold(declared("other"))).toBe("action_claim");
    expect(actionClaimHold(UNKNOWN)).toBe("action_claim_undeclared");
  });
  it("her eylem kodu tek başına tutar", () => {
    for (const k of CLAIMED_ACTION_KINDS) expect(actionClaimHold(declared(k))).toBe("action_claim");
  });
});

describe("bayrak — yalnız tam '1'", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["", "0", "true", "yes", " 1", "1 "])("%j → kapalı", (v) => {
    vi.stubEnv("AI_ACTION_CLAIMS_ENABLED", v);
    expect(actionClaimsEnabled()).toBe(false);
  });
  it("'1' → açık", () => {
    vi.stubEnv("AI_ACTION_CLAIMS_ENABLED", "1");
    expect(actionClaimsEnabled()).toBe(true);
  });
});

describe("kanal kapısı — makbuzsuz eylem beyanı otomatik gitmez", () => {
  it("KONTROL: beyan istenmedi (bayrak kapalı) → bugünkü gibi geçer", () => {
    expect(autoReplyGateFailure(passing, GUEST)).toBeNull();
  });
  it("boş beyan geçer", () => {
    expect(autoReplyGateFailure({ ...passing, claimedActions: declared() }, GUEST)).toBeNull();
  });
  it("🚨 eylem beyanı → action_claim (kelime vetosunun kaçırdığı metinde de)", () => {
    expect(autoReplyGateFailure({ ...passing, claimedActions: declared("notified_team") }, GUEST)).toBe("action_claim");
  });
  it("🚨 istenip gelmeyen / bozuk beyan → action_claim_undeclared (tanınmayan ≠ temiz)", () => {
    expect(autoReplyGateFailure({ ...passing, claimedActions: UNKNOWN }, GUEST)).toBe("action_claim_undeclared");
  });
  it("kelime vetosu ÖNCE: ikisi de tutarsa gerekçe bugünküyle aynı (reply_output_veto)", () => {
    const vetoed = { ...passing, reply: "Talebinizi ev sahibinize ilettim.", claimedActions: declared("forwarded_to_host") };
    expect(autoReplyGateVerdict(vetoed, GUEST)).toEqual({ reason: "blocked", detail: "reply_output_veto" });
  });
  it("güvenlik kontrolleri eylem beyanından ÖNCE (risk düzeyi gerekçesi gölgelenmez)", () => {
    const risky = { ...passing, riskLevel: "high", claimedActions: declared("forwarded_to_host") };
    expect(autoReplyGateVerdict(risky, GUEST)).toEqual({ reason: "blocked", detail: "model_risk_level" });
  });
  it("teşhis kipi (erken giriş akışının tetiği) çıktı vetosuyla BİRLİKTE eylem beyanını da atlar", () => {
    const r = { ...passing, claimedActions: declared("will_follow_up") };
    expect(autoReplyGateFailure(r, GUEST, { skipOutputVetoForDiagnosis: true })).toBeNull();
    expect(autoReplyGateFailure({ ...passing, claimedActions: UNKNOWN }, GUEST, { skipOutputVetoForDiagnosis: true })).toBeNull();
  });
  it("düşük güven eylem beyanından SONRA (gerekçe beyan: 'düşük güven' kovasına karışmaz)", () => {
    const r = { ...passing, confidence: 0.3, claimedActions: declared("booked_or_reserved") };
    expect(autoReplyGateFailure(r, GUEST)).toBe("action_claim");
  });
});

describe("QR kapısı — kanalla AYNI yüklem", () => {
  it("KONTROL: beyan yok → geçer", () => {
    expect(evaluateEscalation(passing, GUEST)).toMatchObject({ escalate: false });
  });
  it("boş beyan geçer", () => {
    expect(evaluateEscalation({ ...passing, claimedActions: declared() }, GUEST)).toMatchObject({ escalate: false });
  });
  it("🚨 eylem beyanı → devir (action_claim)", () => {
    expect(evaluateEscalation({ ...passing, claimedActions: declared("arranged_service") }, GUEST)).toEqual({
      escalate: true,
      reason: "action_claim",
    });
  });
  it("🚨 unknown → devir (action_claim_undeclared)", () => {
    expect(evaluateEscalation({ ...passing, claimedActions: UNKNOWN }, GUEST)).toEqual({
      escalate: true,
      reason: "action_claim_undeclared",
    });
  });
  it("kelime vetosu önce (gerekçe unverified_commitment kalır)", () => {
    const vetoed = { ...passing, reply: "Talebinizi ev sahibinize ilettim.", claimedActions: declared("forwarded_to_host") };
    expect(evaluateEscalation(vetoed, GUEST)).toEqual({ escalate: true, reason: "unverified_commitment" });
  });
});

describe("gerekçe paritesi — sessizce NULL'a düşmez", () => {
  it("iki gerekçe risk-events REASONS ve QR ESCALATION_REASONS içinde", () => {
    for (const r of ACTION_CLAIM_REASONS) {
      expect(ESCALATION_REASON_CODES.has(r)).toBe(true);
      expect((ESCALATION_REASONS as readonly string[]).includes(r)).toBe(true);
    }
  });
  it("raporların 'size bırakılanlar' sorgusu iki gerekçeyi de sayar (satır görünmez kalmasın)", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(app)/reports/page.tsx"), "utf8");
    const start = src.indexOf("const HELD_REASONS = [");
    expect(start).toBeGreaterThan(-1);
    const list = src.slice(start, src.indexOf("];", start));
    for (const r of ACTION_CLAIM_REASONS) expect(list).toContain(`"${r}"`);
  });
});

describe("koddan kurulan doğrulanmış metin (erken giriş onayı / politika)", () => {
  it("modelin atılan taslağına ait beyan taşınmaz → [] (kapı tutmaz)", () => {
    const v = verifiedEarlyCheckinResult({ ...passing, claimedActions: declared("will_follow_up") }, "Onay metni");
    expect(v.claimedActions).toEqual(declared());
    expect(actionClaimHold(v.claimedActions)).toBeNull();
    const u = verifiedEarlyCheckinResult({ ...passing, claimedActions: UNKNOWN }, "Onay metni");
    expect(u.claimedActions).toEqual(declared());
  });
  it("beyan istenmediyse (bayrak kapalı) alan EKLENMEZ — bugünküyle birebir", () => {
    const v = verifiedEarlyCheckinResult(passing, "Onay metni");
    expect("claimedActions" in v).toBe(false);
  });
});

describe("karar kaydı kanıtı (g.ma) — yalnız kapalı-küme kodlar", () => {
  it("beyan kanıta girer; istenmediyse alan yok", () => {
    expect(gateEvidenceOf({ ...passing, claimedActions: declared("forwarded_to_host") }, GUEST, undefined, null).ma).toEqual([
      "forwarded_to_host",
    ]);
    expect(gateEvidenceOf({ ...passing, claimedActions: UNKNOWN }, GUEST, undefined, null).ma).toEqual(["unknown"]);
    expect(gateEvidenceOf({ ...passing, claimedActions: declared() }, GUEST, undefined, null).ma).toEqual([]);
    expect("ma" in gateEvidenceOf(passing, GUEST, undefined, null)).toBe(false);
  });
  it("temizleyici serbest metni düşürür, 'unknown' yalnız tek başına geçer", () => {
    expect(cleanGateEvidence({ lx: [], ma: ["forwarded_to_host", "I called the host"] })?.ma).toEqual(["forwarded_to_host"]);
    expect(cleanGateEvidence({ lx: [], ma: ["unknown"] })?.ma).toEqual(["unknown"]);
    expect(cleanGateEvidence({ lx: [], ma: ["unknown", "other"] })?.ma).toEqual(["other"]);
    expect(cleanGateEvidence({ lx: [], ma: "forwarded_to_host" as unknown as string[] })).not.toHaveProperty("ma");
    expect(cleanActionClaimEvidence(undefined)).toBeUndefined();
    expect(actionClaimEvidence(undefined)).toBeUndefined();
  });
});

const input: SuggestReplyInput = {
  guestMessage: GUEST,
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
  reservation: null,
  knowledgeBase: [{ category: "wifi", title: "Wi-Fi", content: "Ağ Lale-5G, şifre Lale2025." }],
  tone: "warm",
  language: "tr",
  now: new Date("2026-09-25T10:00:00Z"),
};

describe("istem — bayrak kapalıyken bayt bayt aynı", () => {
  it("🚨 declareActions verilmezse / false ise istem aynı ve alanı anmaz", () => {
    const base = buildReplyPrompt(input).text;
    expect(buildReplyPrompt({ ...input, declareActions: false }).text).toBe(base);
    expect(base).not.toContain("claimedActions");
  });
  it("açıkken blok TEK KEZ ve GÖREV çerçevesinin içinde", () => {
    const on = buildReplyPrompt({ ...input, declareActions: true }).text;
    expect(on.split(ACTION_CLAIMS_PROMPT_BLOCK).length - 1).toBe(1);
    const task = on.lastIndexOf("GÖREV:");
    expect(task).toBeGreaterThan(-1);
    expect(on.indexOf(ACTION_CLAIMS_PROMPT_BLOCK)).toBeGreaterThan(task);
    expect(on.trimEnd().endsWith("════")).toBe(true);
    // Yalnız blok eklenir: çıkarılınca kapalı istem birebir.
    expect(on.replace(ACTION_CLAIMS_PROMPT_BLOCK, "")).toBe(buildReplyPrompt(input).text);
  });
  it("sistem istemi (önbellekli önek) alanı anmaz — bayraktan bağımsız", () => {
    expect(REPLY_SYSTEM_PROMPT).not.toContain("claimedActions");
  });
});

function openAiReturns(content: Record<string, unknown>) {
  const fetchMock = vi.fn<(url: unknown, init?: RequestInit) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), {
        status: 200,
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
function userPromptOf(fetchMock: ReturnType<typeof openAiReturns>): string {
  const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: { role: string; content: string }[] };
  return body.messages.find((m) => m.role === "user")?.content ?? "";
}

const MODEL = {
  intent: "wifi",
  stayChangeAsked: "none",
  confidence: 0.92,
  reply: "The Wi-Fi network is Lale-5G and the password is Lale2025.",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "en",
  riskType: null,
  usedSources: ["kb:wifi"],
  missingInfo: [],
  statedCheckoutTime: null,
  replyStance: "none",
};

describe("suggestReply — bayrak tek yerde, istem ve STRICT çözüm aynı karara bağlı", () => {
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 bayrak KAPALI: istem alanı anmaz; model alanı gönderse bile sonuçta YOK (kapı görmez)", async () => {
    const f = openAiReturns({ ...MODEL, claimedActions: ["forwarded_to_host"] });
    const r = await suggestReply(input);
    expect(userPromptOf(f)).not.toContain("claimedActions");
    expect("claimedActions" in r).toBe(false);
    expect(autoReplyGateFailure(r, GUEST)).toBeNull();
  });

  it("🚨 bayrak AÇIK: istem alanı ister; beyan STRICT çözülür ve kapı tutar", async () => {
    vi.stubEnv("AI_ACTION_CLAIMS_ENABLED", "1");
    const f = openAiReturns({ ...MODEL, claimedActions: ["forwarded_to_host"] });
    const r = await suggestReply(input);
    expect(userPromptOf(f)).toContain(ACTION_CLAIMS_PROMPT_BLOCK);
    expect(r.claimedActions).toEqual(declared("forwarded_to_host"));
    expect(autoReplyGateFailure(r, GUEST)).toBe("action_claim");
  });

  it("bayrak AÇIK + model alanı ATLADI → unknown → tutulur", async () => {
    vi.stubEnv("AI_ACTION_CLAIMS_ENABLED", "1");
    openAiReturns(MODEL);
    const r = await suggestReply(input);
    expect(r.claimedActions).toEqual(UNKNOWN);
    expect(autoReplyGateFailure(r, GUEST)).toBe("action_claim_undeclared");
  });

  it("bayrak AÇIK + boş beyan → bugünkü gibi geçer", async () => {
    vi.stubEnv("AI_ACTION_CLAIMS_ENABLED", "1");
    openAiReturns({ ...MODEL, claimedActions: [] });
    const r = await suggestReply(input);
    expect(r.claimedActions).toEqual(declared());
    expect(autoReplyGateFailure(r, GUEST)).toBeNull();
  });
});
