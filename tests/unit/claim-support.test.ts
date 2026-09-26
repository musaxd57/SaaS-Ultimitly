import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({ alertOnTransition: vi.fn(async () => "alerted"), clearAlertState: vi.fn(async () => {}) }));

import { auditClaims, auditClaimsSafe, CLAIM_CLASSES, type ClaimContext } from "@/lib/ai/claim-support";
import { buildReplyPrompt, buildReplyUserPrompt } from "@/lib/ai/prompts";
import { suggestReply, parseLlmUsage } from "@/lib/ai";
import { buildKbEvidence } from "@/lib/ai/grounding";
import { CONTEXTS, CASES, HARD, type Case } from "../helpers/claim-battery";

// ---------------------------------------------------------------------------
// İDDİA DESTEĞİ GÖLGE ÖLÇÜMÜ (09-23). Model cevabındaki somut iddiaların (saat/tarih/para/kod/
// telefon/birimli miktar) modelin gördüğü veride harfiyen geçip geçmediği. KARAR DEĞİL: hiçbir
// kapı okumaz (mimari pin). Batarya ajan ölçümünden (sentetik); eşikler ÖLÇÜLEN değere pinli.
// ---------------------------------------------------------------------------

/**
 * Batarya SABİT anla koşar (09-26): `now` verilmezse zaman çizelgesi gerçek saati kullanıyordu ve iddia bağlamı o anki
 * saati taşıyordu → batarya günde dört dakikada (UTC 05/09/11/19:00) kırmızıydı; 05:00Z'deki tam kapı koşusu düştü.
 * Ürün tarafı ayrıca düzeltildi (bağlamda anlık saat yok, ↓"anlık saat dayanak değildir"); sabit an tarih çakışmasına karşı.
 */
const BATTERY_NOW = new Date("2026-09-26T10:30:00Z");

function contextFor(c: Case, now: Date = BATTERY_NOW): ClaimContext {
  const base = CONTEXTS[c.ctx];
  return buildReplyPrompt({ ...base, guestMessage: c.guest, history: base.history ?? [], now }).claimContext;
}

describe("🚨 anlık saat dayanak değildir (09-26: batarya günde dört dakikada kırmızıydı)", () => {
  const byId = (id: string) => {
    const c = [...CASES, ...HARD].find((x) => x.id === id);
    if (!c) throw new Error(`batarya satırı yok: ${id}`);
    return c;
  };

  it.each([
    ["F03", "2026-09-26T05:00:00Z", "İstanbul 08:00 — 'Kahvaltı sabah 8'de'"],
    ["F02", "2026-09-26T09:00:00Z", "İstanbul 12:00 — 'Check-out is at 12 pm'"],
    ["F45", "2026-09-26T09:00:00Z", "İstanbul 12:00 — 'Çıkış öğlen 12'de'"],
    ["F01", "2026-09-26T11:00:00Z", "İstanbul 14:00 — 'Giriş 14:00'ten itibaren'"],
    ["F05", "2026-09-26T19:00:00Z", "İstanbul 22:00 — 'Sessiz saatler 22:00'"],
  ])("uydurma %s, üretildiği dakika uydurduğu saate denk gelse de desteksiz (%s; %s)", (id, at) => {
    const c = byId(id);
    expect(auditClaims(c.reply, contextFor(c, new Date(at))).u, c.reply).toBeGreaterThan(0);
  });

  it("günün hiçbir saatinde yakalanan uydurma kümesi değişmez (ölçüm saatten bağımsız)", () => {
    const caught = (now: Date) =>
      CASES.filter((c) => c.kind === "fab" && auditClaims(c.reply, contextFor(c, now)).u > 0)
        .map((c) => c.id)
        .join(",");
    const reference = caught(BATTERY_NOW);
    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 8, 26, h, 0, 0));
      expect(caught(now), now.toISOString()).toBe(reference);
    }
  });

  it("bugünün ve yarının TARİHİ dayanak olmayı sürdürür (yalnız saat çıktı)", () => {
    const c = byId("F03");
    const ctx = contextFor(c, new Date("2026-09-26T05:00:00Z"));
    expect(auditClaims("Bugün 26.09.2026.", ctx).u).toBe(0);
    expect(auditClaims("Yarın 27.09.2026.", ctx).u).toBe(0);
  });
});

