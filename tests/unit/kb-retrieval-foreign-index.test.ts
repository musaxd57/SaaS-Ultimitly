import { afterEach, describe, expect, it, vi } from "vitest";
import { FOREIGN_SURFACE_FORMS, foreignTokens, matchForeignConcepts } from "@/lib/ai/retrieval/lexicon-foreign";
import { CONCEPTS } from "@/lib/ai/retrieval/lexicon";

// ---------------------------------------------------------------------------
// YABANCI YÜZEY BİÇİMİ EŞLEŞMESİ — ADAY KONUM DİZİNİ KÂHİNİ (O3 optimizasyon turu, 11-19). `matchForeignConcepts` artık her sözlük
// girdisini yalnız eşleşebileceği konumlarda dener (Latin: baş belirtecin ilk harfiyle başlayan belirteçler; Kiril / Arap: metinde o
// yazının harfi varsa). Aşağıdaki kâhin 11-19 öncesi KABA TARAMADIR (her girdi × her konum); kurallar `lexicon-foreign.ts`ten AYNEN
// kopyalandı (o dosyada değişirse burada da değişmeli — kâhin eski davranışın tanımıdır). Yeni uygulama her girdide birebir aynı listeyi
// (kavram + eşleşen biçim, sözlük sırasıyla) vermeli.
// ---------------------------------------------------------------------------

const ARABIC = /[؀-ۿ]/u;
const CYRILLIC = /[Ѐ-ӿ]/u;
const ARABIC_CLITICS = ["وال", "بال", "فال", "كال", "ولل", "لل", "ال", "و", "ب", "ل", "ف", "ك"];
const LATIN_INFLECTIONS: ReadonlySet<string> = new Set(["", "s", "es", "e", "en", "er", "n"]);
type Script = "latin" | "cyrillic" | "arabic";
type EntryToken = { text: string; script: Script; prefix: boolean; exact: boolean };
type Entry = { conceptId: string; tokens: EntryToken[]; via: string };

const scriptOf = (t: string): Script => (ARABIC.test(t) ? "arabic" : CYRILLIC.test(t) ? "cyrillic" : "latin");
function tokenMatchesOracle(t: string, e: EntryToken): boolean {
  if (e.script === "arabic") {
    const candidates = [t];
    for (const c of ARABIC_CLITICS) if (t.startsWith(c) && t.length - c.length >= 2) candidates.push(t.slice(c.length));
    if (e.exact) return candidates.includes(e.text);
    return candidates.some((x) => x.startsWith(e.text) || (e.text.length >= 4 && x.includes(e.text)));
  }
  if (e.exact) return t === e.text;
  if (e.script === "cyrillic") return t.startsWith(e.text) || (e.text.length >= 5 && t.includes(e.text));
  if (e.prefix) return t.startsWith(e.text);
  return t.startsWith(e.text) && LATIN_INFLECTIONS.has(t.slice(e.text.length));
}
const ORACLE_ENTRIES: Entry[] = [];
for (const concept of CONCEPTS) {
  for (const raw of FOREIGN_SURFACE_FORMS[concept.id] ?? []) {
    const prefix = raw.endsWith("*");
    const exact = raw.endsWith("=");
    const body = prefix || exact ? raw.slice(0, -1) : raw;
    const variants = /[äöü]/i.test(body) ? [body, body.replace(/ä/gi, "ae").replace(/ö/gi, "oe").replace(/ü/gi, "ue")] : [body];
    for (const v of variants) {
      const texts = foreignTokens(v);
      if (texts.length === 0) continue;
      ORACLE_ENTRIES.push({ conceptId: concept.id, tokens: texts.map((text) => ({ text, script: scriptOf(text), prefix, exact })), via: texts.join(" ") });
    }
  }
}
const CONCEPT_IDS = new Set(CONCEPTS.map((c) => c.id));
/** 11-19 öncesi kaba tarama — kâhin (değiştirme). */
function matchOracle(text: string): [string, string][] {
  const toks = foreignTokens(text);
  if (toks.length === 0) return [];
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const entry of ORACLE_ENTRIES) {
    if (seen.has(entry.conceptId)) continue;
    outer: for (let i = 0; i + entry.tokens.length <= toks.length; i++) {
      for (let j = 0; j < entry.tokens.length; j++) if (!tokenMatchesOracle(toks[i + j], entry.tokens[j])) continue outer;
      if (CONCEPT_IDS.has(entry.conceptId)) out.push([entry.conceptId, entry.via]);
      seen.add(entry.conceptId);
      break;
    }
  }
  return out;
}
const actual = (text: string): [string, string][] => matchForeignConcepts(text).map((m) => [m.concept.id, m.via]);

