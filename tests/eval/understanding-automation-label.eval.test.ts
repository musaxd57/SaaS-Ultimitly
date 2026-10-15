import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { buildUnderstandingUserContent, understandGuestMessages, __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { writeSidecar, uniqueReportName } from "./sidecar";

// ---------------------------------------------------------------------------
// G1 ÖLÇÜMÜ (kurucu kararı 10-13: "Evet, kredi gelince ölç"): anlama katmanının bağlamında otomatik şablon mesajı (karşılama / giriş /
// çıkış) bugün "Host:" yazılıyor; hazır yama (`docs/hazir-yamalar/2026-10-13-G1-…patch`) "Automated message:" yazar. Aynı senaryolar
// iki kod sürümünde koşturulur (yamasız çalışma ağacı = "host-etiketi", yamalı = "otomatik-etiketi"); kol, gerçek istem içeriğinden
// ÖLÇÜLÜR (elle verilmez). Yalnız anlama katmanı çağrılır (cevap modeli yok). Senaryolar `evals/understanding-automation-label.json`.
// İKİ KAPI: RUN_REAL_EVAL=1 + OPENAI_API_KEY; anlama katmanı bayrağı koşu içinde açılır.
// ---------------------------------------------------------------------------

interface Scenario {
  id: string;
  lang: string;
  history: { a: "in" | "auto" | "host"; t: string }[];
  message: string;
  /** Güncel misafir mesajından SONRA yazılan şablonlar (AI öner yolunda geçmiş kesilmez). */
  after?: { a: "auto"; t: string }[];
  expect: { stayRequested?: boolean; stayKind?: string; checkinTime?: string; checkoutTime?: string; intentsAny?: string[] };
}
const DATA = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/understanding-automation-label.json"), "utf8")) as {
  stayTimes: { checkIn: string; checkOut: string };
  scenarios: Scenario[];
};
const key = process.env.OPENAI_API_KEY ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const ROUNDS = Math.min(3, Math.max(1, Math.trunc(Number(process.env.G1_EVAL_ROUNDS) || 2)));

export function historyOf(s: Scenario) {
  const base = Date.parse("2026-10-14T08:00:00Z");
  const rows = s.history.map((h, i) => ({
    direction: h.a === "in" ? ("inbound" as const) : ("outbound" as const),
    body: h.t,
    ...(h.a === "auto" ? { author: "automation" } : h.a === "host" ? { author: "host" } : {}),
    at: new Date(base + i * 60_000),
  }));
  const msg = { direction: "inbound" as const, body: s.message, at: new Date(base + rows.length * 60_000) };
  const tail = (s.after ?? []).map((h, i) => ({ direction: "outbound" as const, body: h.t, author: "automation", at: new Date(base + (rows.length + 1 + i) * 60_000) }));
  return [...rows, msg, ...tail];
}

/**
 * KOD KÖKENİ (Haiku 10-15): kollar yamalı ama commit edilmemiş ağaçlarda koşabilir — rapor HEAD'i, ağacın kirli olup olmadığını ve
 * `src/` yerel farkının özetini yazar (kol kimliği ayrıca istemden ölçülür, ↓`armOf`).
 */