describe("batarya — dayanaklı cevapta yanlış alarm YOK, uydurma yakalanır", () => {
  it("🚨 dayanaklı cevapların HİÇBİRİ desteksiz iddia taşımıyor (ayar, KB, rezervasyon, teklif, türetilmiş gece, geçmiş)", () => {
    const legit = [...CASES, ...HARD].filter((c) => c.kind === "legit");
    expect(legit.length).toBeGreaterThanOrEqual(130);
    const offenders = legit
      .map((c) => ({ id: c.id, a: auditClaims(c.reply, contextFor(c)) }))
      .filter((x) => x.a.u > 0)
      .map((x) => `${x.id}:${x.a.uc.join("/")}`);
    expect(offenders).toEqual([]);
  });

  it("uydurma cevapların ölçülen yakalama oranı korunur (ana küme ≥43/45, zor küme ≥8/25)", () => {
    const hit = (xs: Case[]) => xs.filter((c) => c.kind === "fab" && auditClaims(c.reply, contextFor(c)).u > 0).length;
    expect(CASES.filter((c) => c.kind === "fab")).toHaveLength(45);
    expect(hit(CASES)).toBeGreaterThanOrEqual(43);
    expect(HARD.filter((c) => c.kind === "fab")).toHaveLength(25);
    expect(hit(HARD)).toBeGreaterThanOrEqual(8);
  });
});

