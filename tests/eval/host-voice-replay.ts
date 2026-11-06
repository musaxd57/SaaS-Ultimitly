/* ---------------------------------------------------------------------------
 * EV SAHİBİNİN SESİ — TEKRAR OYNATMA, ÜCRETSİZ ÖLÇÜM (kurucu 11-06: "misafire 3. şahıs gitmesin ama yasaklamak AI cevaplarını bozmasın;
 * testler çalıştır, kontroller sağla").
 *
 *   npx tsx --tsconfig tsconfig.json tests/eval/host-voice-replay.ts
 *
 * Model ÇAĞRILMAZ, veritabanı yok: `docs/olcum/*.json` yan dosyalarındaki GERÇEK model cevapları, gönderim kapısının metne bakan sırasıyla
 * geçirilir: önce "ev sahibinize yazın" süzgeci (`stripHostContactFiller`, cümleyi siler), sonra ev sahibinin sesi denetçisi
 * (`hostVoiceViolation`, kapı ayrıntısı `reply_host_voice` — cevabın TAMAMI ev sahibine kalır). Sayılanlar: kaç cevap ham hâliyle üçüncü
 * şahıs taşıyor, süzgeç kaçını kurtarıyor (cümle silinir, kalan cevap gider), kaçı denetçiye takılıp ev sahibine kalıyor (tür ve dil
 * başına, 10-30 istem değişikliğinden önce / sonra ayrı), en sık üçüncü şahıs cümleleri (kısaltılmış).
 * 🚨 Adında kör / kabul / blind / holdout / acceptance / sealed geçen ölçüm dosyaları OKUNMAZ (yasak set kuralı).
 * Yan dosyalar ölçüm setlerinin (kurgusal "Lale" fikstürü) çıktısıdır.
 * ------------------------------------------------------------------------- */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stripHostContactFiller } from "../../src/lib/ai/host-contact-filler";
import { hostVoiceViolation } from "../../src/lib/ai/host-voice-guard";
import { vetoOutgoingReply } from "../../src/lib/ai/output-veto";
import { admitsMissingKnowledge } from "../../src/lib/ai/absence";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(__dirname, "..", "..");
const OLCUM = path.join(REPO, "docs", "olcum");
const FORBIDDEN_NAME = /blind|holdout|kabul|acceptance|sealed|(?:^|[-_.])k[oö]r(?:[-_.]|$)/i;
/** Tekrar oynatmaların kendi çıktıları (örnek cevaplar taşır) ölçüme girmez. */
const REPLAY_OUTPUT = /^(?:host-voice-replay|host-contact-replay)-/;
/** Ev sahibi sesi istem katmanı (K-1029-A) ve denetçi 10-30'da geldi. */
const PROMPT_CHANGE_DAY = "2026-10-30";
const GUEST_FIELDS = ["guest", "guestMessage", "asked", "message", "question"] as const;

type Sample = { reply: string; guest: string | null; lang: string | null; file: string; day: string | null };

export function isForbiddenMeasurementFile(name: string): boolean {
  return FORBIDDEN_NAME.test(name);
}

function collect(): { samples: Sample[]; filesRead: number; filesSkipped: number } {
  const seen = new Set<string>();
  const samples: Sample[] = [];
  let filesRead = 0;
  let filesSkipped = 0;
  for (const f of readdirSync(OLCUM).filter((n) => n.endsWith(".json")).sort()) {
    if (REPLAY_OUTPUT.test(f)) continue;
    if (isForbiddenMeasurementFile(f)) {
      filesSkipped++;
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(path.join(OLCUM, f), "utf8"));
    } catch {
      continue;
    }
    filesRead++;
    const day = /20\d\d-\d\d-\d\d/.exec(f)?.[0] ?? null;
    const walk = (o: unknown, depth: number): void => {
      if (depth > 6 || o === null || typeof o !== "object") return;
      if (Array.isArray(o)) {
        for (const v of o) walk(v, depth + 1);
        return;
      }
      const rec = o as Record<string, unknown>;
      if (typeof rec.reply === "string" && rec.reply.trim() && !seen.has(rec.reply)) {
        seen.add(rec.reply);
        const g = GUEST_FIELDS.map((k) => rec[k]).find((v): v is string => typeof v === "string" && v.trim().length > 0) ?? null;
        samples.push({ reply: rec.reply, guest: g, lang: typeof rec.lang === "string" ? rec.lang : null, file: f, day });
      }
      for (const v of Object.values(rec)) walk(v, depth + 1);
    };
    walk(data, 0);
  }
  return { samples, filesRead, filesSkipped };
}

