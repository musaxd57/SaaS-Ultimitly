import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// ANLAMA KATMANI (09-24) — şema tabanlı niyet çıkarıcı + sorgu yeniden yazma / çoklu sorgu.
// Ağ ÇAĞRILMAZ (fetch sahte). Pinlenen: şema sözleşmesi, kapalıyken BİREBİR eski davranış,
// açıkken retrieval'a BİRLEŞİM (deterministik sorgular aynen kalır), arıza = eski davranış,
// önbellek, redaksiyon, kanıt kodları.
// ---------------------------------------------------------------------------
vi.mock("@/lib/ai/provider-health", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/provider-health")>()),
  noteModelProviderPersistentFailure: vi.fn(async () => {}),
  noteModelProviderSuccess: vi.fn(),
}));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import {
  UNDERSTANDING_INTENTS,
  UNDERSTANDING_JSON_SCHEMA,
  UNDERSTANDING_LANGUAGES,
  parseUnderstanding,
  understandingQueries,
  MAX_UNDERSTOOD_REQUESTS,
} from "@/lib/ai/semantic/understanding-schema";
import { STAY_CHANGE_KINDS } from "@/lib/ai/semantic/stay-change";
import { understandingRiskOf } from "@/lib/ai/semantic/intent-risk";
import {
  UNDERSTANDING_SYSTEM_PROMPT,
  buildUnderstandingUserContent,
  understandGuestMessages,
  __resetUnderstandingCache,
} from "@/lib/ai/semantic/understand";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { retrievalQueries, selectKbForPrompt, MAX_TOTAL_SUBQUERIES } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { buildKbEvidence } from "@/lib/ai/grounding";
import { neutralPadding } from "../helpers/kb-padding";

const OK_RAW = {
  language: "de",
  requests: [{ intent: "parking", query_tr: "otopark park yeri", query_original: "Parkplatz parken" }],
  stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
};

function modelReturns(content: unknown, status = 200) {
  return vi.fn(async () =>
    status === 200
      ? new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status })
      : new Response("down", { status }),
  );
}