describe("sınıflama davranışı", () => {
  const ctx = (facts: string[], extra: Partial<ClaimContext> = {}): ClaimContext => ({ facts, operator: [], guest: [], ...extra });

  it("mülk saati farklı biçimde yazılsa da desteklenir (15:00 ↔ 3 pm ↔ öğleden sonra 3 ↔ 15.00)", () => {
    const c = ctx(["Check-in saati: 15:00\nCheck-out saati: 11:00"]);
    for (const r of ["Giriş 15:00'te.", "Check-in is from 3 pm.", "Öğleden sonra 3'ten itibaren.", "Giriş 15.00'te."]) {
      expect(auditClaims(r, c).u, r).toBe(0);
    }
    expect(auditClaims("Giriş 14:00'te.", c)).toMatchObject({ u: 1, uc: ["time"] });
  });

  it("KATI birim: '5 dakika' 5 kişiyi desteklemez; '1 saat' 60 dakikayı destekler", () => {
    const c = ctx(["Market 5 dakika yürüme mesafesinde.", "Havalimanı 1 saat."]);
    expect(auditClaims("Market 5 dakikada.", c).u).toBe(0);
    expect(auditClaims("Havalimanına 60 dakikada varılır.", c).u).toBe(0);
    expect(auditClaims("Daire 5 kişilik.", c)).toMatchObject({ u: 1, uc: ["people"] });
  });

  it("🚨 telefonun parçası KOD sayılmaz; kod büyük/küçük harfe duyarlı", () => {
    const c = ctx(["Acil hat: 0532 111 22 33.", "Wi-Fi şifresi: Deniz2024!"]);
    expect(auditClaims("Kapı kodu 0532.", c)).toMatchObject({ u: 1, uc: ["code"] });
    expect(auditClaims("Wi-Fi şifresi: deniz2024!", c).uc).toContain("code");
    expect(auditClaims("Wi-Fi şifresi: Deniz2024!", c).u).toBe(0);
  });

  it("BİLİNEN SINIR: aynı cevapta bir kod iki farklı harf yazımıyla geçerse İLK yazım hepsini temsil eder", () => {
    // Kod iddiasının özgün yazımı katlanmış anahtarla bulunur (konum değil — sayı sözcüğü çevirisi
    // uzunlukları değiştirir). İlk yazım doğruysa sonraki yanlış yazım görünmez; tersi de geçerli.
    const c = ctx(["Wi-Fi şifresi: Deniz2024"]);
    expect(auditClaims("Şifre: Deniz2024 — ağ adı da deniz2024.", c).u).toBe(0);
    expect(auditClaims("Şifre: deniz2024 — ağ adı da Deniz2024.", c).u).toBe(2);
  });

  it("destek düzeyleri ayrı sayılır: operatör geçmişi, misafir yankısı (otorite değil), acil sabit", () => {
    const c = ctx([], { operator: ["Anahtar kutusunun kodu 5821."], guest: ["Kodum 7777 mi?"] });
    expect(auditClaims("Kod 5821.", c)).toMatchObject({ op: 1, u: 0 });
    expect(auditClaims("Evet, kod 7777.", c)).toMatchObject({ echo: 1, ec: ["code"], u: 0 });
    expect(auditClaims("Acil durumda 112'yi arayın.", c)).toMatchObject({ k: 1, u: 0 });
  });

  it("türetilmiş gece sayısı desteklenir; metinde yazmayan başka gece sayısı desteklenmez", () => {
    const c = ctx(["Giriş: 15 Eki | Çıkış: 18 Eki"], { derivedNumbers: [3] });
    expect(auditClaims("Konaklamanız 3 gece.", c).u).toBe(0);
    expect(auditClaims("Konaklamanız 4 gece.", c).u).toBe(1);
  });

  it("🚨 sistem isteminin few-shot sahte değeri ('12345678') bağlamda YOK → desteksiz (sızıntı görünür)", () => {
    const { claimContext } = buildReplyPrompt({
      property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
      reservation: null,
      knowledgeBase: [],
      guestMessage: "Wifi şifresi?",
      tone: "warm",
      language: "tr",
    });
    expect(auditClaims("Şifre: 12345678", claimContext)).toMatchObject({ u: 1, uc: ["code"] });
  });

  it("🚨 istem bağlamı YETKİ düzeylerini ayırır: misafir metni otorite değil (echo), bizim geçmiş cevabımız op", () => {
    const { claimContext } = buildReplyPrompt({
      property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
      reservation: null,
      knowledgeBase: [],
      guestMessage: "Kodum 7777 mi?",
      history: [
        { direction: "inbound", body: "Otopark 250 TL mi?" },
        { direction: "outbound", body: "Anahtar kutusunun kodu 5821." },
      ],
      tone: "warm",
      language: "tr",
    });
    expect(auditClaims("Evet, kod 7777.", claimContext)).toMatchObject({ echo: 1, ctx: 0, u: 0 });
    expect(auditClaims("Otopark 250 TL.", claimContext)).toMatchObject({ echo: 1, ctx: 0 });
    expect(auditClaims("Kod 5821.", claimContext)).toMatchObject({ op: 1, ctx: 0 });
  });

  it("kodun yazdığı '[NOT]' satırları ve istem talimatları desteğe SAYILMAZ; KB verisi sayılır", () => {
    const input = {
      property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
      reservation: null,
      knowledgeBase: [{ category: "parking", title: "Otopark", content: "Otopark günlüğü 150 TL." }],
      knowledgeBaseNotes: ["Kaynaklarda çıkış saati için farklı değerler var (11:00 / 13:00)."],
      guestMessage: "Otopark?",
      tone: "warm" as const,
      language: "tr",
    };
    const { claimContext } = buildReplyPrompt(input);
    expect(buildReplyUserPrompt(input)).toContain("13:00"); // KONTROL: not istemde VAR
    expect(auditClaims("Otopark 150 TL.", claimContext).u).toBe(0);
    expect(auditClaims("Çıkış 13:00'te.", claimContext).u).toBe(1);
  });
});