const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\s+/g, " ");

/** Üçüncü şahıs taşıyan ilk cümle (sık kalıpları saymak için; denetçinin cümle bölümüyle aynı kaba kural). */
function firstThirdPersonSentence(text: string): string | null {
  for (const s of text.split(/(?<=[.!?؟])\s+|\n+/u)) if (s.trim() && hostVoiceViolation(s) === "host_third_person") return s.trim();
  return null;
}

/**
 * `heldOnlyByVoice`: kapının metne bakan ÖBÜR iki kuralı (çıktı vetosu — devir / bildirim / "ev sahibinizin kararı" cümlesi, söz, yer tutucu…;
 * "bilgim yok" itirafı) cevabı tutmazdı, YALNIZ ev sahibi sesi denetçisi tuttu — denetçinin gerçek bedeli (gidebilecek bir cevap ev sahibine kaldı).
 */
type Bucket = {
  replies: number;
  rawThird: number;
  rescuedByFilter: number;
  held: number;
  heldThird: number;
  heldInternal: number;
  heldReferral: number;
  heldOnlyByVoice: number;
};
const bucket = (): Bucket => ({ replies: 0, rawThird: 0, rescuedByFilter: 0, held: 0, heldThird: 0, heldInternal: 0, heldReferral: 0, heldOnlyByVoice: 0 });

