import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ CEVAP TEKRARI — benzerlik ölçümü (kurucu fikri 10-23: "aynı soru farklı kelimelerle gelince embedding anlasın";
// Codex: "embedding benzerliği aynı cevabın verilebileceğini kanıtlamaz"). Soru: misafirin ham metni ya da anlama katmanının sorgusu
// (query_tr) üzerinde benzerlik, aynı ihtiyacı (tekrar kullanılabilir) benzeyen ama FARKLI ihtiyaçtan (karar isteyen istek, koşullu
// değişke, başka alt soru, şikâyet) ayırabiliyor mu — tek başına ve kod kapılarıyla birlikte. Veritabanı yok; misafire hiçbir şey gitmez.
// Koşul: RUN_REAL_EVAL=1 + OPENAI_API_KEY + ANSWER_REUSE_OUT (çıktı öneki). Bulutta NODE_USE_ENV_PROXY=1.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import { embedTexts, cosineOfUnit } from "@/lib/ai/embeddings/provider";
import { understandGuestMessages } from "@/lib/ai/semantic/understand";
import { reuseGate, type ReuseNeed } from "@/lib/answer-reuse/core";

const OUT = process.env.ANSWER_REUSE_OUT;
const run = process.env.RUN_REAL_EVAL === "1" && Boolean(process.env.OPENAI_API_KEY) && Boolean(OUT);

interface Group {
  id: string;
  same: string[];
  near: string[];
  answer: string;
}
const SET = JSON.parse(readFileSync("evals/answer-reuse-2026-10-23.json", "utf8")) as { groups: Group[] };

interface Probe {
  group: string;
  text: string;
  role: "anchor" | "same" | "near";
  need: ReuseNeed | null;
}

describe.skipIf(!run)("CEVAP TEKRARI — benzerlik (gerçek gömme + anlama katmanı)", () => {
  it("ham metin / anlama sorgusu / sorgu + kod kapısı", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_SEMANTIC_MODEL", process.env.AI_SEMANTIC_MODEL || "gpt-5.1");
    const probes: Probe[] = [];
    for (const g of SET.groups) {
      g.same.forEach((t, i) => probes.push({ group: g.id, text: t, role: i === 0 ? "anchor" : "same", need: null }));
      g.near.forEach((t) => probes.push({ group: g.id, text: t, role: "near", need: null }));
    }
    // Anlama katmanı (üretimdeki çağrının aynısı, öğe kipi): tek istekli mesajda isteğin türü + Türkçe sorgusu.
    for (const p of probes) {
      const u = await understandGuestMessages({ guestMessage: p.text, stayTimes: { checkIn: "15:00", checkOut: "11:00" } as never, items: true });
      if (u.status !== "ok") continue;
      const r = u.value.requests;
      p.need =
        r.length === 1 && r[0].queryTr
          ? { kind: r[0].intent, query: r[0].queryTr, language: u.value.language, stayChange: u.value.stay.requested }
          : null;
    }
    // Sağlayıcı çağrı başına en çok 64 metin alır (`EMBEDDING_BATCH_MAX`) → parça parça.
    const embedAll = async (texts: string[]): Promise<number[][] | null> => {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 50) {
        const part = await embedTexts(texts.slice(i, i + 50), { deadlineMs: 30_000 });
        if (!part) return null;
        out.push(...part);
      }
      return out;
    };
    const raw = await embedAll(probes.map((p) => p.text));
    const qry = await embedAll(probes.map((p) => p.need?.query ?? p.text));
    expect(raw && qry).toBeTruthy();

    // Çiftler: grubun çapası × grubun öteki soruları (aynı / yakın) + çapa × öteki grupların çapaları (alakasız).
    type Pair = { anchor: string; other: string; label: "same" | "near" | "cross"; cosRaw: number; cosQuery: number; gate: string; sameLanguage: boolean };
    const pairs: Pair[] = [];
    const idx = (p: Probe) => probes.indexOf(p);
    const anchors = probes.filter((p) => p.role === "anchor");
    for (const a of anchors) {
      for (const o of probes) {
        if (o === a) continue;
        const label = o.group === a.group ? (o.role === "near" ? "near" : "same") : o.role === "anchor" ? "cross" : null;
        if (!label) continue;
        const cosRaw = cosineOfUnit(raw![idx(a)], raw![idx(o)]) ?? 0;
        const cosQuery = cosineOfUnit(qry![idx(a)], qry![idx(o)]) ?? 0;
        // Kapı dil kuralı HARİÇ ölçülür (ilk dilim yalnız aynı dilde tekrar kullanır — ayrı satırda); kayıtlı cevap grubun parçası.
        const answer = SET.groups.find((g) => g.id === a.group)!.answer;
        const gate = a.need && o.need ? reuseGate(a.need, { ...o.need, language: a.need.language }, answer) : "no_understanding";
        const sameLanguage = Boolean(a.need && o.need && a.need.language === o.need.language);
        pairs.push({ anchor: a.text, other: o.text, label, cosRaw, cosQuery, gate, sameLanguage });
      }
    }

    // Eşik taraması: doğru tekrar (aynı) / yanlış tekrar (yakın + alakasız) — dört yöntem.
    const methods: Record<string, (p: Pair, t: number) => boolean> = {
      "ham metin benzerliği": (p, t) => p.cosRaw >= t,
      "anlama sorgusu benzerliği": (p, t) => p.cosQuery >= t,
      "sorgu benzerliği + kod kapısı": (p, t) => p.cosQuery >= t && p.gate === "ok",
      "ham benzerlik + kod kapısı": (p, t) => p.cosRaw >= t && p.gate === "ok",
      "sorgu + kapı + AYNI DİL (ilk dilim)": (p, t) => p.cosQuery >= t && p.gate === "ok" && p.sameLanguage,
    };
    const thresholds = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
    const same = pairs.filter((p) => p.label === "same");
    const wrong = pairs.filter((p) => p.label !== "same");
    const lines: string[] = [
      "# Cevap tekrarı — benzerlik ölçümü (geliştirme seti)",
      "",
      `Set: \`evals/answer-reuse-2026-10-23.json\` · ${SET.groups.length} grup · ${probes.length} soru · ${pairs.length} çift (aynı ${same.length} · yakın ${pairs.filter((p) => p.label === "near").length} · alakasız ${pairs.filter((p) => p.label === "cross").length}) · gömme ${process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small"} · anlama ${process.env.AI_SEMANTIC_MODEL || "gpt-5.1"}`,
      "",
      "| yöntem | eşik | doğru tekrar (aynı ihtiyaç) | 🚨 yanlış tekrar (yakın / alakasız) |",
      "|---|---|---|---|",
    ];
    for (const [name, f] of Object.entries(methods)) {
      for (const t of thresholds) {
        const tp = same.filter((p) => f(p, t)).length;
        const fp = wrong.filter((p) => f(p, t)).length;
        lines.push(`| ${name} | ${t} | ${tp}/${same.length} | ${fp}/${wrong.length} |`);
      }
    }
    // Ayrıntı: yakın çiftlerin en yüksek benzerlikleri (embedding'in neden tek başına izin olamayacağı) + kapının ret sebebi.
    lines.push("", "## En benzer YAKIN (farklı ihtiyaç) çiftler", "", "| çapa | soru | ham | sorgu | kapı |", "|---|---|---|---|---|");
    for (const p of [...pairs.filter((x) => x.label === "near")].sort((a, b) => b.cosQuery - a.cosQuery).slice(0, 20)) {
      lines.push(`| ${p.anchor} | ${p.other} | ${p.cosRaw.toFixed(3)} | ${p.cosQuery.toFixed(3)} | ${p.gate} |`);
    }
    lines.push("", "## En az benzer AYNI çiftler", "", "| çapa | soru | ham | sorgu | kapı |", "|---|---|---|---|---|");
    for (const p of [...same].sort((a, b) => a.cosQuery - b.cosQuery).slice(0, 15)) {
      lines.push(`| ${p.anchor} | ${p.other} | ${p.cosRaw.toFixed(3)} | ${p.cosQuery.toFixed(3)} | ${p.gate} |`);
    }
    lines.push("", "## Kapının ret sebepleri (aynı / yakın)", "", "| sebep | aynı | yakın + alakasız |", "|---|---|---|");
    const reasons = [...new Set(pairs.map((p) => p.gate))];
    for (const r of reasons) lines.push(`| ${r} | ${same.filter((p) => p.gate === r).length} | ${wrong.filter((p) => p.gate === r).length} |`);
    lines.push("", "## Anlama katmanının sorgusu", "", "| grup | rol | soru | tür | sorgu |", "|---|---|---|---|---|");
    for (const p of probes) lines.push(`| ${p.group} | ${p.role} | ${p.text} | ${p.need?.kind ?? "—"} | ${p.need?.query ?? "(tek istek değil / yok)"} |`);
    writeFileSync(`${OUT}.md`, lines.join("\n") + "\n");
    writeFileSync(`${OUT}.json`, JSON.stringify({ probes, pairs }, null, 2));
  }, 600_000);
});
