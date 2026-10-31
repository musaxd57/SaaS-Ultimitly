/* ---------------------------------------------------------------------------
 * GERÇEK MESAJ SETİ — KÖR ETİKETLEME (09-24). Kurucunun makinesinde, veritabanına HİÇ bağlanmadan çalışır.
 *
 *   npx tsx scripts/eval-real-label.ts              etiketle (her cevaptan sonra kaydeder; q ile çık, sonra devam)
 *   npx tsx scripts/eval-real-label.ts --finalize   bitince eval setini oluştur + SHA-256'yı yaz
 *
 * Araç hiçbir model ya da kelime ağı tahmini GÖSTERMEZ; öğenin hangi katmandan geldiğini de göstermez (kör).
 * Dosyalar yalnız git'in yok saydığı `evals/private/` altında. Kural metni: `src/lib/eval-real/labeling.ts`.
 * ------------------------------------------------------------------------- */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  applyLabelAction,
  bindLabelFile,
  buildRealDataset,
  guardedOutputPath,
  LABEL_RUBRIC,
  resumeIndex,
  type CandidateFile,
  type LabelFile,
  type LabelState,
} from "../src/lib/eval-real/labeling";
import { gitIgnoredIn } from "./eval-real-shared";

const REPO = path.resolve(__dirname, "..");
const gitIgnored = gitIgnoredIn(REPO);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}


/** Yarıda kesilse bile bozuk dosya bırakmayan yazma (geçici dosya + yeniden adlandırma). */
function writeAtomic(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}

async function main(): Promise<void> {
  const inPath = path.resolve(REPO, arg("--in") ?? "evals/private/real-candidates.json");
  const labelsPath = guardedOutputPath(REPO, arg("--labels") ?? "evals/private/real-labels.json", gitIgnored);
  const candidatesBytes = readFileSync(inPath);
  const candidatesSha256 = createHash("sha256").update(candidatesBytes).digest("hex");
  const file = JSON.parse(candidatesBytes.toString("utf8")) as CandidateFile;
  if (file.kind !== "lixus-real-candidates" || !Array.isArray(file.items)) throw new Error("aday dosyası tanınmadı");
  // Etiketler YALNIZ ait oldukları aday dosyasıyla kullanılır (yeniden üretilmiş dosyaya sessizce oturmasın).
  const bound = bindLabelFile(existsSync(labelsPath) ? JSON.parse(readFileSync(labelsPath, "utf8")) : null, candidatesSha256);
  const labels = bound.labels;
  const saveLabels = (next: LabelState) => {
    const lf: LabelFile = { kind: "lixus-real-labels", candidatesSha256, labels: next.labels };
    writeAtomic(labelsPath, `${JSON.stringify(lf, null, 1)}\n`);
  };

  if (process.argv.includes("--finalize")) {
    const out = guardedOutputPath(REPO, arg("--out") ?? "evals/private/stay-change-real.json", gitIgnored);
    const ds = buildRealDataset(file, bound);
    const json = `${JSON.stringify(ds, null, 1)}\n`;
    writeAtomic(out, json);
    const byKind = new Map<string, number>();
    for (const r of ds.requests) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    console.log(`Set: ${ds.requests.length} mesaj · ${[...byKind].map(([k, n]) => `${k} ${n}`).join(" · ")}`);
    console.log(`Çıkarılan: kişisel bilgi ${ds.excluded.pii} · emin değilim ${ds.excluded.unsure} · etiketsiz ${ds.excluded.unlabeled}`);
    console.log(`Yazıldı: ${path.relative(REPO, out)}`);
    console.log(`SHA-256: ${createHash("sha256").update(json).digest("hex")}`);
    console.log("Bu SHA-256'yı Claude'a iletin (ya da evals/sealed/SEALS.json'a 'local-only' kaydı olarak ekleyin). Dosyayı PAYLAŞMAYIN.");
    return;
  }

  let state: LabelState = { labels, index: resumeIndex(file.items, labels) };
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));
  console.clear();
  console.log(LABEL_RUBRIC.join("\n"));
  await ask("\nBaşlamak için Enter… ");
  while (state.index < file.items.length) {
    const it = file.items[state.index];
    console.clear();
    console.log(`${state.index + 1} / ${file.items.length}   (standart giriş ${it.checkIn} · çıkış ${it.checkOut})\n`);
    console.log(it.text);
    console.log("\n0 yok · 1 ek gece · 2 erken giriş · 3 geç çıkış · 4 tarih değişikliği · 5 müsaitlik · x kişisel bilgi · s emin değilim · b geri · q çık");
    const key = (await ask("> ")).trim().toLowerCase();
    if (key === "q") break;
    const next = applyLabelAction(state, file.items, key === "b" ? { type: "back" } : { type: "key", key });
    if (next !== state) saveLabels(next);
    state = next;
  }
  rl.close();
  const done = Object.keys(state.labels).length;
  console.log(`\nKaydedildi: ${done} / ${file.items.length} etiket. ${done === file.items.length ? "Bitti — şimdi --finalize ile seti oluşturun." : "Aynı komutla kaldığınız yerden devam edin."}`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`Durdu: ${err instanceof Error ? err.message : "bilinmeyen hata"}`);
    process.exit(1);
  });
}