function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const ALL_FORMS = Object.values(FOREIGN_SURFACE_FORMS)
  .flat()
  .map((f) => f.replace(/[*=]$/, ""));

function mismatches(inputs: Iterable<string>): { text: string; oracle: [string, string][]; actual: [string, string][] }[] {
  const out: { text: string; oracle: [string, string][]; actual: [string, string][] }[] = [];
  for (const text of inputs) {
    const o = matchOracle(text);
    const a = actual(text);
    if (JSON.stringify(o) !== JSON.stringify(a)) out.push({ text, oracle: o, actual: a });
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("matchForeignConcepts — 11-19 öncesi kaba taramayla birebir", () => {
  it("kâhin gerçekten sözlüğü taşıyor (boş kâhin her şeyi geçirirdi)", () => {
    expect(ORACLE_ENTRIES.length).toBeGreaterThan(300);
    expect(matchOracle("Wo ist der Parkplatz?").map(([id]) => id)).toContain("parking");
  });

  it("her yüzey biçimi tek başına, cümle içinde, çekim / ön ek / iç ek ile", () => {
    const inputs: string[] = [];
    for (const f of ALL_FORMS) {
      inputs.push(f, `Wo ist ${f} bitte?`, `${f}s`, `${f}en`, `${f}x`, `при${f}ся`, `ال${f}`, `وال${f}`, `x${f}`, f.toUpperCase());
    }
    expect(mismatches(inputs)).toEqual([]);
  });

  it("karışık yazı sistemleri, rakamlar ve Türkçe / İngilizce gündelik metin", () => {
    const fixed = [
      "", "12 34 56", "abcключ", "ключabc", "alwifi الwifi", "WLAN-Passwort und Parkplatz", "¿Dónde está la playa? ¿Y el metro?",
      "Нет воды и света, где огнетушитель?", "لا يوجد ماء في الشقة، أين المصعد؟", "Wifi şifresi nedir, otopark var mı?",
      "Is there a hairdryer and a fridge?", "Merhaba, bavulları erken bırakabilir miyiz?", "Schlüssel verloren, Hausmeister?",
      "Handtuecher und Muell", "à partir de 15h", "Paradan kesinti var mı?", "the drapes are dirty", "machine à laver ne marche pas",
    ];
    expect(mismatches(fixed)).toEqual([]);
  });

  it("rastgele cümleler: 2–5 sözlük biçimi + dolgu belirteçleri + bozulmalar", () => {
    const FILLER = ["the", "der", "la", "и", "في", "merhaba", "bitte", "por", "favor", "12", "3", "wifi", "ok", "x", "ç", "ß", "é"];
    const r = rng(1119);
    const inputs: string[] = [];
    for (let i = 0; i < 2500; i++) {
      const parts: string[] = [];
      const n = 2 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        let f = ALL_FORMS[Math.floor(r() * ALL_FORMS.length)];
        const m = r();
        if (m < 0.15) f = f.slice(0, Math.max(1, f.length - 1));
        else if (m < 0.3) f = f + ["s", "es", "en", "er", "n", "e", "a", "ый", "ة"][Math.floor(r() * 9)];
        else if (m < 0.4) f = ARABIC_CLITICS[Math.floor(r() * ARABIC_CLITICS.length)] + f;
        parts.push(f, FILLER[Math.floor(r() * FILLER.length)]);
      }
      inputs.push(parts.join(r() < 0.5 ? " " : ", "));
    }
    expect(mismatches(inputs)).toEqual([]);
  });
});

describe("matchForeignConcepts — iş miktarı sözlük büyüklüğüne bağlı değil", () => {
  it("hiçbir girdinin başlayamayacağı belirteçlerde (rakam) belirteç karşılaştırması yapılmaz", () => {
    const spy = vi.spyOn(String.prototype, "startsWith");
    expect(actual("12 34 56 78 90 11 22 33")).toEqual([]);
    // Kaba tarama: her Latin girdi × her konum (300+ × 8 startsWith).
    expect(spy).not.toHaveBeenCalled();
  });

  it("Latin metinde karşılaştırma sayısı kaba taramanın küçük bir kesri", () => {
    const text = "Is there a parking place near the apartment and where are the towels please";
    const toks = foreignTokens(text).length;
    const spy = vi.spyOn(String.prototype, "startsWith");
    actual(text);
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(calls).toBeGreaterThan(0);
    // Kaba tarama Latin girdilerin her biri için her konumda en az bir startsWith yapardı.
    const latinEntries = ORACLE_ENTRIES.filter((e) => e.tokens[0].script === "latin").length;
    expect(calls * 5).toBeLessThan(latinEntries * toks);
  });
});
