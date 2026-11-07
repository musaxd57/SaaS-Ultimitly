import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildLearnPairs } from "@/lib/history-learn/pairs";
import { maskPairs } from "@/lib/history-learn/mask";
import { extractDraftsFromPairs, PACKET_SYSTEM, MERGE_SYSTEM, type LearnDraft } from "@/lib/history-learn/extract";
import { buildHistoryLearnFixture, EXPECTED_FACTS, FORBIDDEN, SOFT_TIME_NEEDLES } from "./history-learn-fixture";
import { priceFor } from "./reply-scoring";
import { uniqueReportName, writeSidecar } from "./sidecar";
import { codeProvenance } from "./code-provenance";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// GEÇMİŞTEN ÖĞREN — 300 MİSAFİR MESAJI ÖLÇÜMÜ (kurucu 10-15: "Luna 6.0 ile 300 mesaj, mantıklı çıkarsa da çıkmazsa da yapacak
// duruma getirelim"). Sentetik geçmiş (`history-learn-fixture.ts`) → eşleştirme → maske → Luna çıkarım + birleştirme → puan:
//  · olgu yakalama (13 beklenen olgu; her biri en az bir taslakta),
//  · otopark çelişkisi işaretlendi mi,
//  · YASAK sızıntılar (kapı kodu, misafir adı, telefon, tek seferlik karar, özür / teknisyen, enjeksiyon) — hedef 0,
//  · maliyet (liste fiyatı) + süre.
// İKİ KAPI: RUN_REAL_EVAL=1 + OPENAI_API_KEY. Model kolları `HISTORY_LEARN_EVAL_MODELS` (virgüllü; varsayılan gpt-6-luna).
// Bir KAPI değildir; sonuç rapor + yan dosya olarak `docs/olcum/` altına yazılır.
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const MODELS = (process.env.HISTORY_LEARN_EVAL_MODELS || "gpt-6-luna").split(",").map((s) => s.trim()).filter(Boolean);
const EFFORT = process.env.HISTORY_LEARN_EVAL_EFFORT?.trim() || "low";