export function codeProvenance(cwd: string): { head: string; dirty: boolean; srcDiff: string } {
  try {
    const run = (c: string) => execSync(c, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const head = run("git rev-parse --short HEAD").trim();
    const diff = run("git diff HEAD -- src");
    return { head, dirty: diff.length > 0, srcDiff: diff.length ? createHash("sha256").update(diff).digest("hex").slice(0, 12) : "-" };
  } catch {
    return { head: "?", dirty: false, srcDiff: "?" };
  }
}

/**
 * Kol İSTEMDEN ölçülür (elle verilmez), iki eksende: (1) ev sahibi cevabından ÖNCEKİ otomatik mesajın etiketi ("Host" / "Automated
 * message" — G1), (2) son cevaptan SONRA gelen otomatik mesaj isteme giriyor mu (G1b; bugün girmiyor — K7 penceresi).
 */
export function armOf(): string {
  const label = buildUnderstandingUserContent({
    guestMessage: "Tamam",
    history: [
      { direction: "outbound", body: "PROBE-A", author: "automation" },
      { direction: "outbound", body: "Evet.", author: "host" },
      { direction: "inbound", body: "Tamam" },
    ],
  } as never);
  const after = buildUnderstandingUserContent({
    guestMessage: "Tamam",
    history: [
      { direction: "outbound", body: "PROBE-B", author: "automation" },
      { direction: "inbound", body: "Tamam" },
    ],
  } as never);
  const l = /Automated message[^\n]*PROBE-A/u.test(label) ? "otomatik" : "host";
  const a = after.includes("PROBE-B") ? "gorunur" : "gorunmez";
  return `etiket-${l}_sonraki-${a}`;
}

export function judge(s: Scenario, u: { requests: { intent: string }[]; stay: { requested: boolean; kind: string; checkinTime: string | null; checkoutTime: string | null } }) {
  const fails: string[] = [];
  const e = s.expect;
  if (e.stayRequested === false && u.stay.requested) fails.push(`konaklama değişikliği uyduruldu (${u.stay.kind})`);
  if (e.stayKind && (!u.stay.requested || u.stay.kind !== e.stayKind)) fails.push(`tür ${u.stay.requested ? u.stay.kind : "yok"} ≠ ${e.stayKind}`);
  if (e.checkinTime && u.stay.checkinTime !== e.checkinTime) fails.push(`giriş saati ${u.stay.checkinTime} ≠ ${e.checkinTime}`);
  if (e.checkoutTime && u.stay.checkoutTime !== e.checkoutTime) fails.push(`çıkış saati ${u.stay.checkoutTime} ≠ ${e.checkoutTime}`);
  if (e.intentsAny && !u.requests.some((r) => e.intentsAny!.includes(r.intent))) fails.push(`niyet ${u.requests.map((r) => r.intent).join("+") || "—"} ∌ ${e.intentsAny.join("|")}`);
  return fails;
}

describe.skipIf(!enabled)("G1 — anlama katmanında otomatik mesaj etiketi (ücretli)", () => {
  it("senaryolar × tur → rapor", async () => {
    process.env.AI_UNDERSTANDING_ENABLED = "1";
    const arm = armOf();
    const rows: { id: string; round: number; ok: boolean; fails: string[]; intents: string[]; stay: string; status: string }[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      __resetUnderstandingCache();
      for (const s of DATA.scenarios) {
        const out = await understandGuestMessages({ guestMessage: s.message, history: historyOf(s), stayTimes: DATA.stayTimes });
        if (out.status !== "ok") {
          rows.push({ id: s.id, round, ok: false, fails: [`katman ${out.status}`], intents: [], stay: "—", status: out.status });
          continue;
        }
        const fails = judge(s, out.value);
        rows.push({
          id: s.id,
          round,
          ok: fails.length === 0,
          fails,
          intents: out.value.requests.map((r) => r.intent),
          stay: out.value.stay.requested ? `${out.value.stay.kind} ${out.value.stay.checkinTime ?? ""}${out.value.stay.checkoutTime ?? ""}`.trim() : "yok",
          status: out.status,
        });
      }
    }
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const name = uniqueReportName(dir, `g1-otomatik-etiket-${date}-${arm}.md`);
    const okN = rows.filter((r) => r.ok).length;
    const prov = codeProvenance(path.resolve(__dirname, "../.."));
    const lines = [
      `# G1 — anlama katmanında otomatik mesaj etiketi (${date}) · kol: ${arm}`,
      "",
      `Senaryo ${DATA.scenarios.length} × tur ${ROUNDS} · doğru ${okN}/${rows.length} · katman hatası ${rows.filter((r) => r.status !== "ok").length}`,
      "",
      `Kod: HEAD \`${prov.head}\` · ${prov.dirty ? `yerel src değişikliği VAR (özet \`${prov.srcDiff}\` — yamalı ölçüm ağacı)` : "yerel src değişikliği yok"} · kol istemden ölçüldü: \`${arm}\``,
      "",
      "| Senaryo | Tur | Sonuç | Niyetler | Konaklama | Hata |",
      "|---|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.id} | ${r.round + 1} | ${r.ok ? "✓" : "✗"} | ${r.intents.join(" + ") || "—"} | ${r.stay} | ${r.fails.join("; ")} |`),
    ];
    writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
    writeSidecar(dir, name, { suite: "g1-automation-label", version: 1, meta: { arm, rounds: ROUNDS, scenarios: DATA.scenarios.length, provenance: prov }, rows });
    expect(rows.length).toBe(DATA.scenarios.length * ROUNDS);
  }, 30 * 60_000);
});

describe("G1 ölçer — çevrimdışı pinler", () => {
  it("senaryolar kimlikçe eşsiz, her birinde en az bir otomatik ya da ev sahibi mesajı var", () => {
    const ids = DATA.scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of DATA.scenarios) expect(s.history.some((h) => h.a === "auto" || h.a === "host")).toBe(true);
    expect(DATA.scenarios.filter((s) => s.history.some((h) => h.a === "host")).length).toBeGreaterThanOrEqual(2); // kontrol senaryoları
  });
  it("otomatik mesaj yazar alanıyla geçmişe girer; kol istemden ölçülür (bu ağaçta tanımlı bir kol döner)", () => {
    const h = historyOf(DATA.scenarios[0]);
    expect(h[0]).toMatchObject({ direction: "outbound", author: "automation" });
    expect(h[h.length - 1]).toMatchObject({ direction: "inbound", body: DATA.scenarios[0].message });
    expect(armOf()).toMatch(/^etiket-(otomatik|host)_sonraki-(gorunur|gorunmez)$/u);
  });
  it("hakem: uydurulan konaklama değişikliği ve yanlış saat hata sayılır", () => {
    const s = DATA.scenarios.find((x) => x.id === "tr-geç-çıkış-teklifi-evet")!;
    expect(judge(s, { requests: [{ intent: "late_checkout" }], stay: { requested: true, kind: "late_checkout", checkinTime: null, checkoutTime: "13:00" } })).toEqual([]);
    expect(judge(s, { requests: [{ intent: "late_checkout" }], stay: { requested: true, kind: "late_checkout", checkinTime: null, checkoutTime: "12:00" } }).length).toBe(1);
    const t = DATA.scenarios.find((x) => x.id === "tr-geç-çıkış-hatırlatma-teşekkür")!;
    expect(judge(t, { requests: [{ intent: "greeting_thanks" }], stay: { requested: true, kind: "late_checkout", checkinTime: null, checkoutTime: "13:00" } })[0]).toMatch(/uyduruldu/);
  });
});
