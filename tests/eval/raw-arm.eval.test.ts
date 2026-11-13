import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NeedSpec } from "./need-scoring";
import { armText, checkRequest, isRawResult, normalizeForQuote, numberTokens, numbersOf, sameNumber, sourceTextOf, type RawCheckIssue, type RawNote, type RawRequest, type RawResult } from "./raw-arm";
import { RAW_ARMS, RAW_DEV_SETS, renderRawReport, reportLabel, scoreRawSet, scoredScenarios, type RawDevSet, type RawRow } from "./raw-arm-score";

// ---------------------------------------------------------------------------
// HAM MODEL KOLU ↔ ÜRÜN (katman atfı; kurucu / Codex 11-12) — ÇEVRİMDIŞI PİNLER (her `npm test`te koşar; model çağrısı yok).
//
//  1. Mekanik denetim (`raw-arm.ts`): alıntı notta mı, sayı alıntıda mı, modelin varlık / koşul beyanı.
//  2. Puanlama çekirdeği (`raw-arm-score.ts`): ham çıktıların ürün ölçerinin AYNI cetveliyle (`need-scoring.ts`) üç kolda puanlanması ve
//     rapor metni — kurgusal küçük bir setle.
//
// Raporun KENDİSİ bir test değildir (11-13, CI 1797: "ortam değişkeni yoksa atla" diye yazılmış rapor testi CI'ın atlanan test tabanını
// aşıyordu; o denetim artık yerel kapıda da koşar): `npx tsx tests/eval/raw-arm-report.ts <ham çıktı dizini> [etiket] [çıktı dizini]`.
//
// 🚨 Yalnız geliştirme setleri (`RAW_DEV_SETS`). Mühürlü / kör setler bu ölçere hiç girmez.
// ---------------------------------------------------------------------------

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
    // İlk grup aynı, sonraki grup farklı (mutasyon 11-13: yalnız ilk grup kıyaslansa bunlar aynı çıkıyordu).
    expect(sameNumber(one("23:00"), one("23:30"))).toBe(false);
    expect(sameNumber(one("1.500"), one("1.600"))).toBe(false);
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
    // Koşul alanı boş olsa da model "kapsamıyor" / "bilinmiyor" dediyse gitmez (beyanın kendisi yeter).
    expect(checkRequest(req({ condition_in_source: "", condition_covers_question: "unknown" }), NOTES, PROPERTY)).toEqual<RawCheckIssue[]>(["condition_not_covering"]);
    expect(checkRequest(req({ condition_in_source: "", condition_covers_question: "no" }), NOTES, PROPERTY)).toEqual<RawCheckIssue[]>(["condition_not_covering"]);
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
    expect([...RAW_DEV_SETS]).toEqual(["grounding-dev", "turn-messages-dev"]);
    for (const set of RAW_DEV_SETS) {
      const data = JSON.parse(readFileSync(path.join(process.cwd(), "evals", `${set}.json`), "utf8")) as RawDevSet;
      expect(data.scenarios.length).toBeGreaterThan(10);
      for (const s of data.scenarios) {
        expect(s.expect.needs?.length, `${set} ${s.id}`).toBeGreaterThan(0);
        expect(data.kbSets[s.kb], `${set} ${s.id} kb`).toBeDefined();
      }
    }
  });
});