describe("öteki dillerde kesin saat biçimleri (09-26) — misafirin saatini tekrarlamak YANKIDIR, uydurma değil", () => {
  const FACTS = ["Check-in saati: 15:00\nCheck-out saati: 11:00"];
  const ctx = (guest: string[] = []): ClaimContext => ({ facts: FACTS, operator: [], guest });

  it("🚨 gerçek model koşusunda desteksiz sayılan cevaplar: misafirin 'um 12 Uhr' / 'около 10 утра' / 'um 13 Uhr' saati → yankı", () => {
    const cases: [string, string][] = [
      [
        "Können wir schon um 12 Uhr einchecken?",
        "Hallo Alex, der reguläre Check-in ist ab 15:00 Uhr möglich. Ob ein Check-in schon um 12:00 Uhr möglich ist, liegt im Ermessen des Gastgebers.",
      ],
      [
        "Можно заселиться пораньше, около 10 утра?",
        "Здравствуйте, Alex. Стандартное время заселения у меня указано как 15:00. Возможность заселиться около 10:00 зависит от уборки квартиры.",
      ],
      [
        "Wäre ein später Check-out um 13 Uhr möglich?",
        "Hallo Alex, unser regulärer Check-out ist um 11:00 Uhr. Ein Check-out um 13:00 Uhr hängt von Verfügbarkeit und Reinigungsplan ab.",
      ],
    ];
    for (const [guest, reply] of cases) {
      const a = auditClaims(reply, ctx([guest]));
      expect(a.u, reply).toBe(0);
      expect(a.echo, reply).toBe(1);
      expect(a.ctx, reply).toBe(1);
    }
  });

  it("cevaptaki çıplak saat artık İDDİA: bağlamdakiyle aynıysa destekli, farklıysa desteksiz (DE/RU/ES/FR)", () => {
    const supported = [
      "Der Check-in ist ab 15 Uhr möglich.",
      "Заселение в 3 часа дня.",
      "El check-in es a las 3 de la tarde.",
      "L'arrivée est possible à 15 heures.",
      "Check-out bis 11 Uhr vormittags.",
      "Check-in um 3 Uhr.", // belirsiz: 3 ya da 15 — 15:00 bağlamda
    ];
    for (const r of supported) expect(auditClaims(r, ctx()).u, r).toBe(0);
    const fabricated = [
      "Der Check-in ist ab 14 Uhr möglich.",
      "Заселение в 14 часов.",
      "Можно приехать к 9 утра.",
      "El check-in es a las 2 de la tarde.",
      "Le départ est à 10 heures du matin.",
    ];
    for (const r of fabricated) expect(auditClaims(r, ctx()), r).toMatchObject({ u: 1, uc: ["time"] });
  });

  it("süre ve sayı biçimleri SAAT sayılmaz (sayı olarak ölçülmeleri önceki davranıştır, değişmedi)", () => {
    for (const r of [
      "Der Strand ist 2 Stunden entfernt.",
      "До пляжа около 2 часов езды.",
      "Будем через 2 часа.",
      "Мы бронируем на 3 дня.",
      "Стоимость указана за 3 ночи.",
      "Живём в 2 часах езды от центра.",
      "La plage est à 2 heures de route.",
      "Llevamos toallas a las 4 habitaciones.",
      "El aeropuerto está a 2 horas.",
    ]) {
      expect(auditClaims(r, ctx()).uc, r).not.toContain("time");
    }
  });

  it("gün dilimi okunur: 'nachts' / 'ночи' gece, 'abends' / 'вечера' akşam", () => {
    const c = (t: string): ClaimContext => ({ facts: [t], operator: [], guest: [] });
    expect(auditClaims("Die Rezeption schließt um 11 Uhr nachts.", c("Resepsiyon 23:00'te kapanır.")).u).toBe(0);
    expect(auditClaims("Тишина с 2 часов ночи.", c("Sessizlik 02:00")).u).toBe(0); // "с 2 часов ночи" → 02:00
    expect(auditClaims("Ужин в 8 вечера.", c("Akşam yemeği 20:00")).u).toBe(0);
    expect(auditClaims("Die Rezeption schließt um 11 Uhr abends.", c("Resepsiyon 11:00'de kapanır.")).u).toBe(1); // 23 ≠ 11
    // Gece sabahın erken saatidir ("2 Uhr nachts" = 02:00, 14:00 DEĞİL); "N часов вечера" akşamdır (23:00 ≠ 11:00).
    expect(auditClaims("Ruhe ab 2 Uhr nachts.", c("Sessizlik 02:00")).u).toBe(0);
    expect(auditClaims("Тишина с 11 часов вечера.", c("Sessizlik 11:00")).u).toBe(1);
  });

  it("BİLİNEN SINIR: '1 gibi' (13:00) bağlam okumadan çıkarılamaz — cevaptaki 13:00 desteksiz kalır", () => {
    const a = auditClaims(
      "Merhaba Alex, normal çıkış saatimiz 11:00. Saat 13:00'teki geç çıkış isteğiniz ev sahibinizin kararıdır.",
      ctx(["yarın biraz geç çıksak olur mu, 1 gibi"]),
    );
    expect(a).toMatchObject({ u: 1, uc: ["time"] });
  });
});

