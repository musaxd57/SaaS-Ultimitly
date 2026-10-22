import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Kurucu 10-22 akşam:
//  1. "bilgi tabanıyla ilgili kendi kullandığı model işlev özellik veri için baktığı hiçbir şey müşteriye gitmemeli" — canlı ölçümde giden
//     "Bilgi tabanımda otoparkın … yazıyor" türü cümle. Kök: istemin kendisi "kayıtlarımda şu yazıyor" örneği veriyordu. Artık: istemde kaynak
//     anlatma yasağı + kıdemli okuyucunun beşinci hükmü (anlamla, bir kez yeniden yazdırır) + kodun açık sözcük yedeği (ANAHTARSIZ).
//  2. "müşteriye daire adı ne … daire numarası anca verilir … kat 2 daire 3 gibidir" — mülkün İÇ adı cevap istemine gitmez; misafire görünen
//     ad (U4) varsa yalnız o.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import { namesInternalSource, admitsMissingKnowledge } from "@/lib/ai/absence";
import {
  SENIOR_READER_ADDENDUM,
  SENIOR_READER_JSON_SCHEMA,
  parseSeniorReaderVerdict,
} from "@/lib/ai/semantic/absence-judge";
import { seniorRewriteReasons, SENIOR_REWRITE_NOTES } from "@/lib/ai/semantic/senior-rewrite";
import { REPLY_SYSTEM_PROMPT, buildReplyUserPrompt } from "@/lib/ai/prompts";
import { autoReplyGateVerdict } from "@/lib/automation";
import { evaluateEscalation } from "@/lib/guest-chat-gate";

afterEach(() => vi.unstubAllEnvs());

const NAMED = [
  "Bilgi tabanımda otoparkın günlük ücretinin gişede nakit veya kartla ödenebildiği yazıyor; yani kart da geçiyor.",
  "BİLGİ TABANIMDA çıkış saati 11:00 yazıyor.",
  "Elimdeki bilgilere göre otopark ücretsiz.",
  "Kayıtlarımda çıkış saati 11:00 olarak görünüyor.",
  "Notlarımda kahvaltının 8'de olduğu yazıyor.",
  "Bana verilen bilgilerde havuz 09:00'da açılıyor.",
  "According to my notes, check-in is at 3 pm.",
  "The information I have says the pool opens at 9.",
  "Our records show two guests.",
  "I can see in our system that you arrive Friday.",
  "My knowledge base says the gym is on floor 2.",
  "Laut unserer Datenbank ist der Check-in um 15 Uhr.",
  "Selon nos notes, le check-in est à 15h.",
  "Según mis notas, el check-in es a las 15:00.",
];
const PLAIN = [
  "Otopark ücreti gişede nakit veya kartla ödeniyor.",
  "Isıtma sistemimiz merkezi; termostat salonda.",
  "The heating system is electric.",
  "There is a house guide we have in the drawer with all the details.",
  "Çıkış saati 11:00. Kayıt için pasaportunuzu getirin.",
  "Wi-Fi ağı Lale-5G, şifresi Lale2025.",
  "Notları buzdolabının üstüne bırakabilirsiniz.",
  "My notes for you: please lock the door when you leave.",
  "You'll find the Wi-Fi details in our notes on the fridge.",
  "The manual is in our files folder on the shelf.",
  "Check-in is from 15:00; the building's records office is downstairs.",
];

