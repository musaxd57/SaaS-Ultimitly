import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { needMetrics, scoreNeeds, type NeedResult, type NeedSpec } from "./need-scoring";
import { armText, checkRequest, isRawResult, normalizeForQuote, numberTokens, numbersOf, sameNumber, sourceTextOf, type RawArm, type RawCheckIssue, type RawNote, type RawRequest, type RawResult } from "./raw-arm";

// ---------------------------------------------------------------------------
// HAM MODEL KOLU ↔ ÜRÜN (katman atfı; kurucu / Codex 11-12).
//
// İki kısım:
//  1. Mekanik denetimin çevrimdışı pinleri (her `npm test`te koşar; model çağrısı yok).
//  2. Rapor: `RAW_ARM_DIR` verilirse o klasördeki ham çıktıları (`<set>.json` — `scripts/claude-work/run.ts` `raw_baseline` üretir) GELİŞTİRME
//     setlerinin insan yazımı ihtiyaç listesiyle, ürün ölçerinin AYNI cetveliyle (`need-scoring.ts`) puanlar; üç kol yan yana:
//       ham (kapısız) · ham + yalnız mekanik denetim · ham + mekanik + modelin varlık / koşul beyanı.
//     `RAW_ARM_LABEL` rapor adına girer (ör. model adı). Model ÇAĞIRMAZ; ücretsiz.
//
// 🚨 Yalnız geliştirme setleri (aşağıdaki sabit liste). Mühürlü / kör setler bu ölçere hiç girmez.
// ---------------------------------------------------------------------------

const DEV_SETS = ["grounding-dev", "turn-messages-dev"] as const;

interface DevSet {
  property: Record<string, unknown>;
  kbSets: Record<string, RawNote[]>;
  scenarios: { id: string; class?: string; lang?: string; kb: string; message: string; expect: { needs?: NeedSpec[] } }[];
}
interface RawRow {
  id: string;
  result: unknown;
  model?: string | null;
}

const NOTES: RawNote[] = [
  { category: "amenities", title: "Havuz", content: "Havuz hafta sonu 09:00–23:00 arası açıktır." },
  { category: "local", title: "Market", content: "En yakın market 150 metre uzaklıktadır." },
  { category: "transfer", title: "Havalimanı transferi", content: "Havalimanından tek yön transfer 900 TL’dir; en az bir gün önce yazın." },
];
const PROPERTY = JSON.stringify({ name: "Lale – bahçe katı", checkInTime: "15:00", checkOutTime: "11:00" });

function req(over: Partial<RawRequest>): RawRequest {
  return {
    request_tr: "x",
    decision: "answer",
    entity_asked: "havuz",
    entity_in_source: "havuz",
    same_entity: "yes",
    attribute_asked: "kapanış saati",
    condition_in_source: "",
    condition_covers_question: "n/a",
    evidence_note: "N1",
    evidence_quote: "Havuz hafta sonu 09:00–23:00 arası açıktır.",
    sentence: "Havuzumuz hafta sonu 23:00'e kadar açık.",
    reason_tr: "",
    ...over,
  };
}

