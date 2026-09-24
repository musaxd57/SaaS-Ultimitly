import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { detectAvailabilityClaim, detectAvailabilityRequest, hasAvailabilityDeferral } from "@/lib/ai/availability-claims";
import { runStayChangeGuard } from "@/lib/ai/semantic/guard";
import { understandGuestMessages, __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { slotTimesShifted, type StayGuardVerdict } from "@/lib/ai/semantic/stay-change";
import { writeSidecar } from "./sidecar";

// ---------------------------------------------------------------------------
// KONAKLAMA DEĞİŞİKLİĞİ ANLAM KATMANI — GERÇEK MODEL EVAL'İ (09-24).
//
// Veri: `evals/stay-change.json` (SENTETİK; iki kör batarya: `dev` = ilk kör batarya, deterministik
// yedeğin doğruluk düzeltmelerinde GÖRÜLDÜ; `holdout` = ikinci kör batarya — ayarlamada kullanılmadı ama
// 09-24 denetimlerinde defalarca ÖLÇÜLDÜ, yani o da artık görüldü (dış inceleme 09-24)).
// 🚨 MÜHÜRLÜ FİNAL SETİ (`evals/sealed/`, `docs/EVAL-MUHURLU-FINAL.md`): kör yazar üretti, geliştirici içeriğini
// görmedi. YALNIZ `EVAL_SEALED_FINAL=1` + gerçek model koşusunda, YALNIZ bu dosyada okunur ve o koşuda dev/holdout
// hiç yüklenmez. Model/istem/kod dondurulmadan koşulmaz; koşulduktan sonra "yandı" sayılır, yenisi yazılır.
//
// Ölçülen üç katman, AYNI etiketlere karşı:
//  · yedek   — deterministik kelime ağı (her koşuda, anahtar gerekmez);
//  · bekçi   — bağımsız ikinci model (`runStayChangeGuard`), cevap + istek alanları;
//  · anlama  — şema tabanlı niyet çıkarıcı (`understandGuestMessages`), istek alanları.
// Saat kıyası KODDA (`slotTimesShifted`) — modelin çıkardığı saat + mülkün standart saati.
//
// İKİ KAPI: RUN_REAL_EVAL=1 + gerçek anahtar (`npm run eval`). Anahtar yoksa yalnız yedek ölçülür ve
// rapor "MODEL KOŞMADI" der. EKSİK KOŞU "GEÇTİ" DİYE OKUNAMAZ: tek bir çağrı düşerse rapor GEÇERSİZ.
// Maliyet (tam koşu, iki bölüm): ~1.300 küçük çağrı; `EVAL_STAY_LIMIT` ile örneklenebilir.
// Açma kararı (kurucu): holdout'ta cevap sınıfları ve istekler için isabet + yanlış alarm oranı
// raporlanır; `AI_STAY_GUARD_ENABLED` / `AI_UNDERSTANDING_ENABLED` / `AI_STAY_POLICY=enforce` bu
// rapora bakılarak açılır (`docs/EVAL-CALISTIRMA.md`).
// ---------------------------------------------------------------------------

interface ReqItem {
  id: string;
  split: string;
  text: string;
  lang: string;
  kind: string;
  checkIn: string;
  checkOut: string;
}
interface RepItem {
  id: string;
  split: string;
  text: string;
  lang: string;
  label: string;
  checkIn: string;
  checkOut: string;
}

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");

const SEALED = process.env.EVAL_SEALED_FINAL === "1";
const SEALED_FILE = path.resolve(__dirname, "../../evals/sealed/stay-change-final.json");
// Mühür kısmi (anahtarsız / yalnız yedek) koşuyla YAKILMAZ: içerik ancak tam final koşusunda okunur.
if (SEALED && !enabled) throw new Error("EVAL_SEALED_FINAL=1 yalnız gerçek model koşusunda (RUN_REAL_EVAL=1 + anahtar).");
const DATASET = SEALED ? SEALED_FILE : path.resolve(__dirname, "../../evals/stay-change.json");
const data = JSON.parse(readFileSync(DATASET, "utf8")) as { version: number; requests: ReqItem[]; replies: RepItem[] };
const SPLITS = SEALED ? ["final"] : ["dev", "holdout"];
const LIMIT = Number(process.env.EVAL_STAY_LIMIT) > 0 ? Math.trunc(Number(process.env.EVAL_STAY_LIMIT)) : Infinity;
const CONCURRENCY = 4;

/** Cevap etiketi → bu cevap misafire OTOMATİK gidebilir mi (doğru davranış)? */
function replyMayAutoSend(label: string): boolean {
  return label === "deferral" || label === "offer" || label === "neutral";
}

interface Tally {
  n: number;
  ok: number;
}
const tally = (): Tally => ({ n: 0, ok: 0 });
function add(map: Map<string, Tally>, k: string, ok: boolean) {
  const t = map.get(k) ?? tally();
  t.n++;
  t.ok += +ok;
  map.set(k, t);
}
const pct = (t?: Tally) => (t && t.n ? `${t.ok}/${t.n} (${Math.round((100 * t.ok) / t.n)}%)` : "—");

async function pool<T>(items: readonly T[], fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

const lines: string[] = [];
const rows: unknown[] = [];
let failures = 0;
const saved: Record<string, string | undefined> = {};

describe("konaklama değişikliği anlam katmanı — eval", () => {
  beforeAll(() => {
    for (const k of ["AI_STAY_GUARD_ENABLED", "AI_UNDERSTANDING_ENABLED"]) saved[k] = process.env[k];
    if (enabled) {
      process.env.AI_STAY_GUARD_ENABLED = "1";
      process.env.AI_UNDERSTANDING_ENABLED = "1";
    }
    __resetUnderstandingCache();
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("veri seti yüklendi ve etiket sözlüğü kapalı", () => {
    expect(data.requests.length).toBeGreaterThan(100);
    expect(data.replies.length).toBeGreaterThan(100);
    for (const r of data.requests) expect(["extend", "early", "late", "date_change", "availability", "none"]).toContain(r.kind);
    for (const r of data.replies) expect(["claim", "grant", "deferral", "offer", "refusal", "neutral"]).toContain(r.label);
  });

  it("deterministik yedek (her koşuda)", () => {
    const req = new Map<string, Tally>();
    const rep = new Map<string, Tally>();
    for (const r of data.requests) {
      const hit = detectAvailabilityRequest(r.text) !== null;
      add(req, `${r.split}|${r.kind === "none" ? "none(doğru=yok)" : "istek(doğru=var)"}`, r.kind === "none" ? !hit : hit);
    }
    for (const r of data.replies) {
      const claim = detectAvailabilityClaim(r.text) !== null;
      const def = hasAvailabilityDeferral(r.text);
      const ok = r.label === "claim" || r.label === "grant" ? claim : r.label === "neutral" ? !claim : r.label === "refusal" ? !def : !claim && def;
      add(rep, `${r.split}|${r.label}`, ok);
    }
    lines.push("## Deterministik yedek (kelime ağı)", "", "| bölüm · sınıf | doğru |", "|---|---|");
    for (const [k, t] of [...req, ...rep].sort()) lines.push(`| ${k} | ${pct(t)} |`);
    lines.push("");
  });

  it.skipIf(!enabled)(
    "bekçi + anlama katmanı (gerçek model)",
    async () => {
      const guardReq = new Map<string, Tally>();
      const nluReq = new Map<string, Tally>();
      const guardRep = new Map<string, Tally>();
      // Örnek sınırı BÖLÜM BAŞINA: dev önce geldiği için düz `slice` holdout'u hiç ölçmezdi (inceleme 09-24).
      const perSplit = <T extends { split: string }>(xs: T[]) =>
        Number.isFinite(LIMIT) ? SPLITS.flatMap((sp) => xs.filter((x) => x.split === sp).slice(0, LIMIT)) : xs;
      const reqs = perSplit(data.requests);
      const reps = perSplit(data.replies);

      await pool(reqs, async (r) => {
        const stayTimes = { checkIn: r.checkIn, checkOut: r.checkOut };
        const truth = r.kind !== "none";
        const g = await runStayChangeGuard({ guestMessages: [r.text], reply: "Thank you for your message.", stayTimes });
        if (g?.status !== "ok") failures++;
        else {
          const v: StayGuardVerdict = g.verdict;
          const said = v.guestRequestsChange || slotTimesShifted({ checkinTime: v.requestedCheckinTime, checkoutTime: v.requestedCheckoutTime }, stayTimes);
          add(guardReq, `${r.split}|${truth ? "istek" : "none"}|${r.lang}`, said === truth);
          rows.push({ layer: "guard-req", id: r.id, truth, said });
        }
        const u = await understandGuestMessages({ guestMessage: r.text, stayTimes });
        if (u.status !== "ok") failures++;
        else {
          const said = u.value.stay.requested || slotTimesShifted(u.value.stay, stayTimes);
          add(nluReq, `${r.split}|${truth ? "istek" : "none"}|${r.lang}`, said === truth);
          rows.push({ layer: "nlu-req", id: r.id, truth, said, intents: u.value.requests.map((x) => x.intent) });
        }
      });

      await pool(reps, async (r) => {
        const stayTimes = { checkIn: r.checkIn, checkOut: r.checkOut };
        const g = await runStayChangeGuard({ guestMessages: ["Could you help me with my stay?"], reply: r.text, stayTimes });
        if (g?.status !== "ok") {
          failures++;
          return;
        }
        const v = g.verdict;
        const blocked = v.replyStatesCalendar || v.replyGrantsChange;
        const defers = v.replyDefersToHost && !blocked;
        // Ölçüt ürünün kararı: gönderilmemesi gereken cevap (claim/grant) → blocked; doğru ertelemeler/teklif
        // → blocked DEĞİL ve erteleme tanındı; tarafsız → blocked değil; ret → ertelemesiz sayılır.
        const ok = replyMayAutoSend(r.label) ? !blocked && (r.label === "neutral" || defers) : r.label === "refusal" ? v.replyRefuses || blocked : blocked;
        add(guardRep, `${r.split}|${r.label}|${r.lang}`, ok);
        rows.push({ layer: "guard-reply", id: r.id, label: r.label, blocked, defers, refuses: v.replyRefuses });
      });

      const table = (title: string, m: Map<string, Tally>) => {
        lines.push(`## ${title}`, "", "| bölüm · sınıf · dil | doğru |", "|---|---|");
        for (const [k, t] of [...m].sort()) lines.push(`| ${k} | ${pct(t)} |`);
        lines.push("");
      };
      table("Bekçi — misafir isteği (+ KODDA saat kıyası)", guardReq);
      table("Anlama katmanı — misafir isteği (+ KODDA saat kıyası)", nluReq);
      table("Bekçi — cevap duruşu (claim/grant durmalı; erteleme/teklif/tarafsız gitmeli)", guardRep);
    },
    3_600_000,
  );

  afterAll(() => {
    // 🚨 RAPOR YALNIZ GERÇEK MODEL KOŞUSUNDA YAZILIR (inceleme 09-24): ana suite `tests/**` topladığı için bu
    // dosya her `npm test`te koşuyor ve her koşu repoya tarihli rapor yazıyordu — aynı gün ücretli bir koşunun
    // raporunu "MODEL KOŞMADI" ile EZEBİLİRDİ. Anahtarsız koşuda yedek tablosu yalnız konsola basılır.
    if (!enabled) {
      if (process.env.EVAL_CONFIG === "1") console.log(lines.join("\n"));
      return;
    }
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const name = SEALED ? `stay-change-FINAL-eval-${stamp}.md` : `stay-change-eval-${stamp}.md`;
    const status = failures > 0 ? `GEÇERSİZ — ${failures} çağrı düştü` : "GEÇERLİ";
    const head = [
      `# Konaklama değişikliği anlam katmanı — eval (${stamp})`,
      "",
      `Durum: **${status}** · veri sürümü ${data.version} · istek ${data.requests.length} · cevap ${data.replies.length}` +
        (Number.isFinite(LIMIT) ? ` · örnek sınırı ${LIMIT}` : ""),
      "",
      SEALED
        ? "🚨 MÜHÜRLÜ FİNAL KOŞUSU: genelleme ölçüsü bu raporun TAMAMIdır. Koşu bitti → set YANDI (`evals/sealed/SEALS.json` durumu `burned`; sonraki karar için yeni kör set)."
        : "Bu rapordaki `dev` ve `holdout` bölümleri GÖRÜLDÜ (dev: düzeltmelerde; holdout: 09-24 denetimlerinde ölçüldü) — gelişme göstergesidir, son açma kararı yalnız mühürlü final setiyle (`docs/EVAL-MUHURLU-FINAL.md`).",
      "",
    ];
    writeFileSync(path.join(dir, name), [...head, ...lines].join("\n"), "utf8");
    writeSidecar(dir, name, { suite: "stay-change", version: data.version, meta: { status, failures, enabled }, rows });
  });
});