describe("kodun açık sözcük yedeği — namesInternalSource", () => {
  it("iç kaynağı adlandıran cümle (olumlu da, yedi dil) yakalanır", () => {
    for (const t of NAMED) expect([t, namesInternalSource(t)]).toEqual([t, true]);
  });

  it("olgu cümlesi ve mülkün fiziksel nesneleri (sistem, kılavuz, not kâğıdı) yakalanmaz", () => {
    for (const t of PLAIN) expect([t, namesInternalSource(t)]).toEqual([t, false]);
  });

  it("olumlu anlatım 'bilgim yok' sayılmaz (ayrı kural, ayrı ayrıntı kodu)", () => {
    expect(admitsMissingKnowledge(NAMED[0])).toBe(false);
  });

  it("uzun girdide doğrusal (karesel iş yok)", () => {
    const long = "bilgi ".repeat(20_000) + "x";
    const t0 = performance.now();
    namesInternalSource(long);
    namesInternalSource("a".repeat(50_000));
    namesInternalSource(" ".repeat(50_000) + "notlarımda");
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe("kıdemli okuyucu — beşinci hüküm", () => {
  const FULL = {
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

  it("istem ve şema beşinci soruyu taşır", () => {
    expect(SENIOR_READER_ADDENDUM).toMatch(/names_internal_source = true when the draft tells the guest WHERE its information comes from/);
    expect(SENIOR_READER_ADDENDUM).toMatch(/printed guide, a sign, a manual/);
    expect(SENIOR_READER_JSON_SCHEMA.schema.required).toEqual(expect.arrayContaining(["names_internal_source", "source_quote"]));
  });

  it("evet / dolu alıntı → internalSource; alan eksikse okuma geçersiz", () => {
    expect(parseSeniorReaderVerdict(FULL)?.checks?.internalSource).toBe(false);
    expect(parseSeniorReaderVerdict({ ...FULL, names_internal_source: true, source_quote: "x" })?.checks?.internalSource).toBe(true);
    expect(parseSeniorReaderVerdict({ ...FULL, source_quote: "Bilgi tabanımda yazıyor." })?.checks?.internalSource).toBe(true);
    const missing: Record<string, unknown> = { ...FULL };
    delete missing.names_internal_source;
    expect(parseSeniorReaderVerdict(missing)).toBeNull();
  });

  it("yeniden yazma sebebi okuyucudan YA DA kod yedeğinden; not olguyu doğrudan söylemeyi öğretir", () => {
    const none = { payHost: false, contact: false, apology: false, internalSource: false };
    expect(seniorRewriteReasons(none, { contactHolds: false, apologyRule: false })).toEqual([]);
    expect(seniorRewriteReasons({ ...none, internalSource: true }, { contactHolds: false, apologyRule: false })).toEqual(["internalSource"]);
    expect(seniorRewriteReasons(none, { contactHolds: false, apologyRule: false, internalSourceLexical: true })).toEqual(["internalSource"]);
    expect(SENIOR_REWRITE_NOTES.internalSource).toMatch(/Otopark ücreti gişede ödeniyor/);
  });
});

describe("kapı — kanal ve QR aynı yüklem", () => {
  const ok = { intent: "general", riskLevel: "none", confidence: 0.92, source: "openai", riskType: null as string | null };
  const read = (reply: string, internalSource: boolean) => ({
    reply,
    outcome: {
      status: "ok" as const,
      admits: false,
      quote: "",
      checks: { payHost: false, contact: false, apology: false, internalSource },
    },
  });

  it("kanal: kod yedeği (okuyucusuz) ve okuyucu hükmü ayrı ayrı tutar; olgu cümlesi gider", () => {
    const named = { ...ok, reply: NAMED[0] };
    expect(autoReplyGateVerdict(named, "Otopark kartla ödenir mi?")).toEqual({ reason: "blocked", detail: "reply_internal_source" });
    const subtle = { ...ok, reply: "From what I was told, parking is paid at the booth." };
    expect(autoReplyGateVerdict(subtle, "Parking?")).toBeNull();
    expect(autoReplyGateVerdict(subtle, "Parking?", { absenceJudge: read(subtle.reply, true) })).toEqual({
      reason: "blocked",
      detail: "reply_internal_source",
    });
    const plain = { ...ok, reply: PLAIN[0] };
    expect(autoReplyGateVerdict(plain, "Otopark kartla ödenir mi?", { absenceJudge: read(plain.reply, false) })).toBeNull();
  });

  it("QR: aynı kural", () => {
    const named = { ...ok, reply: NAMED[6] };
    expect(evaluateEscalation(named, "When is check-in?", "Alex", []).reason).toBe("reply_internal_source");
    const subtle = { ...ok, reply: "From what I was told, check-in is at 3 pm." };
    expect(evaluateEscalation(subtle, "When is check-in?", "Alex", []).reason).toBeNull();
    expect(evaluateEscalation(subtle, "When is check-in?", "Alex", [], { absenceJudge: read(subtle.reply, true) }).reason).toBe(
      "reply_internal_source",
    );
  });
});

describe("cevap istemi", () => {
  it("kaynak anlatma yasağı var; eski 'kayıtlarımda şu yazıyor' örneği yok", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("KAYNAK ANLATMA YASAĞI");
    expect(REPLY_SYSTEM_PROMPT).toContain('DOĞRU: "Otopark ücreti gişede nakit veya kartla ödeniyor."');
    expect(REPLY_SYSTEM_PROMPT).not.toContain("kayıtlarımda şu yazıyor");
    expect(REPLY_SYSTEM_PROMPT).toMatch(/14\. reply bilgiyi nereden bildiğini anlatıyor mu/);
  });

  it("mülkün İÇ adı istemde yok; misafire görünen ad varsa yalnız o, yoksa ad satırı hiç yok", () => {
    const base = { guestMessage: "Merhaba", knowledgeBase: [], history: [] };
    const withName = buildReplyUserPrompt({
      ...base,
      property: { name: "Daire 5 / arka cephe", guestDisplayName: " Kat 2  Daire 3 ", checkInTime: "15:00", checkOutTime: "11:00" },
    } as never);
    expect(withName).not.toContain("arka cephe");
    expect(withName).toContain("Misafire görünen daire adı: Kat 2 Daire 3");
    const without = buildReplyUserPrompt({
      ...base,
      property: { name: "Daire 5 / arka cephe", checkInTime: "15:00", checkOutTime: "11:00" },
    } as never);
    expect(without).not.toContain("arka cephe");
    expect(without).not.toContain("Misafire görünen daire adı");
    expect(without).toContain("Check-in saati: 15:00");
  });
});