describe("ham model kolu — mekanik denetim (çevrimdışı)", () => {
  it("sayılar: saat / tutar yazım farkı aynı sayıdır; farklı sayı farklıdır", () => {
    expect(numbersOf("09:00–23:00 arası, 1.500 TL, 2 kişi")).toEqual(["900", "2300", "1500", "2"]);
    expect(numbersOf("9.00 ile 23.00")).toEqual(["900", "2300"]);
    expect(numbersOf("saat 00:30")).toEqual(["30"]);
    expect(numbersOf("0")).toEqual(["0"]);
    expect(numbersOf("sayı yok")).toEqual([]);
  });

  it("🚨 aynı rakamlar başka sayı olabilir: '1,5 km' alıntısı '15 km'yi, '11:00' alıntısı '1100'ü desteklemez", () => {
    const one = (t: string) => numberTokens(t)[0];
    // Yazım farkı, aynı sayı.
    expect(sameNumber(one("09:00"), one("9.00"))).toBe(true);
    expect(sameNumber(one("1,5"), one("1.5"))).toBe(true);
    expect(sameNumber(one("1.500"), one("1500"))).toBe(true);
    expect(sameNumber(one("1500"), one("1,500"))).toBe(true);
    expect(sameNumber(one("1.250.000"), one("1250000"))).toBe(true);
    // Saat / tutar kısaltması: sondaki sıfır grubu (en çok iki rakam) sayıyı değiştirmez.
    expect(sameNumber(one("23"), one("23:00"))).toBe(true);
    expect(sameNumber(one("900,00"), one("900"))).toBe(true);
    expect(sameNumber(one("09:00"), one("9"))).toBe(true);
    // Aynı rakamlar, başka sayı.
    expect(sameNumber(one("1,5"), one("15"))).toBe(false);
    expect(sameNumber(one("11:00"), one("1100"))).toBe(false);
    expect(sameNumber(one("1.50"), one("150"))).toBe(false);
    expect(sameNumber(one("150"), one("1500"))).toBe(false);
    // 🚨 Haiku incelemesi 11-13: grup SAYISI aynı diye aynı sayı sayılıyordu.
    expect(sameNumber(one("10,05"), one("1.005"))).toBe(false);
    expect(sameNumber(one("10.00"), one("1.000"))).toBe(false);
    expect(sameNumber(one("23:30"), one("23"))).toBe(false);
    // "1.000" bindir, "1" değil (sondaki sıfır kuralı üç rakamlı gruba uygulanmaz).
    expect(sameNumber(one("1.000"), one("1"))).toBe(false);
    // Bilinen sınır (güvenli yön): karışık yazım eşleşmez.
    expect(sameNumber(one("1.500,50"), one("1500.50"))).toBe(false);
    // Denetimde: ondalık uzaklık notu, tam sayı cümlesi → gitmez; aynı yazım geçer.
    const notes: RawNote[] = [{ category: "local", title: "Plaj", content: "Plaj 1,5 km uzaklıktadır." }];
    const base = req({ evidence_note: "N1", evidence_quote: "Plaj 1,5 km uzaklıktadır." });
    expect(checkRequest({ ...base, sentence: "Plaj 15 km uzaklıkta." }, notes, PROPERTY)).toEqual<RawCheckIssue[]>(["value_not_in_quote"]);
    expect(checkRequest({ ...base, sentence: "Plaj 1.5 km uzaklıkta." }, notes, PROPERTY)).toEqual([]);
  });

  it("alıntı: boşluk / tire / tırnak biçimi düşürmez; harf değişikliği düşürür", () => {
    expect(normalizeForQuote("Havuz  hafta sonu\n09:00—23:00")).toBe(normalizeForQuote("Havuz hafta sonu 09:00–23:00"));
    expect(normalizeForQuote("900 TL’dir")).toBe("900 TL'dir");
    expect(normalizeForQuote("Havuz")).not.toBe(normalizeForQuote("havuz"));
  });

  it("kimlik: N<i> ve PROPERTY çözülür; köşeli ayraçlı / küçük harfli yazım da; olmayan kimlik çözülmez", () => {
    expect(sourceTextOf("N2", NOTES, PROPERTY)).toBe("Market: En yakın market 150 metre uzaklıktadır.");
    expect(sourceTextOf("[n2]", NOTES, PROPERTY)).toBe("Market: En yakın market 150 metre uzaklıktadır.");
    expect(sourceTextOf("PROPERTY", NOTES, PROPERTY)).toBe(PROPERTY);
    expect(sourceTextOf(" [ N2 ] ".replace(/ /g, ""), NOTES, PROPERTY)).toBe("Market: En yakın market 150 metre uzaklıktadır.");
    expect(sourceTextOf("[N2", NOTES, PROPERTY)).toBeNull();
    expect(sourceTextOf("N1, N2", NOTES, PROPERTY)).toBeNull();
    expect(sourceTextOf("N9", NOTES, PROPERTY)).toBeNull();
    expect(sourceTextOf("N0", NOTES, PROPERTY)).toBeNull();
    expect(sourceTextOf("bilgi tabanı", NOTES, PROPERTY)).toBeNull();
  });

  it("geçen cümle: kimlik bu turda, alıntı notta birebir, sayılar alıntıda, beyan olumlu", () => {
    expect(checkRequest(req({}), NOTES, PROPERTY)).toEqual([]);
    // Mülk alanından cevap.
    expect(checkRequest(req({ evidence_note: "PROPERTY", evidence_quote: '"checkOutTime":"11:00"', sentence: "Çıkış saatimiz 11:00." }), NOTES, PROPERTY)).toEqual([]);
  });

  it("🚨 uydurma alıntı: notta geçmeyen metin kaynak sayılmaz", () => {
    expect(checkRequest(req({ evidence_quote: "Havuz her gün 23:00'e kadar açıktır." }), NOTES, PROPERTY)).toContain<RawCheckIssue>("quote_not_in_note");
    expect(checkRequest(req({ evidence_quote: "" }), NOTES, PROPERTY)).toContain<RawCheckIssue>("quote_not_in_note");
    // Doğru metin, yanlış not kimliği: alıntı o notta yok.
    expect(checkRequest(req({ evidence_note: "N2" }), NOTES, PROPERTY)).toContain<RawCheckIssue>("quote_not_in_note");
    expect(checkRequest(req({ evidence_note: "N7" }), NOTES, PROPERTY)).toContain<RawCheckIssue>("unknown_note");
  });

  it("🚨 bağlamsız alıntı: notta birebir geçen tek karakter / çıplak sayı kaynak sayılmaz; notun tamamı kısa da olsa sayılır", () => {
    // "." her notta geçer; "11" mülk alanında geçer — ikisi de cümleyi desteklemez (Haiku incelemesi 11-13: denetimi geçiyordu).
    expect(checkRequest(req({ evidence_quote: ".", sentence: "Otoparkımız ücretsiz." }), NOTES, PROPERTY)).toEqual<RawCheckIssue[]>(["quote_too_short"]);
    expect(checkRequest(req({ evidence_note: "PROPERTY", evidence_quote: "11", sentence: "Havuzumuz 11'e kadar açık." }), NOTES, PROPERTY)).toEqual<RawCheckIssue[]>(["quote_too_short"]);
    expect(checkRequest(req({ evidence_quote: "09:00–23:00", sentence: "Havuzumuz 23:00'e kadar açık." }), NOTES, PROPERTY)).toEqual<RawCheckIssue[]>(["quote_too_short"]);
    // Kısa ama notun TAMAMI (içerik ya da "başlık: içerik") → bağlam eksik değil.
    const short: RawNote[] = [{ category: "property_info", title: "Kat", content: "3. kat" }];
    expect(checkRequest(req({ evidence_quote: "3. kat", sentence: "Dairemiz 3. katta." }), short, PROPERTY)).toEqual([]);
    expect(checkRequest(req({ evidence_quote: "Kat: 3. kat", sentence: "Dairemiz 3. katta." }), short, PROPERTY)).toEqual([]);
    expect(checkRequest(req({ evidence_quote: "kat", sentence: "Dairemiz katta." }), short, PROPERTY)).toEqual<RawCheckIssue[]>(["quote_too_short"]);
    // Uzun ama sözcüksüz alıntı (yalnız saatler) da bağlam taşımaz: hangi şeyin saati olduğu alıntıda yok.
    const hours: RawNote[] = [{ category: "amenities", title: "Spor salonu", content: "Spor salonu 09:00–12:00 / 14:00–18:00 arası açıktır." }];
    expect(checkRequest(req({ evidence_quote: "09:00–12:00 / 14:00–18:00", sentence: "Havuzumuz 18:00'e kadar açık." }), hours, PROPERTY)).toEqual<RawCheckIssue[]>(["quote_too_short"]);
    expect(checkRequest(req({ evidence_quote: "Spor salonu 09:00–12:00 / 14:00–18:00 arası açıktır.", sentence: "Spor salonumuz 18:00'e kadar açık." }), hours, PROPERTY)).toEqual([]);
  });

  it("🚨 taşınmış değer: cümledeki sayı alıntıda yoksa gitmez (market 150 m → eczane, 900 TL → otogar)", () => {
    // Alıntı gerçek, cümle alıntıda olmayan bir sayı söylüyor.
    expect(checkRequest(req({ sentence: "Havuzumuz hafta içi 22:00'ye kadar açık." }), NOTES, PROPERTY)).toEqual<RawCheckIssue[]>(["value_not_in_quote"]);
    // Sayı alıntıda var ama model varlığın farklı olduğunu beyan etti → sayı denetimi geçer, beyan tutar.
    const pharmacy = req({ entity_asked: "eczane", entity_in_source: "market", same_entity: "no", evidence_note: "N2", evidence_quote: "En yakın market 150 metre uzaklıktadır.", sentence: "Eczane 150 metre uzaklıkta." });
    expect(checkRequest(pharmacy, NOTES, PROPERTY)).toEqual<RawCheckIssue[]>(["entity_mismatch"]);
  });

  it("🚨 koşul: not hafta sonunu söylüyor, soru hafta içi → beyan 'kapsamıyor' / 'bilinmiyor' ise gitmez", () => {
    expect(checkRequest(req({ condition_in_source: "hafta sonu", condition_covers_question: "no" }), NOTES, PROPERTY)).toEqual<RawCheckIssue[]>(["condition_not_covering"]);
    expect(checkRequest(req({ condition_in_source: "hafta sonu", condition_covers_question: "unknown" }), NOTES, PROPERTY)).toEqual<RawCheckIssue[]>(["condition_not_covering"]);
    expect(checkRequest(req({ condition_in_source: "hafta sonu", condition_covers_question: "yes" }), NOTES, PROPERTY)).toEqual([]);
    // Notta koşul yazıyorsa "geçerli değil" yetmez — açık "kapsıyor" gerekir (Haiku incelemesi 11-13).
    expect(checkRequest(req({ condition_in_source: "hafta sonu", condition_covers_question: "n/a" }), NOTES, PROPERTY)).toEqual<RawCheckIssue[]>(["condition_not_covering"]);
    // Koşul alanı boş / biçimsel boşluk ise "geçerli değil" olağandır.
    for (const none of ["", " ", "-", "yok", "none", "N/A"]) {
      expect(checkRequest(req({ condition_in_source: none, condition_covers_question: "n/a" }), NOTES, PROPERTY), none).toEqual([]);
    }
  });

  it("karar 'cevapla' değilse cümle hiç gitmez; boş cümle cevap değildir", () => {
    expect(checkRequest(req({ decision: "no_source" }), NOTES, PROPERTY)).toEqual<RawCheckIssue[]>(["not_answer"]);
    expect(checkRequest(req({ decision: "host_decides" }), NOTES, PROPERTY)).toEqual<RawCheckIssue[]>(["not_answer"]);
    expect(checkRequest(req({ sentence: "  " }), NOTES, PROPERTY)).toContain<RawCheckIssue>("empty_sentence");
  });

  it("kol metni: ham = modelin cevabı; denetimli kollarda cevap onaylı cümlelerden kurulur, geçmeyen istek düşer, öteki gider", () => {
    const good = req({});
    const moved = req({ entity_asked: "eczane", same_entity: "no", evidence_note: "N2", evidence_quote: "En yakın market 150 metre uzaklıktadır.", sentence: "Eczane 150 metre uzaklıkta." });
    const invented = req({ evidence_quote: "Kahvaltı sunmuyoruz.", sentence: "Kahvaltı sunmuyoruz." });
    const result: RawResult = { requests: [good, moved, invented], reply: "Havuz 23:00'e kadar açık. Eczane 150 metre. Kahvaltı sunmuyoruz.", would_send: true };
    expect(armText(result, "raw", NOTES, PROPERTY)).toBe(result.reply);
    // Yalnız mekanik: uydurma alıntı düşer; taşınmış değer (alıntı gerçek, sayı alıntıda) kodun göremediği yerdir → kalır.
    expect(armText(result, "mechanical", NOTES, PROPERTY)).toBe("Havuzumuz hafta sonu 23:00'e kadar açık. Eczane 150 metre uzaklıkta.");
    // Beyan uygulanınca taşınmış değer de düşer.
    expect(armText(result, "declared", NOTES, PROPERTY)).toBe("Havuzumuz hafta sonu 23:00'e kadar açık.");
    // Aynı cümle iki istekte beyan edildiyse bir kez gider.
    expect(armText({ requests: [good, good], reply: "x", would_send: true }, "declared", NOTES, PROPERTY)).toBe("Havuzumuz hafta sonu 23:00'e kadar açık.");
    // Hiçbiri geçmezse tur ev sahibinde kalır.
    expect(armText({ requests: [invented], reply: "Kahvaltı sunmuyoruz.", would_send: true }, "declared", NOTES, PROPERTY)).toBeNull();
    // Model "gönderme" dediyse ham kol da göndermez.
    expect(armText({ requests: [], reply: "", would_send: false }, "raw", NOTES, PROPERTY)).toBeNull();
    expect(armText({ requests: [good], reply: "x", would_send: false }, "raw", NOTES, PROPERTY)).toBeNull();
  });

  it("biçim denetimi: şema dışı çıktı ölçüme girmez", () => {
    expect(isRawResult({ requests: [req({})], reply: "x", would_send: true })).toBe(true);
    expect(isRawResult({ requests: [{ ...req({}), same_entity: true }], reply: "x", would_send: true })).toBe(false);
    expect(isRawResult({ requests: [{ ...req({}), decision: "maybe" }], reply: "x", would_send: true })).toBe(false);
    expect(isRawResult({ requests: "yok", reply: "x", would_send: true })).toBe(false);
    expect(isRawResult(null)).toBe(false);
  });

  it("setler: geliştirme setlerinin her senaryosunda ihtiyaç listesi var; ölçer yalnız bu iki seti tanır", () => {
    expect([...DEV_SETS]).toEqual(["grounding-dev", "turn-messages-dev"]);
    for (const set of DEV_SETS) {
      const data = JSON.parse(readFileSync(path.join(process.cwd(), "evals", `${set}.json`), "utf8")) as DevSet;
      expect(data.scenarios.length).toBeGreaterThan(10);
      for (const s of data.scenarios) {
        expect(s.expect.needs?.length, `${set} ${s.id}`).toBeGreaterThan(0);
        expect(data.kbSets[s.kb], `${set} ${s.id} kb`).toBeDefined();
      }
    }
  });
});