// ── Puanlama çekirdeği (kurgusal set; gerçek ham çıktı gerekmez) ─────────────────────────────────────────────────────────────────────────
const need = (over: Partial<NeedSpec> & Pick<NeedSpec, "kind" | "want">): NeedSpec => over;
const SET: RawDevSet = {
  property: JSON.parse(PROPERTY) as Record<string, unknown>,
  kbSets: { A: NOTES },
  scenarios: [
    { id: "s1", class: "dogrudan", kb: "A", message: "Havuz kaça kadar açık?", expect: { needs: [need({ kind: "amenity", want: "answered", all: ["23[:.]00"], about: ["havuz"] })] } },
    { id: "s2", kb: "A", message: "Transfer ne kadar?", expect: { needs: [need({ kind: "transfer", want: "answered", all: ["900"], about: ["transfer"] })] } },
    { id: "s3", kb: "A", message: "En yakın eczane nerede?", expect: { needs: [need({ kind: "local", want: "open", forbid: ["150"] })] } },
    { id: "s4", kb: "A", message: "Otopark var mı?", expect: { needs: [need({ kind: "parking", want: "open", forbid: ["otopark"] })] } },
    { id: "s5", kb: "A", message: "Kahvaltı var mı?", expect: { needs: [need({ kind: "breakfast", want: "open", forbid: ["kahvalt"] })] } },
  ],
};
const one = (r: RawRequest): RawResult => ({ requests: [r], reply: r.sentence, would_send: true });
const ROWS: RawRow[] = [
  // s1 — doğru cevap, alıntı notta, sayı alıntıda; ikinci isteği model açık bıraktı (istek sayısı senaryo sayısından ayrışsın).
  { id: "s1", result: { requests: [req({}), req({ decision: "no_source", sentence: "" })], reply: req({}).sentence, would_send: true } },
  // s2 — yanlış tutar (not 900 der, cümle 950): yalnız mekanik denetim görür.
  { id: "s2", result: one(req({ entity_asked: "transfer", entity_in_source: "transfer", evidence_note: "N3", evidence_quote: "Havalimanından tek yön transfer 900 TL’dir", sentence: "Transferimiz 950 TL." })) },
  // s3 — eczane sorusuna market notu: alıntı ve sayı yerinde (mekanik denetim GEÇER), modelin kendi beyanı "aynı varlık değil".
  { id: "s3", result: one(req({ entity_asked: "eczane", entity_in_source: "market", same_entity: "no", evidence_note: "N2", evidence_quote: "En yakın market 150 metre uzaklıktadır.", sentence: "Eczanemiz 150 metre uzaklıkta." })) },
  // s4 — ham çıktısı YOK. s5 — şema dışı çıktı.
  { id: "s5", result: { requests: "yok", reply: "x", would_send: true } },
];