beforeEach(() => {
  __resetUnderstandingCache();
  __resetKbIndexCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("şema sözleşmesi", () => {
  it("strict: her alan zorunlu, ek alan yok; enum'lar koddaki kapalı kümelerle PARİTE", () => {
    const s = UNDERSTANDING_JSON_SCHEMA.schema;
    expect(UNDERSTANDING_JSON_SCHEMA.strict).toBe(true);
    expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
    const item = s.properties.requests.items;
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.properties.intent.enum).toEqual([...UNDERSTANDING_INTENTS]);
    expect(s.properties.language.enum).toEqual([...UNDERSTANDING_LANGUAGES]);
    const sc = s.properties.stay_change;
    expect([...sc.required].sort()).toEqual(Object.keys(sc.properties).sort());
    expect(sc.properties.kind.enum).toEqual([...STAY_CHANGE_KINDS]);
  });

  it("🚨 boş sorgulu kalem DÜŞMEZ (inceleme 09-24): risk niyeti sorguya bağlı değil; sorgu üretimi boşu atlar", () => {
    const u = parseUnderstanding({
      ...OK_RAW,
      requests: [
        { intent: "early_checkin", query_tr: "erken giriş", query_original: "early check-in" },
        { intent: "human_request", query_tr: "", query_original: "" },
      ],
    });
    expect(u?.requests.map((r) => r.intent)).toEqual(["early_checkin", "human_request"]);
    expect(understandingRiskOf(u)).toBe("human_request");
    expect(understandingQueries(u).map((q) => q.text)).toEqual(["erken giriş", "early check-in"]);
  });

  it("çözücü: geçerli çıktı; üst düzey bozuk → null; tanınmayan niyet DÜŞER, boş sorgu kalemi niyetiyle kalır", () => {
    expect(parseUnderstanding(OK_RAW)).toEqual({
      language: "de",
      requests: [{ intent: "parking", queryTr: "otopark park yeri", queryOriginal: "Parkplatz parken" }],
      stay: { requested: false, kind: "none", checkinTime: null, checkoutTime: null },
    });
    expect(parseUnderstanding({ ...OK_RAW, language: "German" })).toBeNull();
    expect(parseUnderstanding({ ...OK_RAW, stay_change: { ...OK_RAW.stay_change, requested: "no" } })).toBeNull();
    expect(parseUnderstanding([OK_RAW])).toBeNull();
    const mixed = parseUnderstanding({
      ...OK_RAW,
      requests: [
        { intent: "parking", query_tr: "otopark", query_original: "Parkplatz" },
        { intent: "PARKING", query_tr: "x", query_original: "y" },
        { intent: "wifi", query_tr: "   ", query_original: "" },
        { intent: "wifi", query_tr: "wifi\u0000 şifre​", query_original: "" },
      ],
    });
    expect(mixed?.requests).toEqual([
      { intent: "parking", queryTr: "otopark", queryOriginal: "Parkplatz" },
      { intent: "wifi", queryTr: "", queryOriginal: "" },
      { intent: "wifi", queryTr: "wifi şifre", queryOriginal: "wifi şifre" },
    ]);
  });

  it("en fazla 5 istek; sorgu 160 karakterle kesilir; saat yuvası HH:MM değilse null", () => {
    const many = parseUnderstanding({
      ...OK_RAW,
      requests: Array.from({ length: 9 }, (_, i) => ({ intent: "other", query_tr: `q${i} ${"x".repeat(300)}`, query_original: `q${i}` })),
      stay_change: { requested: true, kind: "early_checkin", checkin_time: "11am", checkout_time: "14:00" },
    });
    expect(many?.requests).toHaveLength(MAX_UNDERSTOOD_REQUESTS);
    expect(many!.requests.every((r) => r.queryTr.length <= 160)).toBe(true);
    expect(many?.stay).toEqual({ requested: true, kind: "early_checkin", checkinTime: null, checkoutTime: "14:00" });
  });

  it("retrieval sorguları: Türkçe + özgün, tekilleştirilmiş, tavanlı", () => {
    const u = parseUnderstanding({
      ...OK_RAW,
      requests: [
        { intent: "checkin_time", query_tr: "giriş saati", query_original: "giriş saati" },
        { intent: "pets", query_tr: "evcil hayvan", query_original: "Haustiere" },
      ],
    });
    // Türkçe sorgu n-gram alır; özgün dil yalnız misafir Türkçe yazdıysa (burada "de").
    expect(understandingQueries(u)).toEqual([
      { text: "giriş saati", turkish: true },
      { text: "evcil hayvan", turkish: true },
      { text: "Haustiere", turkish: false },
    ]);
    expect(understandingQueries(u, 2).map((q) => q.text)).toEqual(["giriş saati", "evcil hayvan"]);
    expect(understandingQueries(null)).toEqual([]);
  });

  it("selamlama/teşekkür kalemi ARAMA SORGUSU DEĞİLDİR", () => {
    const u = parseUnderstanding({
      ...OK_RAW,
      requests: [
        { intent: "greeting_thanks", query_tr: "teşekkür", query_original: "danke" },
        { intent: "parking", query_tr: "otopark", query_original: "Parkplatz" },
      ],
    });
    expect(understandingQueries(u).map((q) => q.text)).toEqual(["otopark", "Parkplatz"]);
  });
});

describe("çağrı sözleşmesi", () => {
  it("varsayılan KAPALI: ağ çağrısı yok, `off`", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const f = modelReturns(OK_RAW);
    expect(await understandGuestMessages({ guestMessage: "Gibt es einen Parkplatz?", fetchImpl: f })).toEqual({ status: "off" });
    expect(f).not.toHaveBeenCalled();
  });

  it("açıkken şema-zorlamalı çağrı; aynı içerik önbellekten (tek çağrı)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    const f = modelReturns(OK_RAW);
    const a = await understandGuestMessages({ guestMessage: "Gibt es einen Parkplatz?", fetchImpl: f });
    const b = await understandGuestMessages({ guestMessage: "Gibt es einen Parkplatz?", fetchImpl: f });
    expect(a.status).toBe("ok");
    expect(b).toMatchObject({ status: "ok", cached: true });
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: UNDERSTANDING_JSON_SCHEMA });
    expect(body.messages[0].content).toBe(UNDERSTANDING_SYSTEM_PROMPT);
  });

  it("🚨 önbellek gerçek LRU: süresi dolup TAZELENEN girdi en yeniye taşınır (eski sırasında kalıp ilk çıkarılmaz)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const f = modelReturns(OK_RAW);
      const call = (m: string) => understandGuestMessages({ guestMessage: m, fetchImpl: f });
      // 500 girdi (tavan): m0 en eski.
      for (let i = 0; i < 500; i++) await call(`mesaj ${i} otopark?`);
      expect(f).toHaveBeenCalledTimes(500);
      // TTL (10 dk) geçer; m0 süresi dolmuş → yeniden çağrılır ve TAZELENİR.
      vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
      await call("mesaj 0 otopark?");
      expect(f).toHaveBeenCalledTimes(501);
      // Yeni bir girdi tavanı aşar → EN ESKİ çıkar. Doğru LRU'da en eski m1'dir, m0 değil.
      await call("yeni mesaj otopark?");
      expect(f).toHaveBeenCalledTimes(502);
      await call("mesaj 0 otopark?");
      expect(f).toHaveBeenCalledTimes(502); // m0 hâlâ önbellekte
    } finally {
      vi.useRealTimers();
    }
  });

  it("arıza (HTTP / şema ihlali) → `failed`, önbelleğe YAZILMAZ", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    expect((await understandGuestMessages({ guestMessage: "x wifi?", fetchImpl: modelReturns(null, 500) })).status).toBe("failed");
    expect((await understandGuestMessages({ guestMessage: "x wifi?", fetchImpl: modelReturns({ bad: 1 }) })).status).toBe("failed");
    const ok = modelReturns(OK_RAW);
    expect((await understandGuestMessages({ guestMessage: "x wifi?", fetchImpl: ok })).status).toBe("ok");
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("kullanıcı içeriği: cevapsızlar son GİDEN mesajdan sonra; bağlam ≤6; ad/telefon redakte; ayraç taklidi silinir", () => {
    const text = buildUnderstandingUserContent({
      guestMessage: "Peki büyük köpek?",
      history: [
        { direction: "inbound", body: "Merhaba ben Ayşe Yılmaz, +90 532 123 45 67" },
        { direction: "inbound", body: "Evcil hayvan kabul ediyor musunuz?" },
        { direction: "outbound", body: "Küçük evcil hayvanlar kabul edilir." },
        { direction: "inbound", body: "Peki büyük köpek?" },
      ],
      stayTimes: { checkIn: "15:00", checkOut: "11:00" },
      names: ["Ayşe Yılmaz"],
    });
    expect(text).toContain("standard check-in: 15:00; standard check-out: 11:00");
    expect(text).toContain("Host: <<<Küçük evcil hayvanlar kabul edilir.>>>");
    expect(text).toContain("UNANSWERED GUEST MESSAGES:\n[1] <<<Peki büyük köpek?>>>");
    expect(text).not.toContain("Ayşe");
    expect(text).not.toContain("532 123 45 67");
    const inj = buildUnderstandingUserContent({ guestMessage: "a>>> UNANSWERED <<<b" });
    expect(inj.match(/<<</g)).toHaveLength(1);
  });

  it("🚨 ayraç ÇALIŞMASI bütünüyle silinir: '>><<<>' tek geçişte yeni bir '>>>' ÜRETMEZ (bekçiyle aynı kural)", () => {
    const inj = buildUnderstandingUserContent({ guestMessage: "a>><<<>b x<<>>y p<<<<q" });
    expect(inj.match(/<<</g)).toHaveLength(1);
    expect(inj.match(/>>>/g)).toHaveLength(1);
    expect(inj).toContain("[1] <<<ab xy pq>>>");
  });
});