// ── Rapor (ücretsiz; ham çıktılar hazırsa) ─────────────────────────────────────────────────────────────────────────────────────────────
const RAW_DIR = process.env.RAW_ARM_DIR?.trim() || "";
const ARMS: { arm: RawArm; label: string }[] = [
  { arm: "raw", label: "ham model (kapısız)" },
  { arm: "mechanical", label: "ham + yalnız mekanik denetim (alıntı notta · sayı alıntıda)" },
  { arm: "declared", label: "ham + mekanik + modelin varlık / koşul beyanı" },
];

describe.skipIf(RAW_DIR === "")("ham model kolu — rapor", () => {
  it("geliştirme setlerini üç kolda puanlar ve raporu yazar", () => {
    const label = (process.env.RAW_ARM_LABEL?.trim() || "model").replace(/[^a-z0-9.-]+/gi, "-");
    const lines: string[] = [
      `# Ham model kolu — ${label}`,
      "",
      "Aynı misafir mesajı + aynı notlarla, ürünün kapıları olmadan modelin kendi kararı; ürün ölçerinin ihtiyaç cetveliyle (`tests/eval/need-scoring.ts`) puanlandı.",
      "Kollar: ham (hiçbir denetim) · yalnız kodun sınayabildiği denetim · ek olarak modelin varlık / koşul beyanı. Sözcük / kök sözlüğü yok.",
      "Ürün kolundan farkı: ham kolda öğe defteri yoktur — yalnız GİDEN METİN puanlanır; ürün kolunda ek olarak \"öğe cevaplandı sayıldı ama değer gitmedi\" yanlışı da sayılır.",
      "",
    ];
    let scoredSets = 0;
    const sidecar: Record<string, unknown> = { label, sets: {} };
    for (const set of DEV_SETS) {
      const rawPath = path.join(RAW_DIR, `${set}.json`);
      if (!existsSync(rawPath)) {
        lines.push(`## ${set}`, "", "ham çıktı yok — atlandı", "");
        continue;
      }
      const data = JSON.parse(readFileSync(path.join(process.cwd(), "evals", `${set}.json`), "utf8")) as DevSet;
      const rows = JSON.parse(readFileSync(rawPath, "utf8")) as RawRow[];
      const byId = new Map(rows.map((r) => [r.id, r]));
      const propertyJson = JSON.stringify(data.property);
      const perArm = new Map<RawArm, NeedResult[]>(ARMS.map((a) => [a.arm, []]));
      const issueCounts: Record<string, number> = {};
      const detail: Record<string, unknown>[] = [];
      let missing = 0;
      let malformed = 0;
      let requests = 0;
      for (const s of data.scenarios) {
        const row = byId.get(s.id);
        if (!row) {
          missing += 1;
          continue;
        }
        if (!isRawResult(row.result)) {
          malformed += 1;
          continue;
        }
        const result = row.result;
        const notes = data.kbSets[s.kb] ?? [];
        const needs = s.expect.needs ?? [];
        const checks = result.requests.map((r) => ({ request: r.request_tr, decision: r.decision, issues: checkRequest(r, notes, propertyJson) }));
        requests += result.requests.length;
        for (const c of checks) for (const i of c.issues) if (i !== "not_answer") issueCounts[i] = (issueCounts[i] ?? 0) + 1;
        const armOut: Record<string, unknown> = {};
        for (const { arm } of ARMS) {
          const text = armText(result, arm, notes, propertyJson);
          const scored = scoreNeeds(needs, text, []);
          perArm.get(arm)!.push(...scored);
          armOut[arm] = { text, needs: scored.map((n) => `${n.kind}:${n.want}${n.wrongAnswered ? "✖YANLIŞ" : n.textOk ? "✔" : "✖"}`) };
        }
        detail.push({ id: s.id, class: s.class ?? null, message: s.message, checks, arms: armOut });
      }
      lines.push(`## ${set}`, "", `Senaryo ${data.scenarios.length} · ham çıktısı olmayan ${missing} · biçimi bozuk ${malformed} · modelin çıkardığı istek ${requests}`, "");
      lines.push("| Kol | Doğru cevap | Gereksiz tutma | Açık kaldı | 🚨 Yanlış gönderim |", "|---|---|---|---|---|");
      const metricsOut: Record<string, unknown> = {};
      for (const { arm, label: armLabel } of ARMS) {
        const m = needMetrics(perArm.get(arm)!);
        metricsOut[arm] = m;
        lines.push(`| ${armLabel} | ${m.answeredOk} / ${m.answered} | ${m.needlessHold} | ${m.openOk} / ${m.open} | **${m.wrong}** |`);
      }
      lines.push("", `Denetimin düşürdüğü cümleler (sebep → sayı): ${Object.entries(issueCounts).map(([k, v]) => `${k} ${v}`).join(" · ") || "yok"}`, "");
      (sidecar.sets as Record<string, unknown>)[set] = { scenarios: data.scenarios.length, missing, malformed, requests, metrics: metricsOut, issueCounts, detail };
      // Rapor boş çıkmasın: en az bir senaryo puanlanmış olmalı.
      expect(data.scenarios.length - missing - malformed, `${set}: puanlanan senaryo`).toBeGreaterThan(0);
      scoredSets += 1;
    }
    // Klasör adı yanlışsa (hiç ham çıktı bulunamadı) koşu yeşil kalmaz.
    expect(scoredSets, `RAW_ARM_DIR içinde ham çıktı bulunamadı: ${RAW_DIR}`).toBeGreaterThan(0);
    const outDir = process.env.RAW_ARM_OUT?.trim() || path.join(process.cwd(), "docs", "olcum");
    mkdirSync(outDir, { recursive: true });
    const base = `raw-arm-${new Date().toISOString().slice(0, 10)}-${label}`;
    writeFileSync(path.join(outDir, `${base}.md`), `${lines.join("\n")}\n`, "utf8");
    writeFileSync(path.join(outDir, `${base}.json`), `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
    console.log(lines.join("\n"));
  });
});