describe("ham model kolu — puanlama çekirdeği (çevrimdışı)", () => {
  it("üç kol aynı ham çıktıdan ayrışır: ham 2 yanlış · mekanik 1 yanlış + 1 tutma · beyanla 0 yanlış", () => {
    const score = scoreRawSet(SET, ROWS);
    expect(score).toMatchObject({ scenarios: 5, missing: 1, malformed: 1, requests: 4 });
    expect(scoredScenarios(score)).toBe(3);
    // ham: doğru havuz cevabı + yanlış tutar + yanlış varlık hepsi gider.
    expect(score.metrics.raw).toMatchObject({ answered: 2, answeredOk: 1, needlessHold: 0, open: 1, openOk: 0, wrong: 2 });
    // mekanik: 950 alıntıda yok → transfer cümlesi düşer (tur gitmez = tutma); eczane cümlesi mekanik denetimi geçer → hâlâ yanlış.
    expect(score.metrics.mechanical).toMatchObject({ answered: 2, answeredOk: 1, needlessHold: 1, open: 1, openOk: 0, wrong: 1 });
    // beyan: "aynı varlık değil" → eczane cümlesi de düşer.
    expect(score.metrics.declared).toMatchObject({ answered: 2, answeredOk: 1, needlessHold: 1, open: 1, openOk: 1, wrong: 0 });
    // Düşürme sebepleri: istek başına bir kez, kol başına DEĞİL.
    expect(score.issueCounts).toEqual({ value_not_in_quote: 1, entity_mismatch: 1 });
  });

  it("ayrıntı satırı: puanlanan her senaryo için mesaj, denetim sonucu ve kol metinleri (eksik / bozuk satır ayrıntıya girmez)", () => {
    const score = scoreRawSet(SET, ROWS);
    expect(score.detail.map((d) => d.id)).toEqual(["s1", "s2", "s3"]);
    expect(score.detail[0]).toMatchObject({ id: "s1", class: "dogrudan", message: "Havuz kaça kadar açık?" });
    expect(score.detail[1]).toMatchObject({ class: null, checks: [{ decision: "answer", issues: ["value_not_in_quote"] }] });
    const arms = score.detail[1].arms as Record<string, { text: string | null; needs: string[] }>;
    expect(arms.raw).toEqual({ text: "Transferimiz 950 TL.", needs: ["transfer:answered✖YANLIŞ"] });
    expect(arms.mechanical).toEqual({ text: null, needs: ["transfer:answered✖"] });
    expect((score.detail[0].arms as typeof arms).declared.needs).toEqual(["amenity:answered✔"]);
  });

  it("'cevap değil' kararı düşürme sayılmaz; modelin açık bıraktığı istek üç kolda da açık kalır", () => {
    const rows: RawRow[] = [{ id: "s3", result: { requests: [req({ decision: "no_source", sentence: "" })], reply: "", would_send: false } }];
    const score = scoreRawSet(SET, rows);
    expect(score.issueCounts).toEqual({});
    expect(score.missing).toBe(4);
    for (const { arm } of RAW_ARMS) expect(score.metrics[arm]).toMatchObject({ open: 1, openOk: 1, wrong: 0 });
  });

  it("rapor: set başına tablo (üç kol) + düşürme sebepleri; ham çıktısı olmayan set 'atlandı' yazar ve puanlanmış sayılmaz", () => {
    const score = scoreRawSet(SET, ROWS);
    const report = renderRawReport("fable-5.2", { "grounding-dev": score, "turn-messages-dev": null });
    const text = report.lines.join("\n");
    expect(report.lines[0]).toBe("# Ham model kolu — fable-5.2");
    expect(text).toContain("## grounding-dev\n\nSenaryo 5 · ham çıktısı olmayan 1 · biçimi bozuk 1 · modelin çıkardığı istek 4");
    expect(text).toContain("| ham model (kapısız) | 1 / 2 | 0 | 0 / 1 | **2** |");
    expect(text).toContain("| ham + yalnız mekanik denetim (alıntı notta · sayı alıntıda) | 1 / 2 | 1 | 0 / 1 | **1** |");
    expect(text).toContain("| ham + mekanik + modelin varlık / koşul beyanı | 1 / 2 | 1 | 1 / 1 | **0** |");
    expect(text).toContain("Denetimin düşürdüğü cümleler (sebep → sayı): value_not_in_quote 1 · entity_mismatch 1");
    expect(text).toContain("## turn-messages-dev\n\nham çıktı yok — atlandı");
    expect(report).toMatchObject({ scoredSets: 1, emptySets: [] });
    expect(Object.keys(report.sidecar.sets)).toEqual(["grounding-dev"]);
    expect(report.sidecar.label).toBe("fable-5.2");
    // Düşürme yoksa "yok" yazar.
    const clean = renderRawReport("m", { "grounding-dev": scoreRawSet(SET, [ROWS[0]]), "turn-messages-dev": null });
    expect(clean.lines.join("\n")).toContain("(sebep → sayı): yok");
  });

  it("🚨 boş rapor yeşil sayılmaz: hiç ham çıktı yok → puanlanan set 0; çıktısı var ama tek senaryosu puanlanamayan set ayrı listelenir", () => {
    expect(renderRawReport("m", { "grounding-dev": null, "turn-messages-dev": null })).toMatchObject({ scoredSets: 0, emptySets: [] });
    const allBroken = scoreRawSet(SET, [{ id: "s1", result: null }]);
    expect(scoredScenarios(allBroken)).toBe(0);
    expect(renderRawReport("m", { "grounding-dev": allBroken, "turn-messages-dev": null })).toMatchObject({ scoredSets: 0, emptySets: ["grounding-dev"] });
    // Listede olmayan set adı rapora GİRMEZ (set adı çağırandan alınmaz).
    const stray = renderRawReport("m", { "baska-set": scoreRawSet(SET, ROWS) });
    expect(stray.scoredSets).toBe(0);
    expect(stray.lines.join("\n")).not.toContain("baska-set");
  });

  it("etiket dosya adına uygun karakterlere iner; boşsa 'model'", () => {
    expect(reportLabel("fable-5.2")).toBe("fable-5.2");
    expect(reportLabel(" gpt 5.1 / ham ")).toBe("gpt-5.1-ham");
    expect(reportLabel("../../etc")).toBe("..-..-etc");
    expect(reportLabel(undefined)).toBe("model");
    expect(reportLabel("  ")).toBe("model");
  });

  it("🚨 rapor kabuğu set adını komut satırından almaz: okunan set dosyaları yalnız sabit geliştirme listesinden kurulur", () => {
    const cliPath = path.join(process.cwd(), "tests", "eval", "raw-arm-report.ts");
    expect(existsSync(cliPath)).toBe(true);
    const cli = readFileSync(cliPath, "utf8");
    // Okunan set dosyaları yalnız sabit listeden kurulur; `evals/` altında başka bir yol yazılmaz.
    expect(cli).toContain("for (const set of RAW_DEV_SETS)");
    expect(cli.match(/"evals"/g)?.length).toBe(1);
  });
});