function main(): void {
  const { samples, filesRead, filesSkipped } = collect();
  const all = bucket();
  const before = bucket();
  const after = bucket();
  const byLang: Record<string, Bucket> = {};
  const phrases = new Map<string, number>();
  const onlyVoicePhrases = new Map<string, number>();
  const onlyVoiceExamples: { file: string; reply: string; kind: string }[] = [];
  const heldExamples: { file: string; reply: string; kind: string }[] = [];
  const rescuedExamples: { file: string; before: string; after: string }[] = [];

  for (const s of samples) {
    const period = s.day && s.day >= PROMPT_CHANGE_DAY ? after : before;
    const lang = (byLang[s.lang ?? "?"] ??= bucket());
    const buckets = [all, period, lang];
    for (const b of buckets) b.replies++;
    const raw = hostVoiceViolation(s.reply);
    if (raw === "host_third_person") for (const b of buckets) b.rawThird++;
    const filtered = stripHostContactFiller(s.reply, s.guest ? [s.guest] : []);
    // Süzgeç cevabın TAMAMINI ev sahibine bırakıyorsa (geriye içerik kalmadı) o cevap bu ölçümün değil süzgeç ölçümünün konusu.
    if (filtered.hostContactOnly) continue;
    const v = hostVoiceViolation(filtered.text);
    if (raw === "host_third_person" && v === null) {
      for (const b of buckets) b.rescuedByFilter++;
      if (rescuedExamples.length < 8) rescuedExamples.push({ file: s.file, before: short(s.reply), after: short(filtered.text) });
    }
    if (v !== null) {
      for (const b of buckets) {
        b.held++;
        if (v === "host_third_person") b.heldThird++;
        else if (v === "internal_system") b.heldInternal++;
        else b.heldReferral++;
      }
      if (heldExamples.length < 15) heldExamples.push({ file: s.file, reply: short(s.reply), kind: v });
      const otherRuleHolds = vetoOutgoingReply(filtered.text) !== null || admitsMissingKnowledge(filtered.text);
      if (!otherRuleHolds) {
        for (const b of buckets) b.heldOnlyByVoice++;
        if (onlyVoiceExamples.length < 25) onlyVoiceExamples.push({ file: s.file, reply: short(s.reply, 220), kind: v });
        const sentence = v === "host_third_person" ? firstThirdPersonSentence(filtered.text) : null;
        if (sentence) {
          const key = short(sentence.toLocaleLowerCase("tr"), 110);
          onlyVoicePhrases.set(key, (onlyVoicePhrases.get(key) ?? 0) + 1);
        }
      }
      if (v === "host_third_person") {
        const sentence = firstThirdPersonSentence(filtered.text);
        if (sentence) {
          const key = short(sentence.toLocaleLowerCase("tr"), 90);
          phrases.set(key, (phrases.get(key) ?? 0) + 1);
        }
      }
    }
  }

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");
  const row = (name: string, b: Bucket) =>
    `| ${name} | ${b.replies} | ${b.rawThird} (${pct(b.rawThird, b.replies)}) | ${b.rescuedByFilter} | ${b.held} (${pct(b.held, b.replies)}) | ${b.heldThird} | ${b.heldInternal} | ${b.heldReferral} | ${b.heldOnlyByVoice} (${pct(b.heldOnlyByVoice, b.replies)}) |`;
  const topOnlyVoice = [...onlyVoicePhrases.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const topPhrases = [...phrases.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  // Model çağrısı yok → çalışma kimliği yalnız kod sürümü (run-meta.ts sunucu modülü yükler; bu tekrar oynatma ona gerek duymaz).
  let commit = "?";
  try {
    commit = execFileSync("git", ["-C", REPO, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    /* git yoksa kimlik "?" */
  }
  const runtime = { commit, models: "yok (tekrar oynatma)" };
  const day = new Date().toISOString().slice(0, 10);
  const json = { day, filesRead, filesSkipped, all, before, after, byLang, topPhrases, topOnlyVoice, heldExamples, onlyVoiceExamples, rescuedExamples, runtime };
  writeFileSync(path.join(OLCUM, `host-voice-replay-${day}.json`), `${JSON.stringify(json, null, 2)}\n`);
  const md = [
    `# Ev sahibinin sesi — tekrar oynatma (${day}, ücretsiz, model çağrısı yok)`,
    "",
    `Okunan ölçüm dosyası: ${filesRead} · yasak adlı (kör / kabul / blind / acceptance …) atlanan: ${filesSkipped} · tekil cevap: ${all.replies}.`,
    `Sıra gönderim kapısıyla aynı: "ev sahibinize yazın" süzgeci cümleyi siler → kalan metinde ev sahibi sesi denetçisi (\`reply_host_voice\`).`,
    "",
    "| Küme | Cevap | Ham üçüncü şahıs | Süzgeç kurtardı | Ev sahibine kalır | · üçüncü şahıs | · arka plan anlatımı | · başka işletme | YALNIZ bu denetçi tuttu |",
    "|---|---|---|---|---|---|---|---|---|",
    row("Hepsi", all),
    row(`${PROMPT_CHANGE_DAY} öncesi ölçümler`, before),
    row(`${PROMPT_CHANGE_DAY} ve sonrası`, after),
    ...Object.entries(byLang)
      .sort((a, b) => b[1].replies - a[1].replies)
      .slice(0, 8)
      .map(([k, b]) => row(`dil: ${k}`, b)),
    "",
    "## En sık üçüncü şahıs cümleleri (ev sahibine kalan cevaplarda)",
    ...topPhrases.map(([p, n]) => `- ${n}× ${p}`),
    "",
    "## YALNIZ bu denetçinin tuttuğu cevaplardaki üçüncü şahıs cümleleri (öbür kurallar göndermeye izin verirdi)",
    ...topOnlyVoice.map(([p, n]) => `- ${n}× ${p}`),
    "",
    "## YALNIZ bu denetçinin tuttuğu örnek cevaplar",
    ...onlyVoiceExamples.map((e) => `- \`${e.file}\` (${e.kind}): ${e.reply}`),
    "",
    "## Süzgecin kurtardığı örnekler (cümle silinir, kalan cevap gider)",
    ...rescuedExamples.map((e) => `- \`${e.file}\`\n  - önce: ${e.before}\n  - sonra: ${e.after}`),
    "",
    "## Ev sahibine kalan örnekler",
    ...heldExamples.map((e) => `- \`${e.file}\` (${e.kind}): ${e.reply}`),
    "",
    `Çalışma: kod ${runtime.commit} · model çağrısı yok.`,
    "",
  ].join("\n");
  writeFileSync(path.join(OLCUM, `host-voice-replay-${day}.md`), md);
  console.log(md.split("\n").slice(0, 16).join("\n"));
}

if (process.argv[1] && /host-voice-replay\.ts$/.test(process.argv[1])) main();