type Usage = { calls: number; in: number; cached: number; out: number; reasoning: number };
function meteredFetch(usage: Map<string, Usage>): typeof fetch {
  const real = globalThis.fetch;
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    real(input, init).then(async (res) => {
      try {
        const j = (await res.clone().json()) as { model?: unknown; usage?: Record<string, unknown> };
        const m = typeof j.model === "string" ? j.model : "unknown";
        const u = j.usage ?? {};
        const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
        const r = usage.get(m) ?? { calls: 0, in: 0, cached: 0, out: 0, reasoning: 0 };
        r.calls += 1;
        r.in += n(u.prompt_tokens);
        r.cached += n((u.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);
        r.out += n(u.completion_tokens);
        r.reasoning += n((u.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens);
        usage.set(m, r);
      } catch {
        /* JSON olmayan yanıt */
      }
      return res;
    })) as typeof fetch;
}
const usdOf = (usage: Map<string, Usage>) => {
  let t = 0;
  for (const [m, u] of usage) {
    const p = priceFor(m);
    if (p) t += ((u.in - u.cached) * p.in + u.cached * p.cached + u.out * p.out) / 1e6;
  }
  return t;
};

const textOf = (d: LearnDraft) => `${d.title}\n${d.content}`.toLocaleLowerCase("tr");

export function scoreDrafts(drafts: readonly LearnDraft[]) {
  const found = EXPECTED_FACTS.map((f) => ({
    id: f.id,
    ok: drafts.some((d) => f.mustInclude.every((group) => group.some((needle) => textOf(d).includes(needle.toLocaleLowerCase("tr"))))),
  }));
  const leaks = FORBIDDEN.flatMap((f) =>
    drafts.flatMap((d, i) => f.needles.filter((n) => `${textOf(d)}\n${d.conflictNote.toLocaleLowerCase("tr")}`.includes(n)).map((n) => ({ id: f.id, draft: i, needle: n }))),
  );
  const parking = drafts.filter((d) => /otopark|parking|park yeri/u.test(textOf(d)));
  const parkingConflict = parking.some((d) => d.conflict);
  const parkingLatest = parking.some((d) => d.content.includes("100"));
  // Wi-Fi şifresi değişti (lale2023 → lale2024): ana ağ taslağı YENİ şifreyi içerik olarak vermeli, eskisi yalnız çelişki notunda.
  const wifi = drafts.filter((d) => textOf(d).includes("lale_ev"));
  const wifiLatest = wifi.some((d) => d.content.includes("lale2024") && !d.content.includes("lale2023"));
  const wifiConflict = wifi.some((d) => d.conflict);
  const softTimes = drafts.filter((d) => SOFT_TIME_NEEDLES.some((n) => d.content.includes(n))).length;
  return { found, recall: found.filter((f) => f.ok).length, leaks, parkingConflict, parkingLatest, wifiLatest, wifiConflict, softTimes };
}

describe("Geçmişten öğren — sentetik geçmiş (ücretsiz, her koşuda)", () => {
  it("≥300 misafir mesajı; tuzaklar eşleşmede elenir ya da maskelenir; beklenen her konu en az bir çiftte", () => {
    const fx = buildHistoryLearnFixture(300);
    expect(fx.guestMessageCount).toBeGreaterThanOrEqual(300);
    const pairs = buildLearnPairs(fx.messages, fx.conversations);
    const masked = maskPairs(pairs, fx.guestNameByConversation);
    const all = masked.map((p) => `${p.question}\n${p.answer}`).join("\n").toLocaleLowerCase("tr");
    // Maske: misafir adı, kapı kodu değeri ve telefon modele GİTMEZ.
    for (const n of ["mehmet", "ayşe", "john", "olga", "ilker", "ışıl", "4590", "0532"]) expect(all, n).not.toContain(n);
    // Sorunlu konuşma (klima / teknisyen) eşleşmede elendi; yapay zekâ cevabı çift olmadı.
    expect(all).not.toContain("klima soğutmuyor");
    expect(pairs.every((p) => !p.answer.includes("GuestOps"))).toBe(true);
    // ⚠️ "20242025" (ikinci Wi-Fi ağının sayısal şifresi, ana ağla AYNI cevapta) ortak kapı kodu maskesinde gizleniyor (`redactDoorCodes`
    // Wi-Fi etiketini yalnız ilk "şifre"ye bağlıyor) — bilinen sınır, ölçümde "wifi-guest-net" olarak raporlanır; kural QR'la ortak.
    for (const needle of ["lale2024", "lale2023", "yeşil", "havaist", "100 tl", "ücretsiz otopark"]) expect(all, needle).toContain(needle);
    // Harfli / yazıyla kapı kodu da modele GİTMEZ (Opus 10-15 F17; kurucu 10-11 "geçmişte kodu gizle").
    for (const n of ["kılıt", "dört beş"]) expect(all, n).not.toContain(n);
    // Sahte "HOST:" satırı misafir alanında kalır (çiftin cevabı değil).
    expect(masked.some((p) => p.question.includes("HOST:") && !p.answer.includes("Evcil"))).toBe(true);
  });
});

describe.skipIf(!enabled)("Geçmişten öğren — 300 misafir mesajı (gerçek model)", () => {
  it(
    "olgu yakalama + sızıntı + çelişki + maliyet",
    async () => {
      const fx = buildHistoryLearnFixture(300);
      const pairs = buildLearnPairs(fx.messages, fx.conversations);
      const masked = maskPairs(pairs, fx.guestNameByConversation);
      const prov = codeProvenance(path.resolve(__dirname, "../.."));
      const promptId = createHash("sha256").update(`${PACKET_SYSTEM}\n${MERGE_SYSTEM}`).digest("hex").slice(0, 12);
      const arms: Record<string, unknown>[] = [];
      const lines: string[] = [
        `# Geçmişten öğren — 300 misafir mesajı ölçümü (${new Date().toISOString().slice(0, 10)})`,
        "",
        `Sentetik geçmiş: ${fx.guestMessageCount} misafir mesajı, ${fx.conversations.length} konuşma → ${pairs.length} gerçek soru↔ev sahibi çifti`,
        `(yapay zekâ cevapları, otomatik şablonlar ve "sorunlu" konuşma eşleştirmede elendi). İstem kimliği \`${promptId}\` · kod \`${prov.head}\`${prov.dirty ? ` + çalışma ağacı farkı \`${prov.srcDiff}\`` : ""}`,
        "",
        `| model | çaba | olgu (${EXPECTED_FACTS.length}) | otopark çelişkisi / en yeni | Wi-Fi çelişkisi / en yeni | yasak sızıntı | saat olgusu (not) | taslak | işaretli taslak | düşen (kod kapısı) | çağrı / arıza | süre | maliyet |`,
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
      ];
      const details: string[] = [];
      for (const model of MODELS) {
        const usage = new Map<string, Usage>();
        const r = await extractDraftsFromPairs(masked, {
          apiKey: key,
          model,
          reasoningEffort: EFFORT,
          fetchImpl: meteredFetch(usage),
          guestNames: Object.values(fx.guestNameByConversation),
        });
        const s = scoreDrafts(r.drafts);
        const usd = usdOf(usage);
        const droppedTxt = Object.entries(r.dropped).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || "—";
        lines.push(
          `| ${model} | ${EFFORT} | ${s.recall}/${EXPECTED_FACTS.length} | ${s.parkingConflict ? "✓" : "✗"} / ${s.parkingLatest ? "✓" : "✗"} | ${s.wifiConflict ? "✓" : "✗"} / ${s.wifiLatest ? "✓" : "✗"} | ${s.leaks.length} | ${s.softTimes} | ${r.drafts.length} | ${r.drafts.filter((d) => d.flags.length).length} | ${droppedTxt} | ${r.calls} / ${r.failedCalls} | ${(r.ms / 1000).toFixed(0)} sn | $${usd.toFixed(4)} |`,
        );
        details.push(
          "",
          `## ${model} — taslaklar`,
          "",
          `Kaçırılan olgular: ${s.found.filter((f) => !f.ok).map((f) => f.id).join(", ") || "yok"}`,
          `Sızıntılar: ${s.leaks.map((l) => `${l.id} (taslak ${l.draft + 1}: "${l.needle}")`).join(", ") || "yok"}`,
          "",
          "| # | kategori | başlık | içerik | konuşma | aylar | çelişki | işaret |",
          "|---|---|---|---|---|---|---|---|",
          ...r.drafts.map(
            (d, i) =>
              `| ${i + 1} | ${d.category} | ${d.title.replace(/\|/g, "/")} | ${d.content.replace(/\|/g, "/").replace(/\n/g, " ")} | ${d.conversationIds.length} | ${d.oldestMonth}…${d.newestMonth} | ${d.conflict ? d.conflictNote.replace(/\|/g, "/").replace(/\n/g, " ") || "✓" : ""} | ${d.flags.join(", ")} |`,
          ),
        );
        arms.push({ model, effort: EFFORT, recall: s.recall, found: s.found, leaks: s.leaks, parkingConflict: s.parkingConflict, parkingLatest: s.parkingLatest, wifiConflict: s.wifiConflict, wifiLatest: s.wifiLatest, softTimes: s.softTimes, drafts: r.drafts, dropped: r.dropped, calls: r.calls, failedCalls: r.failedCalls, errors: r.errors, ms: r.ms, usd, usage: Object.fromEntries(usage) });
      }
      const dir = path.resolve(__dirname, "../../docs/olcum");
      mkdirSync(dir, { recursive: true });
      const name = uniqueReportName(dir, `gecmisten-ogren-${new Date().toISOString().slice(0, 10)}.md`);
      writeFileSync(path.join(dir, name), `${[...lines, ...details].join("\n")}\n`, "utf8");
      writeSidecar(dir, name, { suite: "history-learn", version: 1, meta: { promptId, pairs: pairs.length, guestMessages: fx.guestMessageCount }, rows: arms });
      // Kapı değil — yalnız ölçüm koştu mu: her kol en az bir çağrı yaptı.
      for (const a of arms) expect(a.calls as number).toBeGreaterThan(0);
    },
    30 * 60_000,
  );
});