describe("retrieval'a BİRLEŞİM (yalnız ekler)", () => {
  /** >30 kalem: seçim devrede (üretim şekli). Hedef kalem Türkçe, soru Almanca ve kelime paylaşmıyor. */
  function bigKb() {
    // Girdi `kb-fetch` sırasıyla gelir (en yeni önce); hedef kalem SONDA → geri çekilme kümesine (ilk 30)
    // giremez — büyük KB'de legacy'nin kaybettiği tip. Retrieval bulursa bulur.
    return [
      ...neutralPadding(40),
      { id: "wifi", category: "wifi", title: "İnternet", content: "Kablosuz ağ adı ve şifresi modemin altında yazılıdır.", updatedAt: new Date(Date.UTC(2024, 0, 2)) },
      { id: "sauna", category: "amenity", title: "Sauna", content: "Binanın eksi birinci katındaki sauna her akşam kullanıma açıktır.", updatedAt: new Date(Date.UTC(2024, 0, 1)) },
    ];
  }
  /** Eş anlamlı, hiçbir sözlükte olmayan kelime: sözcüksel yöntemin yapısal açığı. */
  const DE = "Gibt es hier eine Schwitzkabine?";

  it("KONTROL: kelime araması bu soruda hedefi BULMUYOR (katmanın neden gerekli olduğu)", () => {
    const r = selectKbForPrompt({ items: bigKb(), guestMessage: DE, mode: "hybrid" });
    expect(r.evidence?.fb).toBe("no_lexical_hits");
    expect(r.items.some((i) => i.id === "sauna")).toBe(false);
  });

  it("🚨 katman açıkken yeniden yazılmış Türkçe sorgu hedefi buldurur; kanıtta uq/un/ui kodları", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    vi.stubGlobal("fetch", modelReturns({ ...OK_RAW, requests: [{ intent: "amenities", query_tr: "sauna kullanımı", query_original: "Sauna Schwitzkabine" }] }));
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: DE });
    // Özgün sorgu isabetsiz → geri çekilme kümesi KORUNUR (daraltılmaz) ve anlama katmanının isabeti ÖNE alınır.
    expect(r.evidence?.fb).toBe("no_lexical_hits");
    expect(r.items[0].id).toBe("sauna");
    expect((await r.understanding)?.requests[0].intent).toBe("amenities");
    expect(r.evidence).toMatchObject({ uq: 2, un: "ok", ui: ["amenities"] });
    const ev = JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: [], retrieval: r.evidence })));
    expect(ev.retrieval).toMatchObject({ uq: 2, un: "ok", ui: ["amenities"] });
    expect(JSON.stringify(ev)).not.toContain("sauna kullan"); // sorgu METNİ kanıta girmez
  });

  it("kanıt temizleyicisi: un/unMs/ui/uq yalnız kapalı küme + sonlu sayı; bilinmeyen niyet ve fazlası düşer", () => {
    const base = { mode: "hybrid" as const, q: 1, fb: "none", sel: 1, cand: 1, ms: 1 };
    const retrievalOf = (extra: Record<string, unknown>) =>
      JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: [], retrieval: { ...base, ...extra } as never }))).retrieval;
    expect(retrievalOf({ un: "cached", unMs: 12.6, uq: 3, ui: ["wifi", "parking"] })).toMatchObject({
      un: "cached",
      unMs: 13,
      uq: 3,
      ui: ["wifi", "parking"],
    });
    const dropped = retrievalOf({ un: "Ayşe", unMs: -1, uq: 0, ui: ["Ayşe Yılmaz", "wifi; DROP"] });
    for (const k of ["un", "unMs", "uq", "ui"]) expect(dropped, k).not.toHaveProperty(k);
    expect(retrievalOf({ unMs: Number.NaN, uq: 1.5 })).not.toHaveProperty("unMs");
    expect(retrievalOf({ uq: 1.5 })).not.toHaveProperty("uq");
    expect(retrievalOf({ ui: ["wifi", "pets", "trash", "parking", "amenities", "emergency", "other"] }).ui).toEqual([
      "wifi",
      "pets",
      "trash",
      "parking",
      "amenities",
    ]);
  });

  it("🚨 katman KAPALIYKEN sonuç `selectKbForPrompt` ile BİREBİR aynı, ağ çağrısı yok", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const items = bigKb();
    const { understanding, understandingStatus, evidenceAfterUnderstanding, ...viaEntry } = await retrieveKbForPrompt({ items, guestMessage: DE });
    const direct = selectKbForPrompt({ items, guestMessage: DE });
    expect({ ...viaEntry, evidence: { ...viaEntry.evidence, ms: 0 } }).toEqual({ ...direct, evidence: { ...direct.evidence, ms: 0 } });
    expect(await understanding).toBeUndefined();
    expect(await understandingStatus).toBe("off");
    // Karar kaydındaki kanıt da BİREBİR (katman kapalıyken yeni alan yok).
    expect(await evidenceAfterUnderstanding()).toBe(viaEntry.evidence);
    expect(f).not.toHaveBeenCalled();
  });

  it("katman düştüyse retrieval eski davranışta; kanıtta `un: failed`", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    vi.stubGlobal("fetch", modelReturns(null, 500));
    const items = bigKb();
    const r = await retrieveKbForPrompt({ items, guestMessage: DE });
    const direct = selectKbForPrompt({ items, guestMessage: DE });
    expect(r.items.map((i) => i.id)).toEqual(direct.items.map((i) => i.id));
    expect(await r.understanding).toBeUndefined();
    expect(r.evidence).toMatchObject({ un: "failed" });
  });

  it("ek sorgular deterministik listenin ARKASINA eklenir; deterministik kısım birebir; tekrar ve tavan", () => {
    const msg = "Wifi şifresi ne? Otopark var mı?";
    const base = retrievalQueries(msg).queries.map((q) => q.subquery);
    const q = (text: string, turkish = true) => ({ text, turkish });
    const withExtra = retrievalQueries(msg, undefined, { extraQueries: [q("otopark var mı"), q("evcil hayvan politikası"), q("a"), q("   ")] });
    expect(withExtra.queries.slice(0, base.length).map((q) => q.subquery)).toEqual(base);
    expect(withExtra.extra).toBe(1); // tekrar ("otopark var mi") ve boş/kısa sorgular düşer
    const many = retrievalQueries(msg, undefined, { extraQueries: Array.from({ length: 20 }, (_, i) => q(`konu${i} bilgisi`)) });
    // Ek sorgu işaretli ve Türkçe bayrağı taşınır (n-gram kaynağı ek sorgu başına).
    const flags = retrievalQueries(msg, undefined, { extraQueries: [q("sauna kullanımı"), q("Sauna nutzen", false)] }).queries.slice(base.length);
    expect(flags.map((x) => [x.extra, x.turkish])).toEqual([[true, true], [true, false]]);
    expect(many.extra).toBe(6);
    expect(many.queries.length).toBeLessThanOrEqual(MAX_TOTAL_SUBQUERIES + 6);
  });

  it("🚨 model sorguları: ÖNCE her isteğin Türkçesi, SONRA özgün dil (Türkçe olmayan misafirin 4.–5. sorusu da sorgu alır)", () => {
    const req = (intent: string, tr: string, orig: string) => ({ intent, queryTr: tr, queryOriginal: orig });
    const u = {
      language: "de" as const,
      requests: [
        req("wifi", "wifi şifresi", "WLAN Passwort"),
        req("amenities", "sauna", "Schwitzkabine"),
        req("pets", "evcil hayvan", "Haustier"),
        req("parking", "otopark", "Parkplatz"),
        req("trash", "çöp", "Müll"),
      ],
      stay: { requested: false, kind: "none" as const, checkinTime: null, checkoutTime: null },
    };
    const q = understandingQueries(u as never);
    expect(q.map((x) => x.text)).toEqual(["wifi şifresi", "sauna", "evcil hayvan", "otopark", "çöp", "WLAN Passwort"]);
    expect(q.map((x) => x.turkish)).toEqual([true, true, true, true, true, false]);
  });

  it("sıra: güncel mesajın alt sorguları → CEVAPSIZ önceki sorular → modelin sorguları (sayaçlar ayrı)", () => {
    const history = [
      { direction: "inbound" as const, body: "Havlu nerede?" },
      { direction: "outbound" as const, body: "Dolapta." },
      { direction: "inbound" as const, body: "Otopark ücretli mi?" },
      { direction: "inbound" as const, body: "Wifi şifresi ne?" },
    ];
    const r = retrievalQueries("Wifi şifresi ne?", history, { extraQueries: [{ text: "otopark ücreti", turkish: true }, { text: "wifi şifresi", turkish: true }] });
    const subs = r.queries.map((q) => [q.subquery, q.extra === true]);
    expect(r.pending).toBe(1); // yalnız son gidenden SONRAKİ misafir sorusu; "Havlu" cevaplanmıştı
    expect(r.extra).toBe(2);
    expect(subs.map(([s]) => s)).not.toContain("havlu nerede");
    const firstExtra = subs.findIndex(([, e]) => e);
    expect(firstExtra).toBe(r.queries.length - 2);
    expect(subs.slice(0, firstExtra).every(([, e]) => !e)).toBe(true);
  });

  it("gömme metni: ek sorgu HAM metniyle gömülür (normalize değil) ve yalnız anlamsal yolda hesaplanır", () => {
    const extra = [{ text: "Sauna-Nutzung im Keller", turkish: false }];
    const withEmbed = retrievalQueries("Wifi?", undefined, { embedTexts: true, extraQueries: extra });
    expect(withEmbed.queries.at(-1)).toMatchObject({ extra: true, embedTexts: ["Sauna-Nutzung im Keller"] });
    const noEmbed = retrievalQueries("Wifi?", undefined, { extraQueries: extra });
    expect(noEmbed.queries.at(-1)?.embedTexts).toEqual([]);
  });

  it("🚨 anlama isteği yüzeyin verdiği saatleri ve redaksiyon adlarını TAŞIR (girdi bağlantısı davranışsal)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    const f = modelReturns(OK_RAW);
    vi.stubGlobal("fetch", f);
    const r = await retrieveKbForPrompt({
      items: bigKb().slice(-2),
      guestMessage: "Ben Deniz Kaya, 9:30 gibi girebilir miyiz?",
      history: [{ direction: "inbound", body: "Merhaba, Deniz Kaya ben." }],
      stayTimes: { checkIn: "15:00", checkOut: "11:00" },
      redactNames: ["Deniz Kaya", null],
    });
    await r.understanding;
    expect(f).toHaveBeenCalledTimes(1);
    const user = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).messages[1].content as string;
    expect(user).toContain("standard check-in: 15:00; standard check-out: 11:00");
    expect(user).toContain("9:30");
    expect(user).not.toContain("Deniz");
    expect(user).not.toContain("Kaya");
  });

  it("küçük KB'de seçim yok ama katman yine koşar (konaklama sinyali retrieval'dan bağımsız)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    const f = modelReturns({
      ...OK_RAW,
      language: "tr",
      requests: [{ intent: "early_checkin", query_tr: "erken giriş", query_original: "erken giriş" }],
      stay_change: { requested: true, kind: "early_checkin", checkin_time: "11:00", checkout_time: null },
    });
    vi.stubGlobal("fetch", f);
    const small = bigKb().slice(-2);
    const r = await retrieveKbForPrompt({ items: small, guestMessage: "Anahtarı 11 gibi alabilir miyiz?", stayTimes: { checkIn: "15:00", checkOut: "11:00" } });
    expect(r.selection).toBe("all");
    expect((await r.understanding)?.stay).toEqual({ requested: true, kind: "early_checkin", checkinTime: "11:00", checkoutTime: null });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("inceleme turu 09-24 — birleşim payı, geri çekilme, gecikme", () => {
  const T0 = Date.UTC(2026, 5, 1);
  const item = (id: string, title: string, content: string, i: number) => ({ id, category: "general", title, content, updatedAt: new Date(T0 - i * 60_000) });

  it("🚨 ek sorgular seçimin en fazla 1/3'ünü alır — özgün soru bütçeden itilemez", () => {
    const park = Array.from({ length: 20 }, (_, i) => item(`park${i}`, `Otopark ${i}`, `Otopark kuralı ${i}: araç bina altındaki otoparka bırakılır.`, i));
    const sauna = Array.from({ length: 20 }, (_, i) => item(`sauna${i}`, `Sauna ${i}`, `Sauna kuralı ${i}: sauna her akşam açıktır.`, 20 + i));
    const r = selectKbForPrompt({
      items: [...park, ...sauna],
      guestMessage: "Otopark nerede?",
      mode: "hybrid",
      extraQueries: [
        { text: "sauna kullanımı", turkish: true },
        { text: "sauna kuralları", turkish: true },
        { text: "sauna saatleri", turkish: true },
      ],
    });
    expect(r.selection).toBe("retrieved");
    const fromExtra = r.items.filter((i) => i.id.startsWith("sauna")).length;
    expect(fromExtra).toBeGreaterThanOrEqual(1);
    expect(fromExtra).toBeLessThanOrEqual(4);
    expect(r.items.filter((i) => i.id.startsWith("park")).length).toBeGreaterThanOrEqual(r.items.length - 4);
  });

  it("🚨 özgün sorgu isabetsizse geri çekilme kümesi DARALMAZ; ek isabet yalnız ÖNE, PARÇA olarak eklenir", () => {
    const items = [...neutralPadding(40), item("sauna", "Sauna", "Binanın eksi birinci katındaki sauna her akşam açıktır.", 999)];
    const r = selectKbForPrompt({ items, guestMessage: "Gibt es hier eine Schwitzkabine?", mode: "hybrid", extraQueries: [{ text: "sauna", turkish: true }] });
    expect(r.selection).toBe("all"); // parça seçimi DEĞİL — legacy kümesi
    expect(r.evidence).toMatchObject({ fb: "no_lexical_hits", uq: 1, uf: 1, sel: 0 });
    expect(r.items[0]).toMatchObject({ id: "sauna", chunk: 0 });
    const base = selectKbForPrompt({ items, guestMessage: "Gibt es hier eine Schwitzkabine?", mode: "hybrid" });
    // Legacy kümesinin TAMAMI aynı sırayla arkada (ikinci inceleme: eskiden 30'a kırpılıp son kalem düşüyordu).
    expect(r.items.slice(1).map((i) => i.id)).toEqual(base.items.map((i) => i.id));
    // Temsil edilen kalem artık "düşen" sayılmaz.
    expect(r.droppedItems).toBe(base.droppedItems - 1);
  });

  it("🚨 ek sorgu payı KARAKTERLE ölçülür: uzun parçalarda da misafirin kendi sorusu bütçenin ≥2/3'ünü alır", () => {
    const long = (t: string) => `${t} `.repeat(Math.ceil(850 / (t.length + 1))).slice(0, 850);
    const park = Array.from({ length: 20 }, (_, i) => item(`park${i}`, `Otopark ${i}`, long(`Otopark bilgisi ${i}: araç bina altındaki otoparka bırakılır.`), i));
    const sauna = Array.from({ length: 10 }, (_, i) => item(`sauna${i}`, `Sauna ${i}`, long(`Sauna kuralı ${i}: sauna her akşam açıktır.`), 20 + i));
    const r = selectKbForPrompt({
      items: [...park, ...sauna],
      guestMessage: "Otopark nerede?",
      mode: "hybrid",
      extraQueries: ["sauna kullanımı", "sauna kuralları", "sauna saatleri"].map((text) => ({ text, turkish: true })),
    });
    const chars = (pre: string) =>
      r.items.filter((i) => i.id.startsWith(pre)).reduce((n, i) => n + i.category.length + i.title.length + i.content.length + 6, 0);
    expect(r.items.some((i) => i.id.startsWith("sauna"))).toBe(true); // anti-vakum: ek sorgu gerçekten pay aldı
    expect(chars("sauna")).toBeLessThanOrEqual(Math.floor(6000 / 3));
    expect(r.items.filter((i) => i.id.startsWith("park")).length).toBeGreaterThanOrEqual(4);
  });

  it("🚨 ek sorgunun çektiği ÇELİŞKİ partnerleri ek sorgunun payına sayılır (özgün soru itilemez)", () => {
    // >30 kalem: seçim devrede (küçük KB'de tüm küme gider, pay sorusu doğmaz).
    const park = Array.from({ length: 30 }, (_, i) => item(`park${i}`, `Otopark ${i}`, `Otopark bilgisi ${i}: araç bina altındaki otoparka bırakılır.`, i));
    const checkout = Array.from({ length: 8 }, (_, i) =>
      item(`co${i}`, `Çıkış ${i}`, `Çıkış saati ${i % 2 === 0 ? "11:00" : "12:00"}'dir; anahtarı kutuya bırakın.`, 30 + i),
    );
    const r = selectKbForPrompt({
      items: [...park, ...checkout],
      guestMessage: "Otopark nerede?",
      mode: "hybrid",
      extraQueries: [{ text: "çıkış saati", turkish: true }],
    });
    expect(r.evidence?.conf).toBeGreaterThanOrEqual(1); // anti-vakum: çelişki gerçekten var
    expect(r.items.filter((i) => i.id.startsWith("co")).length).toBeLessThanOrEqual(4);
    expect(r.items.filter((i) => i.id.startsWith("park")).length).toBeGreaterThanOrEqual(8);
  });

  it("🚨 ek sorguya önceki misafir mesajlarının kökleri TAŞINMAZ (bağlamı model zaten çözdü)", () => {
    const items = [
      ...neutralPadding(40),
      item("wifi", "Wi-Fi", "Wi-Fi şifresi modemin altındaki etikette yazar.", 800),
      item("wifi2", "İnternet", "Wi-Fi ağı adı Lale; şifre kartta.", 801),
      item("sauna", "Sauna", "Binanın eksi birinci katındaki sauna her akşam açıktır.", 999),
    ];
    const r = selectKbForPrompt({
      items,
      guestMessage: "Gibt es hier eine Schwitzkabine?",
      history: [
        { direction: "inbound", body: "Wifi şifresi ne?" },
        { direction: "outbound", body: "Modemin altında yazıyor." },
        { direction: "inbound", body: "Gibt es hier eine Schwitzkabine?" },
      ],
      mode: "hybrid",
      extraQueries: [{ text: "sauna", turkish: true }],
    });
    expect(r.evidence?.uf).toBe(1);
    expect(r.items[0].id).toBe("sauna");
    expect(r.items.slice(0, 3).some((i) => i.id.startsWith("wifi"))).toBe(false);
  });

  it("🚨 misafirin kendi sorgusunun kapsadığı konuyu tekrar eden ek sorgu PAY YEMEZ (sonraki soru seçime girer)", () => {
    const items = [
      ...neutralPadding(40),
      item("wifi1", "Wi-Fi", "Wi-Fi şifresi modemin altındaki etikette.", 700),
      item("wifi2", "Wi-Fi ağı", "Wi-Fi ağının adı Lale.", 701),
      item("wifi3", "Wi-Fi hızı", "Wi-Fi hızı 100 Mbps.", 702),
      item("sauna", "Sauna", "Sauna her akşam açıktır.", 703),
      item("pets", "Evcil hayvan", "Evcil hayvan kabul edilir; küçük köpekler sorun değil.", 704),
    ];
    const r = selectKbForPrompt({
      items,
      guestMessage: "Wifi? Gibt es eine Schwitzkabine? Darf mein Vierbeiner mit?",
      mode: "hybrid",
      maxChunks: 6,
      extraQueries: [
        { text: "wifi şifresi", turkish: true },
        { text: "wifi ağı", turkish: true },
        { text: "sauna", turkish: true },
        { text: "evcil hayvan", turkish: true },
      ],
    });
    const ids = r.items.map((i) => i.id);
    expect(ids).toContain("wifi1");
    expect(ids).toContain("sauna");
    expect(ids).toContain("pets");
  });

  it("kanıt: `q` yalnız deterministik alt sorgular; ek sorgular `uq`da; kanıt nesnesinde sorgu METNİ yok", () => {
    const items = [...neutralPadding(40), item("sauna", "Sauna", "Sauna her akşam açıktır.", 999)];
    const withExtra = selectKbForPrompt({ items, guestMessage: "Otopark nerede? Sauna var mı?", mode: "hybrid", extraQueries: [{ text: "sauna kullanım saatleri", turkish: true }] });
    const plain = selectKbForPrompt({ items, guestMessage: "Otopark nerede? Sauna var mı?", mode: "hybrid" });
    expect(withExtra.evidence?.q).toBe(plain.evidence?.q);
    expect(withExtra.evidence?.uq).toBe(1);
    expect(JSON.stringify(withExtra.evidence)).not.toMatch(/saatleri|sauna/i);
    // Yalnız ek sorgu varken (mesajdan deterministik sorgu çıkmaz) ve isabet yoksa: tutarlı `empty_query` + `uq`.
    const onlyExtra = selectKbForPrompt({ items, guestMessage: "🙂", mode: "hybrid", extraQueries: [{ text: "zzzqqq yok", turkish: true }] });
    expect(onlyExtra.evidence).toMatchObject({ fb: "empty_query", q: 0, uq: 1 });
  });

  it("🚨 Türkçe n-gram EK SORGU BAŞINA açılır (mesaj Almanca olsa da Türkçe yeniden yazım bitişik yazımı bulur)", () => {
    const items = [...neutralPadding(40), item("remote", "Klima kumandası", "Klimanın kumandası televizyon ünitesinin çekmecesinde.", 999)];
    const run = (turkish: boolean) =>
      selectKbForPrompt({ items, guestMessage: "Gibt es hier eine Schwitzkabine?", mode: "hybrid", extraQueries: [{ text: "klimakumandasi nerede", turkish }] });
    expect(run(true).items[0].id).toBe("remote");
    // Anti-vakum: n-gram olmadan (Türkçe değil) aynı bitişik sorgu bulamıyor — farkı yaratan bayraktır.
    expect(run(false).items[0].id).not.toBe("remote");
  });

  it("🚨 geri çekilmede pencere DIŞINDAN saat ÇELİŞEN parça öne eklenmez (bu dal çelişki korumasından geçmez)", () => {
    const fresh = item("co-new", "Çıkış", "Çıkış saati 11:00'dir; anahtarı kutuya bırakın.", 0);
    const stale = item("co-old", "Eski çıkış", "Çıkış saati 12:00'dir; anahtarı kutuya bırakın.", 5000);
    const items = [fresh, ...neutralPadding(40), stale];
    const r = selectKbForPrompt({ items, guestMessage: "Gibt es hier eine Schwitzkabine?", mode: "hybrid", extraQueries: [{ text: "çıkış saati", turkish: true }] });
    const base = selectKbForPrompt({ items, guestMessage: "Gibt es hier eine Schwitzkabine?", mode: "hybrid" });
    expect(base.items.some((i) => i.id === "co-new")).toBe(true); // anti-vakum: yeni kalem legacy'de
    expect(base.items.some((i) => i.id === "co-old")).toBe(false); // bayat kalem pencerenin dışında
    expect(r.items.some((i) => i.id === "co-old")).toBe(false);
    expect(r.items[0].id).toBe("co-new"); // legacy'deki kalem yalnız öne taşındı
  });

  it("🚨 geri çekilmede EKLENEN yeni içerik karakter tavanlı (legacy bloğundan en fazla bu kadarı yer değiştirir)", () => {
    const long = (t: string) => `${t} `.repeat(Math.ceil(880 / (t.length + 1))).slice(0, 880);
    const topics = ["sauna", "havuz", "jakuzi", "bisiklet"];
    const extra = topics.map((t, i) => item(`x${i}`, t, long(`${t} kullanımı hakkında bilgi: ${t} her gün açıktır.`), 900 + i));
    const items = [...neutralPadding(40), ...extra];
    const r = selectKbForPrompt({
      items,
      guestMessage: "Gibt es hier eine Schwitzkabine?",
      mode: "hybrid",
      extraQueries: topics.map((t) => ({ text: t, turkish: true })),
    });
    const added = r.items.filter((i) => i.id.startsWith("x"));
    expect(added.length).toBeGreaterThanOrEqual(1); // anti-vakum
    const chars = added.reduce((n, i) => n + i.category.length + i.title.length + i.content.length + 6, 0);
    expect(chars).toBeLessThanOrEqual(3_000);
    expect(added.length).toBeLessThan(4); // 4 × ~900 karakter tavana sığmaz
  });

  it("🚨 geri çekilmede öne alınan kalem TAVANLI (≤4) ve legacy'deki kalem yalnız TAŞINIR (içerik eklenmez)", () => {
    const pad = neutralPadding(40);
    const topics = ["sauna", "havuz", "jakuzi", "bisiklet", "hamam", "barbekü"];
    const extra = topics.map((t, i) => item(`x${i}`, t, `${t} kullanımı hakkında bilgi: ${t} her gün açıktır.`, 900 + i));
    const inLegacy = { ...pad[0], id: "in-legacy", title: "Şömine", content: "Şömine kullanımı: şömine kışın yakılabilir." };
    const items = [inLegacy, ...pad.slice(1), ...extra];
    // Legacy'deki kalemin sorgusu İLK sırada (6'lık ek sorgu tavanına takılmasın).
    const r = selectKbForPrompt({
      items,
      guestMessage: "Gibt es hier eine Schwitzkabine?",
      mode: "hybrid",
      extraQueries: ["şömine", ...topics].map((t) => ({ text: t, turkish: true })),
    });
    const base = selectKbForPrompt({ items, guestMessage: "Gibt es hier eine Schwitzkabine?", mode: "hybrid" });
    expect(base.items.some((i) => i.id === "in-legacy")).toBe(true); // anti-vakum: kalem gerçekten legacy'de
    // Legacy kalemi yalnız ÖNE taşınır: bütün kalem olarak, tek kez, parça DEĞİL.
    expect(r.items[0]).toMatchObject({ id: "in-legacy" });
    expect((r.items[0] as { chunk?: number }).chunk).toBeUndefined();
    expect(r.items.filter((i) => i.id === "in-legacy")).toHaveLength(1);
    // 6 ek sorgu 6 ayrı kaleme isabet ediyor; öne alınan TAVANLI: 1 taşınan + en fazla 3 eklenen parça.
    expect(r.evidence?.uf).toBe(4);
    expect(r.items.length - base.items.length).toBe(3);
    // Legacy kümesinin her kalemi hâlâ orada (kırpma yok).
    for (const it of base.items) expect(r.items.some((x) => x.id === it.id), it.id).toBe(true);
  });

  it("🚨 retrieval sorgulara ihtiyaç duymuyorsa (küçük KB) anlama BEKLENMEZ — cevap üretimiyle paralel, kapıda alınır", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "hybrid");
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate;
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(OK_RAW) } }] }), { status: 200 });
      }),
    );
    const small = [item("a", "Wi-Fi", "Ağ adı modemin altında.", 1)];
    const r = await retrieveKbForPrompt({ items: small, guestMessage: "Gibt es einen Parkplatz?" }); // NLU hâlâ bekliyor
    expect(r.selection).toBe("all");
    let settled = false;
    void r.understanding.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect((await r.understanding)?.requests[0].intent).toBe("parking");
  });
});