// ── Komut satırı kabuğu (gerçek süreç; kurgusal ham çıktı) ───────────────────────────────────────────────────────────────────────────────
describe("ham model kolu — rapor komutu", () => {
  const cli = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "tests/eval/raw-arm-report.ts", ...args], { cwd: process.cwd(), encoding: "utf8" });
  const scratch = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "raw-arm-cli-"));
    const raw = path.join(dir, "ham");
    const out = path.join(dir, "rapor");
    mkdirSync(raw);
    return { dir, raw, out };
  };

  it("argümansız → kullanım + çıkış 2", () => {
    const r = cli([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("kullanım:");
  });

  it("🚨 dizinde ham çıktı yoksa çıkış 1 ve rapor YAZILMAZ; listede olmayan set dosyası okunmaz", () => {
    const { dir, raw, out } = scratch();
    try {
      writeFileSync(path.join(raw, "baska-set.json"), "[]");
      const r = cli([raw, "deneme", out]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("ham çıktı bulunamadı");
      expect(existsSync(out)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("🚨 ham çıktı var ama tek senaryo puanlanamadı → çıkış 1 ve rapor YAZILMAZ", () => {
    const { dir, raw, out } = scratch();
    try {
      writeFileSync(path.join(raw, "grounding-dev.json"), "[]");
      const r = cli([raw, "deneme", out]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("puanlanan senaryo yok: grounding-dev");
      expect(existsSync(out)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("puanlanan bir senaryo varsa çıkış 0; rapor + ayrıntı dosyası etiketle yazılır, öteki set 'atlandı'", () => {
    const { dir, raw, out } = scratch();
    try {
      const data = JSON.parse(readFileSync(path.join(process.cwd(), "evals", "grounding-dev.json"), "utf8")) as RawDevSet;
      const row: RawRow = { id: data.scenarios[0].id, result: { requests: [req({ decision: "no_source", sentence: "" })], reply: "", would_send: false } };
      writeFileSync(path.join(raw, "grounding-dev.json"), JSON.stringify([row]));
      const r = cli([raw, "deneme etiketi", out]);
      expect(r.status, r.stderr).toBe(0);
      const files = readdirSync(out).sort();
      expect(files).toHaveLength(2);
      expect(files[0]).toMatch(/^raw-arm-\d{4}-\d{2}-\d{2}-deneme-etiketi\.json$/);
      expect(files[1]).toMatch(/^raw-arm-\d{4}-\d{2}-\d{2}-deneme-etiketi\.md$/);
      const md = readFileSync(path.join(out, files[1]), "utf8");
      expect(md).toContain("# Ham model kolu — deneme-etiketi");
      expect(md).toContain(`## grounding-dev\n\nSenaryo ${data.scenarios.length} · ham çıktısı olmayan ${data.scenarios.length - 1} · biçimi bozuk 0 · modelin çıkardığı istek 1`);
      expect(md).toContain("## turn-messages-dev\n\nham çıktı yok — atlandı");
      const sidecar = JSON.parse(readFileSync(path.join(out, files[0]), "utf8")) as { label: string; sets: Record<string, { detail: { id: string }[] }> };
      expect(sidecar.label).toBe("deneme-etiketi");
      expect(sidecar.sets["grounding-dev"].detail.map((d) => d.id)).toEqual([row.id]);
      expect(r.stdout).toContain(md.trimEnd());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