describe("gizlilik, güvenlik, dayanıklılık", () => {
  it("🚨 özet PII'siz: yalnız sayılar + kapalı-küme sınıflar; ham değer (kod, telefon) YOK", () => {
    const a = auditClaims("Kod 4827, telefon +90 532 999 88 77, şifre GizliX9.", { facts: [], operator: [], guest: [] });
    expect(Object.keys(a).sort()).toEqual(["ctx", "ec", "echo", "k", "n", "op", "u", "uc", "v"]);
    const json = JSON.stringify(a);
    for (const raw of ["4827", "532", "GizliX9", "999"]) expect(json).not.toContain(raw);
    for (const cls of [...a.uc, ...a.ec]) expect(CLAIM_CLASSES).toContain(cls);
  });

  it("kanıt JSON'u yalnız temizlenmiş alanları taşır (sahte alan/serbest metin sızamaz)", () => {
    const dirty = { v: 1, n: 2, ctx: 1, op: 0, echo: 0, k: 0, u: 1, uc: ["code", "SIZINTI 4827"], ec: [], raw: "4827" } as never;
    const json = String(buildKbEvidence({ retrieved: [], usedLabels: [], claims: dirty, llm: { pt: 10, cpt: 4, ct: -2, m: "model <sız>", x: "sız" } as never }));
    expect(json).not.toContain("4827");
    expect(json).not.toContain("sız");
    expect(JSON.parse(json)).toMatchObject({ claims: { u: 1, uc: ["code"] } });
    expect(JSON.parse(json).llm).toEqual({ pt: 10, cpt: 4 });
  });

  it("sağlayıcı kullanım gövdesi SAYIYA indirgenir: bozuk alan ölçülmemiş sayılır, model adı biçim dışıysa yazılmaz", () => {
    expect(
      parseLlmUsage({ model: "gpt 5.1 <x>", usage: { prompt_tokens: -3, completion_tokens: "80", prompt_tokens_details: { cached_tokens: Number.NaN } } }),
    ).toBeUndefined();
    expect(parseLlmUsage({ model: "gpt-5.1", usage: { prompt_tokens: 10.7, completion_tokens_details: { reasoning_tokens: 4 } } })).toEqual({ pt: 10, rt: 4, m: "gpt-5.1" });
    expect(parseLlmUsage(null)).toBeUndefined();
  });

  it("kanıt kırpılsa bile iddia özeti ve kullanım KORUNUR (kırpma yalnız kalem listesini kısaltır)", () => {
    const retrieved = Array.from({ length: 120 }, (_, i) => ({ id: `kb-item-${String(i).padStart(4, "0")}-xxxxxxxx`, updatedAt: new Date(0) }));
    const json = JSON.parse(
      String(
        buildKbEvidence({
          retrieved,
          usedLabels: [],
          claims: { v: 1, n: 1, ctx: 0, op: 0, echo: 0, k: 0, u: 1, uc: ["time"], ec: [] },
          llm: { pt: 5 },
        }),
      ),
    );
    expect(json.omitted).toBeGreaterThan(0); // KONTROL: gerçekten kırpıldı
    expect(json).toMatchObject({ claims: { u: 1, uc: ["time"] }, llm: { pt: 5 } });
  });

  it("ölçülmediyse kanıt biçimi DEĞİŞMEZ (anahtar eklenmez)", () => {
    expect(JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: ["history"] })))).toEqual({ retrieved: [], used: ["history"] });
  });

  it("asla fırlatmaz; bağlam yoksa ölçülmedi (undefined)", () => {
    expect(auditClaimsSafe("Saat 15:00", undefined)).toBeUndefined();
    expect(auditClaimsSafe("Saat 15:00", { facts: null as never, operator: [], guest: [] })).toBeUndefined();
  });

  it("çekişmeli 24k girdiler makul sürede biter (ReDoS + karesel iş pini)", () => {
    // Ölçüldü (09-23): bugünkü kodla hepsi birlikte ~230 ms. Sınırsız e-posta kalıbı üç e-posta
    // girdisinin her birinde ~1 sn; kod iddiası başına tüm metni yeniden bölmek "şifre: X1"
    // tekrarında 2,8 sn. Eşik ikisini de ayırır, yavaş CI'ya ~6× pay bırakır.
    const evils = [
      "1.2.3.".repeat(4000) + "a@" + "b.".repeat(2000),
      "a".repeat(24000),
      "a".repeat(12000) + "@" + "b.".repeat(6000),
      "Kod " + "9".repeat(24000),
      "12:00 ".repeat(4000),
      "0532 ".repeat(4800),
      "şifre: X1 ".repeat(2400),
    ];
    const t0 = performance.now();
    for (const e of evils) auditClaims(e, { facts: [e], operator: [e.slice(0, 8000)], guest: [e.slice(0, 8000)] });
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it("🚨 misafirin yazdığı ↔ cevabın yankıladığı kod belirteçleri karesel iş üretmez (inceleme 09-23: 4,3–10 sn)", () => {
    // Cevapta "A1" tekrarı + misafir bağlamında "www.q.co/A1" tekrarı: her kod iddiası her URL
    // aralığıyla kıyaslanıyordu. Artık belirteç başına bir tarama + önek toplamı (~15 ms).
    const reply = "A1 ".repeat(1300);
    const guest = "www.q.co/A1 ".repeat(4000);
    const t0 = performance.now();
    const a = auditClaims(reply, { facts: [], operator: [], guest: [guest] });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(a.n).toBeGreaterThan(1000); // KONTROL: iddialar gerçekten çıkarıldı
  });

  it("🚨 mimari: gönderim kapıları iddia ölçümünü İÇE AKTARMAZ (gölge sessizce kapıya dönüşemez)", () => {
    for (const f of ["src/lib/ai/fallback.ts", "src/lib/guest-chat-gate.ts", "src/lib/ai/output-veto.ts", "src/lib/ai/absence.ts"]) {
      const src = readFileSync(path.resolve(__dirname, "../..", f), "utf8");
      expect(src, f).not.toMatch(/claim-support/);
    }
  });
});