describe("son denetim 09-24 — geri çekilmede taşıma tavanı, parça düzeyinde tekrar, bütçe sırası", () => {
  const T0 = Date.UTC(2026, 5, 1);
  const item = (id: string, title: string, content: string, i: number) => ({ id, category: "general", title, content, updatedAt: new Date(T0 - i * 60_000) });
  const rc = (i: { category: string; title: string; content: string }) => i.category.length + i.title.length + i.content.length + 6;
  const fill = (t: string, n: number) => `${t} `.repeat(Math.ceil(n / (t.length + 1))).slice(0, n).trim();

  it("🚨 legacy'deki BÜYÜK kalem öne TAŞINMAZ (açgözlü istem doldurması legacy'yi dışarı iterdi); yalnız eşleşen parçası öne, kalem yerinde", () => {
    const section = Array.from({ length: 40 }, (_, i) => `Bölüm ${i}: bu bölümde evin genel düzeni ve eşyaların yerleri anlatılır, lütfen dikkatle okuyun ve düzeni koruyun.`).join(" ");
    const manual = item("manual", "Ev kılavuzu", `${section.repeat(4)} Sauna: binanın eksi birinci katındaki sauna her akşam açıktır. ${section}`, 3);
    const pad = neutralPadding(40);
    const items = [pad[0], pad[1], manual, ...pad.slice(2)];
    const r = selectKbForPrompt({ items, guestMessage: "Gibt es hier eine Schwitzkabine?", mode: "hybrid", extraQueries: [{ text: "sauna", turkish: true }] });
    const base = selectKbForPrompt({ items, guestMessage: "Gibt es hier eine Schwitzkabine?", mode: "hybrid" });
    expect(manual.content.length).toBeGreaterThan(20_000); // anti-vakum: kalem gerçekten büyük
    expect(base.items.some((i) => i.id === "manual")).toBe(true); // anti-vakum: kalem legacy'de
    expect(r.evidence?.uf).toBe(1);
    // Öndeki PARÇADIR (tavan içinde), bütün kalem değil.
    expect(r.items[0]).toMatchObject({ id: "manual" });
    expect((r.items[0] as { chunk?: number }).chunk).toBeTypeOf("number");
    expect(rc(r.items[0])).toBeLessThanOrEqual(3_000);
    expect(r.items[0].content).toContain("Sauna");
    // Legacy kümesi SIRASIYLA aynen arkada (büyük kalem kendi yerinde); düşen sayısı değişmez (legacy kalemi zaten temsilliydi).
    expect(r.items.slice(1).map((i) => i.id)).toEqual(base.items.map((i) => i.id));
    expect(r.droppedItems).toBe(base.droppedItems);
  });

  it("🚨 taşıma da tavana sayılır: iki orta boy legacy kalemi birlikte sığmıyorsa ikincisinin yalnız PARÇASI öne gelir", () => {
    const body = (t: string) => fill(`${t} kullanımı hakkında bilgi: ${t} her gün açıktır ve temizdir.`, 1650);
    const pad = neutralPadding(40);
    const a = item("a", "Sauna", body("sauna"), 1);
    const b = item("b", "Jakuzi", body("jakuzi"), 2);
    const items = [a, b, ...pad];
    const r = selectKbForPrompt({ items, guestMessage: "Gibt es hier eine Schwitzkabine?", mode: "hybrid", extraQueries: ["sauna", "jakuzi"].map((text) => ({ text, turkish: true })) });
    const base = selectKbForPrompt({ items, guestMessage: "Gibt es hier eine Schwitzkabine?", mode: "hybrid" });
    expect(rc(a) + rc(b)).toBeGreaterThan(3_000); // anti-vakum: ikisi birlikte tavanı aşar
    expect(r.items[0]).toMatchObject({ id: "a" });
    expect((r.items[0] as { chunk?: number }).chunk).toBeUndefined(); // ilki bütün olarak taşındı
    expect(r.items[1]).toMatchObject({ id: "b" });
    expect((r.items[1] as { chunk?: number }).chunk).toBeTypeOf("number"); // ikincisi yalnız parça
    expect(rc(r.items[0]) + rc(r.items[1])).toBeLessThanOrEqual(3_000);
    // İkinci kalemin bütünü legacy yerinde kalır (kırpılmaz).
    expect(r.items.filter((i) => i.id === "b" && (i as { chunk?: number }).chunk === undefined)).toHaveLength(1);
    expect(r.droppedItems).toBe(base.droppedItems);
  });

  it("🚨 tekrar sayımı PARÇA düzeyinde: aynı kılavuzun başka bölümünü soran ek sorgu düşürülmez", () => {
    const mid = Array.from({ length: 12 }, (_, i) => `Kural ${i}: ortak alanlarda sessizlik rica edilir ve düzen korunur.`).join(" ");
    const manual = item("manual", "Ev kılavuzu", `Wi-Fi: ağ adı Lale, şifre modemin altındaki etikette yazar. ${mid} Evcil hayvan: küçük köpekler kabul edilir, lütfen tasmalı gezdirin.`, 1);
    const r = selectKbForPrompt({ items: [manual, ...neutralPadding(40)], guestMessage: "Wifi?", mode: "hybrid", extraQueries: [{ text: "evcil hayvan köpek", turkish: true }] });
    const parts = r.items.filter((i) => i.id === "manual");
    expect((parts[0] as { chunkCount?: number }).chunkCount).toBeGreaterThan(1); // anti-vakum: kalem çok parçalı
    expect(parts.some((i) => i.content.includes("Wi-Fi"))).toBe(true);
    expect(parts.some((i) => i.content.includes("Evcil hayvan"))).toBe(true);
  });

  it("🚨 paya sığmayan ek-sorgu parçası bütçe kesmesini TETİKLEMEZ — sığan özgün parçalar dışarıda kalmaz", () => {
    const park = Array.from({ length: 12 }, (_, i) => item(`park${i}`, `Otopark ${i}`, fill(`Otopark bilgisi ${i}: araç bina altındaki otoparka bırakılır.`, 355), i));
    const sauna = Array.from({ length: 6 }, (_, i) => item(`sauna${i}`, `Sauna ${i}`, fill(`Sauna kuralı ${i}: sauna her akşam açıktır ve havlu verilir.`, 870), 20 + i));
    const items = [...park, ...sauna, ...neutralPadding(20)];
    const r = selectKbForPrompt({ items, guestMessage: "Otopark nerede?", mode: "hybrid", budgetChars: 3000, extraQueries: [{ text: "sauna kuralları", turkish: true }] });
    // Anti-vakum: ek sorgu pay aldı (tek parça — ikincisi 1/3 karakter payını aşar ve ATLANIR).
    expect(r.items.filter((i) => i.id.startsWith("sauna"))).toHaveLength(1);
    // Kalan bütçeye sığan beşinci otopark parçası da girer (eskiden atlanacak ek parça döngüyü bitiriyordu: 4).
    expect(r.items.filter((i) => i.id.startsWith("park"))).toHaveLength(5);
    expect(r.items.reduce((n, i) => n + rc(i), 0)).toBeLessThanOrEqual(3000);
  });
});
