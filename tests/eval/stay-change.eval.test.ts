import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  detectAvailabilityClaim,
  detectAvailabilityRequest,
  detectAvailabilityRequestKinds,
  hasAvailabilityDeferral,
} from "@/lib/ai/availability-claims";
import { explicitTimeMentions, mentionsAnotherDay } from "@/lib/early-checkin/text-checks";
import { runStayChangeGuard } from "@/lib/ai/semantic/guard";
import { semanticModel, semanticReasoningEffort } from "@/lib/ai/semantic/config";
import { understandGuestMessages, __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { slotTimesShifted, type StayGuardVerdict } from "@/lib/ai/semantic/stay-change";
import { writeSidecar } from "./sidecar";
import { summarizeUnion, unionMetricsLines, type UnionRow } from "./stay-metrics";

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
// raporlanır; `AI_STAY_GUARD_ENABLED` / `AI_UNDERSTANDING_ENABLED` bu rapora bakılarak açılır (gölge kip yok —
// açılan katman doğrudan karar verir; `docs/EVAL-CALISTIRMA.md`).
// ---------------------------------------------------------------------------

interface ReqItem {
  id: string;
  split: string;
  /** Yalnız gerçek sette (B): "candidate" | "rest" — sonuçlar katman katman raporlanır (yeniden ağırlıklandırma). */
  stratum?: string;
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
const SEALS_FILE = path.resolve(__dirname, "../../evals/sealed/SEALS.json");
const datasetBytes = readFileSync(DATASET);
type SealEntry = { sha256?: string; state?: string; location?: string };
const seals = (): Record<string, SealEntry> => JSON.parse(readFileSync(SEALS_FILE, "utf8")) as Record<string, SealEntry>;
if (SEALED) {
  // 🚨 Mühürlü A seti yalnız SHA-256'sı kayıtla eşleşir ve durumu "sealed" ise koşulur: yanmış ya da değiştirilmiş
  // set sessizce koşulmasın (inceleme 09-24). Kısmi koşu da mührü yakardı → örnek sınırı mühürlü koşuda YASAK.
  const seal = seals()[path.basename(DATASET)];
  if (!seal || seal.state !== "sealed") throw new Error("mühürlü set 'sealed' durumunda değil (yanmış ya da kayıtsız).");
  if (createHash("sha256").update(datasetBytes).digest("hex") !== seal.sha256) throw new Error("mühürlü setin SHA-256'sı kayıtla eşleşmiyor.");
  if (process.env.EVAL_STAY_LIMIT) throw new Error("EVAL_STAY_LIMIT mühürlü koşuda kullanılamaz (kısmi koşu seti yakar).");
}
const base = JSON.parse(datasetBytes.toString("utf8")) as { version: number; requests: ReqItem[]; replies: RepItem[] };

// GERÇEK SET (B, `docs/EVAL-MUHURLU-FINAL.md`): kurucunun gerçek misafir mesajlarından, anonim, YALNIZ kurucunun
// makinesinde (depoya girmez). Yalnız mühürlü final koşusunda ve dosyanın SHA-256'sı `SEALS.json`daki
// "local-only" kaydıyla eşleşirse okunur; rapora METİN girmez (yalnız sayılar ve "r-0001" gibi sıra kimlikleri).
const REAL_SET = process.env.EVAL_REAL_SET?.trim() ?? "";
if (REAL_SET && !SEALED) throw new Error("EVAL_REAL_SET yalnız mühürlü final koşusunda okunur (EVAL_SEALED_FINAL=1).");
function loadRealSet(file: string): { requests: ReqItem[]; strata?: Record<string, { population: number; labeled: number }> } {
  const bytes = readFileSync(path.resolve(file));
  const seal = seals()["stay-change-real.json"];
  if (!seal || seal.location !== "local-only" || seal.state !== "sealed") {
    throw new Error("gerçek set için mühür kaydı yok (SEALS.json → stay-change-real.json: location local-only, state sealed).");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== seal.sha256) throw new Error("gerçek setin SHA-256'sı mühürle eşleşmiyor.");
  const ds = JSON.parse(bytes.toString("utf8")) as {
    source?: string;
    requests?: ReqItem[];
    strata?: Record<string, { population: number; labeled: number }>;
  };
  if (ds.source !== "real-anonymized" || !Array.isArray(ds.requests)) throw new Error("gerçek set tanınmadı.");
  return { requests: ds.requests, strata: ds.strata };
}
const real = REAL_SET ? loadRealSet(REAL_SET) : null;
const data = real ? { ...base, requests: [...base.requests, ...real.requests] } : base;
const SPLITS = SEALED ? (real ? ["final", "real"] : ["final"]) : ["dev", "holdout"];
const LIMIT = Number(process.env.EVAL_STAY_LIMIT) > 0 ? Math.trunc(Number(process.env.EVAL_STAY_LIMIT)) : Infinity;
const CONCURRENCY = 4;

/** Tablo anahtarının bölüm kısmı: gerçek sette katmanla birlikte ("real/candidate") — oranlar yeniden ağırlıklanabilsin. */
const splitKey = (r: { split: string; stratum?: string }) => (r.stratum ? `${r.split}/${r.stratum}` : r.split);

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
      add(req, `${splitKey(r)}|${r.kind === "none" ? "none(doğru=yok)" : "istek(doğru=var)"}`, r.kind === "none" ? !hit : hit);
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
      const unionReq = new Map<string, Tally>();
      const guardRep = new Map<string, Tally>();
      // Karar ölçüleri (dilim 9): bölüm başına birleşim satırları — tehlikeli kaçak · gereksiz inceleme · bilgi sorusu ↔
      // izin · bilinmiyor · katman gerekliliği (`stay-metrics.ts`, saf; metin taşımaz).
      const unionRows = new Map<string, UnionRow[]>();
      // "Başka gün" işareti sabit bir güne göre (eval deterministik): tarih / gün adı / "yarın" metni somut istek sayılır.
      const EVAL_NOW = new Date("2026-10-14T09:00:00.000Z");
      // Örnek sınırı BÖLÜM BAŞINA: dev önce geldiği için düz `slice` holdout'u hiç ölçmezdi (inceleme 09-24).
      const perSplit = <T extends { split: string }>(xs: T[]) =>
        Number.isFinite(LIMIT) ? SPLITS.flatMap((sp) => xs.filter((x) => x.split === sp).slice(0, LIMIT)) : xs;
      const reqs = perSplit(data.requests);
      const reps = perSplit(data.replies);

      await pool(reqs, async (r) => {
        const stayTimes = { checkIn: r.checkIn, checkOut: r.checkOut };
        const truth = r.kind !== "none";
        let guardSaid: boolean | null = null;
        let nluSaid: boolean | null = null;
        const g = await runStayChangeGuard({ guestMessages: [r.text], reply: "Thank you for your message.", stayTimes });
        if (g?.status !== "ok") failures++;
        else {
          const v: StayGuardVerdict = g.verdict;
          const said = v.guestRequestsChange || slotTimesShifted({ checkinTime: v.requestedCheckinTime, checkoutTime: v.requestedCheckoutTime }, stayTimes);
          guardSaid = said;
          add(guardReq, `${splitKey(r)}|${truth ? "istek" : "none"}|${r.lang}`, said === truth);
          rows.push({ layer: "guard-req", id: r.id, truth, said });
        }
        const u = await understandGuestMessages({ guestMessage: r.text, stayTimes });
        if (u.status !== "ok") failures++;
        else {
          const said = u.value.stay.requested || slotTimesShifted(u.value.stay, stayTimes);
          nluSaid = said;
          add(nluReq, `${splitKey(r)}|${truth ? "istek" : "none"}|${r.lang}`, said === truth);
          rows.push({ layer: "nlu-req", id: r.id, truth, said, intents: u.value.requests.map((x) => x.intent) });
        }
        const lexicalKinds = detectAvailabilityRequestKinds(r.text);
        const bucket = unionRows.get(splitKey(r)) ?? [];
        bucket.push({
          kind: r.kind,
          lexical: detectAvailabilityRequest(r.text) !== null,
          lexicalKinds,
          guard: guardSaid,
          nlu: nluSaid,
          intents: u.status === "ok" ? u.value.requests.map((x) => x.intent) : [],
          concrete: explicitTimeMentions(r.text).length > 0 || mentionsAnotherDay([r.text], EVAL_NOW, "Europe/Istanbul"),
        });
        unionRows.set(splitKey(r), bucket);
        // BİRLEŞİM (09-24 değişmezi): hiçbir katmanın "istek yok"u başka bir katmanın isteğini silemez → ürünün
        // tutuşu kelime ağı ∨ bekçi ∨ anlama. Yalnız iki model de koştuysa sayılır (düşen çağrı zaten GEÇERSİZ).
        if (guardSaid !== null && nluSaid !== null) {
          const said = detectAvailabilityRequest(r.text) !== null || guardSaid || nluSaid;
          add(unionReq, `${splitKey(r)}|${truth ? "istek (doğru = tutuldu)" : "none (doğru = gitti; yanlış = GEREKSİZ İNCELEME)"}`, said === truth);
          rows.push({ layer: "union-req", id: r.id, truth, said });
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
      table("BİRLEŞİM — kelime ağı ∨ bekçi ∨ anlama (ürünün tutuşu)", unionReq);
      lines.push(
        "`none` satırında yanlış kalan pay = gereksiz insan incelemesi (kurucu: özellikle bakılacak oran). ALT SINIRDIR:",
        "cevap modelinin beyanı ve konu etiketi (`ri`) bu harness'ta koşmaz; canlıda `sc` kanıtıyla ayrıca ölçülür",
        "(`docs/ANLAM-KATMANI-2026-09-24.md` §2.2).",
        "",
      );
      table("Bekçi — cevap duruşu (claim/grant durmalı; erteleme/teklif/tarafsız gitmeli)", guardRep);
      for (const [sp, rs] of [...unionRows].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(...unionMetricsLines(`Karar ölçüleri — ${sp} (cevap modeli beyanı / konu etiketi hariç: alt sınır)`, summarizeUnion(rs)));
      }
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
    // Model kıyası (09-25): aynı gün iki modelin koşusu birbirini EZMESİN → mühürsüz raporun adı modeli taşır.
    const modelTag = semanticModel().replace(/[^a-z0-9.-]+/gi, "_");
    const name = SEALED ? `stay-change-FINAL-eval-${stamp}.md` : `stay-change-eval-${stamp}-${modelTag}.md`;
    const status = failures > 0 ? `GEÇERSİZ — ${failures} çağrı düştü` : "GEÇERLİ";
    const head = [
      `# Konaklama değişikliği anlam katmanı — eval (${stamp})`,
      "",
      `Durum: **${status}** · veri sürümü ${data.version} · istek ${data.requests.length} · cevap ${data.replies.length}` +
        (Number.isFinite(LIMIT) ? ` · örnek sınırı ${LIMIT}` : ""),
      `Model: \`${semanticModel()}\` · reasoning_effort: ${semanticReasoningEffort() ?? "model varsayılanı"}`,
      "",
      SEALED
        ? "🚨 MÜHÜRLÜ FİNAL KOŞUSU: genelleme ölçüsü bu raporun TAMAMIdır. Koşu bitti → set YANDI (`evals/sealed/SEALS.json` durumu `burned`; sonraki karar için yeni kör set)."
        : "Bu rapordaki `dev` ve `holdout` bölümleri GÖRÜLDÜ (dev: düzeltmelerde; holdout: 09-24 denetimlerinde ölçüldü) — gelişme göstergesidir, son açma kararı yalnız mühürlü final setiyle (`docs/EVAL-MUHURLU-FINAL.md`).",
      ...(real
        ? [
            "",
            `Gerçek set (B): ${real.requests.length} misafir mesajı (bölüm \`real\`) — kurucunun hesabından, anonim, yalnız yerel; metin bu rapora girmez. Bu koşuyla o da YANDI.`,
            ...(real.strata
              ? [
                  `Katman evreni (yeniden ağırlıklandırma için): ${Object.entries(real.strata)
                    .map(([k, v]) => `${k} ${v.labeled}/${v.population}`)
                    .join(" · ")} (etiketli / evren).`,
                ]
              : []),
          ]
        : []),
      "",
    ];
    writeFileSync(path.join(dir, name), [...head, ...lines].join("\n"), "utf8");
    writeSidecar(dir, name, { suite: "stay-change", version: data.version, meta: { status, failures, enabled }, rows });
  });
});