describe("suggestReply — ölçüm ve kullanım sonuca taşınır", () => {
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const input = {
    property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
    reservation: null,
    knowledgeBase: [{ category: "parking", title: "Otopark", content: "Otopark günlüğü 150 TL." }],
    guestMessage: "Otopark ücreti?",
    tone: "warm" as const,
    language: "tr",
  };
  const response = (reply: string, usage?: object) =>
    new Response(
      JSON.stringify({
        model: "gpt-5.1-2026",
        usage,
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ intent: "parking", confidence: 0.9, reply, riskLevel: "none" }) } }],
      }),
      { status: 200 },
    );

  it("model cevabı → claimAudit + llmUsage (önbellek oranı gözlemlenebilir)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("Otopark günlüğü 200 TL.", { prompt_tokens: 12000, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 11000 } })),
    );
    const r = await suggestReply(input);
    expect(r.source).toBe("openai");
    expect(r.claimAudit).toMatchObject({ n: 1, u: 1, uc: ["money"] });
    expect(r.llmUsage).toEqual({ pt: 12000, ct: 80, cpt: 11000, m: "gpt-5.1-2026" });
  });

  it("dayanaklı cevap → u = 0; kullanım yoksa alan YOK (ölçülmedi, sıfır değil)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response("Otopark günlüğü 150 TL.")));
    const r = await suggestReply(input);
    expect(r.claimAudit).toMatchObject({ n: 1, ctx: 1, u: 0 });
    expect(r.llmUsage).toEqual({ m: "gpt-5.1-2026" });
  });

  it("kesilmiş (finish_reason=length) yanıt fallback'e düşer ama harcanan token GÖRÜNÜR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ usage: { prompt_tokens: 900, completion_tokens: 2000 }, choices: [{ finish_reason: "length", message: { content: "{" } }] }), { status: 200 })),
    );
    const r = await suggestReply(input);
    expect(r.source).toBe("fallback");
    expect(r.claimAudit).toBeUndefined();
    expect(r.llmUsage).toEqual({ pt: 900, ct: 2000 });
  });
});
